import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Spinner } from '@librechat/client';
import { silentTargetFor, storeSilentTarget } from './silentSession';
import { useAuthContext } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, isRestoring } = useAuthContext();
  const location = useLocation();

  if (isRestoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-primary">
        <Spinner className="size-6 text-text-secondary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Покрывает и случай, который 401-обработчик в AuthContext не видит: свежая
    // вкладка без токена (например, глубокая ссылка, открытая отдельно) — сюда
    // приходят уже неавторизованными, а не по перехваченному запросу.
    const targetPath = silentTargetFor(location);
    if (targetPath) {
      storeSilentTarget(targetPath);
    }
    return <Navigate to="/login" replace={true} />;
  }

  return <>{children}</>;
}
