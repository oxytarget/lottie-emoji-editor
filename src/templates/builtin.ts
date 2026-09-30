import { anim, loop, pingPong, shiftLoop, stat, type Ease } from '../lottie/anim';
import { ellipse, group, rect } from '../lottie/shapes';
import type { Prop } from '../lottie/types';
import { arc, bolt, bubble, crown, flame, heart, rays, ribbonTail, seeded, sparkle, star } from './kit';
import type { BuildContext, Template } from './types';

const C = 256;
const OP = 120;

/** Standard round badge used by most characters. */
function badge(ctx: BuildContext, d: number) {
  return group(ctx.painted([ellipse(0, 0, d, d)], 'body'));
}

/** Twinkling sparkle layer (scale 0 → 100 → 0) with a phase offset. */
function twinkle(ctx: BuildContext, x: number, y: number, r: number, phase: number) {
  ctx.layers.shape({
    nm: 'sparkle',
    p: [x, y],
    s: shiftLoop(ctx.op, [[0, [0, 0], 'out'], [0.18, [100, 100], 'inOut'], [0.36, [0, 0], 'hold'], [0.99, [0, 0]]], phase),
    r: shiftLoop(ctx.op, [[0, 0, 'linear'], [0.36, 90, 'hold'], [0.99, 90]], phase),
    shapes: [group(ctx.painted(sparkle(r), 'accent', { strokeWidth: ctx.outlineWidth * 0.6 }))],
  });
}

const classic: Template = {
  id: 'classic',
  emoji: '😀',
  name: { uk: 'Класика', ru: 'Классика', en: 'Classic' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, C],
      s: loop(ctx.op, [[0, [100, 100], 'inOut'], [0.25, [104, 96], 'inOut'], [0.5, [100, 100], 'inOut'], [0.75, [96, 104], 'inOut']]),
    });
    ctx.content({ p: [0, 0], slot: [290, 170], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 380)] });
  },
};

const bounce: Template = {
  id: 'bounce',
  emoji: '🏀',
  name: { uk: 'Стрибок', ru: 'Прыжок', en: 'Bounce' },
  duration: OP,
  build(ctx) {
    const ground = 452;
    const r = 150;
    const rig = ctx.layers.null({
      nm: 'rig',
      p: loop(ctx.op, [[0, [C, ground], 'out'], [0.5, [C, ground - 64], 'in']]),
      s: loop(ctx.op, [[0, [112, 88], 'out'], [0.14, [94, 106], 'inOut'], [0.5, [100, 100], 'inOut'], [0.86, [96, 104], 'in']]),
    });
    ctx.content({ p: [0, -r], slot: [230, 140], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, -r], parent: rig, shapes: [badge(ctx, r * 2)] });
    ctx.layers.shape({
      nm: 'shadow',
      p: [C, ground + 20],
      s: loop(ctx.op, [[0, [100, 100], 'out'], [0.5, [62, 62], 'in']]),
      shapes: [group([ellipse(0, 0, 230, 34), ctx.fill('outline', { x: -115, y: -17, w: 230, h: 34 }, 22)])],
    });
  },
};

const heartTpl: Template = {
  id: 'heart',
  emoji: '❤️',
  name: { uk: 'Серце', ru: 'Сердце', en: 'Heart' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, 268],
      s: loop(ctx.op, [[0, [100, 100], 'out'], [0.1, [111, 111], 'inOut'], [0.2, [100, 100], 'out'], [0.3, [107, 107], 'inOut'], [0.45, [100, 100], 'hold'], [0.99, [100, 100]]]),
    });
    ctx.content({ p: [0, -22], slot: [245, 135], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [group(ctx.painted(heart(380), 'body'))] });
    [
      [70, 0],
      [442, 0.5],
    ].forEach(([x, phase]) => {
      ctx.layers.shape({
        nm: 'mini-heart',
        p: shiftLoop(ctx.op, [[0, [x, 400], 'linear'], [0.999, [x + (x < C ? -14 : 14), 120], 'hold']], phase),
        o: shiftLoop(ctx.op, [[0, 0, 'linear'], [0.2, 100, 'linear'], [0.75, 100, 'linear'], [0.98, 0, 'hold']], phase),
        s: stat([100, 100]),
        shapes: [group(ctx.painted(heart(70), 'accent', { strokeWidth: ctx.outlineWidth * 0.6 }))],
      });
    });
  },
};

