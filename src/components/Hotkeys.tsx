import { useEffect, useState } from 'react';
import { translate } from '../i18n';
import { copySelection, deleteSelection, pasteText, storedClip } from '../state/editCommands';
import { redo, startHistory, undo } from '../state/history';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
const say = (key: Parameters<typeof translate>[1]) => useUi.getState().showToast(translate(useEditor.getState().lang, key));

/**
 * Keyboard of the editor: Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo, Delete/Backspace removes the selection,
 * Ctrl/⌘+C / V copy and paste layers — through the system clipboard, so between editor windows too. Fields
 * being typed in keep their own keys.
 */
export function useHotkeys(): void {
  useEffect(() => {
    startHistory();
    const inEditor = () => useUi.getState().section === 'create';
    const onKey = (e: KeyboardEvent) => {
      if (!inEditor() || typing(e.target) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        say(undo() ? 'undone' : 'nothingToUndo');
      } else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        if (redo()) say('redone');
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (deleteSelection()) e.preventDefault();
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!inEditor() || typing(e.target) || window.getSelection()?.toString()) return;
      const json = copySelection();
      if (!json || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', json);
      say('clipCopied');
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!inEditor() || typing(e.target)) return;
      // The system clipboard first (another window, another app); this browser's last copy if it holds none.
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (pasteText(text) || (!text.trim() && pasteText(storedClip()))) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}

/** Short messages (copied, pasted, undone…) at the bottom. */
export function Toast() {
  const toast = useUi((u) => u.toast);
  const [shown, setShown] = useToastTimer(toast?.n);
  if (!toast || !shown) return null;
  return (
    <div key={toast.n} className="toast" role="status" onClick={() => setShown(false)}>
      {toast.text}
    </div>
  );
}

function useToastTimer(n: number | undefined): [boolean, (v: boolean) => void] {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (n === undefined) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), 2600);
    return () => clearTimeout(timer);
  }, [n]);
  return [shown, setShown];
}
