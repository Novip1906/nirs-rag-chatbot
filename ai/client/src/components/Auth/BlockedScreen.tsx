import { ShieldBan } from 'lucide-react';
import { Button } from '@librechat/client';
import { useAuthContext, useLocalize } from '~/hooks';

export default function BlockedScreen() {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();

  return (
    <div
      role="alert"
      className="flex h-screen w-full items-center justify-center bg-surface-primary p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-border-light bg-surface-secondary p-8 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-status-error-subtle text-text-destructive">
          <ShieldBan className="size-7" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary">
          {localize('com_ui_blocked_title')}
        </h1>
        <p className="mt-3 text-sm text-text-secondary">{localize('com_ui_blocked_description')}</p>
        {user?.email != null && user.email !== '' && (
          <p className="mt-2 text-sm text-text-secondary-alt">{user.email}</p>
        )}
        <Button variant="outline" className="mt-6 w-full" onClick={() => logout()}>
          {localize('com_nav_log_out')}
        </Button>
      </div>
    </div>
  );
}
