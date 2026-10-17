import { formatLimit, formatLimitChange, STATUS_VARIANT, UNKNOWN_LIMIT } from '../display';

describe('limit request display helpers', () => {
  it('renders a recorded limit as a dollar amount', () => {
    expect(formatLimit(500)).toBe('$500,00');
  });

  it('renders a missing snapshot as a dash rather than zero', () => {
    expect(formatLimit(null)).toBe(UNKNOWN_LIMIT);
    expect(formatLimit(undefined)).toBe(UNKNOWN_LIMIT);
  });

  it('shows the transition once a new limit has been granted', () => {
    const groupSeparator = new Intl.NumberFormat('ru-RU').format(1000).charAt(1);
    expect(formatLimitChange(500, 1200)).toBe(`$500,00 → $1${groupSeparator}200,00`);
  });

  it('shows only the current limit while the request is still open', () => {
    expect(formatLimitChange(500, null)).toBe('$500,00');
  });

  it('keeps the dash on both sides for pre-snapshot records', () => {
    expect(formatLimitChange(null, null)).toBe(UNKNOWN_LIMIT);
  });

  it('maps a rejected request to the error tag, not the pending one', () => {
    expect(STATUS_VARIANT.rejected).toBe('error');
    expect(STATUS_VARIANT.approved).toBe('success');
    expect(STATUS_VARIANT.pending).toBe('warning');
  });
});
