import type { DictationPhase } from '~/utils/audio/dictation';
import type { TranslationKeys } from '~/hooks/useLocalize';

export const DICTATION_STATUS_KEYS: Record<Exclude<DictationPhase, 'idle'>, TranslationKeys> = {
  listening: 'com_ui_dictation_listening',
  transcribing: 'com_ui_dictation_transcribing',
};
