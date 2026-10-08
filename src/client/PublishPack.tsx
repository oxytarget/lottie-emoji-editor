import { useState } from 'react';
import { adminCall } from '../lib/accountApi';
import { useAccount } from '../state/account';
import { packEditOf, useEditor, type ImportedTemplate } from '../state/store';
import { CheckIcon, ShieldIcon } from '../components/icons';
import { useCT } from './i18n';

/**
 * Admin, advanced editor: publishes how the stickers of a template pack are set up (where the client's photo /
 * logo / text goes, hidden parts, colours, added layers) — clients opening the pack get exactly that.
 */
export function PublishPack({ imp }: { imp: ImportedTemplate }) {
  const t = useCT();
  const role = useAccount((s) => s.account?.role);
  const [state, setState] = useState<null | 'busy' | 'done' | 'failed'>(null);
  const pack = imp.source?.pack;
  if (role !== 'admin' || !pack) return null;
  const publish = async () => {
    setState('busy');
    const s = useEditor.getState();
    const stickers = s.imports.filter((i) => i.source?.pack === pack);
    const edits = Object.fromEntries(stickers.map((i) => [i.source!.uid, packEditOf(i)]));
    // The logos/texts the layer lists insert travel along.
    const keys = new Set(stickers.flatMap((i) => i.layout.flatMap((op) => (op.kind === 'insert' ? [op.svg] : []))));
    const svgs = Object.fromEntries([...keys].flatMap((k) => (s.layoutSvgs[k] ? [[k, s.layoutSvgs[k]]] : [])));
    const res = await adminCall('publish-template', {
      pack,
      edits: { edits, svgs },
    });
    setState(res.ok ? 'done' : 'failed');
  };
  return (
    <button type="button" className="pill-btn is-compact is-accent" disabled={state === 'busy'} onClick={publish}>
      {state === 'busy' ? (
        <span className="btn-spinner" aria-hidden />
      ) : state === 'done' ? (
        <CheckIcon width={16} height={16} />
      ) : (
        <ShieldIcon width={16} height={16} />
      )}
      {state === 'done' ? t('published') : t('publish')}
    </button>
  );
}
