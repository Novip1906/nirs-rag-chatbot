import { DEFAULT_DICTATION_LANGUAGE } from 'librechat-data-provider';
import type { DictationLanguage } from 'librechat-data-provider';
import { createStorageAtom } from './jotai-utils';

export const dictationLanguageAtom = createStorageAtom<DictationLanguage>(
  'dictationLanguage',
  DEFAULT_DICTATION_LANGUAGE,
);
