import { formatLocaleDate, formatLocaleDateTime } from '../date';

const localDate = (year: number, month: number, day: number, hour = 0, minute = 0): string =>
  new Date(year, month, day, hour, minute).toISOString();

describe('formatLocaleDate', () => {
  it('formats a medium-length date for the ru interface language', () => {
    expect(formatLocaleDate(localDate(2026, 8, 13), 'ru')).toBe('13 сент. 2026 г.');
  });

  it('formats a medium-length date for the en interface language', () => {
    expect(formatLocaleDate(localDate(2026, 8, 13), 'en')).toBe('Sep 13, 2026');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatLocaleDate('not a date', 'en')).toBe('');
  });

  it('does not throw on an invalid locale tag and falls back to the environment locale', () => {
    expect(() => formatLocaleDate(localDate(2026, 8, 13), 'xx-invalid-!!')).not.toThrow();
    expect(formatLocaleDate(localDate(2026, 8, 13), 'xx-invalid-!!')).not.toBe('');
  });
});

describe('formatLocaleDateTime', () => {
  it('formats a medium date with a 24-hour clock for the ru interface language', () => {
    expect(formatLocaleDateTime(localDate(2026, 8, 13, 23, 31), 'ru', false)).toBe(
      '13 сент. 2026 г., 23:31',
    );
  });

  it('formats a medium date with a 12-hour clock for the en interface language', () => {
    expect(formatLocaleDateTime(localDate(2026, 8, 13, 23, 31), 'en', true)).toMatch(
      /^Sep 13, 2026, 11:31\sPM$/,
    );
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatLocaleDateTime('not a date', 'en', true)).toBe('');
  });

  it('does not throw on an invalid locale tag and falls back to the environment locale', () => {
    expect(() =>
      formatLocaleDateTime(localDate(2026, 8, 13, 23, 31), 'xx-invalid-!!', false),
    ).not.toThrow();
    expect(formatLocaleDateTime(localDate(2026, 8, 13, 23, 31), 'xx-invalid-!!', false)).not.toBe(
      '',
    );
  });
});