const starTpl: Template = {
  id: 'star',
  emoji: '⭐',
  name: { uk: 'Зірка', ru: 'Звезда', en: 'Star' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, 270],
      r: pingPong(ctx.op, -6, 6, 1, 'inOut'),
      s: pingPong(ctx.op, [100, 100], [104, 104], 2, 'inOut'),
    });
    ctx.content({ p: [0, 8], slot: [215, 118], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [group(ctx.painted(star(5, 232, 140), 'body'))] });
    twinkle(ctx, 70, 80, 34, 0);
    twinkle(ctx, 446, 96, 26, 0.35);
    twinkle(ctx, 444, 440, 30, 0.7);
  },
};

const fire: Template = {
  id: 'fire',
  emoji: '🔥',
  name: { uk: 'Вогонь', ru: 'Огонь', en: 'Fire' },
  duration: OP,
  build(ctx) {
    const cy = 306;
    const R = 160;
    const rig = ctx.layers.null({ nm: 'rig', p: [C, cy], s: pingPong(ctx.op, [100, 100], [103, 103], 2, 'inOut') });
    ctx.content({ p: [0, 0], slot: [250, 140], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, R * 2)] });
    const flames: Array<[number, number, number, number]> = [
      // angle, width, height, phase
      [-90, 118, 140, 0],
      [-125, 96, 118, 0.3],
      [-55, 96, 118, 0.6],
      [-155, 74, 92, 0.15],
      [-25, 74, 92, 0.45],
    ];
    for (const [angle, w, h, phase] of flames) {
      const a = (angle * Math.PI) / 180;
      const base: [number, number] = [C + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30)];
      ctx.layers.shape({
        nm: 'flame',
        p: base,
        r: angle + 90,
        s: shiftLoop(ctx.op, [[0, [100, 100], 'inOut'], [0.25, [92, 113], 'inOut'], [0.5, [104, 94], 'inOut'], [0.75, [96, 108], 'inOut']], phase),
        shapes: [group(ctx.painted(flame(w, h), 'accent'))],
      });
    }
  },
};

const crownTpl: Template = {
  id: 'crown',
  emoji: '👑',
  name: { uk: 'Корона', ru: 'Корона', en: 'Crown' },
  duration: OP,
  build(ctx) {
    const cy = 296;
    const rig = ctx.layers.null({ nm: 'rig', p: [C, cy], s: pingPong(ctx.op, [100, 100], [103, 97], 2, 'inOut') });
    const crownW = 210;
    const crownH = 118;
    const tips: Array<[number, number]> = [
      [-crownW / 2, -crownH * 0.72],
      [0, -crownH],
      [crownW / 2, -crownH * 0.72],
    ];
    ctx.layers.shape({
      nm: 'crown',
      p: pingPong(ctx.op, [C - 6, cy - 150], [C + 6, cy - 158], 1, 'inOut'),
      r: pingPong(ctx.op, -9, 7, 1, 'inOut'),
      shapes: [
        ...tips.map(([x, y]) => group(ctx.painted([ellipse(x, y, 30, 30)], 'accent', { strokeWidth: ctx.outlineWidth * 0.7 }))),
        group(ctx.painted(crown(crownW, crownH), 'accent')),
      ],
    });
    ctx.content({ p: [0, 18], slot: [270, 150], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 356)] });
  },
};

const bubbleTpl: Template = {
  id: 'bubble',
  emoji: '💬',
  name: { uk: 'Репліка', ru: 'Реплика', en: 'Speech' },
  duration: OP,
  build(ctx) {
    // The rig sits on the bubble's bottom edge so it wobbles around its tail.
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, 386],
      s: loop(ctx.op, [[0, [100, 100], 'inOut'], [0.25, [104, 97], 'inOut'], [0.5, [100, 100], 'inOut'], [0.75, [97, 103], 'inOut']]),
      r: pingPong(ctx.op, -2.5, 2.5, 1, 'inOut'),
    });
    ctx.content({ p: [0, -168], slot: [340, 190], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, -150], parent: rig, shapes: [group(ctx.painted(bubble(430, 300, 90, 72), 'body'))] });
  },
};

