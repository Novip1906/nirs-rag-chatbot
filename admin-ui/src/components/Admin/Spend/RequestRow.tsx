import { useEffect, useState } from 'react';
import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  Tag,
} from '@librechat/client';
import type { AdminSpendImage, AdminSpendRequest } from '~/api';
import { useAdminSpendImageQuery, useAdminSpendTranscriptQuery } from '~/data-provider/Admin';
import {
  displayUserName,
  formatExactValue,
  formatRecentChatDate,
} from '~/components/Admin/common/insightsKit';
import { formatUsd } from '~/components/Admin/utils/format';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface RequestRowProps {
  record: AdminSpendRequest;
  locale: string;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  getScenarioLabel: (scenario: string) => string;
}

function Transcript({ messageId, locale }: { messageId: string; locale: string }): JSX.Element {
  const localize = useLocalize();
  const transcriptQuery = useAdminSpendTranscriptQuery(messageId);

  if (transcriptQuery.isLoading) {
    return <TranscriptSkeleton />;
  }
  if (transcriptQuery.isError) {
    return (
      <p className="text-sm text-text-secondary">{localize('com_admin_spend_transcript_failed')}</p>
    );
  }
  const transcript = transcriptQuery.data;
  if (!transcript) {
    return (
      <p className="text-sm text-text-secondary">{localize('com_admin_spend_transcript_gone')}</p>
    );
  }

  return (
    <div className="space-y-3">
      {transcript.conversationTitle != null && transcript.conversationTitle !== '' && (
        <p className="text-xs text-text-tertiary">
          {localize('com_admin_spend_transcript_chat', { 0: transcript.conversationTitle })}
        </p>
      )}
      <TranscriptBlock
        speaker="question"
        title={localize('com_admin_spend_transcript_question')}
        body={transcript.question}
        fallback={localize('com_admin_spend_transcript_no_question')}
        timestamp={transcript.askedAt}
        locale={locale}
      />
      <TranscriptBlock
        speaker="answer"
        title={localize('com_admin_spend_transcript_answer')}
        body={transcript.answer}
        fallback={localize('com_admin_spend_transcript_no_answer')}
        timestamp={transcript.answeredAt}
        locale={locale}
      />
      {(transcript.images ?? []).map((image) => (
        <TranscriptImage
          key={image.fileId}
          messageId={messageId}
          image={image}
          locale={locale}
        />
      ))}
    </div>
  );
}

function TranscriptImage({
  messageId,
  image,
  locale,
}: {
  messageId: string;
  image: AdminSpendImage;
  locale: string;
}): JSX.Element {
  const localize = useLocalize();
  const imageQuery = useAdminSpendImageQuery(messageId, image.fileId);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageQuery.data) {
      return;
    }
    const objectUrl = URL.createObjectURL(imageQuery.data);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [imageQuery.data]);

  return (
    <div className="flex flex-col gap-2" data-testid="spend-transcript-image">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {localize('com_admin_spend_transcript_image')}
        </span>
        {image.createdAt != null && (
          <span className="text-xs text-text-tertiary">
            {formatRecentChatDate(image.createdAt, locale)}
          </span>
        )}
        <span className="text-xs text-text-tertiary">{image.model}</span>
      </div>
      <div className="w-full px-1 text-sm text-text-primary">
        <span className="text-text-secondary">
          {localize('com_admin_spend_transcript_image_prompt')}:{' '}
        </span>
        <span className="whitespace-pre-wrap break-words">{image.prompt}</span>
      </div>
      {imageQuery.isError && (
        <p className="text-sm text-text-secondary">
          {localize('com_admin_spend_transcript_image_failed')}
        </p>
      )}
      {imageQuery.isLoading && <Skeleton className="h-48 w-48 rounded-lg" />}
      {url != null && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="w-fit">
          <img
            src={url}
            alt={image.prompt}
            className="max-h-80 max-w-full rounded-lg border border-border-light"
          />
        </a>
      )}
    </div>
  );
}

function TranscriptSkeleton(): JSX.Element {
  const localize = useLocalize();
  return (
    <div
      className="space-y-3"
      data-testid="spend-transcript-skeleton"
      role="status"
      aria-label={localize('com_admin_spend_transcript_loading')}
    >
      <div className="flex flex-col items-end gap-1" aria-hidden="true">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-2/3 rounded-2xl" />
      </div>
      <div className="flex flex-col gap-1" aria-hidden="true">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

type TranscriptRole = 'question' | 'answer';

const TRANSCRIPT_BODY_CLASS: Record<TranscriptRole, string> = {
  question:
    'w-fit max-w-full rounded-2xl rounded-br-md bg-surface-tertiary px-4 py-2.5 text-sm text-text-primary',
  answer: 'w-full px-1 text-sm text-text-primary',
};

function TranscriptBlock({
  speaker,
  title,
  body,
  fallback,
  timestamp,
  locale,
}: {
  speaker: TranscriptRole;
  title: string;
  body: string;
  fallback: string;
  timestamp?: string;
  locale: string;
}): JSX.Element {
  const hasBody = body.trim() !== '';
  return (
    <div className={cn('flex flex-col gap-1', speaker === 'question' && 'items-end')}>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {title}
        </span>
        {timestamp != null && (
          <span className="text-xs text-text-tertiary">
            {formatRecentChatDate(timestamp, locale)}
          </span>
        )}
      </div>
      <div
        data-testid={`spend-transcript-${speaker}`}
        className={cn(
          'max-h-72 overflow-y-auto break-words',
          TRANSCRIPT_BODY_CLASS[speaker],
          !hasBody && 'italic text-text-secondary',
        )}
      >
        {hasBody ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _n, children, ...props }) => (
                <a
                  {...props}
                  className="text-text-primary underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              p: ({ node: _n, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
              ul: ({ node: _n, ...props }) => (
                <ul {...props} className="mb-2 list-disc pl-5 last:mb-0" />
              ),
              ol: ({ node: _n, ...props }) => (
                <ol {...props} className="mb-2 list-decimal pl-5 last:mb-0" />
              ),
              code: ({ node: _n, ...props }) => (
                <code {...props} className="rounded bg-surface-tertiary px-1 py-0.5 text-xs" />
              ),
            }}
          >
            {body}
          </ReactMarkdown>
        ) : (
          fallback
        )}
      </div>
    </div>
  );
}

