import { Navigate } from 'react-router-dom';
import { useAccess } from '~/hooks/useAccess';

export default function AdminHome(): JSX.Element | null {
  const { isAdmin, isLoading } = useAccess();

  if (isLoading) {
    return null;
  }

  return <Navigate to={isAdmin ? '/admin/users' : '/admin/ai/users'} replace={true} />;
}