const sparkleTpl: Template = {
  id: 'sparkle',
  emoji: '✨',
  name: { uk: 'Блиск', ru: 'Блеск', en: 'Sparkle' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({ nm: 'rig', p: [C, C], s: pingPong(ctx.op, [100, 100], [104, 104], 1, 'inOut') });
    twinkle(ctx, 88, 96, 42, 0);
    twinkle(ctx, 430, 84, 32, 0.25);
    twinkle(ctx, 440, 414, 44, 0.5);
    twinkle(ctx, 80, 424, 30, 0.75);
    ctx.content({ p: [0, 0], slot: [255, 150], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 340)] });
  },
};

const orbit: Template = {
  id: 'orbit',
  emoji: '🪐',
  name: { uk: 'Орбіта', ru: 'Орбита', en: 'Orbit' },
  duration: OP,
  build(ctx) {
    const R = 206;
    ctx.layers.shape({
      nm: 'moons',
      p: [C, C],
      r: anim([[0, 0, 'linear'], [ctx.op, 120]]),
      shapes: [0, 120, 240].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return group(ctx.painted([ellipse(Math.cos(a) * R, Math.sin(a) * R, 46, 46)], 'accent', { strokeWidth: ctx.outlineWidth * 0.7 }));
      }),
    });
    const rig = ctx.layers.null({ nm: 'rig', p: [C, C], s: pingPong(ctx.op, [100, 100], [103, 103], 2, 'inOut') });
    ctx.content({ p: [0, 0], slot: [235, 140], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 310)] });
    ctx.layers.shape({
      nm: 'track',
      p: [C, C],
      shapes: [group([ellipse(0, 0, R * 2, R * 2), ctx.stroke('outline', { x: -R, y: -R, w: R * 2, h: R * 2 }, 5, 45)])],
    });
  },
};

const zap: Template = {
  id: 'zap',
  emoji: '⚡',
  name: { uk: 'Блискавка', ru: 'Молния', en: 'Zap' },
  duration: OP,
  build(ctx) {
    const rnd = seeded(7);
    const shake: Array<[number, number[], Ease]> = [[0, [C, 266], 'linear']];
    for (let t = 6; t < 48; t += 6) shake.push([t, [C + (rnd() - 0.5) * 16, 266 + (rnd() - 0.5) * 12], 'linear']);
    shake.push([54, [C, 266], 'hold'], [ctx.op, [C, 266], 'linear']);
    const flash: Prop = anim([
      [0, 100, 'hold'],
      [10, 0, 'hold'],
      [16, 100, 'hold'],
      [44, 0, 'hold'],
      [ctx.op - 12, 100, 'hold'],
      [ctx.op, 100],
    ]);
    ctx.layers.shape({ nm: 'bolt-l', p: [84, 150], r: -18, o: flash, shapes: [group(ctx.painted(bolt(150), 'accent'))] });
    ctx.layers.shape({ nm: 'bolt-r', p: [432, 380], r: 22, o: flash, shapes: [group(ctx.painted(bolt(130), 'accent'))] });
    const rig = ctx.layers.null({ nm: 'rig', p: anim(shake) });
    ctx.content({ p: [0, 0], slot: [245, 140], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 324)] });
  },
};

const spinner: Template = {
  id: 'spinner',
  emoji: '🔄',
  name: { uk: 'Кільце', ru: 'Кольцо', en: 'Ring' },
  duration: OP,
  build(ctx) {
    const R = 206;
    const circumference = 2 * Math.PI * R;
    const period = circumference / 16;
    const rig = ctx.layers.null({ nm: 'rig', p: [C, C], s: pingPong(ctx.op, [100, 100], [104, 104], 2, 'inOut') });
    ctx.content({ p: [0, 0], slot: [250, 150], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 330)] });
    ctx.layers.shape({
      nm: 'ring',
      p: [C, C],
      r: anim([[0, 0, 'linear'], [ctx.op, 90]]),
      shapes: [
        group([
          ellipse(0, 0, R * 2, R * 2),
          { ...ctx.stroke('accent', { x: -R, y: -R, w: R * 2, h: R * 2 }, 22), d: [
            { n: 'd', nm: 'dash', v: stat(period * 0.5) },
            { n: 'g', nm: 'gap', v: stat(period * 0.5) },
            { n: 'o', nm: 'offset', v: stat(0) },
          ] },
        ]),
      ],
    });
  },
};

