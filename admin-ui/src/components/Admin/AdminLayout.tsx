import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, ShieldCheck, X } from 'lucide-react';
import { Button, IconButton, Spinner } from '@librechat/client';
import { useAccess, useAuthContext, useLocalize } from '~/hooks';
import { chatUrl, navigateExternal } from '~/config';
import AdminErrorState from './common/AdminErrorState';
import AccountMenu from './AccountMenu';
import AdminNav from './AdminNav';
import AdminTabs from './AdminTabs';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';

const ADMIN_APP_TITLE = 'Corporate Admin';

export default function AdminLayout(): JSX.Element | null {
  const localize = useLocalize();
  const { isAuthenticated, logout } = useAuthContext();
  const { canEnter, isLoading, directoryError, refetchDirectory, aiError, refetchAi } = useAccess();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const directoryUnavailable = isAuthenticated && !isLoading && !canEnter && directoryError;
  const aiUnavailable =
    isAuthenticated && !isLoading && !canEnter && !directoryError && aiError;
  const isNonAdmin = isAuthenticated && !isLoading && !canEnter && !directoryError && !aiError;

  useEffect(() => {
    document.title = ADMIN_APP_TITLE;
  }, []);

  useEffect(() => {
    if (isNonAdmin) {
      navigateExternal(chatUrl());
    }
  }, [isNonAdmin]);

  if (!isAuthenticated || isNonAdmin) {
    return null;
  }

  const logoutButton = (
    <Button size="sm" variant="outline" onClick={() => logout()}>
      {localize('com_admin_logout')}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-surface-primary">
        <Spinner className="size-6 text-text-secondary" />
        {logoutButton}
      </div>
    );
  }

  if (aiUnavailable) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-surface-primary p-6 text-text-primary">
        <div className="w-full max-w-md">
          <AdminErrorState onRetry={refetchAi} />
          <div className="mt-3 flex justify-end">{logoutButton}</div>
        </div>
      </div>
    );
  }

  if (directoryUnavailable) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-surface-primary p-6 text-text-primary">
        <div className="w-full max-w-md">
          <AdminErrorState
            message={localize('com_admin_directory_unavailable')}
            onRetry={refetchDirectory}
          />
          <div className="mt-3 flex justify-end">{logoutButton}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full flex-col bg-surface-primary text-text-primary">
      <header className="flex shrink-0 flex-col border-b border-border-light">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <IconButton
            label={localize('com_admin_nav_toggle')}
            size="sm"
            className="sm:hidden"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface-secondary text-text-secondary">
            <ShieldCheck className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold">{localize('com_admin_title')}</span>
          <div className="order-last w-full sm:order-none sm:ml-1 sm:w-auto">
            <AdminTabs />
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LanguageToggle />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border-light sm:block">
          <AdminNav />
        </aside>
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 flex sm:hidden">
            <div
              className="absolute inset-0 bg-surface-overlay/65"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <div className="relative flex h-full w-64 max-w-[80vw] flex-col bg-surface-primary shadow-lg">
              <div className="flex items-center justify-between border-b border-border-light px-3 py-3">
                <span className="text-sm font-semibold">{localize('com_admin_title')}</span>
                <IconButton
                  label={localize('com_ui_close')}
                  size="sm"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <div className="flex-1 overflow-y-auto" onClick={() => setMobileNavOpen(false)}>
                <AdminNav />
              </div>
            </div>
          </div>
        )}
        {/* `min-h-0` — без него flex-item со скроллом внутри мог растягиваться по
            высоте содержимого и создавать второй, внешний скролл поверх своего же
            внутреннего overflow-y-auto (заметно на длинных формах вроде страницы
            пользователя). */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" role="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
