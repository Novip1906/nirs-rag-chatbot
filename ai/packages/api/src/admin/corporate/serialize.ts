import type { ILimits } from '@librechat/data-schemas';
import type { AdminFeedbackRow, AdminLimits } from 'librechat-data-provider';

export interface FeedbackRowInput {
  messageId: string;
  conversationId: string;
  userId: string;
  userName: string;
  model: string;
  rating: AdminFeedbackRow['rating'];
  tag: string;
  text: string;
  date: Date;
}

export function toAdminFeedbackRow(row: FeedbackRowInput): AdminFeedbackRow {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    userId: row.userId,
    userName: row.userName,
    model: row.model,
    rating: row.rating,
    tag: row.tag,
    text: row.text,
    date: row.date.toISOString(),
  };
}

const LIMIT_KEYS: Array<keyof AdminLimits> = ['dailyCostUsd'];

/**
 * Лимиты приходят из Mongoose под-схемой: собственных перечисляемых свойств у документа
 * нет, значения отдаёт прототип. Отдать такой объект в `res.json` — значит отправить
 * клиенту `$__`, `_doc` и `$__parent` вместо числа. Пересобирается по ключам.
 */
export function toAdminLimits(limits: ILimits | AdminLimits | null | undefined): AdminLimits {
  const plain = {} as AdminLimits;
  for (const key of LIMIT_KEYS) {
    plain[key] = limits?.[key] ?? null;
  }
  return plain;
}
