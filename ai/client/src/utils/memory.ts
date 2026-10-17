import { matchSorter } from 'match-sorter';
import type { MemoriesResponse, TUserMemory, MemoryArtifact } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';

type HandleMemoryArtifactParams = {
  memoryArtifact: MemoryArtifact;
  currentData: MemoriesResponse;
};

type MemoryApiError = {
  response?: { data?: { error?: string } };
};

type MemoryDisplayTitleSource = {
  title?: string;
  value?: string;
};

const MEMORY_DISPLAY_TITLE_FALLBACK_MAX_LENGTH = 60;

export function getMemoryDisplayTitle(memory: MemoryDisplayTitleSource): string {
  const title = memory.title?.trim();
  if (title) {
    return title;
  }

  const firstLine = memory.value?.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= MEMORY_DISPLAY_TITLE_FALLBACK_MAX_LENGTH) {
    return firstLine;
  }

  return `${firstLine.slice(0, MEMORY_DISPLAY_TITLE_FALLBACK_MAX_LENGTH)}…`;
}

/** Usage totals track the shared personal pool only; agent- and project-partition
 *  writes never affect the personal usage badge. */
const isPersonal = (agentId?: string, chatProjectId?: string) =>
  agentId == null && chatProjectId == null;

const samePartition = (memory: TUserMemory, agentId?: string, chatProjectId?: string) =>
  (memory.agentId ?? undefined) === (agentId ?? undefined) &&
  (memory.chatProjectId ?? undefined) === (chatProjectId ?? undefined);

/**
 * @returns the localization key of the failure, or null when the value is valid
 */
export function getRequiredFieldError(value: string): TranslationKeys | null {
  return value.trim() ? null : 'com_ui_field_required';
}

export function getMemoryApiErrorMessage(error: Error, fallback: string): string {
  if (!('response' in error)) {
    return fallback;
  }

  const message = (error as Error & MemoryApiError).response?.data?.error;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/**
 * Pure function to handle memory artifact updates
 * @param params - Object containing memoryArtifact and currentData
 * @returns Updated MemoriesResponse or undefined if no update needed
 */
export function handleMemoryArtifact({
  memoryArtifact,
  currentData,
}: HandleMemoryArtifactParams): MemoriesResponse | undefined {
  const { type, key, value, title, tokenCount = 0, agentId, chatProjectId } = memoryArtifact;

  if (type === 'update' && !value) {
    return undefined;
  }

  const memories = currentData.memories;
  const existingIndex = memories.findIndex(
    (m) => m.key === key && samePartition(m, agentId, chatProjectId),
  );

  if (type === 'delete') {
    if (existingIndex === -1) {
      return undefined;
    }

    const deletedMemory = memories[existingIndex];
    const newMemories = [...memories];
    newMemories.splice(existingIndex, 1);

    const totalTokens = isPersonal(agentId, chatProjectId)
      ? currentData.totalTokens - (deletedMemory.tokenCount || 0)
      : currentData.totalTokens;
    const usagePercentage = currentData.tokenLimit
      ? Math.min(100, Math.round((totalTokens / currentData.tokenLimit) * 100))
      : null;

    return {
      ...currentData,
      memories: newMemories,
      totalTokens,
      usagePercentage,
    };
  }

  if (type === 'update') {
    const timestamp = new Date().toISOString();
    let totalTokens = currentData.totalTokens;
    let newMemories: TUserMemory[];
    const updatedMemory: TUserMemory = {
      key,
      value: value!,
      tokenCount,
      updated_at: timestamp,
      ...(agentId != null ? { agentId } : {}),
      ...(chatProjectId != null ? { chatProjectId } : {}),
    };

    if (existingIndex >= 0) {
      const oldTokenCount = memories[existingIndex].tokenCount || 0;
      if (isPersonal(agentId, chatProjectId)) {
        totalTokens = totalTokens - oldTokenCount + tokenCount;
      }

      newMemories = [...memories];
      newMemories[existingIndex] = {
        ...updatedMemory,
        title: title ?? memories[existingIndex].title,
        agentName: memories[existingIndex].agentName,
        chatProjectName: memories[existingIndex].chatProjectName,
      };
    } else {
      if (isPersonal(agentId, chatProjectId)) {
        totalTokens = totalTokens + tokenCount;
      }
      newMemories = [...memories, { ...updatedMemory, title }];
    }

    const usagePercentage = currentData.tokenLimit
      ? Math.min(100, Math.round((totalTokens / currentData.tokenLimit) * 100))
      : null;

    return {
      ...currentData,
      memories: newMemories,
      totalTokens,
      usagePercentage,
    };
  }

  return undefined;
}

export function searchMemories(memories: TUserMemory[], query: string): TUserMemory[] {
  const newestFirst = [...memories].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return newestFirst;
  }
  return matchSorter(newestFirst, trimmedQuery, {
    keys: ['title', 'value'],
    baseSort: (a, b) => a.index - b.index,
  });
}
