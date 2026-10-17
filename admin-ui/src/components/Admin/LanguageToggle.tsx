import { SegmentedControl } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useLocaleContext } from '~/locales/LocaleProvider';
import type { SupportedLocale } from '~/locales';

export default function LanguageToggle(): JSX.Element {
  const localize = useLocalize();
  const { locale, setLocale } = useLocaleContext();

  return (
    <SegmentedControl<SupportedLocale>
      role="radiogroup"
      size="sm"
      ariaLabel={localize('com_admin_language_label')}
      value={locale}
      onChange={setLocale}
      items={[
        { value: 'ru', label: 'RU', ariaLabel: localize('com_admin_language_ru') },
        { value: 'en', label: 'EN', ariaLabel: localize('com_admin_language_en') },
      ]}
    />
  );
}
