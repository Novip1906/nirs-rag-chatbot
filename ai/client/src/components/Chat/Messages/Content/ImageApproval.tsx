import { useEffect, useMemo, useState } from 'react';
import { ImageIcon, TriangleAlert } from 'lucide-react';
import { Button } from '@librechat/client';
import type { Agents } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useApprovalContext, useResumeSubmit } from './ApprovalContext';
import { useLocalize } from '~/hooks';

const ASPECT_RATIOS: Array<{ value: string; label?: TranslationKeys }> = [
  { value: '1:1', label: 'com_ui_image_ratio_square' },
  { value: '16:9', label: 'com_ui_image_ratio_landscape' },
  { value: '9:16', label: 'com_ui_image_ratio_portrait' },
  { value: '4:3' },
  { value: '3:4' },
  { value: '3:2' },
  { value: '2:3' },
];

const KNOWN_RATIOS = new Set(ASPECT_RATIOS.map((ratio) => ratio.value));

interface ImageArgs {
  aspectRatio: string;
  aspectValid: boolean;
  imageIds: string[];
  raw: Record<string, unknown>;
}

function parseArgs(args: string | Record<string, unknown> | undefined): ImageArgs {
  let raw: Record<string, unknown> = {};
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args);
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
    } catch {
      raw = {};
    }
  } else if (args != null) {
    raw = args;
  }
  const aspect = typeof raw.aspect_ratio === 'string' ? raw.aspect_ratio : '';
  return {
    aspectRatio: KNOWN_RATIOS.has(aspect) ? aspect : '1:1',
    aspectValid: raw.aspect_ratio == null || KNOWN_RATIOS.has(aspect),
    imageIds: Array.isArray(raw.image_ids)
      ? raw.image_ids.filter((id): id is string => typeof id === 'string')
      : [],
    raw,
  };
}

export default function ImageApproval({
  approval,
  toolCallId,
  args,
  fallback,
}: {
  approval: NonNullable<Agents.ToolCall['approval']>;
  toolCallId: string;
  args: string | Record<string, unknown> | undefined;
  fallback: React.ReactNode;
}) {
  const localize = useLocalize();
  const { actionId } = approval;
  const { registerToolCall, unregisterToolCall, setDecision, getStatus } = useApprovalContext();
  const { submitToolApproval } = useResumeSubmit();
  const initial = useMemo(() => parseArgs(args), [args]);
  const [seen, setSeen] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(initial.aspectRatio);

  if (seen !== initial) {
    setSeen(initial);
    if (!dirty) {
      setAspectRatio(initial.aspectRatio);
    }
  }

  useEffect(() => {
    registerToolCall(actionId, toolCallId);
    return () => unregisterToolCall(actionId, toolCallId);
  }, [registerToolCall, unregisterToolCall, actionId, toolCallId]);

  const status = getStatus(actionId);
  const locked = status === 'submitting' || status === 'submitted' || status === 'expired';

  if (status === 'submitted') {
    return <>{fallback}</>;
  }

  const submit = (decision: Agents.ToolApprovalResolution) => {
    setDecision(actionId, toolCallId, decision);
    submitToolApproval(actionId);
  };

  const generate = () => {
    const edited = !initial.aspectValid || aspectRatio !== initial.aspectRatio;
    submit(
      edited
        ? {
            tool_call_id: toolCallId,
            decision: 'edit',
            editedArguments: { ...initial.raw, aspect_ratio: aspectRatio },
          }
        : { tool_call_id: toolCallId, decision: 'approve' },
    );
  };

  const cancel = () =>
    submit({
      tool_call_id: toolCallId,
      decision: 'reject',
      reason: 'Сотрудник отменил генерацию картинки.',
    });

  return (
    <div
      className="my-2 flex w-full flex-col gap-3 rounded-lg border border-border-light bg-surface-secondary p-3"
      data-testid="image-approval"
      data-tool-call-id={toolCallId}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
        {localize('com_ui_image_approval_title')}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">
          {localize('com_ui_image_approval_format')}
        </span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {ASPECT_RATIOS.map((ratio) => (
            <Button
              key={ratio.value}
              size="sm"
              role="radio"
              disabled={locked}
              aria-checked={aspectRatio === ratio.value}
              variant={aspectRatio === ratio.value ? 'default' : 'outline'}
              onClick={() => {
                setDirty(true);
                setAspectRatio(ratio.value);
              }}
            >
              {ratio.label ? `${localize(ratio.label)} ${ratio.value}` : ratio.value}
            </Button>
          ))}
        </div>
      </div>

      {initial.imageIds.length > 0 && (
        <span className="text-xs text-text-secondary">
          {localize('com_ui_image_approval_sources', { 0: initial.imageIds.length })}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="submit" disabled={locked} onClick={generate}>
          {status === 'submitting'
            ? localize('com_ui_submitting')
            : localize('com_ui_image_approval_generate')}
        </Button>
        <Button size="sm" variant="outline" disabled={locked} onClick={cancel}>
          {localize('com_ui_cancel')}
        </Button>
        {(status === 'expired' || status === 'error') && (
          <span className="flex items-center text-xs text-text-warning">
            <TriangleAlert className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {localize(status === 'expired' ? 'com_ui_approval_expired' : 'com_ui_approval_error')}
          </span>
        )}
      </div>
    </div>
  );
}