function CallBreakdown({
  record,
  locale,
  getScenarioLabel,
}: {
  record: AdminSpendRequest;
  locale: string;
  getScenarioLabel: (scenario: string) => string;
}): JSX.Element {
  const localize = useLocalize();
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">
        {localize('com_admin_spend_calls_title')}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border-light">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{localize('com_admin_spend_col_date')}</TableHead>
              <TableHead>{localize('com_admin_spend_col_model')}</TableHead>
              <TableHead>{localize('com_admin_spend_col_scenario')}</TableHead>
              <TableHead className="text-right">{localize('com_admin_spend_col_tokens')}</TableHead>
              <TableHead className="text-right">{localize('com_admin_spend_col_cost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {record.calls.map((call, index) => (
              <TableRow key={`${record.id}-${index}`}>
                <TableCell className="whitespace-nowrap text-sm text-text-secondary">
                  {formatRecentChatDate(call.createdAt, locale)}
                </TableCell>
                <TableCell className="text-sm">{call.model}</TableCell>
                <TableCell className="text-sm">{getScenarioLabel(call.scenario)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatExactValue(call.promptTokens + call.completionTokens, locale)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  <div className="flex items-center justify-end gap-2">
                    {call.costSource === 'unknown' && (
                      <Tag variant="warning" label={localize('com_admin_spend_cost_unknown')} />
                    )}
                    {call.costSource === 'estimate' &&
                      localize('com_admin_spend_cost_estimate', { 0: formatUsd(call.costUsd) })}
                    {call.costSource === 'provider' && formatUsd(call.costUsd)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function RequestRow({
  record,
  locale,
  isExpanded,
  onToggle,
  getScenarioLabel,
}: RequestRowProps): JSX.Element {
  const localize = useLocalize();
  const extraModels = record.models.length - 1;
  const [wasExpanded, setWasExpanded] = useState(isExpanded);

  useEffect(() => {
    if (isExpanded) {
      setWasExpanded(true);
    }
  }, [isExpanded]);

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => onToggle(record.id)}
        aria-expanded={isExpanded}
      >
        <TableCell className="w-8 align-middle">
          <button
            type="button"
            aria-label={localize(
              isExpanded ? 'com_admin_spend_collapse' : 'com_admin_spend_expand',
            )}
            aria-expanded={isExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(record.id);
            }}
            className="rounded-md p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </button>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm text-text-secondary">
          {formatRecentChatDate(record.createdAt, locale)}
        </TableCell>
        <TableRowHeader>
          {displayUserName(record.userName ?? '', localize('com_insights_unknown_user'))}
        </TableRowHeader>
        <TableCell>{record.departmentName ?? localize('com_admin_users_no_department')}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span>{record.model}</span>
            {extraModels > 0 && (
              <span className="text-xs text-text-tertiary">
                {localize('com_admin_spend_extra_models', { 0: extraModels })}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>{getScenarioLabel(record.scenario)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {formatExactValue(record.callCount, locale)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatExactValue(record.promptTokens + record.completionTokens, locale)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <div className="flex items-center justify-end gap-2">
            {formatUsd(record.costUsd)}
            {record.unknownCostCalls > 0 && (
              <Tag variant="warning" label={localize('com_admin_spend_cost_unknown')} />
            )}
          </div>
        </TableCell>
      </TableRow>
      {wasExpanded && (
        <TableRow>
          <TableCell
            colSpan={9}
            className={cn('bg-surface-secondary p-0', isExpanded && 'border-b border-border-light')}
          >
            <div
              aria-hidden={!isExpanded}
              {...(!isExpanded ? { inert: '' } : {})}
              onTransitionEnd={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.propertyName === 'grid-template-rows' &&
                  !isExpanded
                ) {
                  setWasExpanded(false);
                }
              }}
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
                isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <div className="space-y-4 p-4">
                  {record.messageId != null && record.messageId !== '' ? (
                    <Transcript messageId={record.messageId} locale={locale} />
                  ) : (
                    <p className="text-sm text-text-secondary">
                      {localize('com_admin_spend_transcript_service')}
                    </p>
                  )}
                  <CallBreakdown
                    record={record}
                    locale={locale}
                    getScenarioLabel={getScenarioLabel}
                  />
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
