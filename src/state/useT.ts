import { useCallback } from 'react';
import { translate, type I18nKey } from '../i18n';
import { useEditor } from './store';

export function useT() {
  const lang = useEditor((s) => s.lang);
  return useCallback((key: I18nKey) => translate(lang, key), [lang]);
}
