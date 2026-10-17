import {
  clearLoggedOutIntentionally,
  clearSessionActive,
  clearSilentTarget,
  consumeSilentTarget,
  markAutoLoginAttempt,
  markLoggedOutIntentionally,
  markSessionActive,
  recentAutoLoginAttempt,
  silentTargetFor,
  storeSilentTarget,
  wasLoggedOutIntentionally,
  wasSessionActive,
} from '../silentSession';

describe('silentSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('is inactive until a session is marked active', () => {
    expect(wasSessionActive()).toBe(false);
    markSessionActive();
    expect(wasSessionActive()).toBe(true);
  });

  it('clearing the flag turns it back off', () => {
    markSessionActive();
    clearSessionActive();
    expect(wasSessionActive()).toBe(false);
  });

  it('never stores anything token-shaped — only the flag itself', () => {
    markSessionActive();
    const raw = sessionStorage.getItem('admin.session.active');
    expect(raw).toBe('true');
  });

  it('stores and consumes the silent-restore target exactly once', () => {
    storeSilentTarget('/admin/spend');
    expect(consumeSilentTarget()).toBe('/admin/spend');
    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('returns undefined when no target was stored', () => {
    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('returns a target consumed within the TTL window', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    storeSilentTarget('/admin/users?page=3');

    jest.spyOn(Date, 'now').mockReturnValue(now + 9 * 60 * 1000);
    expect(consumeSilentTarget()).toBe('/admin/users?page=3');

    jest.restoreAllMocks();
  });

  it('drops a target once it is older than the TTL window', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    storeSilentTarget('/admin/users?page=3');

    jest.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000 + 1);
    expect(consumeSilentTarget()).toBeUndefined();

    jest.restoreAllMocks();
  });

  it('ignores a corrupted stored target instead of throwing', () => {
    sessionStorage.setItem('admin.session.silentTarget', 'not-json');
    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('clears the stored target without returning it', () => {
    storeSilentTarget('/admin/spend');
    clearSilentTarget();
    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('does nothing when there was nothing stored', () => {
    expect(() => clearSilentTarget()).not.toThrow();
  });
});

describe('silentSession — rejects a target shaped like an external redirect', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it.each(['//evil.com/admin', '/\\evil.com/admin', 'https://evil.com', 'evil.com'])(
    'drops a stored target of %p instead of handing it back',
    (unsafeTarget) => {
      sessionStorage.setItem(
        'admin.session.silentTarget',
        JSON.stringify({ target: unsafeTarget, storedAt: Date.now() }),
      );
      expect(consumeSilentTarget()).toBeUndefined();
    },
  );

  it('still accepts an ordinary in-app path', () => {
    storeSilentTarget('/admin/users?page=3');
    expect(consumeSilentTarget()).toBe('/admin/users?page=3');
  });
});

describe('silentTargetFor', () => {
  it('combines pathname and search into the target', () => {
    expect(silentTargetFor({ pathname: '/admin/spend', search: '?range=30d' })).toBe(
      '/admin/spend?range=30d',
    );
  });

  it('refuses the login page as a target', () => {
    expect(silentTargetFor({ pathname: '/login', search: '' })).toBeUndefined();
  });

  it('refuses the OpenID callback route as a target', () => {
    expect(silentTargetFor({ pathname: '/auth/openid/callback', search: '?code=abc' })).toBeUndefined();
  });
});

describe('silentSession — auto-login attempt timestamp', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.useRealTimers();
  });

  it('reports no recent attempt when none was ever recorded', () => {
    expect(recentAutoLoginAttempt(30_000)).toBe(false);
  });

  it('reports a recent attempt right after it was marked', () => {
    markAutoLoginAttempt();
    expect(recentAutoLoginAttempt(30_000)).toBe(true);
  });

  it('stops reporting an attempt as recent once the window elapses', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    markAutoLoginAttempt();

    jest.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    expect(recentAutoLoginAttempt(30_000)).toBe(false);

    jest.restoreAllMocks();
  });

  it('ignores a corrupted timestamp instead of throwing', () => {
    sessionStorage.setItem('admin.session.lastAutoAttempt', 'not-a-number');
    expect(recentAutoLoginAttempt(30_000)).toBe(false);
  });
});

describe('silentSession — intentional-logout flag survives across tabs', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('is inactive until logout is marked', () => {
    expect(wasLoggedOutIntentionally()).toBe(false);
    markLoggedOutIntentionally();
    expect(wasLoggedOutIntentionally()).toBe(true);
  });

  it('clearing the flag turns it back off', () => {
    markLoggedOutIntentionally();
    clearLoggedOutIntentionally();
    expect(wasLoggedOutIntentionally()).toBe(false);
  });

  it('is stored in localStorage, not sessionStorage — a fresh tab (which starts with empty sessionStorage but shares localStorage) must still see it', () => {
    markLoggedOutIntentionally();

    expect(localStorage.getItem('admin.session.loggedOut')).toBe('true');
    expect(sessionStorage.getItem('admin.session.loggedOut')).toBeNull();

    // Simulates opening a brand-new tab of the same origin: sessionStorage never
    // carries over to a new tab, but localStorage does — the flag must still read true.
    sessionStorage.clear();
    expect(wasLoggedOutIntentionally()).toBe(true);
  });
});
