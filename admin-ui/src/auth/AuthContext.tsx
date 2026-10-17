import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  computeCodeChallenge,
  consumeVerifier,
  generateCodeVerifier,
  generateState,
  storeAuthRequest,
} from './pkce';
import { buildAuthorizeUrl, buildLogoutUrl, exchangeCode } from './oidc';
import {
  clearLoggedOutIntentionally,
  clearSessionActive,
  clearSilentTarget,
  markLoggedOutIntentionally,
  markSessionActive,
  silentTargetFor,
  storeSilentTarget,
  wasSessionActive,
} from './silentSession';
import {
  getSession,
  registerUnauthorizedHandler,
  sessionFromTokens,
  setSession,
  subscribe,
} from './tokenStore';
import type { Session } from './tokenStore';
import { navigateExternal } from '../config';
import type { TUser } from '../types/user';

const CALLBACK_PATH = '/auth/openid/callback';

type AuthContextType = {
  user: TUser | undefined;
  token: string | undefined;
  isAuthenticated: boolean;
  isRestoring: boolean;
  login: () => Promise<void>;
  logout: () => void;
  completeLogin: (code: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const redirectUri = (): string => `${window.location.origin}${CALLBACK_PATH}`;

async function redirectToOpenId(targetPath?: string): Promise<void> {
  const verifier = generateCodeVerifier();
  const state = generateState();
  storeAuthRequest(verifier, state);
  if (targetPath) {
    storeSilentTarget(targetPath);
  }
  const codeChallenge = await computeCodeChallenge(verifier);
  navigateExternal(buildAuthorizeUrl({ codeChallenge, state, redirectUri: redirectUri() }));
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [session, setLocalSession] = useState<Session | undefined>(() => getSession());
  const [isRestoring, setIsRestoring] = useState<boolean>(() => getSession() == null);

  useEffect(() => subscribe(setLocalSession), []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      const targetPath = silentTargetFor(location);
      if (targetPath) {
        storeSilentTarget(targetPath);
      }
      setSession(undefined);
      // Без этого сброс сессии по 401 оставляет признак «сессия была активна» —
      // при устойчивом 401 (рассинхрон часов, ротация ключа, отозванный доступ)
      // новый токен эту причину не лечит, и защита маршрута с эффектом
      // восстановления ниже уводили бы обратно на единый вход по кругу.
      clearSessionActive();
    });
  }, [location]);

  useEffect(() => {
    // Экран с объяснением ошибки не должен тут же смениться новым переходом —
    // иначе даже открытие /login?error=… по этому эффекту улетает на сервер входа,
    // так и не показавшись человеку.
    const hasErrorParam = new URLSearchParams(location.search).get('error') != null;
    if (hasErrorParam) {
      setIsRestoring(false);
      return;
    }
    if (getSession() != null) {
      setIsRestoring(false);
      return;
    }
    if (location.pathname === CALLBACK_PATH) {
      // AuthCallbackPage owns the exchange for this navigation; nothing to restore here.
      setIsRestoring(false);
      return;
    }
    if (!wasSessionActive()) {
      setIsRestoring(false);
      return;
    }

    setIsRestoring(true);
    const targetPath = silentTargetFor(location);
    redirectToOpenId(targetPath).catch(() => {
      clearSessionActive();
      setIsRestoring(false);
      navigateExternal(`${window.location.origin}/login?error=silent_login_failed`);
    });
    // Runs once against the location the app booted with — a silent retry should never
    // re-fire just because the user navigated around after the initial mount resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (): Promise<void> => {
    await redirectToOpenId();
  };

  const completeLogin = async (code: string): Promise<boolean> => {
    const verifier = consumeVerifier();
    if (!verifier) {
      clearSessionActive();
      return false;
    }
    try {
      const tokens = await exchangeCode({
        code,
        codeVerifier: verifier,
        redirectUri: redirectUri(),
      });
      setSession(sessionFromTokens(tokens));
      markSessionActive();
      // Только теперь, а не в момент клика: если вход не завершится успешно
      // (сеть, отклонённый код), человек всё ещё в осознанно вышедшем состоянии,
      // и признак должен остаться — иначе неудачная попытка входа в одной вкладке
      // молча включила бы автопереход во всех остальных вкладках этого источника.
      clearLoggedOutIntentionally();
      return true;
    } catch {
      clearSessionActive();
      return false;
    }
  };

  const logout = (): void => {
    const idTokenHint = getSession()?.idToken;
    clearSessionActive();
    markLoggedOutIntentionally();
    // Осознанный выход не должен унести человека в чужую цель при следующем входе —
    // без этого сохранённая с прошлого 401 страница вернулась бы даже тому, кто
    // вышел намеренно и, возможно, вошёл заново под другой учётной записью.
    clearSilentTarget();
    setSession(undefined);
    // Полномочия и списки прошлого пользователя иначе остаются в памяти react-query
    // до перезагрузки страницы — сегодня это не стреляет только потому, что вход
    // всегда идёт через внешний переход, который память и так обнуляет.
    queryClient.clear();
    navigateExternal(buildLogoutUrl(`${window.location.origin}/login`, idTokenHint));
  };

  const value = useMemo<AuthContextType>(
    () => ({
      user: session?.user,
      token: session?.token,
      isAuthenticated: session != null,
      isRestoring,
      login,
      logout,
      completeLogin,
    }),
    [session, isRestoring],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext should be used inside AuthProvider');
  }
  return context;
}