const ribbon: Template = {
  id: 'ribbon',
  emoji: '🎀',
  name: { uk: 'Стрічка', ru: 'Лента', en: 'Ribbon' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, C],
      r: pingPong(ctx.op, -4, 4, 1, 'inOut'),
      s: pingPong(ctx.op, [100, 100], [103, 103], 2, 'inOut'),
    });
    ctx.content({ p: [0, 0], slot: [360, 104], parent: rig });
    ctx.layers.shape({ nm: 'band', p: [0, 0], parent: rig, shapes: [group(ctx.painted([rect(0, 0, 392, 146, 22)], 'body'))] });
    ctx.layers.shape({
      nm: 'tails',
      p: [0, 0],
      parent: rig,
      shapes: [group(ctx.painted(ribbonTail(-1, 150, 236, 10, 124), 'accent')), group(ctx.painted(ribbonTail(1, 150, 236, 10, 124), 'accent'))],
    });
  },
};

const shake: Template = {
  id: 'shake',
  emoji: '😮',
  name: { uk: 'Вау', ru: 'Вау', en: 'Wow' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, 262],
      r: anim([[0, 0, 'inOut'], [8, -13, 'inOut'], [16, 11, 'inOut'], [24, -8, 'inOut'], [32, 5, 'inOut'], [40, 0, 'hold'], [ctx.op, 0]]),
      s: anim([[0, [100, 100], 'out'], [10, [108, 108], 'inOut'], [36, [100, 100], 'hold'], [ctx.op, [100, 100]]]),
    });
    ctx.content({ p: [0, 0], slot: [250, 150], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 336)] });
    const lines = (dir: -1 | 1) =>
      [0, 1].map((i) => {
        const r = 196 + i * 34;
        const from = dir < 0 ? 200 : -20;
        return group([...arc(r, from, from + 40), ctx.stroke('accent', { x: -r, y: -r, w: r * 2, h: r * 2 }, 14)]);
      });
    ctx.layers.shape({
      nm: 'motion',
      p: [C, 262],
      o: anim([[0, 0, 'out'], [6, 100, 'hold'], [34, 100, 'inOut'], [48, 0, 'hold'], [ctx.op, 0]]),
      shapes: [...lines(-1), ...lines(1)],
    });
  },
};

const party: Template = {
  id: 'party',
  emoji: '🎉',
  name: { uk: 'Свято', ru: 'Праздник', en: 'Party' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: loop(ctx.op, [[0, [C, 270], 'inOut'], [0.5, [C, 250], 'inOut']]),
    });
    ctx.content({ p: [0, 0], slot: [245, 145], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 320)] });
    const rnd = seeded(42);
    const roles = ['accent', 'outline', 'accent', 'body'] as const;
    for (let i = 0; i < 12; i++) {
      const x = 44 + ((i * 37) % 12) * 38 + rnd() * 10;
      const phase = (i * 5) % 12 / 12;
      const drift = (rnd() - 0.5) * 40;
      const piece = i % 3 === 0 ? ellipse(0, 0, 22, 22) : rect(0, 0, 16, 30, 4);
      const role = roles[i % roles.length];
      ctx.layers.shape({
        nm: 'confetti',
        p: shiftLoop(ctx.op, [[0, [x, 30], 'linear'], [0.999, [x + drift, 482], 'hold']], phase),
        r: shiftLoop(ctx.op, [[0, 0, 'linear'], [0.999, 360 * (i % 2 ? 1 : -1), 'hold']], phase),
        o: shiftLoop(ctx.op, [[0, 0, 'linear'], [0.12, 100, 'linear'], [0.82, 100, 'linear'], [0.98, 0, 'hold']], phase),
        shapes: [group([piece, ctx.fill(role, { x: -11, y: -15, w: 22, h: 30 })])],
      });
    }
  },
};

