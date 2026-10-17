import { logger } from '@librechat/data-schemas';

export interface BlockedAccessDeps {
  getUserPolicy: (userId: string) => Promise<{ blocked?: boolean } | null>;
}

/**
 * Блокировка проверяется на каждом авторизованном запросе, поэтому обращение к
 * `userPolicy` кэшируется на короткое окно: снятие блокировки доходит до
 * пользователя за один TTL, а админская правка сбрасывает запись сразу через
 * `invalidateBlockedUser`.
 */
const BLOCKED_TTL_MS = 30_000;
const MAX_ENTRIES = 5000;

const cache = new Map<string, { blocked: boolean; expiresAt: number }>();

export function invalidateBlockedUser(userId: string): void {
  cache.delete(userId);
}

function remember(userId: string, blocked: boolean): boolean {
  if (cache.size >= MAX_ENTRIES) {
    cache.clear();
  }
  cache.set(userId, { blocked, expiresAt: Date.now() + BLOCKED_TTL_MS });
  return blocked;
}

export async function isUserBlocked(
  deps: BlockedAccessDeps,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.blocked;
  }

  try {
    const policy = await deps.getUserPolicy(userId);
    return remember(userId, policy?.blocked === true);
  } catch (error) {
    logger.error('[isUserBlocked] Failed to read Corporate AI user policy', error);
    return false;
  }
}
