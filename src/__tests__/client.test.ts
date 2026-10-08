import { describe, expect, it } from 'vitest';
import { artToSvg, balanceLines, buildDesign } from '../client/design';
import { commentPayload, formatTon, tonTransferLink } from '../client/ton';
import { svgToArt } from '../content/svg';

const square = (fill: string, size = 100) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect x="0" y="0" width="${size}" height="${size}" fill="${fill}"/></svg>`;
const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#ff0000"/></svg>`;

describe('client design layout', () => {
  it('splits a long single line near the middle', () => {
    expect(balanceLines('short')).toBe('short');
    expect(balanceLines('Coffee shop on the corner')).toBe('Coffee shop\non the corner');
    expect(balanceLines('already\ntwo lines here ok')).toBe('already\ntwo lines here ok');
  });

  it('turns artwork into SVG and back, keeping shapes and colours', () => {
    const art = svgToArt(square('#336699')).art!;
    const back = svgToArt(artToSvg(art.items)).art!;
    expect(back.items).toHaveLength(1);
    expect(back.items[0].fill).toMatchObject({ type: 'solid' });
    expect(back.bbox.w).toBeCloseTo(art.bbox.w, 0);
  });

  it('keeps proportions and puts a logo badge on the photo, all inside the square', async () => {
    const svg = await buildDesign({ photo: square('#00ff00'), logo: wide, text: '', fontId: 'x', textColor: '#fff', outline: null });
    const art = svgToArt(svg!).art!;
    expect(art.items).toHaveLength(2);
    const [photo, logo] = art.items.map((it) => svgToArt(artToSvg([it])).art!.bbox);
    // The square photo stays square, the 4:1 logo stays 4:1.
    expect(photo.w / photo.h).toBeCloseTo(1, 1);
    expect(logo.w / logo.h).toBeCloseTo(4, 1);
    // The badge sits on the photo's lower right corner.
    expect(logo.x + logo.w).toBeGreaterThan(photo.x + photo.w * 0.8);
    expect(logo.y + logo.h).toBeGreaterThan(photo.y + photo.h * 0.8);
    for (const b of [photo, logo]) {
      expect(b.x).toBeGreaterThanOrEqual(-500);
      expect(b.x + b.w).toBeLessThanOrEqual(500);
      expect(b.y).toBeGreaterThanOrEqual(-500);
      expect(b.y + b.h).toBeLessThanOrEqual(500);
    }
  });

  it('leaves text alone to the text path', async () => {
    expect(await buildDesign({ photo: null, logo: null, text: 'Hi', fontId: 'x', textColor: '#fff', outline: null })).toBeNull();
  });
});

describe('TON payments', () => {
  it('serializes a text comment as a bag of cells with a CRC-32C', () => {
    const boc = Uint8Array.from(atob(commentPayload('ES-abc')), (c) => c.charCodeAt(0));
    expect([...boc.slice(0, 4)]).toEqual([0xb5, 0xee, 0x9c, 0x72]);
    // One cell, one root, no refs; its data: zero op + "ES-abc".
    expect(boc[6]).toBe(1);
    expect(boc[7]).toBe(1);
    const cell = boc.slice(11, boc.length - 4);
    expect(cell[0]).toBe(0);
    expect(cell[1]).toBe((4 + 6) * 2);
    expect(new TextDecoder().decode(cell.slice(6))).toBe('ES-abc');
    expect(boc[9]).toBe(cell.length);
  });

  it('formats amounts and transfer links', () => {
    expect(formatTon('398000000')).toBe('0.398');
    expect(formatTon('5000000000')).toBe('5');
    expect(tonTransferLink('UQx', '1000', 'ES-1 a')).toBe('ton://transfer/UQx?amount=1000&text=ES-1%20a');
  });
});
