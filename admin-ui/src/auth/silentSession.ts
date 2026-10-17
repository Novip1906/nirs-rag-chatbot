const ACTIVE_FLAG_KEY = 'admin.session.active';
const TARGET_KEY = 'admin.session.silentTarget';

/**
 * No token ever lives here — just a marker that this tab has completed a real
 * login before, so a reload can retry silently against the live single sign-on
 * session instead of dropping straight to the login form. Cleared on logout
 * and whenever a login attempt (silent or manual) fails, so a dead single sign-on
 * session can't bounce the app in a redirect loop.
 */
export function markSessionActive(): void {
  try {
    sessionStorage.setItem(ACTIVE_FLAG_KEY, 'true');
  } catch {
    return;
  }
}

export function clearSessionActive(): void {
  try {
    sessionStorage.removeItem(ACTIVE_FLAG_KEY);
  } catch {
    return;
  }
}

export function wasSessionActive(): boolean {
  try {
    return sessionStorage.getItem(ACTIVE_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

const TARGET_TTL_MS = 10 * 60 * 1000;

const LOGIN_PATH = '/login';
const CALLBACK_PATH = '/auth/openid/callback';

/**
 * Общая для RequireAuth и AuthContext логика: ни экран входа, ни сам callback не
 * годятся в цель возврата — первый обнулил бы её тут же следующим 401/редиректом,
 * второй никогда не бывает местом, куда стоит возвращаться после входа.
 */
export function silentTargetFor(location: { pathname: string; search: string }): string | undefined {
  if (location.pathname === LOGIN_PATH || location.pathname === CALLBACK_PATH) {
    return undefined;
  }
  return `${location.pathname}${location.search}`;
}

/**
 * Только относительный путь в пределах приложения: `//evil.com` и `/\evil.com`
 * браузер и часть роутеров толкуют как переход на другой хост, хотя оба начинаются
 * с одного слеша. Раз в это поле в принципе может попасть что угодно из
 * sessionStorage (расширение, старая версия фронтенда, ручная правка), возврат
 * после входа не должен доверять форме значения без проверки.
 */
function isSafeSilentTarget(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\');
}

export function storeSilentTarget(target: string): void {
  if (wasLoggedOutIntentionally()) {
    return;
  }
  try {
    sessionStorage.setItem(TARGET_KEY, JSON.stringify({ target, storedAt: Date.now() }));
  } catch {
    return;
  }
}

export function clearSilentTarget(): void {
  try {
    sessionStorage.removeItem(TARGET_KEY);
  } catch {
    return;
  }
}

export function consumeSilentTarget(): string | undefined {
  try {
    const raw = sessionStorage.getItem(TARGET_KEY);
    sessionStorage.removeItem(TARGET_KEY);
    if (raw == null) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as { target?: unknown; storedAt?: unknown };
    if (typeof parsed.target !== 'string' || typeof parsed.storedAt !== 'number') {
      return undefined;
    }
    if (Date.now() - parsed.storedAt > TARGET_TTL_MS) {
      return undefined;
    }
    if (!isSafeSilentTarget(parsed.target)) {
      return undefined;
    }
    return parsed.target;
  } catch {
    return undefined;
  }
}

const LOGGED_OUT_KEY = 'admin.session.loggedOut';

export function markLoggedOutIntentionally(): void {
  try {
    localStorage.setItem(LOGGED_OUT_KEY, 'true');
  } catch {
    return;
  }
}

// Снимается в AuthContext только при успешном обмене кода на сессию, а не в
// момент клика по кнопке входа — иначе неудачная попытка (сеть, отклонённый
// код) молча сняла бы защиту раньше, чем человек действительно вошёл.
export function clearLoggedOutIntentionally(): void {
  try {
    localStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    return;
  }
}

export function wasLoggedOutIntentionally(): boolean {
  try {
    return localStorage.getItem(LOGGED_OUT_KEY) === 'true';
  } catch {
    return false;
  }
}

const LAST_AUTO_ATTEMPT_KEY = 'admin.session.lastAutoAttempt';

/**
 * Отметка времени последнего автоматического перехода на единый вход. Обычный
 * ref внутри LoginPage переживает только одно монтирование компонента, а
 * переход на сервер входа и обратно — это полная перезагрузка страницы, так что
 * защититься от петли «/login → сервер входа → callback → 401 → /login» можно
 * только меткой в sessionStorage, которая переживает перезагрузку.
 */
export function markAutoLoginAttempt(): void {
  try {
    sessionStorage.setItem(LAST_AUTO_ATTEMPT_KEY, String(Date.now()));
  } catch {
    return;
  }
}

export function recentAutoLoginAttempt(withinMs: number): boolean {
  try {
    const raw = sessionStorage.getItem(LAST_AUTO_ATTEMPT_KEY);
    if (raw == null) {
      return false;
    }
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    return Date.now() - timestamp < withinMs;
  } catch {
    return false;
  }
}
