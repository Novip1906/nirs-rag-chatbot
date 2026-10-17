import { formatDate } from '../files';

const localDate = (year: number, month: number, day: number): string =>
  new Date(year, month, day).toISOString();

describe('formatDate', () => {
  it('formats the full date for the ru interface language', () => {
    expect(formatDate(localDate(2026, 8, 13), false, 'ru')).toBe('13 сент. 2026 г.');
  });

  it('formats the full date for the en interface language', () => {
    expect(formatDate(localDate(2026, 8, 13), false, 'en')).toBe('Sep 13, 2026');
  });

  it('formats the small-screen date using the interface language', () => {
    expect(formatDate(localDate(2026, 8, 13), true, 'en')).toBe('9/13/26');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDate('not a date', false, 'en')).toBe('');
  });

  it('returns an empty string for an empty value', () => {
    expect(formatDate('', false, 'en')).toBe('');
  });
});
