import { Navigate, Outlet } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { useAuthContext, useLocalize } from '~/hooks';
import { useAccess } from '~/hooks/useAccess';
import AdminErrorState from './common/AdminErrorState';

export default function RequireAdmin(): JSX.Element {
  const localize = useLocalize();
  const { logout } = useAuthContext();
  const { isAdmin, isLoading, directoryError, refetchDirectory } = useAccess();

  const logoutButton = (
    <Button size="sm" variant="outline" onClick={() => logout()}>
      {localize('com_admin_logout')}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-4">
        <Spinner className="size-6 text-text-secondary" />
        {logoutButton}
      </div>
    );
  }

  if (!isAdmin && directoryError) {
    return (
      <div className="p-6">
        <AdminErrorState
          message={localize('com_admin_directory_unavailable')}
          onRetry={refetchDirectory}
        />
        <div className="mt-3 flex justify-end">{logoutButton}</div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/admin/ai/users" replace={true} />;
  }

  return <Outlet />;
}
