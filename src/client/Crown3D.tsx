import { useEffect, useRef } from 'react';
import { SparkleIcon } from '../components/icons';

/**
 * PRO's crown: a golden crown with thickness, turning around its vertical axis.
 *
 * Drawn on a canvas, layer by layer, in the right order for each angle (the crown's two faces and the gold edge
 * between them): no CSS 3D, so no layer sorting glitches, seams or flattening in Telegram's web views.
 */

const ART_W = 100;
const ART_H = 86;
/** Thickness of the crown, in art units. */
const DEPTH = 12;
/** Layers along the depth: dense enough to look solid edge-on. */
const LAYERS = 28;
const TURN_MS = 7000;

function crownSvg(kind: 'face' | 'edge', scale: number): string {
  const w = Math.round(ART_W * scale);
  const h = Math.round(ART_H * scale);
  const body = 'M12 64 L5 20 L29 40 L50 8 L71 40 L95 20 L88 64 Z';
  if (kind === 'edge') {
    // The gold side of the crown: no jewels (they sit on the faces), darker towards the bottom.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${ART_W} ${ART_H}">
<defs><linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e09a1c"/><stop offset="0.6" stop-color="#b8670a"/><stop offset="1" stop-color="#8a4a05"/></linearGradient></defs>
<path d="${body}" fill="url(#e)" stroke="url(#e)" stroke-width="2.5" stroke-linejoin="round"/>
<rect x="10" y="62" width="80" height="16" rx="5" fill="#94510a" stroke="#94510a" stroke-width="2.5"/>
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${ART_W} ${ART_H}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#fff6c2"/><stop offset="0.35" stop-color="#ffd23f"/><stop offset="0.72" stop-color="#f5a00b"/><stop offset="1" stop-color="#b45309"/></linearGradient>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe17a"/><stop offset="1" stop-color="#c46a07"/></linearGradient>
<radialGradient id="r" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffd1dc"/><stop offset="0.45" stop-color="#ff3b6b"/><stop offset="1" stop-color="#8a0b2e"/></radialGradient>
<radialGradient id="s" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#d6e4ff"/><stop offset="0.45" stop-color="#5b7cff"/><stop offset="1" stop-color="#1e2a8a"/></radialGradient>
</defs>
<path d="${body}" fill="url(#g)" stroke="#9a5205" stroke-width="2.5" stroke-linejoin="round"/>
<rect x="10" y="62" width="80" height="16" rx="5" fill="url(#b)" stroke="#9a5205" stroke-width="2.5"/>
<path d="M18 56 L14 30 L30 45 L50 17" fill="none" stroke="#fff8d6" stroke-opacity="0.65" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="5" cy="20" r="5.5" fill="url(#s)"/><circle cx="95" cy="20" r="5.5" fill="url(#s)"/><circle cx="50" cy="8" r="6.5" fill="url(#r)"/>
<circle cx="30" cy="70" r="4" fill="url(#s)"/><ellipse cx="50" cy="70" rx="7" ry="5" fill="url(#r)"/><circle cx="70" cy="70" r="4" fill="url(#s)"/>
</svg>`;
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Draws the crown turned by `angle` (radians) into a box of `w`×`h` device pixels. */
function draw(ctx: CanvasRenderingContext2D, face: HTMLImageElement, edge: HTMLImageElement, shade: HTMLCanvasElement, angle: number, w: number, h: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const k = Math.min(w / ART_W, h / ART_H) * 0.9;
  const artW = ART_W * k;
  const artH = ART_H * k;
  ctx.clearRect(0, 0, w, h);
  // Back to front: a layer at depth z is nearer the viewer the bigger z·cos is.
  const layers = Array.from({ length: LAYERS }, (_, i) => (i / (LAYERS - 1) - 0.5) * DEPTH);
  layers.sort((a, b) => a * cos - b * cos);
  // The face towards the viewer, lit by how squarely it faces us, with a shine sweeping over it.
  const sctx = shade.getContext('2d')!;
  sctx.clearRect(0, 0, shade.width, shade.height);
  sctx.globalCompositeOperation = 'source-over';
  sctx.drawImage(face, 0, 0, shade.width, shade.height);
  sctx.globalCompositeOperation = 'source-atop';
  sctx.fillStyle = `rgba(90, 40, 0, ${(1 - Math.abs(cos)) * 0.3})`;
  sctx.fillRect(0, 0, shade.width, shade.height);
  const sweep = ((angle / (Math.PI * 2)) % 1) * 2.4 - 0.7;
  const g = sctx.createLinearGradient(shade.width * sweep, 0, shade.width * (sweep + 0.25), shade.height * 0.6);
  g.addColorStop(0, 'rgba(255,250,220,0)');
  g.addColorStop(0.5, 'rgba(255,250,220,0.35)');
  g.addColorStop(1, 'rgba(255,250,220,0)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, shade.width, shade.height);
  for (const z of layers) {
    const isFace = Math.abs(Math.abs(z) - DEPTH / 2) < 1e-6;
    ctx.save();
    ctx.translate(w / 2 + z * sin * k, h / 2);
    // Turning around the vertical axis: the width shrinks with cos (and mirrors from behind).
    ctx.scale(Math.abs(cos) < 0.02 ? 0.02 * Math.sign(cos || 1) : cos, 1);
    if (isFace) ctx.drawImage(shade, -artW / 2, -artH / 2, artW, artH);
    else ctx.drawImage(edge, -artW / 2, -artH / 2, artW, artH);
    ctx.restore();
  }
}

export function Crown3D() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let raf = 0;
    let alive = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(el.clientWidth * dpr);
    const h = Math.round(el.clientHeight * dpr);
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const scale = Math.min(w / ART_W, h / ART_H) * 0.9;
    Promise.all([loadImage(crownSvg('face', scale)), loadImage(crownSvg('edge', scale))]).then(
      ([face, edge]) => {
        if (!alive) return;
        const shade = document.createElement('canvas');
        shade.width = face.width;
        shade.height = face.height;
        const start = performance.now();
        const frame = (now: number) => {
          if (!alive) return;
          draw(ctx, face, edge, shade, ((now - start) / TURN_MS) * Math.PI * 2 + 0.5, w, h);
          raf = requestAnimationFrame(frame);
        };
        if (reducedMotion()) draw(ctx, face, edge, shade, 0.5, w, h);
        else raf = requestAnimationFrame(frame);
      },
      () => {},
    );
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="c-crown3d" aria-hidden>
      <span className="c-crown3d-glow" />
      <span className="c-crown3d-shadow" />
      <div className="c-crown3d-float">
        <canvas ref={canvas} className="c-crown3d-canvas" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <SparkleIcon key={i} className={`c-crown3d-spark is-${i}`} width={14} height={14} />
      ))}
    </div>
  );
}
