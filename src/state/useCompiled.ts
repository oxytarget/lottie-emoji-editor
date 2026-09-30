import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtStyle, VectorArt } from '../content/art';
import { DEFAULT_FONT_ID, hasFont, loadFont, type LoadedFont } from '../content/fonts';
import { svgToArt, type SvgImportResult } from '../content/svg';
import { textToArt } from '../content/text';
import type { TgsCheck } from '../lottie/export';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import type { Localized } from '../templates/types';
import { compileAll, type CompileInput, type CompileOutput } from './compile';
import { useEditor } from './store';

export interface CompiledEmoji {
  id: string;
  name: Localized | string;
  /** Lottie JSON (without the TGS marker). */
  json: string;
  check: TgsCheck;
  imported: boolean;
  /** Emoji the custom emoji is linked to when added to a pack. */
  emoji: string;
}

export interface Compiled {
  emojis: CompiledEmoji[];
  byId: Map<string, CompiledEmoji>;
  missingChars: string[];
  fontLoading: boolean;
  fontError: boolean;
  svg: SvgImportResult | null;
  /** True while newer edits are still being compiled. */
  pending: boolean;
}

function useFont(fontId: string) {
  const id = hasFont(fontId) ? fontId : DEFAULT_FONT_ID;
  const [state, setState] = useState<{ id: string; font: LoadedFont | null; error: boolean }>({ id: '', font: null, error: false });
  useEffect(() => {
    let alive = true;
    loadFont(id)
      .then((font) => alive && setState({ id, font, error: false }))
      .catch(() => alive && setState((s) => ({ ...s, id, error: true })));
    return () => {
      alive = false;
    };
  }, [id]);
  return { font: state.font, loading: state.id !== id, error: state.error };
}

type Runner = (input: CompileInput, done: (out: CompileOutput[]) => void) => void;

/**
 * Compiles in a Web Worker, always keeping at most one job in flight and only the newest
 * waiting input — fast typing never queues up stale work. Falls back to the main thread.
 */
function useCompileRunner(): Runner {
  const ref = useRef<Runner | null>(null);
  if (!ref.current) {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    let busy = false;
    let seq = 0;
    let queued: { input: CompileInput; done: (out: CompileOutput[]) => void } | null = null;
    let current: ((out: CompileOutput[]) => void) | null = null;
    let lastInput: CompileInput | null = null;

    const runLocal = (input: CompileInput, done: (out: CompileOutput[]) => void) => {
      busy = true;
      setTimeout(() => {
        const out = compileAll(input);
        busy = false;
        done(out);
        flush();
      }, 0);
    };

    const flush = () => {
      if (busy || !queued) return;
      const { input, done } = queued;
      queued = null;
      if (!worker) return runLocal(input, done);
      busy = true;
      current = done;
      worker.postMessage({ seq: ++seq, input });
    };

    if (worker) {
      worker.onmessage = (e: MessageEvent<{ seq: number; output?: CompileOutput[]; error?: string }>) => {
        busy = false;
        if (e.data.output && current) current(e.data.output);
        else if (e.data.error) console.error('Compile failed:', e.data.error);
        flush();
      };
      worker.onerror = (e) => {
        // The worker could not start (e.g. blocked by CSP) — continue on the main thread.
        console.warn('Compile worker unavailable, falling back to main thread', e.message);
        worker?.terminate();
        worker = null;
        busy = false;
        const pendingDone = current;
        current = null;
        if (pendingDone && !queued && lastInput) queued = { input: lastInput, done: pendingDone };
        flush();
      };
    }

    ref.current = (input, done) => {
      lastInput = input;
      queued = { input, done };
      flush();
    };
  }
  return ref.current;
}

/** Turns the editor state into ready-to-export Lottie animations for every template. */
export function useCompiled(): Compiled {
  const s = useEditor();
  const { font, loading, error } = useFont(s.fontId);

  const textResult = useMemo(() => {
    if (!font) return { art: null, missing: [] as string[] };
    return textToArt(font, { text: s.text, letterSpacing: s.letterSpacing, lineHeight: s.lineHeight, uppercase: s.uppercase });
  }, [font, s.text, s.letterSpacing, s.lineHeight, s.uppercase]);

  const svg = useMemo(() => (s.logo ? svgToArt(s.logo.svg) : null), [s.logo]);
  const art: VectorArt | null = s.mode === 'logo' ? svg?.art ?? null : textResult.art;

  const artStyle: ArtStyle = useMemo(() => {
    if (s.mode === 'logo') {
      return {
        mode: s.logoColors,
        fill: s.textFill,
        outline: s.logoOutline ? s.textOutline : null,
        outlineWidth: s.logoOutline ? s.textOutlineWidth : 0,
      };
    }
    return { mode: 'paint', fill: s.textFill, outline: s.textOutline, outlineWidth: s.textOutlineWidth };
  }, [s.mode, s.logoColors, s.logoOutline, s.textFill, s.textOutline, s.textOutlineWidth]);

  const input: CompileInput = useMemo(
    () => ({
      art,
      artStyle,
      colors: s.colors,
      outlineWidth: s.outlineWidth,
      scale: s.scale,
      offsetY: s.offsetY,
      imports: s.imports.map(({ id, data, colorMap, overlay, hidden, replace }) => ({ id, data, colorMap, overlay, hidden, replace })),
    }),
    [art, artStyle, s.colors, s.outlineWidth, s.scale, s.offsetY, s.imports],
  );

  const run = useCompileRunner();
  const [result, setResult] = useState<{ input: CompileInput | null; output: CompileOutput[] }>({ input: null, output: [] });

  useEffect(() => {
    run(input, (output) => setResult({ input, output }));
  }, [input, run]);

  const names = useMemo(() => {
    const m = new Map<string, { name: Localized | string; imported: boolean; emoji: string }>();
    for (const t of BUILTIN_TEMPLATES) m.set(t.id, { name: t.name, imported: false, emoji: t.emoji });
    for (const i of s.imports) m.set(i.id, { name: i.name, imported: true, emoji: '⭐' });
    return m;
  }, [s.imports]);

  const emojis = useMemo(
    () =>
      result.output.flatMap((o) => {
        const meta = names.get(o.id);
        return meta ? [{ id: o.id, name: meta.name, json: o.json, check: o.check, imported: meta.imported, emoji: meta.emoji }] : [];
      }),
    [result.output, names],
  );
  const byId = useMemo(() => new Map(emojis.map((e) => [e.id, e])), [emojis]);

  return {
    emojis,
    byId,
    missingChars: s.mode === 'text' ? textResult.missing : [],
    fontLoading: loading,
    fontError: error,
    svg,
    pending: result.input !== input,
  };
}
