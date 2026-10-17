import { buildApproveLimitsPayload } from '../buildApproveLimitsPayload';

describe('buildApproveLimitsPayload', () => {
  it('sets the daily cost field when the cost input is filled', () => {
    const payload = buildApproveLimitsPayload('150');
    expect(payload).toEqual({ dailyCostUsd: 150 });
  });

  it('never sends a request-count field', () => {
    const payload = buildApproveLimitsPayload('150');
    expect(payload).not.toHaveProperty('dailyRequests');
  });

  it('sends an empty object — no fields at all — when nothing was filled in', () => {
    expect(buildApproveLimitsPayload('')).toEqual({});
  });

  it('parses input strings to numbers rather than sending them as strings', () => {
    const payload = buildApproveLimitsPayload('150.5');
    expect(payload.dailyCostUsd).toBe(150.5);
    expect(typeof payload.dailyCostUsd).toBe('number');
  });
});
