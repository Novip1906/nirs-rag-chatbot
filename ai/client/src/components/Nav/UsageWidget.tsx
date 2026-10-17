import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { Button } from '@librechat/client';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Root, Trigger, Portal, Content } from '@radix-ui/react-popover';
import type {
  LimitWindow,
  PendingLimitRequest,
  UsageMeResponse,
  UsageWindow,
} from '~/data-provider/Usage';
import { UsageQueryKeys, useUsageMeQuery, useRequestLimitMutation } from '~/data-provider/Usage';
import { useLocalize, useClockFormat } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

export type UsageSeverity = 'normal' | 'warning' | 'critical';

export interface UsageWindowDisplay {
  kind: LimitWindow;
  percent: number;
  severity: UsageSeverity;
}

function ratioPercent(used: number, limit: number): number {
  if (limit <= 0) {
    return Infinity;
  }
  return (used / limit) * 100;
}

/**
 * Расход показывается только в деньгах: лимит по количеству запросов из системы убран,
 * поэтому окно без рублёвого порога считается неограниченным и в виджете не рисуется.
 */
export function computeWindowPercent(usageWindow: UsageWindow): number | null {
  const { costUsd, limits } = usageWindow;
  if (limits.costUsd == null) {
    return null;
  }
  return ratioPercent(costUsd, limits.costUsd);
}

export function severityFor(percent: number): UsageSeverity {
  if (percent >= 100) {
    return 'critical';
  }
  if (percent > 80) {
    return 'warning';
  }
  return 'normal';
}

/**
 * Единственное окно — суточное: возвращает список из одного элемента (или пустой, если
 * лимит не задан), а не одно значение напрямую — так рендер ниже (`.map`) не завязан на
 * то, что окно всегда одно.
 */
export function buildUsageWindows(data: UsageMeResponse | undefined): UsageWindowDisplay[] {
  if (!data) {
    return [];
  }
  const percent = computeWindowPercent(data.daily);
  if (percent == null) {
    return [];
  }
  return [{ kind: 'daily', percent, severity: severityFor(percent) }];
}

const EXHAUSTED_THRESHOLD = 100;

export function formatPendingSince(createdAt: string, locale: string, hour12: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12,
  }).format(new Date(createdAt));
}

const severityBarClass: Record<UsageSeverity, string> = {
  normal: 'bg-surface-inverted',
  warning: 'bg-status-warning',
  critical: 'bg-status-error',
};

const severityTextClass: Record<UsageSeverity, string> = {
  normal: 'text-text-secondary',
  warning: 'text-status-warning',
  critical: 'text-status-error',
};

function UsageWindowRow({
  kind,
  label,
  percent,
  severity,
  pendingRequest,
}: {
  kind: LimitWindow;
  label: string;
  percent: number;
  severity: UsageSeverity;
  pendingRequest: PendingLimitRequest | null;
}) {
  const localize = useLocalize();
  const hour12 = useClockFormat();
  const { i18n } = useTranslation();
  const [requestFailed, setRequestFailed] = useState(false);
  const exhausted = percent >= EXHAUSTED_THRESHOLD;

  const requestLimitMutation = useRequestLimitMutation({
    onSuccess: () => setRequestFailed(false),
    onError: () => setRequestFailed(true),
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className={cn('font-medium tabular-nums', severityTextClass[severity])}>
          {Math.floor(Math.min(percent, 999))}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(Math.min(percent, 100))}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary"
      >
        <div
          className={cn('h-full rounded-full transition-all', severityBarClass[severity])}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {exhausted &&
        (pendingRequest && pendingRequest.window === kind ? (
          <span className="text-xs text-text-secondary" data-testid={`usage-pending-${kind}`}>
            {localize('com_usage_request_pending', {
              date: formatPendingSince(pendingRequest.createdAt, i18n.language, hour12),
            })}
          </span>
        ) : (
          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={requestLimitMutation.isLoading}
              onClick={() => requestLimitMutation.mutate({ window: kind })}
            >
              {localize('com_usage_request_increase')}
            </Button>
            {requestFailed && (
              <span className="text-xs text-status-error">
                {localize('com_usage_request_error')}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}

function UsageWidget() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const anySubmitting = useRecoilValue(store.anySubmittingSelector);
  const wasSubmittingRef = useRef(false);

  const { data, isError } = useUsageMeQuery();

  useEffect(() => {
    if (wasSubmittingRef.current && !anySubmitting) {
      queryClient.invalidateQueries([UsageQueryKeys.usageMe]);
    }
    wasSubmittingRef.current = anySubmitting;
  }, [anySubmitting, queryClient]);

  const windows = useMemo(() => buildUsageWindows(data), [data]);

  if (isError || windows.length === 0) {
    return null;
  }

  const [worst] = windows;

  return (
    <Root>
      <Trigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={localize('com_usage_widget_label')}
          data-testid="usage-widget-trigger"
          className={cn('h-9 w-9 rounded-lg', severityTextClass[worst.severity])}
        >
          <Gauge className="h-5 w-5" aria-hidden="true" />
        </Button>
      </Trigger>
      <Portal>
        <Content
          side="right"
          align="end"
          sideOffset={8}
          className="z-[125] w-64 rounded-xl border border-border-light bg-surface-secondary p-3 text-text-primary shadow-md outline-none"
        >
          <div className="mb-2 text-sm font-medium">{localize('com_usage_title')}</div>
          <div className="flex flex-col gap-3">
            {windows.map((usageWindow) => (
              <UsageWindowRow
                key={usageWindow.kind}
                kind={usageWindow.kind}
                label={localize('com_usage_daily')}
                percent={usageWindow.percent}
                severity={usageWindow.severity}
                pendingRequest={
                  data?.pendingRequests?.find((request) => request.window === usageWindow.kind) ??
                  null
                }
              />
            ))}
          </div>
        </Content>
      </Portal>
    </Root>
  );
}

export default UsageWidget;
