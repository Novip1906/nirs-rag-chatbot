import {
  DICTATION_LANGUAGES,
  DEFAULT_DICTATION_LANGUAGE,
  isDictationLanguage,
  parseDictationLanguage,
  normalizeDictationLanguage,
} from '../src/dictation';

describe('DICTATION_LANGUAGES', () => {
  it('supports only ru and en, defaulting to ru', () => {
    expect(DICTATION_LANGUAGES).toEqual(['ru', 'en']);
    expect(DEFAULT_DICTATION_LANGUAGE).toBe('ru');
  });
});

describe('isDictationLanguage', () => {
  it('recognizes ru and en', () => {
    expect(isDictationLanguage('ru')).toBe(true);
    expect(isDictationLanguage('en')).toBe(true);
  });

  it('rejects unsupported values', () => {
    expect(isDictationLanguage('de')).toBe(false);
    expect(isDictationLanguage('')).toBe(false);
  });
});

describe('parseDictationLanguage', () => {
  it('takes the part before the hyphen, case-insensitive and trimmed', () => {
    expect(parseDictationLanguage('en-US')).toBe('en');
    expect(parseDictationLanguage(' RU ')).toBe('ru');
  });

  it('returns null for unsupported values', () => {
    expect(parseDictationLanguage('de-DE')).toBeNull();
  });
});

describe('normalizeDictationLanguage', () => {
  it('falls back to ru for unknown values', () => {
    expect(normalizeDictationLanguage('fr')).toBe('ru');
  });
});
