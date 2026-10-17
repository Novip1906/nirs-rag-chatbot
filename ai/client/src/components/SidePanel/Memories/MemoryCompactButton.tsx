import { Shrink } from 'lucide-react';
import { Button, Spinner, TooltipAnchor, useToastContext } from '@librechat/client';
import type { TCompactMemoriesResponse } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useCompactMemoriesMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type ErrorWithResponse = Error & { response?: { status?: number } };

const errorMessageKey = (error: Error): TranslationKeys => {
  const status = (error as ErrorWithResponse)?.response?.status;
  if (status === 409) {
    return 'com_ui_memory_compact_busy';
  }
  if (status === 429) {
    return 'com_ui_memory_compact_rate_limited';
  }
  return 'com_ui_memory_compact_error';
};

const skippedMessageKey = (reason: TCompactMemoriesResponse['reason']): TranslationKeys => {
  if (reason === 'too_few') {
    return 'com_ui_memory_compact_nothing';
  }
  if (reason === 'busy') {
    return 'com_ui_memory_compact_busy';
  }
  return 'com_ui_memory_compact_failed';
};

export default function MemoryCompactButton({ chatProjectId }: { chatProjectId?: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const label = localize(
    chatProjectId ? 'com_ui_memory_compact_project' : 'com_ui_memory_compact_personal',
  );

  const compactMemories = useCompactMemoriesMutation({
    onSuccess: (data) => {
      if (data.compacted) {
        showToast({
          message: localize('com_ui_memory_compact_result', {
            before: data.before,
            after: data.after,
          }),
          status: 'success',
        });
        return;
      }
      showToast({
        message: localize(skippedMessageKey(data.reason)),
        status: data.reason === 'too_few' ? 'info' : 'error',
      });
    },
    onError: (error) => {
      showToast({ message: localize(errorMessageKey(error)), status: 'error' });
    },
  });

  return (
    <TooltipAnchor
      description={label}
      side="bottom"
      render={
        <Button
          variant="outline"
          size="icon"
          className="size-9 shrink-0 bg-transparent"
          aria-label={label}
          onClick={() => compactMemories.mutate({ chatProjectId })}
          disabled={compactMemories.isLoading}
        >
          {compactMemories.isLoading ? (
            <Spinner className="size-4" />
          ) : (
            <Shrink className="size-4" aria-hidden="true" />
          )}
        </Button>
      }
    />
  );
}
