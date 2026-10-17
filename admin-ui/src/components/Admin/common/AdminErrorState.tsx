import { Alert, Button } from '@librechat/client';
import { useLocalize } from '~/hooks';

interface AdminErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export default function AdminErrorState({ message, onRetry }: AdminErrorStateProps): JSX.Element {
  const localize = useLocalize();
  return (
    <Alert variant="error" className="items-center">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{message ?? localize('com_admin_error_loading')}</span>
        {onRetry != null && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {localize('com_admin_retry')}
          </Button>
        )}
      </div>
    </Alert>
  );
}
