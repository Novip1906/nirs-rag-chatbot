import { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { ShieldCheck } from 'lucide-react';
import { useAuthContext, useLocalize } from '~/hooks';
import {
  markAutoLoginAttempt,
  recentAutoLoginAttempt,
  wasLoggedOutIntentionally,
} from '~/auth/silentSession';

// Достаточно, чтобы не спутать обычную перезагрузку страницы с петлёй, но
// достаточно коротко, чтобы человек не ждал минуту, если это разовый сбой.
const AUTO_RETRY_WINDOW_MS = 30_000;

type AutoLoginIssue = 'recent_attempt' | 'redirect_failed';

export default function LoginPage(): JSX.Element | null {
  const localize = useLocalize();
  const { isAuthenticated, isRestoring, login } = useAuthContext();
  const [searchParams] = useSearchParams();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [autoLoginIssue, setAutoLoginIssue] = useState<AutoLoginIssue | undefined>(undefined);
  const autoRedirectStarted = useRef(false);
  const error = searchParams.get('error');

  const startLogin = (): void => {
    setAutoLoginIssue(undefined);
    setIsRedirecting(true);
    login().catch(() => {
      // computeCodeChallenge использует crypto.subtle (недоступен вне защищённого
      // контекста) и сохранение verifier обращается к sessionStorage — оба могут
      // бросить синхронно ещё до перехода на сервер входа, и без этой ветки человек
      // остался бы на вечном спиннере вместо кнопки повторной попытки.
      setIsRedirecting(false);
      setAutoLoginIssue('redirect_failed');
    });
  };

  useEffect(() => {
    if (isRestoring || isAuthenticated || error != null) {
      return;
    }
    // Защита от строгого режима React, который смонтирует эффект дважды —
    // без ref второй проход запустил бы ещё один переход на единый вход.
    if (autoRedirectStarted.current || wasLoggedOutIntentionally()) {
      return;
    }
    autoRedirectStarted.current = true;

    if (recentAutoLoginAttempt(AUTO_RETRY_WINDOW_MS)) {
      // Быстрый возврат на экран входа после недавнего автоперехода — верный
      // признак петли (например, устойчивый 401, который новый токен не лечит).
      // Показываем объяснение и кнопку вместо ещё одного немедленного перехода.
      setAutoLoginIssue('recent_attempt');
      return;
    }

    markAutoLoginAttempt();
    startLogin();
    // Runs once against the location the app booted with — a silent retry should never
    // re-fire just because the user navigated around after the initial mount resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRestoring, isAuthenticated, error, login]);

  if (isRestoring || isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-primary">
        <Spinner className="size-6 text-text-secondary" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/admin" replace={true} />;
  }

  const errorDescription = searchParams.get('error_description');
  const errorMessage =
    error != null
      ? errorDescription != null && errorDescription !== ''
        ? errorDescription
        : localize('com_admin_login_error_generic')
      : undefined;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-primary p-6 text-text-primary">
      <div className="flex flex-col items-center gap-2">
        <ShieldCheck className="size-10 text-text-secondary" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{localize('com_admin_title')}</h1>
      </div>
      {errorMessage != null && (
        <p className="max-w-sm text-center text-sm text-text-destructive">{errorMessage}</p>
      )}
      {errorMessage == null && autoLoginIssue === 'recent_attempt' && (
        <p className="max-w-sm text-center text-sm text-text-secondary">
          {localize('com_admin_login_retry_notice')}
        </p>
      )}
      {errorMessage == null && autoLoginIssue === 'redirect_failed' && (
        <p className="max-w-sm text-center text-sm text-text-destructive">
          {localize('com_admin_login_redirect_failed')}
        </p>
      )}
      <Button onClick={startLogin} disabled={isRedirecting}>
        {localize('com_admin_login_openid')}
      </Button>
    </div>
  );
}
