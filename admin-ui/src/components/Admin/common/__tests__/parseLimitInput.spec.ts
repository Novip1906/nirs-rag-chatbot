import { parseLimitInput } from '../parseLimitInput';

describe('parseLimitInput', () => {
  /**
   * Critical regression: an empty field is "inherit" (`null`), never `0`. Zero means
   * "block every request" in this system — the admin scenario this guards against is
   * selecting a limit to retype it, getting interrupted, and saving with the field blank.
   */
  it('parses an empty string as null (inherit), not zero', () => {
    expect(parseLimitInput('')).toEqual({ value: null });
    expect(parseLimitInput('   ')).toEqual({ value: null });
  });

  it('parses an explicit "0" as the number zero — a deliberate block, not inherit', () => {
    expect(parseLimitInput('0')).toEqual({ value: 0 });
  });

  it('parses an ordinary positive value', () => {
    expect(parseLimitInput('500')).toEqual({ value: 500 });
  });

  it('allows fractional rubles', () => {
    expect(parseLimitInput('12.5')).toEqual({ value: 12.5 });
  });

  it('rejects a negative number with an error, and does not pass it through as a value', () => {
    const result = parseLimitInput('-5');
    expect(result.errorKey).toBe('com_admin_limits_error_negative');
    expect(result.value).not.toBe(-5);
  });

  it('rejects non-numeric input with an error', () => {
    const result = parseLimitInput('abc');
    expect(result.errorKey).toBe('com_admin_limits_error_invalid');
  });
});
