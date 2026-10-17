import { RefreshCw } from 'lucide-react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import { useAdminProviderBalanceQuery } from '~/data-provider/Admin';
import { formatUsd } from '~/components/Admin/utils/format';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ProviderBalance(): JSX.Element | null {
  const localize = useLocalize();
  const { locale } = useLocaleContext();
  const balanceQuery = useAdminProviderBalanceQuery();
  const balance = balanceQuery.data;

  if (balance == null || balance.status === 'not_configured') {
    return null;
  }

  const checkedAt = new Date(balance.checkedAt);
  const checkedAtLabel = Number.isNaN(checkedAt.getTime())
    ? ''
    : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(checkedAt);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-light px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">
          {localize('com_admin_balance_label', { provider: balance.provider })}
        </div>
        {balance.status === 'ok' && balance.amountUsd != null ? (
          <div
            className={cn(
              'text-sm font-semibold',
              balance.amountUsd <= 0 ? 'text-red-500' : 'text-text-primary',
            )}
          >
            {formatUsd(balance.amountUsd)}
          </div>
        ) : (
          <div className="text-sm text-text-secondary">
            {localize('com_admin_balance_unavailable')}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => balanceQuery.refetch()}
        disabled={balanceQuery.isFetching}
        aria-label={localize('com_admin_balance_refresh')}
        title={
          checkedAtLabel === ''
            ? undefined
            : localize('com_admin_balance_checked_at', { time: checkedAtLabel })
        }
        className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover"
      >
        <RefreshCw
          className={cn('size-4', balanceQuery.isFetching && 'animate-spin')}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
