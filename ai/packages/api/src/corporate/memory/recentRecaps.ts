import { logger } from '@librechat/data-schemas';
import type { ConversationMethods } from '@librechat/data-schemas';
import { getSafeErrorMetadata } from '~/utils/errors';

export type RecentRecap = Awaited<
  ReturnType<ConversationMethods['getRecentConversationRecaps']>
>[number];

const FALLBACK_TIMEZONE = 'Europe/Moscow';
const RECENT_RECAPS_LIMIT = 8;
const RECENT_RECAPS_HEADER =
  '# Recent conversations with the user (newest first, excluding the current one). Only the last few conversations are listed, so a topic missing from this list may still have been discussed earlier. Background reference only: rely on it when it is relevant to the current request, and do not bring it up otherwise. These are automatic summaries, not facts the user asked to keep: do not save them to memory unless the user explicitly asks.';

function resolveTimezone(timezone?: string): string {
  if (!timezone) {
    return FALLBACK_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone });
    return timezone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function formatRecapLine(recap: RecentRecap, dayFormat: Intl.DateTimeFormat): string {
  const title = recap.title ? singleLine(recap.title) : '';
  const label = title ? ` «${title}»` : '';
  return `- ${dayFormat.format(recap.recap.at)}${label} — ${singleLine(recap.recap.text)}`;
}

export function formatRecentRecapsBlock(p: {
  recaps: RecentRecap[];
  now: Date;
  timezone?: string;
}): string {
  const timeZone = resolveTimezone(p.timezone);
  const today = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(p.now);
  const lines = [`# Today: ${today}`];
  if (p.recaps.length > 0) {
    const dayFormat = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
    });
    lines.push(
      '',
      RECENT_RECAPS_HEADER,
      ...p.recaps.map((recap) => formatRecapLine(recap, dayFormat)),
    );
  }
  return lines.join('\n');
}

export async function loadRecentRecapsBlock(
  deps: { getRecentConversationRecaps: ConversationMethods['getRecentConversationRecaps'] },
  p: {
    user: string;
    chatProjectId?: string | null;
    excludeConversationId?: string;
    timezone?: string;
    now?: Date;
  },
): Promise<string | undefined> {
  try {
    const recaps = await deps.getRecentConversationRecaps({
      user: p.user,
      chatProjectId: p.chatProjectId ?? null,
      excludeConversationId: p.excludeConversationId,
      limit: RECENT_RECAPS_LIMIT,
    });
    return formatRecentRecapsBlock({ recaps, now: p.now ?? new Date(), timezone: p.timezone });
  } catch (error) {
    logger.warn('[recap] Failed to load recent conversation recaps', getSafeErrorMetadata(error));
    return undefined;
  }
}
