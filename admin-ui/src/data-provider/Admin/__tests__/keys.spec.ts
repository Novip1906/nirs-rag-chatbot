import { adminKeys } from '../keys';

describe('Admin query keys', () => {
  it('scopes the activity key by its query params', () => {
    const params = { from: '2026-01-01', to: '2026-01-31' };

    expect(adminKeys.activity(params)).toEqual(['admin', 'activity', params]);
    expect(adminKeys.activity({})).not.toEqual(adminKeys.activity(params));
  });

  it('scopes the feedback key by its query params', () => {
    const params = { from: '2026-01-01', to: '2026-01-31', rating: 'thumbsDown' as const };

    expect(adminKeys.feedback(params)).toEqual(['admin', 'feedback', params]);
    expect(adminKeys.feedback({})).not.toEqual(adminKeys.feedback(params));
  });
});
