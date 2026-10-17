import { applyTheme, normalizeTheme, persistTheme, readStoredTheme, resolveTheme } from '../theme';

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
  document.documentElement.style.colorScheme = '';
});

describe('theme preferences', () => {
  it('falls back to the system preference for anything unrecognized', () => {
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('solarized')).toBe('system');
    expect(normalizeTheme(null)).toBe('system');
  });

  it('round-trips the stored choice', () => {
    persistTheme('dark');
    expect(readStoredTheme()).toBe('dark');
  });

  /**
   * localStorage бросает в приватном режиме части браузеров — на входе в админку это
   * означало бы белый экран вместо страницы, поэтому чтение и запись обязаны молчать.
   */
  it('survives storage that throws instead of failing to load the app', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readStoredTheme()).toBe('system');
    expect(() => persistTheme('dark')).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('resolves the system preference against the OS setting, and an explicit one as chosen', () => {
    mockMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');

    mockMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  /**
   * `color-scheme` перекрашивает то, что рисует сам браузер — полосы прокрутки и поля
   * ввода. Без него тёмная страница остаётся со светлым скроллбаром сбоку.
   */
  it('applies both the tailwind class and the browser color scheme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
