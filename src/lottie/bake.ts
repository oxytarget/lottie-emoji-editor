import type { LottieAnimation } from './types';

/**
 * Expressions (After Effects scripts in properties: wiggle, loopOut, time * 360…) are run by the full
 * lottie-web player but not by Telegram (rlottie) nor by the editor's light player — such files look broken
 * there. Baking plays the file once in the full player, records every expression-driven property on each
 * frame and writes the values back as ordinary keyframes (straight runs merged), so the file looks the same
 * everywhere.
 *
 * Expressions are code from whoever made the file, run with `eval` by the player — so the player runs in a
 * sandboxed iframe (its own opaque origin: no storage, no Telegram data, no network) and only numbers come
 * back, checked before use.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A property driven by an expression: `{ a, k, x: "script" }`. */
const isExpressionProp = (o: Json) => typeof o.x === 'string' && o.x.trim() !== '' && 'k' in o;

export function hasExpressions(anim: LottieAnimation): boolean {
  let found = false;
  const visit = (n: unknown): void => {
    if (found) return;
    if (Array.isArray(n)) n.forEach(visit);
    else if (isObj(n)) {
      if (isExpressionProp(n)) found = true;
      else Object.values(n).forEach(visit);
    }
  };
  visit(anim);
  return found;
}

/** Walks two structurally equal trees together, calling `fn` for every expression property. */
function pairs(a: unknown, b: unknown, fn: (a: Json, b: Json) => void): void {
  if (Array.isArray(a) && Array.isArray(b)) a.forEach((x, i) => pairs(x, b[i], fn));
  else if (isObj(a) && isObj(b)) {
    if (isExpressionProp(a)) fn(a, b);
    for (const [k, v] of Object.entries(a)) if (typeof v === 'object' && v !== null) pairs(v, b[k], fn);
  }
}

// ---------------------------------------------------------------------------
// Samples → keyframes
// ---------------------------------------------------------------------------

export interface ShapeValue {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}
export type Sample = number[] | ShapeValue;

const isShape = (s: Sample): s is ShapeValue => !Array.isArray(s);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const points = (v: unknown, n: number): number[][] | null =>
  Array.isArray(v) && v.length === n && v.every((p) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1])) ? v.map((p) => [p[0], p[1]]) : null;

/** A sample from the sandbox, rebuilt from plain numbers (anything else is rejected). */
function cleanSample(s: unknown): Sample | null {
  if (Array.isArray(s)) return s.length > 0 && s.length <= 16 && s.every(num) ? s.map(Number) : null;
  if (!isObj(s) || !Array.isArray(s.v) || s.v.length > 2000) return null;
  const n = s.v.length;
  const v = points(s.v, n);
  const i = points(s.i, n);
  const o = points(s.o, n);
  return v && i && o ? { c: s.c === true, v, i, o } : null;
}

function sameSample(a: Sample, b: Sample, eps = 1e-3): boolean {
  if (isShape(a) || isShape(b)) {
    if (!isShape(a) || !isShape(b) || a.v.length !== b.v.length || a.c !== b.c) return false;
    const flat = (s: ShapeValue) => [...s.v, ...s.i, ...s.o].flat();
    const fb = flat(b);
    return flat(a).every((x, k) => Math.abs(x - fb[k]) <= eps);
  }
  return a.length === b.length && a.every((x, k) => Math.abs(x - b[k]) <= eps);
}

/** Keeps the samples needed to draw the same curve with straight segments (within `eps`). */
function simplify(times: number[], values: number[][], eps: number): number[] {
  const keep = [0];
  let a = 0;
  for (let b = 2; b < values.length; b++) {
    const ok = values.slice(a + 1, b).every((v, off) => {
      const k = a + 1 + off;
      const f = (times[k] - times[a]) / (times[b] - times[a]);
      return v.every((x, d) => Math.abs(values[a][d] + (values[b][d] - values[a][d]) * f - x) <= eps);
    });
    if (!ok) {
      keep.push(b - 1);
      a = b - 1;
    }
  }
  if (values.length > 1) keep.push(values.length - 1);
  return keep;
}

const LINEAR = { o: { x: 0, y: 0 }, i: { x: 1, y: 1 } };

