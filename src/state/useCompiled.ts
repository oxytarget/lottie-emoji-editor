import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtStyle, VectorArt } from '../content/art';
import { DEFAULT_FONT_ID, hasFont, loadFont, type LoadedFont } from '../content/fonts';
import { svgToArt, type SvgImportResult } from '../content/svg';
import { textToArt } from '../content/text';
import type { TgsCheck } from '../lottie/export';
import { BUILTIN_TEMPLATES } from '../templates/builtin';
import type { Localized } from '../templates/types';
import { createCompiler, type CompileInput, type CompileOutput } from './compile';
import { useEditor } from './store';
import { useUi } from './ui';

export interface CompiledEmoji {
  id: string;
  name: Localized | string;
  /** Lottie JSON (without the TGS marker). */
  json: string;
  check: TgsCheck;
  imported: boolean;
  /** Emoji the custom emoji is linked to when added to a pack. */
  emoji: string;
  /** Preview JSON with part classes (the active imported animation only). */
  preview?: string;
  /** Telegram pack the template comes from. */
  pack?: string;
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
  /** Current compile input (for instant single-template previews). */
  input: CompileInput;
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

type Runner = (input: CompileInput, keep: string[], done: (out: CompileOutput[]) => void) => void;

/**
 * Compiles in a Web Worker, always keeping at most one job in flight and only the newest
 * waiting input — fast typing never queues up stale work. Imported animations are sent to the
 * worker once. Falls back to the main thread.
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
    const local = createCompiler();
    /** Animations the worker already holds (by id → the exact object sent). */
    const sent = new Map<string, unknown>();
    let busy = false;
    let seq = 0;
    type Job = { input: CompileInput; keep: string[]; done: (out: CompileOutput[]) => void };
    let queued: Job | null = null;
    let current: Job | null = null;

    const runLocal = ({ input, keep, done }: Job) => {
      busy = true;
      setTimeout(() => {
        const out = local.compile(input, keep);
        busy = false;
        done(out);
        flush();
      }, 0);
    };

    const flush = () => {
      if (busy || !queued) return;
      const job = queued;
      queued = null;
      if (!worker) return runLocal(job);
      busy = true;
      current = job;
      const alive = new Set(job.keep);
      for (const id of sent.keys()) if (!alive.has(id)) sent.delete(id);
      const imports = job.input.imports.map((imp) => {
        if (sent.get(imp.id) === imp.data) return { ...imp, data: undefined };
        sent.set(imp.id, imp.data);
        return imp;
      });
      worker.postMessage({ seq: ++seq, input: { ...job.input, imports }, keep: job.keep });
    };

    if (worker) {
      worker.onmessage = (e: MessageEvent<{ seq: number; output?: CompileOutput[]; error?: string }>) => {
        busy = false;
        const job = current;
        current = null;
        if (e.data.output && job) job.done(e.data.output);
        else if (e.data.error) console.error('Compile failed:', e.data.error);
        flush();
      };
      worker.onerror = (e) => {
        // The worker could not start (e.g. blocked by CSP) — continue on the main thread.
        console.warn('Compile worker unavailable, falling back to main thread', e.message);
        worker?.terminate();
        worker = null;
        busy = false;
        const job = current;
        current = null;
        if (job && !queued) queued = job;
        flush();
      };
    }

    ref.current = (input, keep, done) => {
      queued = { input, keep, done };
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

  // Pack stickers are compiled only while on screen, selected or open in the preview.
  const visible = useUi((u) => u.visible);
  const compiledIds = useMemo(
    () =>
      s.imports
        .filter((imp) => !imp.source || visible.has(imp.id) || s.selected.includes(imp.id) || s.active === imp.id)
        .map((imp) => imp.id)
        .join('\n'),
    [s.imports, visible, s.selected, s.active],
  );
  const importsInput = useMemo(() => {
    const ids = new Set(compiledIds.split('\n'));
    return s.imports
      .filter((imp) => ids.has(imp.id))
      .map(({ id, data, colorMap, overlay, hidden, replace, transforms }) => ({ id, data, colorMap, overlay, hidden, replace, transforms }));
  }, [s.imports, compiledIds]);
  const keep = useMemo(() => s.imports.map((imp) => imp.id), [s.imports]);
  const annotate = s.imports.some((imp) => imp.id === s.active) ? s.active : null;

  const input: CompileInput = useMemo(
    () => ({
      art,
      artStyle,
      colors: s.colors,
      outlineWidth: s.outlineWidth,
      scale: s.scale,
      offsetY: s.offsetY,
      offsetX: s.offsetX,
      rotation: s.rotation,
      imports: importsInput,
      annotate,
    }),
    [art, artStyle, s.colors, s.outlineWidth, s.scale, s.offsetY, s.offsetX, s.rotation, importsInput, annotate],
  );

  const run = useCompileRunner();
  // Results are merged: stickers scrolled away keep their last build until they are shown again.
  const [result, setResult] = useState<{ input: CompileInput | null; outputs: ReadonlyMap<string, CompileOutput> }>({ input: null, outputs: new Map() });

  useEffect(() => {
    run(input, keep, (output) =>
      setResult((prev) => {
        const alive = new Set([...BUILTIN_TEMPLATES.map((t) => t.id), ...keep]);
        const outputs = new Map([...prev.outputs].filter(([id]) => alive.has(id)));
        for (const o of output) outputs.set(o.id, o);
        return { input, outputs };
      }),
    );
  }, [input, keep, run]);

  const emojis = useMemo(() => {
    const list: CompiledEmoji[] = [];
    const add = (o: CompileOutput | undefined, meta: Omit<CompiledEmoji, 'id' | 'json' | 'check' | 'preview'>) => {
      if (o) list.push({ id: o.id, json: o.json, check: o.check, preview: o.preview, ...meta });
    };
    for (const t of BUILTIN_TEMPLATES) add(result.outputs.get(t.id), { name: t.name, imported: false, emoji: t.emoji });
    for (const i of s.imports) add(result.outputs.get(i.id), { name: i.name, imported: true, emoji: i.source?.emoji ?? '⭐', pack: i.source?.pack });
    return list;
  }, [result.outputs, s.imports]);
  const byId = useMemo(() => new Map(emojis.map((e) => [e.id, e])), [emojis]);

  return {
    emojis,
    byId,
    missingChars: s.mode === 'text' ? textResult.missing : [],
    fontLoading: loading,
    fontError: error,
    svg,
    pending: result.input !== input,
    input,
  };
}
