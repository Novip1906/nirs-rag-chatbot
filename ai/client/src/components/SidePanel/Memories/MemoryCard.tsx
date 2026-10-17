import { useTranslation } from 'react-i18next';
import type { TUserMemory } from 'librechat-data-provider';
import { getMemoryDisplayTitle } from '~/utils/memory';
import MemoryCardActions from './MemoryCardActions';
import { cn, formatLocaleDate } from '~/utils';
import { useLocalize } from '~/hooks';

interface MemoryCardProps {
  memory: TUserMemory;
  hasUpdateAccess: boolean;
}

export default function MemoryCard({ memory, hasUpdateAccess }: MemoryCardProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const displayTitle = getMemoryDisplayTitle(memory) || localize('com_ui_memory');

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2.5',
        'border border-border-light bg-transparent',
        'hover:bg-surface-secondary',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-text-primary">{displayTitle}</span>
        {memory.agentId != null && (
          <span
            className="shrink-0 truncate rounded-full border border-border-light px-2 py-0.5 text-xs text-text-secondary"
            title={localize('com_ui_memory_agent_badge')}
          >
            {memory.agentName ?? memory.agentId}
          </span>
        )}
        {memory.chatProjectId != null && (
          <span
            className="shrink-0 truncate rounded-full border border-border-light px-2 py-0.5 text-xs text-text-secondary"
            title={localize('com_ui_memory_project_badge')}
          >
            {memory.chatProjectName ?? memory.chatProjectId}
          </span>
        )}
        {memory.tokenCount !== undefined && (
          <span className="shrink-0 text-xs text-text-secondary">
            {localize('com_ui_token_count', { count: memory.tokenCount })}
          </span>
        )}
        {hasUpdateAccess && (
          <div className="ml-auto shrink-0">
            <MemoryCardActions memory={memory} />
          </div>
        )}
      </div>

      {/* Row 2: Value + Date */}
      <div className="mt-1 flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-text-primary" title={memory.value}>
          {memory.value}
        </p>
        <span className="shrink-0 text-xs text-text-secondary">
          {formatLocaleDate(memory.updated_at, i18n.language)}
        </span>
      </div>
    </div>
  );
}
