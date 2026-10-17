import { formatKeyExpiryLabel } from '../utils';

const localize = (key: string, options?: Record<string, unknown>) => {
  const value = options?.[0];
  return value != null ? `${key}:${value}` : key;
};

describe('formatKeyExpiryLabel', () => {
  const localExpiry = new Date(2026, 8, 13, 23, 31).toISOString();

  it('formats the expiry in a 24-hour clock, without AM/PM, for the ru interface language', () => {
    const label = formatKeyExpiryLabel(localize, localExpiry, 'ru', false);
    expect(label).toContain('23:31');
    expect(label).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it('formats the expiry with a meridiem for the en interface language', () => {
    const label = formatKeyExpiryLabel(localize, localExpiry, 'en', true);
    expect(label).toContain('11:31:00 PM');
  });
});
