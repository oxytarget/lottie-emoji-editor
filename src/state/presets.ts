import { hslHex, luminance } from '../lottie/color';
import { primaryColor, solid, type Paint } from '../lottie/paint';
import type { EmojiColors } from '../templates/types';

export interface ColorPreset {
  id: string;
  name: string;
  colors: EmojiColors;
  textFill: Paint;
  textOutline: Paint;
}

const lin = (a: string, b: string, angle = 90): Paint => ({ type: 'linear', colors: [a, b], angle });

export const PRESETS: ColorPreset[] = [
  {
    id: 'mono',
    name: 'Mono',
    colors: { body: solid('#111111'), outline: solid('#ffffff'), accent: solid('#9ca3af') },
    textFill: solid('#ffffff'),
    textOutline: solid('#111111'),
  },
  {
    id: 'nebula',
    name: 'Nebula',
    colors: { body: lin('#8b5cf6', '#4338ca'), outline: solid('#1e1b4b'), accent: lin('#f0abfc', '#c084fc') },
    textFill: solid('#ffffff'),
    textOutline: solid('#1e1b4b'),
  },
  {
    id: 'lava',
    name: 'Lava',
    colors: { body: lin('#ff6b1a', '#c81e1e'), outline: solid('#2b0707'), accent: lin('#fde047', '#f97316') },
    textFill: solid('#fff7ed'),
    textOutline: solid('#2b0707'),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: { body: lin('#22d3ee', '#2563eb'), outline: solid('#0b1f4d'), accent: solid('#a5f3fc') },
    textFill: solid('#ffffff'),
    textOutline: solid('#0b1f4d'),
  },
  {
    id: 'mint',
    name: 'Mint',
    colors: { body: solid('#34d399'), outline: solid('#053b2c'), accent: solid('#fef08a') },
    textFill: solid('#ffffff'),
    textOutline: solid('#053b2c'),
  },
  {
    id: 'candy',
    name: 'Candy',
    colors: { body: lin('#f9a8d4', '#db2777'), outline: solid('#4a0424'), accent: solid('#fde047') },
    textFill: solid('#ffffff'),
    textOutline: solid('#4a0424'),
  },
  {
    id: 'gold',
    name: 'Gold',
    colors: { body: lin('#fde68a', '#f59e0b'), outline: solid('#5b2c06'), accent: solid('#fff7ed') },
    textFill: solid('#5b2c06'),
    textOutline: solid('#fffbeb'),
  },
  {
    id: 'neon',
    name: 'Neon',
    colors: { body: solid('#0f172a'), outline: solid('#22d3ee'), accent: solid('#a3e635') },
    textFill: lin('#a3e635', '#22d3ee', 0),
    textOutline: solid('#0f172a'),
  },
  {
    id: 'paper',
    name: 'Paper',
    colors: { body: solid('#ffffff'), outline: solid('#111111'), accent: solid('#ef4444') },
    textFill: solid('#111111'),
    textOutline: solid('#ffffff'),
  },
];

/** Harmonious random palette for the character. */
export function randomEmojiColors(rnd: () => number = Math.random): EmojiColors {
  const h = Math.floor(rnd() * 360);
  const body = hslHex(h, 0.72 + rnd() * 0.2, 0.5 + rnd() * 0.1);
  const bodyPaint: Paint = rnd() < 0.4 ? lin(hslHex(h + 25, 0.9, 0.62), body, 90) : solid(body);
  const accentHue = h + (rnd() < 0.5 ? 150 : 45);
  return {
    body: bodyPaint,
    outline: solid(hslHex(h, 0.55, 0.12)),
    accent: solid(hslHex(accentHue, 0.9, 0.6)),
  };
}

/** Random readable text colours on top of the given body colour. */
export function randomTextColors(body: Paint, rnd: () => number = Math.random): { fill: Paint; outline: Paint } {
  const dark = luminance(primaryColor(body)) > 0.45;
  const h = Math.floor(rnd() * 360);
  const options = dark
    ? [solid('#111111'), solid(hslHex(h, 0.7, 0.2)), solid('#1e1b4b')]
    : [solid('#ffffff'), solid(hslHex(h, 0.95, 0.75)), lin('#ffffff', hslHex(h, 0.9, 0.8))];
  const fill = options[Math.floor(rnd() * options.length)];
  const outline = dark ? solid('#ffffff') : solid(hslHex(h, 0.6, 0.12));
  return { fill, outline };
}
