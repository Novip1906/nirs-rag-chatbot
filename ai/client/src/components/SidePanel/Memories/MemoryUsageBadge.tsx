import { useTranslation } from 'react-i18next';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MemoryUsageBadgeProps {
  percentage: number;
  tokenLimit: number;
  totalTokens?: number;
  /** Custom current value for tooltip (overrides totalTokens) */
  tooltipCurrent?: number;
  /** Custom max value for tooltip (overrides tokenLimit) */
  tooltipMax?: number;
}

const getStatusColor = (pct: number): string => {
  if (pct > 90) {
    return 'bg-status-error-subtle text-status-error';
  }
  if (pct > 75) {
    return 'bg-status-warning-subtle text-status-warning';
  }
  return 'bg-status-success-subtle text-status-success';
};

export default function MemoryUsageBadge({
  percentage,
  tokenLimit,
  totalTokens,
  tooltipCurrent,
  tooltipMax,
}: MemoryUsageBadgeProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();

  const current = tooltipCurrent ?? totalTokens;
  const max = tooltipMax ?? tokenLimit;
  const tokenPhrase = localize('com_ui_token_count', { count: max });

  const tooltipText =
    current !== undefined
      ? `${current.toLocaleString(i18n.language)} / ${tokenPhrase}`
      : tokenPhrase;

  return (
    <TooltipAnchor
      description={tooltipText}
      side="top"
      render={
        <div
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1',
            'text-xs font-medium',
            getStatusColor(percentage),
          )}
          role="status"
          aria-label={`${localize('com_ui_usage')}: ${percentage}%`}
        >
          <span>{percentage}%</span>
          <span className="opacity-70">{localize('com_ui_used').toLowerCase()}</span>
        </div>
      }
    />
  );
}
