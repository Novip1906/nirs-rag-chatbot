import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useTheme } from '~/theme/ThemeProvider';
import type { ThemePreference } from '~/theme/theme';

export default function ThemeToggle(): JSX.Element {
  const localize = useLocalize();
  const { theme, setTheme } = useTheme();

  return (
    <SegmentedControl<ThemePreference>
      role="radiogroup"
      size="sm"
      ariaLabel={localize('com_admin_theme_label')}
      value={theme}
      onChange={setTheme}
      items={[
        { value: 'light', icon: Sun, ariaLabel: localize('com_admin_theme_light') },
        { value: 'dark', icon: Moon, ariaLabel: localize('com_admin_theme_dark') },
        { value: 'system', icon: Monitor, ariaLabel: localize('com_admin_theme_system') },
      ]}
    />
  );
}
