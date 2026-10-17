import axios from 'axios';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { DirectoryError } from '~/types/directory';

const ERROR_KEYS: Record<string, TranslationKeys> = {
  unauthorized: 'com_admin_directory_error_unauthorized',
  forbidden: 'com_admin_directory_error_forbidden',
  not_found: 'com_admin_directory_error_not_found',
  validation_failed: 'com_admin_directory_error_validation_failed',
  email_taken: 'com_admin_directory_error_email_taken',
  department_name_taken: 'com_admin_directory_error_department_name_taken',
  department_not_empty: 'com_admin_directory_error_department_not_empty',
  last_admin: 'com_admin_directory_error_last_admin',
  self_admin_revoke: 'com_admin_directory_error_self_admin_revoke',
  self_block: 'com_admin_directory_error_self_block',
  self_delete: 'com_admin_directory_error_self_delete',
  idp_unavailable: 'com_admin_directory_error_idp_unavailable',
  idp_rejected: 'com_admin_directory_error_idp_rejected',
  idp_account_missing: 'com_admin_directory_error_idp_account_missing',
  already_active: 'com_admin_directory_error_already_active',
  not_activated: 'com_admin_directory_error_not_activated',
  reinvite_required: 'com_admin_directory_error_reinvite_required',
};

const FIELD_KEYS: Record<string, TranslationKeys> = {
  required: 'com_admin_directory_field_required',
  too_long: 'com_admin_directory_field_too_long',
  invalid: 'com_admin_directory_field_invalid',
  unknown: 'com_admin_directory_field_unknown',
  no_department: 'com_admin_directory_field_no_department',
};

function errorBody(error: unknown): Partial<DirectoryError> | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const data: unknown = error.response?.data;
  return data != null && typeof data === 'object' ? (data as Partial<DirectoryError>) : undefined;
}

export function directoryErrorCode(error: unknown): string | undefined {
  const code = errorBody(error)?.error_code;
  return typeof code === 'string' ? code : undefined;
}

export function directoryErrorKey(error: unknown): TranslationKeys {
  const code = directoryErrorCode(error);
  return (code != null ? ERROR_KEYS[code] : undefined) ?? 'com_admin_directory_error_unknown';
}

export function directoryFieldErrors(error: unknown): Record<string, TranslationKeys> {
  const fields = errorBody(error)?.fields;
  if (fields == null || typeof fields !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(fields).map(([field, reason]) => [
      field,
      FIELD_KEYS[reason] ?? 'com_admin_directory_field_invalid',
    ]),
  );
}
