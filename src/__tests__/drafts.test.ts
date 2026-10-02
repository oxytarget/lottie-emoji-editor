import { describe, expect, it } from 'vitest';
import { useEditor } from '../state/store';

describe('drafts', () => {
  it('saves the design, brings it back, renames and deletes', () => {
    const s = useEditor.getState();
    s.set('text', 'BRAND');
    s.set('selected', ['classic', 'heart', 'import-x1', 'pack:Gone:u1']);
    s.set('scale', 1.3);
    const id = useEditor.getState().saveDraft('data:image/png;base64,AAA');
    const draft = useEditor.getState().drafts[0];
    expect(draft.id).toBe(id);
    expect(draft.name).toBe('«BRAND» · 3');
    // Files imported in this session cannot come back later.
    expect(draft.design.selected).toEqual(['classic', 'heart', 'pack:Gone:u1']);

    useEditor.getState().set('text', 'OTHER');
    useEditor.getState().set('scale', 0.8);
    useEditor.getState().openDraft(id);
    const after = useEditor.getState();
    expect([after.text, after.scale]).toEqual(['BRAND', 1.3]);
    // A pack that is no longer in "My packs" is not selected again.
    expect(after.selected).toEqual(['classic', 'heart']);

    // Saving over it keeps its name and picture, updates the design.
    useEditor.getState().set('text', 'NEW');
    useEditor.getState().saveDraft(undefined, id);
    expect(useEditor.getState().drafts).toHaveLength(1);
    expect(useEditor.getState().drafts[0]).toMatchObject({ name: '«BRAND» · 3', thumb: 'data:image/png;base64,AAA' });
    expect(useEditor.getState().drafts[0].design.text).toBe('NEW');

    useEditor.getState().renameDraft(id, '  Promo  ');
    expect(useEditor.getState().drafts[0].name).toBe('Promo');
    // Reset keeps drafts.
    useEditor.getState().reset();
    expect(useEditor.getState().drafts).toHaveLength(1);
    useEditor.getState().deleteDraft(id);
    expect(useEditor.getState().drafts).toEqual([]);
  });
});
