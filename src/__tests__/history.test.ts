import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, redo, startHistory, undo } from '../state/history';
import { useEditor, type ImportedTemplate } from '../state/store';

const sticker = (id: string): ImportedTemplate =>
  ({ id, name: id, data: { layers: [] }, base: { layers: [] }, layout: [], palette: ['#ff0000'], colorMap: {}, overlay: false, hidden: [], replace: null, transforms: {} }) as unknown as ImportedTemplate;

describe('undo / redo', () => {
  beforeEach(() => {
    startHistory();
    useEditor.setState({ text: 'A', scale: 1, imports: [sticker('i1')], selected: ['classic'] });
    clearHistory();
  });

  it('undoes design edits step by step and redoes them', async () => {
    useEditor.getState().set('text', 'AB');
    useEditor.getState().set('text', 'ABC'); // same burst (typing): one step
    await new Promise((r) => setTimeout(r, 750));
    useEditor.getState().set('scale', 1.5);
    expect(undo()).toBe(true);
    expect([useEditor.getState().text, useEditor.getState().scale]).toEqual(['ABC', 1]);
    expect(undo()).toBe(true);
    expect(useEditor.getState().text).toBe('A');
    expect(undo()).toBe(false);
    expect(redo()).toBe(true);
    expect(useEditor.getState().text).toBe('ABC');
    expect(redo()).toBe(true);
    expect(useEditor.getState().scale).toBe(1.5);
  });

  it('undoes edits of imported animations, not selection or packs loading', () => {
    useEditor.getState().set('selected', ['classic', 'i1']);
    useEditor.setState({ imports: [...useEditor.getState().imports, sticker('i2')] });
    expect(undo()).toBe(false);
    useEditor.getState().editImport('i1', { kind: 'hide', part: 'l0', hidden: true });
    expect(useEditor.getState().imports[0].hidden).toEqual(['l0']);
    expect(undo()).toBe(true);
    expect(useEditor.getState().imports[0].hidden).toEqual([]);
    // The pack sticker loaded meanwhile stays; the selection is not touched.
    expect(useEditor.getState().imports.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(useEditor.getState().selected).toEqual(['classic', 'i1']);
  });
});
