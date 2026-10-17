import { validatePartialLimits } from './limitsValidation';

describe('validatePartialLimits', () => {
  it('accepts a valid partial payload', () => {
    const result = validatePartialLimits({ dailyCostUsd: 150 });
    expect(result).toEqual({ ok: true, limits: { dailyCostUsd: 150 } });
  });

  it('accepts null as "no limit" for an individual field', () => {
    const result = validatePartialLimits({ dailyCostUsd: null });
    expect(result).toEqual({ ok: true, limits: { dailyCostUsd: null } });
  });

  it('accepts an empty object', () => {
    expect(validatePartialLimits({})).toEqual({ ok: true, limits: {} });
  });

  it('rejects a negative cost', () => {
    const result = validatePartialLimits({ dailyCostUsd: -5 });
    expect(result.ok).toBe(false);
  });

  it('accepts a non-integer cost (rubles can have kopecks)', () => {
    const result = validatePartialLimits({ dailyCostUsd: 99.9 });
    expect(result).toEqual({ ok: true, limits: { dailyCostUsd: 99.9 } });
  });

  it('rejects NaN and Infinity', () => {
    expect(validatePartialLimits({ dailyCostUsd: NaN }).ok).toBe(false);
    expect(validatePartialLimits({ dailyCostUsd: Infinity }).ok).toBe(false);
    expect(validatePartialLimits({ dailyCostUsd: -Infinity }).ok).toBe(false);
  });

  it('rejects an unknown key instead of silently dropping it', () => {
    const result = validatePartialLimits({ dailyCostUsd: 10, weeklyCostUsd: 5 });
    expect(result.ok).toBe(false);
  });

  it('rejects the removed request-count and monthly fields as unknown keys', () => {
    expect(validatePartialLimits({ dailyRequests: 10 }).ok).toBe(false);
    expect(validatePartialLimits({ monthlyCostUsd: 10 }).ok).toBe(false);
    expect(validatePartialLimits({ monthlyRequests: 10 }).ok).toBe(false);
  });

  it('rejects a string value', () => {
    expect(validatePartialLimits({ dailyCostUsd: '150' }).ok).toBe(false);
  });

  it('rejects arrays and non-objects', () => {
    expect(validatePartialLimits([]).ok).toBe(false);
    expect(validatePartialLimits('nope').ok).toBe(false);
    expect(validatePartialLimits(42).ok).toBe(false);
    expect(validatePartialLimits(null).ok).toBe(false);
  });
});
