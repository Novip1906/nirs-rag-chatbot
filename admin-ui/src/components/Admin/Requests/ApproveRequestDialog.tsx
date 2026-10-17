import { useState } from 'react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogContent,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogTitle,
  Tag,
} from '@librechat/client';
import type { AdminLimitRequest } from '~/api';
import { useApproveLimitRequestMutation } from '~/data-provider/Admin';
import { formatDate } from '~/components/Admin/common/insightsKit';
import { buildApproveLimitsPayload } from './buildApproveLimitsPayload';
import { formatLimit, formatLimitChange, STATUS_LABEL_KEY, STATUS_VARIANT } from './display';
import { useLocalize } from '~/hooks';

interface ApproveRequestDialogProps {
  request: AdminLimitRequest;
  onOpenChange: (open: boolean) => void;
}

export default function ApproveRequestDialog({
  request,
  onOpenChange,
}: ApproveRequestDialogProps): JSX.Element {
  const localize = useLocalize();
  const { locale } = useLocaleContext();
  const approveRequest = useApproveLimitRequestMutation();
  const [costValue, setCostValue] = useState(
    request.limitBefore != null ? String(request.limitBefore) : '',
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const limits = buildApproveLimitsPayload(costValue);
    approveRequest.mutate(
      { id: request.id, payload: { limits } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_admin_requests_approve_title')}</OGDialogTitle>
        </OGDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-2">
          <p className="text-sm text-text-secondary">
            {localize('com_admin_requests_approve_description', {
              name: request.userName,
              window:
                request.window === 'daily'
                  ? localize('com_admin_requests_window_daily')
                  : localize('com_admin_requests_window_monthly'),
            })}
          </p>
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
            <span className="text-sm text-text-secondary">
              {localize('com_admin_requests_current_limit')}
            </span>
            <span className="text-sm font-medium tabular-nums text-text-primary">
              {formatLimit(request.limitBefore)}
            </span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-approve-cost">
              {localize('com_admin_requests_approve_cost_label')}
            </Label>
            <Input
              id="admin-approve-cost"
              type="number"
              min={0}
              /* См. `LimitsFields`: диалог сам подставляет сюда текущий лимит, а он может быть
                 не кратен копейке — с шагом 0,01 одобрение заявки тогда молча не срабатывает. */
              step="any"
              className="tabular-nums"
              placeholder={localize('com_admin_requests_approve_field_placeholder')}
              value={costValue}
              onChange={(event) => setCostValue(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-text-primary">
              {localize('com_admin_requests_history_title')}
            </p>
            {request.history.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {localize('com_admin_requests_history_empty')}
              </p>
            ) : (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {request.history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 text-sm text-text-secondary"
                  >
                    <span className="whitespace-nowrap">{formatDate(entry.createdAt, locale)}</span>
                    <span className="tabular-nums text-text-primary">
                      {formatLimitChange(entry.limitBefore, entry.limitAfter)}
                    </span>
                    <Tag
                      variant={STATUS_VARIANT[entry.status]}
                      label={localize(STATUS_LABEL_KEY[entry.status])}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <OGDialogFooter className="px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {localize('com_admin_action_cancel')}
            </Button>
            <Button type="submit" variant="submit" disabled={approveRequest.isLoading}>
              {localize('com_admin_requests_approve_submit')}
            </Button>
          </OGDialogFooter>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
}