/** The recorded values as a Lottie property (static when nothing changes). */
export function toProp(times: number[], samples: Sample[]): Json {
  const first = samples[0];
  if (samples.every((s) => sameSample(s, first))) return { a: 0, k: isShape(first) ? first : first.length === 1 ? first[0] : first };
  let idx: number[];
  const shapes = samples.filter(isShape);
  // Tolerances far below a pixel/degree/percent: the curve looks the same, the file stays small.
  if (!shapes.length) idx = simplify(times, samples as number[][], 0.05);
  else if (shapes.length === samples.length && shapes.every((x) => x.v.length === shapes[0].v.length && x.c === shapes[0].c)) {
    // Paths with the same vertices tween point by point, like numbers.
    idx = simplify(times, shapes.map((x) => [...x.v, ...x.i, ...x.o].flat()), 0.1);
  } else {
    // Changing vertex counts cannot tween: every change is kept (held).
    idx = samples.flatMap((x, k) => (k === 0 || k === samples.length - 1 || !sameSample(x, samples[k - 1]) ? [k] : []));
  }
  const k = idx.map((j, n) => {
    const s = samples[j];
    const kf: Json = { t: times[j], s: isShape(s) ? [s] : s };
    if (n < idx.length - 1) {
      const next = samples[idx[n + 1]];
      if (isShape(s) && isShape(next) && s.v.length !== next.v.length) kf.h = 1;
      else Object.assign(kf, LINEAR);
    }
    return kf;
  });
  return { a: 1, k };
}

// ---------------------------------------------------------------------------
// The sandboxed player
// ---------------------------------------------------------------------------

/** Plays `data` (expression properties tagged with `__bake`) and returns each one's value on every frame. */
export type Sampler = (job: { data: Json; count: number; frames: number; w: number; h: number }) => Promise<unknown[][]>;

/**
 * Runs inside the sandbox next to lottie-web: finds the player's property objects by their tags (on the
 * property data, on a path item's `ks`/`pt`, or on a keyframed path's first keyframe), plays every frame and
 * posts the values back (paths with tangents made relative again, as files store them).
 */
const SAMPLER_JS = String.raw`(function () {
  function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
  function tagOf(o) {
    var d = o.data;
    if (isObj(d)) {
      if (typeof d.__bake === 'number') return d.__bake;
      if (o.propType === 'shape') {
        var src = isObj(d.ks) ? d.ks : isObj(d.pt) ? d.pt : null;
        if (src && typeof src.__bake === 'number') return src.__bake;
      }
      return undefined;
    }
    var first = Array.isArray(o.keyframes) ? o.keyframes[0] : undefined;
    return o.propType === 'shape' && isObj(first) && typeof first.__bake === 'number' ? first.__bake : undefined;
  }
  function collect(root) {
    var found = new Map(), seen = new Set(), stack = [root];
    while (stack.length) {
      var n = stack.pop();
      if (!n || typeof n !== 'object' || seen.has(n)) continue;
      seen.add(n);
      if (n instanceof Node || ArrayBuffer.isView(n)) continue;
      var tag = tagOf(n);
      if (tag !== undefined && 'v' in n && !found.has(tag)) found.set(tag, n);
      var vals = Array.isArray(n) ? n : Object.values(n);
      for (var i = 0; i < vals.length; i++) if (vals[i] && typeof vals[i] === 'object') stack.push(vals[i]);
    }
    return found;
  }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function read(p) {
    if (p.propType === 'shape') {
      var s = p.v;
      if (!s || !s.v) return null;
      var n = s._length != null ? s._length : s.v.length, v = [], i = [], o = [];
      for (var k = 0; k < n; k++) {
        v.push([r3(s.v[k][0]), r3(s.v[k][1])]);
        i.push([r3(s.i[k][0] - s.v[k][0]), r3(s.i[k][1] - s.v[k][1])]);
        o.push([r3(s.o[k][0] - s.v[k][0]), r3(s.o[k][1] - s.v[k][1])]);
      }
      return { c: !!s.c, v: v, i: i, o: o };
    }
    var mult = p.mult || 1, val = p.v;
    if (typeof val === 'number') return [r3(val / mult)];
    if (val && typeof val.length === 'number') { var out = []; for (var j = 0; j < val.length; j++) out.push(r3(val[j] / mult)); return out; }
    return null;
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var job = e.data;
    try {
      var box = document.createElement('div');
      box.style.cssText = 'width:' + job.w + 'px;height:' + job.h + 'px';
      document.body.appendChild(box);
      var anim = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: false, animationData: job.data });
      var run = function () {
        var props = collect(anim.renderer), samples = [];
        for (var n = 0; n < job.count; n++) samples.push([]);
        for (var f = 0; f < job.frames; f++) {
          try { anim.goToAndStop(f, true); } catch (err) {}
          for (var m = 0; m < job.count; m++) {
            var p = props.get(m), value = null;
            if (p) {
              try { if (p.getValue) p.getValue(); } catch (err2) {}
              try { value = read(p); } catch (err3) { value = null; }
            }
            samples[m].push(value);
          }
        }
        parent.postMessage({ type: 'samples', samples: samples }, '*');
      };
      if (anim.isLoaded) run(); else anim.addEventListener('DOMLoaded', run);
    } catch (err) {
      parent.postMessage({ type: 'error', message: String((err && err.message) || err) }, '*');
    }
  });
  parent.postMessage({ type: 'ready' }, '*');
})();`;

