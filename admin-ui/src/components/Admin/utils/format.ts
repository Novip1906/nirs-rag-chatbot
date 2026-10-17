import axios from 'axios';
import type useLocalize from '~/hooks/useLocalize';
import type { TranslationKeys } from '~/hooks/useLocalize';

const BACKEND_ERROR_KEYS: Record<string, TranslationKeys> = {
  FIELD_NOT_EDITABLE: 'com_admin_ai_error_field_not_editable',
};

const usdFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const smallUsdFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const countFormatter = new Intl.NumberFormat('ru-RU');

export const formatUsd = (value: number): string =>
  value !== 0 && Math.abs(value) < 0.01
    ? `$${smallUsdFormatter.format(value)}`
    : `$${usdFormatter.format(value)}`;

export const formatCount = (value: number): string => countFormatter.format(value);

export const formatPercent = (value: number): string => `${Math.round(value)}%`;

/**
 * Бэкенд-эндпоинты этого приложения почти повсеместно отвечают на ошибку
 * `{ error: '...' }` (считанные исключения — `{ message: '...' }`, например
 * `admin/skills.ts`). Раньше здесь читалось только `message`, и специфический текст
 * бэкенда («Провайдер моделей не отвечает», «Оригинал документа не найден» и т. п.)
 * никогда не доходил до тоста — вместо него всегда показывался общий
 * `com_admin_toast_error`, даже когда сервер прислал внятную причину.
 */
const extractErrorText = (value: unknown): string | undefined => {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }
  const record = value as { error?: unknown; message?: unknown };
  if (typeof record.error === 'string' && record.error !== '') {
    return record.error;
  }
  if (typeof record.message === 'string' && record.message !== '') {
    return record.message;
  }
  return undefined;
};

const hasMessage = (value: unknown): boolean => {
  const message = (value as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message !== '';
};

export const getAdminErrorMessage = (
  error: unknown,
  localize: ReturnType<typeof useLocalize>,
): string => {
  if (axios.isAxiosError(error)) {
    const code = (error.response?.data as { error_code?: unknown } | undefined)?.error_code;
    const codeKey = typeof code === 'string' ? BACKEND_ERROR_KEYS[code] : undefined;
    if (codeKey != null) {
      return localize(codeKey);
    }
    if (error.response?.status === 403 && !hasMessage(error.response?.data)) {
      return localize('com_admin_ai_error_forbidden');
    }
    const fromResponse = extractErrorText(error.response?.data);
    if (fromResponse != null) {
      return fromResponse;
    }
  }
  const fromError = extractErrorText(error);
  if (fromError != null) {
    return fromError;
  }
  return localize('com_admin_toast_error');
};