const sticker: Template = {
  id: 'sticker',
  emoji: '🏷️',
  name: { uk: 'Наліпка', ru: 'Наклейка', en: 'Sticker' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, C],
      r: pingPong(ctx.op, -6, 5, 1, 'inOut'),
      s: pingPong(ctx.op, [100, 100], [104, 104], 1, 'inOut'),
    });
    ctx.content({ p: [0, 0], slot: [270, 200], parent: rig });
    const size = 340;
    const box = { x: -size / 2, y: -size / 2, w: size, h: size };
    ctx.layers.shape({
      nm: 'body',
      p: [0, 0],
      parent: rig,
      shapes: [
        group(ctx.painted([rect(0, 0, size, size, 84)], 'body')),
        group([rect(0, 0, size, size, 84), ctx.stroke('accent', box, ctx.outlineWidth + 26)]),
      ],
    });
  },
};

const boom: Template = {
  id: 'boom',
  emoji: '💥',
  name: { uk: 'Бум', ru: 'Бум', en: 'Boom' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({ nm: 'rig', p: [C, C], s: pingPong(ctx.op, [100, 100], [105, 105], 2, 'inOut') });
    ctx.content({ p: [0, 0], slot: [240, 140], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 310)] });
    ctx.layers.shape({
      nm: 'burst',
      p: [C, C],
      r: anim([[0, 0, 'linear'], [ctx.op, 360 / 14]]),
      s: pingPong(ctx.op, [100, 100], [104, 104], 2, 'inOut'),
      shapes: [group(ctx.painted(star(14, 238, 186), 'accent'))],
    });
  },
};

const sun: Template = {
  id: 'sun',
  emoji: '☀️',
  name: { uk: 'Сонце', ru: 'Солнце', en: 'Sun' },
  duration: OP,
  build(ctx) {
    const rig = ctx.layers.null({ nm: 'rig', p: [C, C], s: pingPong(ctx.op, [100, 100], [103, 103], 2, 'inOut') });
    ctx.content({ p: [0, 0], slot: [245, 145], parent: rig });
    ctx.layers.shape({ nm: 'body', p: [0, 0], parent: rig, shapes: [badge(ctx, 316)] });
    ctx.layers.shape({
      nm: 'rays',
      p: [C, C],
      r: anim([[0, 0, 'linear'], [ctx.op, 30]]),
      shapes: [group(ctx.painted(rays(12, 150, 238, 46), 'accent'))],
    });
  },
};

const coin: Template = {
  id: 'coin',
  emoji: '🪙',
  name: { uk: 'Монета', ru: 'Монета', en: 'Coin' },
  duration: OP,
  build(ctx) {
    const op = ctx.op;
    const rig = ctx.layers.null({
      nm: 'rig',
      p: [C, C],
      s: anim([
        [0, [100, 100], 'hold'],
        [op * 0.2, [100, 100], 'inOut'],
        [op * 0.45, [-100, 100], 'hold'],
        [op * 0.6, [-100, 100], 'inOut'],
        [op * 0.85, [100, 100], 'hold'],
        [op, [100, 100]],
      ]),
    });
    // Counter-flip the content while the coin is mirrored so the text never reads backwards.
    ctx.content({
      p: [0, 0],
      slot: [250, 170],
      parent: rig,
      s: anim([
        [0, [100, 100], 'hold'],
        [op * 0.325, [-100, 100], 'hold'],
        [op * 0.725, [100, 100], 'hold'],
        [op, [100, 100]],
      ]),
    });
    const inner = 318;
    ctx.layers.shape({
      nm: 'coin',
      p: [0, 0],
      parent: rig,
      shapes: [
        group([ellipse(0, 0, inner, inner), ctx.stroke('accent', { x: -inner / 2, y: -inner / 2, w: inner, h: inner }, 10)]),
        badge(ctx, 384),
      ],
    });
  },
};

