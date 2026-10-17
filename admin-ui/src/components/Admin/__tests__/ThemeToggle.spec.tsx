import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '~/theme/ThemeProvider';
import ThemeToggle from '../ThemeToggle';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  mockMatchMedia(false);
});

describe('ThemeToggle', () => {
  it('starts on the system option and marks it as the chosen one', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: 'com_admin_theme_system' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('switches the page to dark and remembers the choice', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'com_admin_theme_dark' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  /**
   * «Как в системе» — это подписка на настройку ОС, а не разовое чтение: у того, у кого
   * тема переключается по расписанию, админка обязана поехать вместе с ней.
   */
  it('follows the OS setting while the system option is selected', () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'com_admin_theme_light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
