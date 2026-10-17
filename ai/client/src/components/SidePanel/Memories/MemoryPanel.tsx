import { useMemo, useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import {
  Button,
  Checkbox,
  Dropdown,
  FilterInput,
  TooltipAnchor,
  OGDialogTrigger,
  useToastContext,
} from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import {
  useUpdateMemoryPreferencesMutation,
  useMemoriesQuery,
  useGetUserQuery,
} from '~/data-provider';
import MemoryCompactionBanner from './MemoryCompactionBanner';
import MemoryCompactButton from './MemoryCompactButton';
import MemoryCardSkeleton from './MemoryCardSkeleton';
import MemoryCreateDialog from './MemoryCreateDialog';
import { useLocalize, useHasAccess } from '~/hooks';
import MemoryUsageBadge from './MemoryUsageBadge';
import { searchMemories } from '~/utils/memory';
import { PanelContent } from '~/components/ui';
import MemoryList from './MemoryList';
import { cn } from '~/utils';

/** Partition filter sentinels; any other value is a prefixed project or agent id */
const PARTITION_ALL = 'all';
const PARTITION_PERSONAL = 'personal';
const PROJECT_PREFIX = 'project:';
const AGENT_PREFIX = 'agent:';

export default function MemoryPanel() {
  const localize = useLocalize();
  const { data: userData } = useGetUserQuery();
  const { data: memData, isLoading } = useMemoriesQuery({ refetchOnMount: 'always' });
  const { showToast } = useToastContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [partitionFilter, setPartitionFilter] = useState(PARTITION_ALL);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);

  const updateMemoryPreferencesMutation = useUpdateMemoryPreferencesMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      setReferenceSavedMemories((prev) => !prev);
    },
  });

  useEffect(() => {
    if (userData?.personalization?.memories !== undefined) {
      setReferenceSavedMemories(userData.personalization.memories);
    }
  }, [userData?.personalization?.memories]);

  const handleMemoryToggle = (checked: boolean) => {
    setReferenceSavedMemories(checked);
    updateMemoryPreferencesMutation.mutate({ memories: checked });
  };

  const hasReadAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });

  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.UPDATE,
  });

  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.CREATE,
  });

  const hasOptOutAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.OPT_OUT,
  });

  const memories: TUserMemory[] = useMemo(() => memData?.memories ?? [], [memData]);

  const partitionOptions = useMemo(() => {
    const projectsById = new Map<string, string>();
    const agentsById = new Map<string, string>();
    for (const memory of memories) {
      if (memory.chatProjectId != null && !projectsById.has(memory.chatProjectId)) {
        projectsById.set(memory.chatProjectId, memory.chatProjectName ?? memory.chatProjectId);
      }
      if (memory.agentId != null && !agentsById.has(memory.agentId)) {
        agentsById.set(memory.agentId, memory.agentName ?? memory.agentId);
      }
    }
    if (projectsById.size === 0 && agentsById.size === 0) {
      return null;
    }
    return [
      { value: PARTITION_ALL, label: localize('com_ui_memories_all') },
      { value: PARTITION_PERSONAL, label: localize('com_ui_memories_personal') },
      ...[...projectsById.entries()].map(([id, label]) => ({
        value: `${PROJECT_PREFIX}${id}`,
        label,
      })),
      ...[...agentsById.entries()].map(([id, label]) => ({ value: `${AGENT_PREFIX}${id}`, label })),
    ];
  }, [memories, localize]);

  /** Falls back to "all" when the selected partition no longer exists
   *  (e.g. the last memory of that agent was deleted), so the panel never
   *  gets stuck filtering on a removed partition. */
  const activePartition = useMemo(() => {
    if (partitionFilter === PARTITION_ALL || partitionFilter === PARTITION_PERSONAL) {
      return partitionFilter;
    }
    return partitionOptions?.some((option) => option.value === partitionFilter)
      ? partitionFilter
      : PARTITION_ALL;
  }, [partitionOptions, partitionFilter]);

  const compactionScope = useMemo(() => {
    if (activePartition.startsWith(PROJECT_PREFIX)) {
      return { chatProjectId: activePartition.slice(PROJECT_PREFIX.length) };
    }
    if (activePartition.startsWith(AGENT_PREFIX)) {
      return { agentId: activePartition.slice(AGENT_PREFIX.length) };
    }
    return {};
  }, [activePartition]);

  const filteredMemories = useMemo(() => {
    const partitionMemories =
      activePartition === PARTITION_ALL
        ? memories
        : activePartition === PARTITION_PERSONAL
          ? memories.filter((memory) => memory.agentId == null && memory.chatProjectId == null)
          : activePartition.startsWith(PROJECT_PREFIX)
            ? memories.filter(
                (memory) => memory.chatProjectId === activePartition.slice(PROJECT_PREFIX.length),
              )
            : memories.filter(
                (memory) => memory.agentId === activePartition.slice(AGENT_PREFIX.length),
              );
    return searchMemories(partitionMemories, searchQuery);
  }, [memories, searchQuery, activePartition]);

  if (!hasReadAccess) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-text-secondary">{localize('com_ui_no_read_access')}</p>
        </div>
      </div>
    );
  }

  const tokenLimit = memData?.tokenLimit ?? null;
  const showUsageBadge = tokenLimit != null;

  return (
    <div
      role="region"
      aria-label={localize('com_ui_memories')}
      className="flex h-full w-full min-w-0 flex-col overflow-hidden pt-2"
    >
      {/* Sticky header: filter, partition, usage + toggle */}
      <div className="shrink-0 space-y-2 px-3 pb-2">
        {/* Header: Filter + Create Button */}
        <div className="flex items-center gap-2">
          <FilterInput
            inputId="memory-search"
            label={localize('com_ui_memories_filter')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName="flex-1"
          />
          {hasCreateAccess && (
            <MemoryCreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <OGDialogTrigger asChild>
                <TooltipAnchor
                  description={localize('com_ui_create_memory')}
                  side="bottom"
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 bg-transparent"
                      aria-label={localize('com_ui_create_memory')}
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                  }
                />
              </OGDialogTrigger>
            </MemoryCreateDialog>
          )}
          {hasUpdateAccess && compactionScope.agentId == null && (
            <MemoryCompactButton chatProjectId={compactionScope.chatProjectId} />
          )}
        </div>

        {/* Partition filter (only when agent-scoped memories exist) */}
        {partitionOptions && (
          <Dropdown
            value={activePartition}
            onChange={setPartitionFilter}
            options={partitionOptions}
            className="w-full"
            triggerClassName="w-full"
            ariaLabel={localize('com_ui_memories_partition_filter')}
            testId="memory-partition-filter"
          />
        )}

        {/* Controls: Usage Badge + Memory Toggle */}
        {(showUsageBadge || hasOptOutAccess) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Usage Badge */}
            {showUsageBadge && (
              <MemoryUsageBadge
                percentage={memData?.usagePercentage ?? 0}
                tokenLimit={tokenLimit}
                totalTokens={memData?.totalTokens ?? 0}
              />
            )}

            {/* Memory Toggle */}
            {hasOptOutAccess && (
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  'min-w-0 max-w-full',
                  showUsageBadge ? 'ml-auto' : 'w-full',
                  referenceSavedMemories && 'bg-surface-hover hover:bg-surface-hover',
                )}
                onClick={() => handleMemoryToggle(!referenceSavedMemories)}
                aria-label={localize('com_ui_use_memory')}
                aria-pressed={referenceSavedMemories}
                disabled={updateMemoryPreferencesMutation.isLoading}
              >
                <Checkbox
                  checked={referenceSavedMemories}
                  tabIndex={-1}
                  aria-hidden="true"
                  aria-label={localize('com_ui_use_memory')}
                  className="pointer-events-none shrink-0"
                />
                <span className="min-w-0 truncate">{localize('com_ui_use_memory')}</span>
              </Button>
            )}
          </div>
        )}

        {hasUpdateAccess && (
          <MemoryCompactionBanner
            compactions={memData?.compactions}
            agentId={compactionScope.agentId}
            chatProjectId={compactionScope.chatProjectId}
          />
        )}
      </div>

      {/* Only the list scrolls */}
      <PanelContent isLoading={isLoading} skeleton={<MemoryCardSkeleton />} className="px-3 pb-3">
        <MemoryList
          memories={filteredMemories}
          hasUpdateAccess={hasUpdateAccess}
          isFiltered={searchQuery.length > 0}
        />
      </PanelContent>
    </div>
  );
}
