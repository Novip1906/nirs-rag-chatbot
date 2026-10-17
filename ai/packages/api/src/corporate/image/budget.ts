import type { AssertLimitsDeps } from '~/corporate/limits';
import { nextDayStart, startOfDay } from '~/corporate/limits';

export type ImageBudgetDeps = AssertLimitsDeps;

export type ImageBudgetVerdict = { allowed: true } | { allowed: false; reason: string };

export const IMAGE_BLOCKED_REASON: string =
  'Доступ к Corporate AI для этой учётной записи заблокирован администратором, картинку сделать нельзя.';

function formatResetAt(resetAt: Date): string {
  return resetAt.toLocaleString('ru-RU', {
    timeZone: process.env.TZ || 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function imageLimitReason(resetAt: Date): string {
  return (
    'Дневной лимит сотрудника исчерпан, поэтому картинку сейчас сделать нельзя. ' +
    `Лимит обновится ${formatResetAt(resetAt)}. Скажи сотруднику об этом без сумм и цифр расхода.`
  );
}

export function imageReserveReason(resetAt: Date): string {
  return (
    'Остатка дневного лимита сотрудника не хватает на картинку, хотя обычные ответы ещё ' +
    `доступны. Лимит обновится ${formatResetAt(resetAt)}. Скажи сотруднику об этом без сумм ` +
    'и цифр расхода.'
  );
}

export async function checkImageBudget(
  deps: ImageBudgetDeps,
  userId: string,
  estimatedCostUsd: number | undefined,
  now: Date = new Date(),
): Promise<ImageBudgetVerdict> {
  const policy = await deps.resolvePolicy(userId);
  if (policy.blocked) {
    return { allowed: false, reason: IMAGE_BLOCKED_REASON };
  }
  const limit = policy.limits.dailyCostUsd;
  if (limit == null || !Number.isFinite(limit)) {
    return { allowed: true };
  }
  const { costUsd: used } = await deps.getUsageTotals(userId, startOfDay(now));
  const reserve = estimatedCostUsd ?? 0;
  if (used >= limit) {
    return { allowed: false, reason: imageLimitReason(nextDayStart(now)) };
  }
  if (used + reserve > limit) {
    return { allowed: false, reason: imageReserveReason(nextDayStart(now)) };
  }
  return { allowed: true };
}
