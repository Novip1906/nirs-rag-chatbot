import { useAtom } from 'jotai';
import { Dropdown } from '@librechat/client';
import { DICTATION_LANGUAGES, normalizeDictationLanguage } from 'librechat-data-provider';
import type { DictationLanguage } from 'librechat-data-provider';
import { dictationLanguageAtom } from '~/store/dictationLanguage';
import { useLocalize } from '~/hooks';

export default function DictationLanguageSelector() {
  const localize = useLocalize();
  const [dictationLanguage, setDictationLanguage] = useAtom(dictationLanguageAtom);

  const options = DICTATION_LANGUAGES.map((language) => ({
    value: language,
    label: localize(`com_nav_dictation_language_${language}`),
  }));

  const labelId = 'dictation-language-selector-label';

  return (
    <div className="flex w-full items-center justify-between">
      <div id={labelId}>{localize('com_nav_dictation_language')}</div>
      <Dropdown
        value={normalizeDictationLanguage(dictationLanguage)}
        options={options}
        onChange={(value) => setDictationLanguage(value as DictationLanguage)}
        testId="dictation-language-selector"
        sizeClasses="z-50 w-[150px]"
        className="z-50"
        aria-labelledby={labelId}
      />
    </div>
  );
}
