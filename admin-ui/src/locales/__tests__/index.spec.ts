import { detectInitialLocale, normalizeLocale, persistLocale } from '../index';

describe('locale detection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to Russian with no stored preference, regardless of browser language', () => {
    expect(detectInitialLocale()).toBe('ru');
  });

  it('normalizeLocale falls back to Russian for unsupported or missing locales', () => {
    expect(normalizeLocale(undefined)).toBe('ru');
    expect(normalizeLocale(null)).toBe('ru');
    expect(normalizeLocale('fr-FR')).toBe('ru');
  });

  it('normalizeLocale accepts a supported locale, base-tag only', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ru-RU')).toBe('ru');
  });

  it('respects an explicitly persisted choice across detections', () => {
    persistLocale('en');
    expect(detectInitialLocale()).toBe('en');
  });
});
