import { useState } from 'react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  Tag,
} from '@librechat/client';
import type { AdminLimitRequest, LimitRequestStatus } from '~/api';
import { useAdminLimitRequestsQuery, useRejectLimitRequestMutation } from '~/data-provider/Admin';
import {
  formatDate,
  InlineEmptyState,
  LoadingState,
  TablePanel,
} from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { formatLimitChange, STATUS_LABEL_KEY, STATUS_VARIANT } from './display';
import ApproveRequestDialog from './ApproveRequestDialog';
import { useLocalize } from '~/hooks';

export default function RequestsView(): JSX.Element {
  const localize = useLocalize();
  const { locale } = useLocaleContext();
  const [filter, setFilter] = useState<LimitRequestStatus>('pending');
  const requestsQuery = useAdminLimitRequestsQuery(filter);
  const rejectRequest = useRejectLimitRequestMutation();
  const [approvingRequest, setApprovingRequest] = useState<AdminLimitRequest | null>(null);

  const requests = requestsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_requests_title')}
        description={localize('com_admin_requests_description')}
        action={
          <Select value={filter} onValueChange={(value) => setFilter(value as LimitRequestStatus)}>
            <SelectTrigger
              className="w-auto min-w-[11rem]"
              aria-label={localize('com_admin_requests_filter_label')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">
                {localize('com_admin_requests_filter_pending')}
              </SelectItem>
              <SelectItem value="approved">
                {localize('com_admin_requests_filter_approved')}
              </SelectItem>
              <SelectItem value="rejected">
                {localize('com_admin_requests_filter_rejected')}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {requestsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {requestsQuery.isError && <AdminErrorState onRetry={() => requestsQuery.refetch()} />}
        {!requestsQuery.isLoading && !requestsQuery.isError && (
          <TablePanel title={localize('com_admin_requests_title')}>
            {requests.length === 0 ? (
              <InlineEmptyState message={localize('com_admin_requests_empty_description')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{localize('com_admin_requests_col_user')}</TableHead>
                      <TableHead>{localize('com_admin_requests_col_window')}</TableHead>
                      <TableHead>{localize('com_admin_requests_col_limit')}</TableHead>
                      <TableHead>{localize('com_admin_requests_col_created')}</TableHead>
                      <TableHead>{localize('com_admin_requests_col_comment')}</TableHead>
                      <TableHead>{localize('com_admin_requests_col_status')}</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">
                          {localize('com_admin_requests_col_actions')}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableRowHeader>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-text-primary">
                              {request.userName}
                            </p>
                            <p className="truncate text-xs text-text-secondary">
                              {request.userEmail}
                            </p>
                          </div>
                        </TableRowHeader>
                        <TableCell>
                          {request.window === 'daily'
                            ? localize('com_admin_requests_window_daily')
                            : localize('com_admin_requests_window_monthly')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          <div>{formatLimitChange(request.limitBefore, request.limitAfter)}</div>
                          {request.history.length > 0 && (
                            <div className="text-xs text-text-secondary">
                              {localize('com_admin_requests_history_count', {
                                count: request.history.length,
                              })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-text-secondary">
                          {formatDate(request.createdAt, locale)}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <span className="line-clamp-2 text-sm text-text-secondary">
                            {request.comment != null && request.comment !== ''
                              ? request.comment
                              : localize('com_admin_requests_no_comment')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Tag
                            variant={STATUS_VARIANT[request.status]}
                            label={localize(STATUS_LABEL_KEY[request.status])}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {request.status === 'pending' && (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => rejectRequest.mutate(request.id)}
                              >
                                {localize('com_admin_requests_reject')}
                              </Button>
                              <Button
                                size="sm"
                                variant="submit"
                                onClick={() => setApprovingRequest(request)}
                              >
                                {localize('com_admin_requests_approve')}
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TablePanel>
        )}
      </div>
      {approvingRequest != null && (
        <ApproveRequestDialog
          request={approvingRequest}
          onOpenChange={(open) => {
            if (!open) {
              setApprovingRequest(null);
            }
          }}
        />
      )}
    </div>
  );
}
