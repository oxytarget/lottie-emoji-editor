/** TGS helpers (gzip via the standard Compression Streams API — works in Workers, Node 18+ and browsers). */

interface LottieLike {
  w: number;
  h: number;
  ip: number;
  op: number;
  layers: Array<{ ind?: number; parent?: number; [k: string]: unknown }>;
  [k: string]: unknown;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Re-targets a TGS animation to a `size × size` canvas (custom emoji use 100×100) by parenting every
 * top-level layer to an invisible null layer that scales the whole scene. Geometry stays untouched.
 */
export async function toEmojiCanvas(tgs: Uint8Array, size = 100): Promise<Uint8Array> {
  const anim = JSON.parse(await gunzip(tgs)) as LottieLike;
  if (anim.w === size && anim.h === size) return tgs;
  const k = (size / Math.max(anim.w, anim.h)) * 100;
  const maxInd = anim.layers.reduce((m, l) => Math.max(m, typeof l.ind === 'number' ? l.ind : 0), 0);
  const rootInd = maxInd + 1;
  const root = {
    ddd: 0,
    ind: rootInd,
    ty: 3,
    nm: 'emoji-canvas',
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [((size - (anim.w * k) / 100) / 2), ((size - (anim.h * k) / 100) / 2), 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [k, k, 100] },
    },
    ao: 0,
    ip: anim.ip,
    op: anim.op,
    st: 0,
    bm: 0,
  };
  const layers = anim.layers.map((l) => (l.parent === undefined ? { ...l, parent: rootInd } : l));
  return gzip(JSON.stringify({ ...anim, w: size, h: size, layers: [...layers, root] }));
}

export async function readTgs(tgs: Uint8Array): Promise<LottieLike> {
  return JSON.parse(await gunzip(tgs)) as LottieLike;
}
