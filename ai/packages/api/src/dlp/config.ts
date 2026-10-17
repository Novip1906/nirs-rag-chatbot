import { dlpConfigSchema } from 'librechat-data-provider';
import type { TCustomConfig, TDlpConfig } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';

/**
 * Приводит секцию `dlp` из `librechat.yaml` к полному виду.
 *
 * Разбор здесь не формальность: `loadCustomConfig` отдаёт **сырой** объект
 * YAML, а схему использует только для проверки (см. `return customConfig` в
 * `api/server/services/Config/loadCustomConfig.js`). Поэтому умолчания к
 * секции никто не применяет, и написанное администратором
 * `dlp: { enabled: true }` дошло бы до маскирования вообще без категорий —
 * то есть маскировать было бы нечего, притом что DLP считался бы включённым.
 *
 * Отсутствие секции — обычное дело и означает выключенный DLP, а вот
 * непригодная секция это ошибка настройки: её видно в журнале, и маскирование
 * не включается, чтобы не создавать видимость защиты.
 */
export function resolveDlpConfig(raw: TCustomConfig['dlp']): TDlpConfig | undefined {
  if (raw == null) {
    return undefined;
  }

  const parsed = dlpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error(
      '[dlp] Секция `dlp` в конфигурации непригодна, маскирование выключено',
      parsed.error.issues,
    );
    return undefined;
  }

  return parsed.data;
}

/**
 * Маскирование включается только вместе с журналом аудита — обёртке он нужен
 * по типу. Пропавшая зависимость поэтому выключает защиту, и выключает молча:
 * именно так DLP и простоял выключенным незамеченным. Настроенный, но
 * неработающий DLP опаснее выключенного, потому что о нём думают, что он есть,
 * так что случай должен быть шумным.
 */
export function warnDlpAuditMissing(hasAuditSink: boolean, dlpConfigured: boolean): boolean {
  if (!dlpConfigured || hasAuditSink) {
    return false;
  }
  logger.error(
    '[dlp] DLP включён в конфигурации, но журнал аудита недоступен — маскирование НЕ применяется',
  );
  return true;
}