// --- Logo-first templates (no body shape) -----------------------------------

const float: Template = {
  id: 'float',
  emoji: '🎈',
  name: { uk: 'Лого: політ', ru: 'Лого: полёт', en: 'Logo: float' },
  duration: OP,
  logoOnly: true,
  build(ctx) {
    const rig = ctx.layers.null({
      nm: 'rig',
      p: loop(ctx.op, [[0, [C, 246], 'inOut'], [0.5, [C, 226], 'inOut']]),
      r: pingPong(ctx.op, -4, 4, 1, 'inOut'),
    });
    ctx.content({ p: [0, 0], slot: [380, 370], parent: rig });
    ctx.layers.shape({
      nm: 'shadow',
      p: [C, 470],
      s: loop(ctx.op, [[0, [100, 100], 'inOut'], [0.5, [78, 78], 'inOut']]),
      shapes: [group([ellipse(0, 0, 250, 30), ctx.fill('outline', { x: -125, y: -15, w: 250, h: 30 }, 18)])],
    });
  },
};

const spin: Template = {
  id: 'spin',
  emoji: '🌀',
  name: { uk: 'Лого: оберт', ru: 'Лого: оборот', en: 'Logo: spin' },
  duration: OP,
  logoOnly: true,
  build(ctx) {
    const op = ctx.op;
    ctx.content({
      p: [C, C],
      slot: [340, 340],
      r: anim([[0, 0, 'hold'], [op * 0.2, 0, 'inOut'], [op * 0.8, 360, 'hold'], [op, 360]]),
      s: anim([[0, [100, 100], 'hold'], [op * 0.2, [100, 100], 'inOut'], [op * 0.5, [88, 88], 'inOut'], [op * 0.8, [100, 100], 'hold'], [op, [100, 100]]]),
    });
  },
};

const pulse: Template = {
  id: 'pulse',
  emoji: '💓',
  name: { uk: 'Лого: пульс', ru: 'Лого: пульс', en: 'Logo: pulse' },
  duration: OP,
  logoOnly: true,
  build(ctx) {
    ctx.content({
      p: [C, C],
      slot: [320, 320],
      s: loop(ctx.op, [[0, [100, 100], 'out'], [0.12, [112, 112], 'inOut'], [0.26, [100, 100], 'out'], [0.38, [107, 107], 'inOut'], [0.52, [100, 100], 'hold'], [0.99, [100, 100]]]),
    });
    for (const phase of [0, 0.5]) {
      ctx.layers.shape({
        nm: 'wave',
        p: [C, C],
        s: shiftLoop(ctx.op, [[0, [70, 70], 'out'], [0.99, [150, 150], 'hold']], phase),
        o: shiftLoop(ctx.op, [[0, 90, 'linear'], [0.99, 0, 'hold']], phase),
        shapes: [group([ellipse(0, 0, 300, 300), ctx.stroke('accent', { x: -150, y: -150, w: 300, h: 300 }, 12)])],
      });
    }
  },
};

const jelly: Template = {
  id: 'jelly',
  emoji: '🍮',
  name: { uk: 'Лого: желе', ru: 'Лого: желе', en: 'Logo: jelly' },
  duration: OP,
  logoOnly: true,
  build(ctx) {
    ctx.content({
      p: [C, C],
      slot: [360, 340],
      anchor: 'bottom',
      s: loop(ctx.op, [
        [0, [100, 100], 'inOut'],
        [0.12, [116, 84], 'inOut'],
        [0.26, [90, 110], 'inOut'],
        [0.4, [106, 95], 'inOut'],
        [0.52, [98, 102], 'inOut'],
        [0.62, [100, 100], 'hold'],
        [0.99, [100, 100]],
      ]),
    });
  },
};

export const BUILTIN_TEMPLATES: Template[] = [
  classic,
  bounce,
  heartTpl,
  starTpl,
  fire,
  crownTpl,
  bubbleTpl,
  sparkleTpl,
  orbit,
  zap,
  spinner,
  ribbon,
  shake,
  party,
  sticker,
  boom,
  sun,
  coin,
  float,
  spin,
  pulse,
  jelly,
];