const TIMEOUT_MS = 30000;

/** The full lottie-web player in a sandboxed iframe (loaded only when a file needs it). */
export const sandboxSampler: Sampler = async (job) => {
  const lottieSource = (await import('lottie-web/build/player/lottie.min.js?raw')).default;
  const frame = document.createElement('iframe');
  // Scripts only: an opaque origin without access to this page, its storage or cookies.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden';
  const safe = (js: string) => js.replace(/<\/script/gi, '<\\/script');
  frame.srcdoc =
    '<!doctype html><meta charset="utf-8">' +
    // No network at all: the file's scripts cannot send anything anywhere.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; img-src data: blob:; style-src 'unsafe-inline'">` +
    `<body><script>${safe(lottieSource)}</script><script>${SAMPLER_JS}</script></body>`;
  return new Promise<unknown[][]>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('Expression baking timed out'))), TIMEOUT_MS);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !isObj(e.data)) return;
      if (e.data.type === 'ready') frame.contentWindow!.postMessage(job, '*');
      else if (e.data.type === 'samples' && Array.isArray(e.data.samples)) {
        const samples = e.data.samples as unknown[];
        done(() => resolve(samples.map((s) => (Array.isArray(s) ? s : []))));
      } else if (e.data.type === 'error') done(() => reject(new Error(String(e.data.message))));
    };
    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
};

// ---------------------------------------------------------------------------

export interface BakeResult {
  anim: LottieAnimation;
  /** Expression properties turned into keyframes. */
  baked: number;
  /** Expression properties that could not be read (left as they were). */
  failed: number;
}

/** Bakes expressions into keyframes (a copy is returned). */
export async function bakeExpressions(anim: LottieAnimation, sampler: Sampler = sandboxSampler): Promise<BakeResult> {
  const out = structuredClone(anim);
  const work = structuredClone(anim);
  const targets: Json[] = [];
  pairs(out, work, (o, w) => {
    w.__bake = targets.length;
    // Keyframed paths keep only their keyframe list in the player: tag its first keyframe too.
    if (Array.isArray(w.k) && isObj(w.k[0])) (w.k[0] as Json).__bake = targets.length;
    targets.push(o);
  });
  if (!targets.length) return { anim: out, baked: 0, failed: 0 };

  const frames = Math.max(1, Math.min(Math.round(anim.op - anim.ip), 2000));
  const raw = await sampler({ data: work as unknown as Json, count: targets.length, frames, w: Math.round(anim.w), h: Math.round(anim.h) });
  const times = Array.from({ length: frames }, (_, f) => anim.ip + f);
  let baked = 0;
  targets.forEach((target, n) => {
    const samples = (raw[n] ?? []).map(cleanSample);
    if (samples.length !== frames || samples.some((s) => !s)) return;
    // Every frame must have the same kind of value (all numbers of one size, or all paths).
    const kinds = new Set(samples.map((s) => (isShape(s!) ? 'shape' : `n${(s as number[]).length}`)));
    if (kinds.size !== 1) return;
    const prop = toProp(times, samples as Sample[]);
    for (const key of ['x', 'k', 'a']) delete target[key];
    Object.assign(target, prop);
    baked++;
  });
  return { anim: out, baked, failed: targets.length - baked };
}
