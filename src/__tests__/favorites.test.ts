import { beforeEach, describe, expect, it } from 'vitest';
import { solid } from '../lottie/paint';
import { initialData, MAX_FAV_LOGO_CHARS, useEditor } from '../state/store';

const svg = (n: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L${n} 0L${n} 10Z"/></svg>`;

beforeEach(() => useEditor.setState({ ...initialData() }));

describe('favourites', () => {
  it('toggles and collects colours without duplicates', () => {
    const s = useEditor.getState();
    s.toggleFavColor('#FF0000');
    expect(useEditor.getState().favColors).toEqual(['#ff0000']);
    expect(s.addFavColors(['#ff0000', '#00FF00', '#00ff00'])).toBe(1);
    expect(useEditor.getState().favColors).toEqual(['#00ff00', '#ff0000']);
    s.toggleFavColor('#ff0000');
    expect(useEditor.getState().favColors).toEqual(['#00ff00']);
  });

  it('keeps logos once, refuses huge ones, and uses them as the logo', () => {
    const s = useEditor.getState();
    const a = s.addFavLogo({ name: 'A', svg: svg(1) })!;
    expect(s.addFavLogo({ name: 'A again', svg: svg(1) })).toEqual(a);
    expect(s.addFavLogo({ name: 'Huge', svg: 'x'.repeat(MAX_FAV_LOGO_CHARS + 1) })).toBeNull();
    expect(useEditor.getState().favLogos).toHaveLength(1);
    s.useLogo(a);
    expect(useEditor.getState()).toMatchObject({ mode: 'logo', logo: { name: 'A', svg: svg(1) } });
    s.removeFavLogo(a.id);
    expect(useEditor.getState().favLogos).toEqual([]);
  });

  it('removes several chosen favourites at once, or all of them', () => {
    const s = useEditor.getState();
    s.addFavColors(['#111111', '#222222', '#333333']);
    s.removeFavColors(['#222222', '#FFFFFF']);
    expect(useEditor.getState().favColors).toEqual(['#111111', '#333333']);
    s.removeFavColors(useEditor.getState().favColors);
    expect(useEditor.getState().favColors).toEqual([]);

    const ids = [1, 2, 3].map((n) => s.addFavLogo({ name: `L${n}`, svg: svg(n) })!.id);
    s.removeFavLogos([ids[0], ids[2], 'unknown']);
    expect(useEditor.getState().favLogos.map((f) => f.name)).toEqual(['L2']);
    s.removeFavLogos(ids);
    expect(useEditor.getState().favLogos).toEqual([]);
  });
});

describe('user presets', () => {
  it('saves colours with the logo and brings both back in one tap', () => {
    const s = useEditor.getState();
    s.set('colors', { body: solid('#123456'), outline: solid('#000000'), accent: solid('#abcdef') });
    s.set('textFill', solid('#ff00ff'));
    s.useLogo({ name: 'brand.svg', svg: svg(5) });
    const preset = s.saveUserPreset('Brand', true)!;
    expect(preset.content).toMatchObject({ mode: 'logo', logo: { name: 'brand.svg' } });
    expect(useEditor.getState().presetId).toBe(preset.id);

    // Change everything, then apply the preset.
    s.set('colors', initialData().colors);
    s.set('mode', 'text');
    s.set('logo', null);
    useEditor.getState().applyUserPreset(preset);
    const after = useEditor.getState();
    expect(after.colors.body).toEqual(solid('#123456'));
    expect(after.textFill).toEqual(solid('#ff00ff'));
    expect(after.mode).toBe('logo');
    expect(after.logo?.svg).toBe(svg(5));
  });

  it('saves only colours when asked, or the text in text mode; reset keeps the library', () => {
    const s = useEditor.getState();
    s.set('text', 'HELLO');
    const colorsOnly = s.saveUserPreset('', false)!;
    expect(colorsOnly.content).toBeUndefined();
    expect(colorsOnly.name).toBe('★ 1');
    const withText = useEditor.getState().saveUserPreset('T', true)!;
    expect(withText.content).toEqual({ mode: 'text', text: 'HELLO', fontId: initialData().fontId });

    useEditor.getState().toggleFavColor('#111111');
    useEditor.getState().reset();
    expect(useEditor.getState().userPresets).toHaveLength(2);
    expect(useEditor.getState().favColors).toEqual(['#111111']);
    useEditor.getState().removeUserPreset(colorsOnly.id);
    expect(useEditor.getState().userPresets.map((p) => p.name)).toEqual(['T']);
  });
});
