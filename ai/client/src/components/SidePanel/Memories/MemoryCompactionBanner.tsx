import { useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { TMemoryCompaction } from 'librechat-data-provider';
import { useUndoMemoryCompactionMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

interface MemoryCompactionBannerProps {
  compactions?: TMemoryCompaction[];
  agentId?: string;
  chatProjectId?: string;
}

type ErrorWithResponse = Error & { response?: { status?: number } };

const samePartition = (compaction: TMemoryCompaction, agentId?: string, chatProjectId?: string) =>
  (compaction.agentId ?? undefined) === (agentId ?? undefined) &&
  (compaction.chatProjectId ?? undefined) === (chatProjectId ?? undefined);

export default function MemoryCompactionBanner({
  compactions,
  agentId,
  chatProjectId,
}: MemoryCompactionBannerProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set());
  const undoCompaction = useUndoMemoryCompactionMutation();

  const latest = useMemo(() => {
    return (compactions ?? [])
      .filter((compaction) => samePartition(compaction, agentId, chatProjectId))
      .reduce<TMemoryCompaction | null>((latest, compaction) => {
        if (!latest || new Date(compaction.createdAt) > new Date(latest.createdAt)) {
          return compaction;
        }
        return latest;
      }, null);
  }, [compactions, agentId, chatProjectId]);

  if (!latest || undoneIds.has(latest.snapshotId)) {
    return null;
  }

  const markUndone = () => {
    setUndoneIds((prev) => new Set(prev).add(latest.snapshotId));
    showToast({ message: localize('com_ui_memory_compact_undone'), status: 'success' });
  };

  const handleUndo = () => {
    undoCompaction.mutate(
      { snapshotId: latest.snapshotId },
      {
        onSuccess: markUndone,
        onError: (error) => {
          if ((error as ErrorWithResponse)?.response?.status === 404) {
            markUndone();
            return;
          }
          showToast({ message: localize('com_ui_memory_compact_undo_error'), status: 'error' });
        },
      },
    );
  };

  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-border-light bg-surface-primary-alt px-3 py-2 text-sm text-text-secondary">
      <span>
        {localize('com_ui_memory_compact_result', {
          before: latest.before,
          after: latest.after,
        })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={handleUndo}
        disabled={undoCompaction.isLoading}
        aria-label={localize('com_ui_memory_compact_undo')}
      >
        {undoCompaction.isLoading ? (
          <Spinner className="mr-1 size-3.5" />
        ) : (
          <Undo2 className="mr-1 size-3.5" aria-hidden="true" />
        )}
        {localize('com_ui_memory_compact_undo')}
      </Button>
    </div>
  );
}
