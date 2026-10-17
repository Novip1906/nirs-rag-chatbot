import { ADMIN_TABS } from '../adminNav.config';
import ru from '~/locales/ru/translation.json';
import en from '~/locales/en/translation.json';

describe('general tab nav', () => {
  const section = ADMIN_TABS.find((tab) => tab.id === 'general')!.sections.find(
    (item) => item.to === '/admin/users',
  )!;

  it('labels the employees section as employees in both languages', () => {
    expect((ru as Record<string, string>)[section.labelKey]).toBe('Сотрудники');
    expect((en as Record<string, string>)[section.labelKey]).toBe('Employees');
  });
});
