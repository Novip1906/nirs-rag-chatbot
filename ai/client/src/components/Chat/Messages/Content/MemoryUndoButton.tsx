import { useState } from 'react';
import { useToastContext } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { MemoryArtifact } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useRevertMemoryMutation } from '~/data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { cn } from '~/utils';

type UndoStatus = 'idle' | 'reverting' | 'reverted' | 'conflict';

type RevertOutcome = 'reverted' | 'conflict' | 'failed';

type ErrorWithResponse = Error & { response?: { status?: number } };

const STATUS_LABEL_KEYS: Record<UndoStatus, TranslationKeys> = {
  idle: 'com_ui_memory_undo',
  reverting: 'com_ui_memory_undoing',
  reverted: 'com_ui_memory_undone',
  conflict: 'com_ui_memory_undo_conflict',
};

const classifyRevertError = (error: unknown): RevertOutcome => {
  const httpStatus = (error as ErrorWithResponse)?.response?.status;
  if (httpStatus === 404) {
    return 'reverted';
  }
  if (httpStatus === 409) {
    return 'conflict';
  }
  return 'failed';
};

const summarize = (outcomes: RevertOutcome[]): UndoStatus | 'failed' => {
  if (outcomes.includes('failed')) {
    return 'failed';
  }
  if (outcomes.includes('conflict')) {
    return 'conflict';
  }
  return 'reverted';
};

export default function MemoryUndoButton({ artifacts }: { artifacts: MemoryArtifact[] }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [status, setStatus] = useState<UndoStatus>('idle');
  const revertMemory = useRevertMemoryMutation();

  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.UPDATE,
  });

  if (!hasUpdateAccess) {
    return null;
  }

  const revertOne = async (artifact: MemoryArtifact): Promise<RevertOutcome> => {
    try {
      await revertMemory.mutateAsync({
        key: artifact.key,
        agentId: artifact.agentId,
        chatProjectId: artifact.chatProjectId,
        expectedValue: artifact.value ?? '',
        previous: artifact.previous ?? null,
      });
      return 'reverted';
    } catch (error) {
      return classifyRevertError(error);
    }
  };

  const handleUndo = async () => {
    if (status !== 'idle') {
      return;
    }
    setStatus('reverting');
    const outcomes: RevertOutcome[] = [];
    for (const artifact of [...artifacts].reverse()) {
      outcomes.push(await revertOne(artifact));
    }
    const result = summarize(outcomes);
    if (result !== 'failed') {
      setStatus(result);
      return;
    }
    setStatus('idle');
    showToast({ message: localize('com_ui_memory_undo_error'), status: 'error' });
  };

  return (
    <button
      type="button"
      className={cn(
        'text-xs font-medium text-text-secondary-alt underline-offset-2 transition-colors',
        'hover:text-text-primary hover:underline disabled:cursor-default disabled:no-underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
      )}
      onClick={handleUndo}
      disabled={status !== 'idle'}
      aria-live="polite"
    >
      {localize(STATUS_LABEL_KEYS[status])}
    </button>
  );
}
