import {
  AttachmentErrorCodes,
  ATTACHMENT_FORMATS,
  EToolResources,
  isAttachmentErrorCode,
} from 'librechat-data-provider';
import type {
  TModelSpec,
  TError,
  AttachmentErrorBody,
  AttachmentFormat,
  AttachmentFormatGroup,
  TTokenConfigMap,
  TStartupConfig,
} from 'librechat-data-provider';
import type { LocalizeFunction, ExtendedFile } from '~/common';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { getModelSpec, normalizeTokenConfigKey } from './endpoints';
import i18n from '~/locales/i18n';

export interface LocalizedMessageWithKey {
  key: TranslationKeys;
  params?: Record<string, string | number>;
}

export interface LocalizedMessageWithText {
  key: null;
  text: string;
}

export type LocalizedMessage = LocalizedMessageWithKey | LocalizedMessageWithText;

export interface UploadErrorEntry {
  filename: string;
  message: LocalizedMessage;
}

export function toUploadErrorEntry(filename: string, message: LocalizedMessage): UploadErrorEntry {
  return { filename, message };
}

const TEXT_AND_CODE_PREVIEW_COUNT = 4;

export function describeAcceptedFormats(
  formats: readonly AttachmentFormat[],
  localize: LocalizeFunction,
): string {
  const byGroup = new Map<AttachmentFormatGroup, AttachmentFormat[]>();
  for (const format of formats) {
    const bucket = byGroup.get(format.group);
    if (bucket) {
      bucket.push(format);
    } else {
      byGroup.set(format.group, [format]);
    }
  }

  const items: string[] = [];
  for (const group of Object.keys(ATTACHMENT_FORMATS) as AttachmentFormatGroup[]) {
    const groupFormats = byGroup.get(group);
    if (!groupFormats || groupFormats.length === 0) {
      continue;
    }
    if (group === 'textAndCode') {
      const preview = groupFormats
        .slice(0, TEXT_AND_CODE_PREVIEW_COUNT)
        .map((format) => `.${format.extension}`)
        .join(', ');
      const suffix = groupFormats.length > TEXT_AND_CODE_PREVIEW_COUNT ? '…' : '';
      items.push(`${localize('com_ui_attachment_text_and_code')} (${preview}${suffix})`);
      continue;
    }
    for (const format of groupFormats) {
      items.push(`.${format.extension}`);
    }
  }

  return items.join(', ');
}

function formatCount(value: number | undefined): string {
  return value != null ? value.toLocaleString(i18n.language) : '';
}

export function describeAttachmentError(
  body: AttachmentErrorBody,
  suggestion?: TModelSpec | null,
): LocalizedMessage {
  const { errorCode, params } = body;
  const filename = params.filename ?? '';

  switch (errorCode) {
    case AttachmentErrorCodes.unsupported_format:
      return { key: 'com_error_files_unsupported_format', params: { 0: '' } };
    case AttachmentErrorCodes.corrupted:
      return { key: 'com_error_attachment_corrupted', params: { 0: filename } };
    case AttachmentErrorCodes.encrypted:
      return { key: 'com_error_attachment_encrypted', params: { 0: filename } };
    case AttachmentErrorCodes.no_text:
      return { key: 'com_error_attachment_no_text', params: { 0: filename } };
    case AttachmentErrorCodes.parse_timeout:
      return {
        key: 'com_error_attachment_parse_timeout',
        params: { 0: filename, 1: formatCount(params.seconds) },
      };
    case AttachmentErrorCodes.too_large:
      return {
        key: 'com_error_attachment_too_large',
        params: { 0: filename, 1: formatCount(params.limitMb) },
      };
    case AttachmentErrorCodes.unpacked_too_large:
      return { key: 'com_error_attachment_unpacked_too_large', params: { 0: filename } };
    case AttachmentErrorCodes.context_overflow: {
      const tokens = formatCount(params.tokens);
      if (suggestion == null) {
        return {
          key: 'com_error_attachment_context_overflow_all',
          params: { 0: filename, 1: tokens },
        };
      }
      const contextTokens = formatCount(params.contextTokens);
      if (params.modelLabel) {
        return {
          key: 'com_error_attachment_context_overflow',
          params: {
            0: filename,
            1: params.modelLabel,
            2: tokens,
            3: contextTokens,
            4: suggestion.label,
          },
        };
      }
      return {
        key: 'com_error_attachment_context_overflow_unknown_model',
        params: { 0: filename, 1: tokens, 2: contextTokens, 3: suggestion.label },
      };
    }
    default:
      return { key: 'com_error_files_upload' };
  }
}

export function describeUploadError(
  error: TError | undefined,
  filename: string,
  suggestion?: TModelSpec | null,
  modelLabel?: string,
): LocalizedMessage {
  if (error?.code === 'ERR_CANCELED') {
    return { key: 'com_error_files_upload_canceled' };
  }

  const body = error?.response?.data;
  const errorCode = body?.errorCode;
  if (body != null && errorCode != null && isAttachmentErrorCode(errorCode)) {
    const params = body.params ?? {};
    return describeAttachmentError(
      {
        message: body.message ?? '',
        errorCode,
        params: { ...params, modelLabel: params.modelLabel ?? modelLabel },
      },
      suggestion,
    );
  }

  const status = error?.response?.status;
  if (status === 413) {
    return { key: 'com_error_attachment_upload_too_large', params: { 0: filename } };
  }

  if (status != null && status >= 400 && status < 500 && body?.message) {
    return { key: null, text: body.message };
  }

  return { key: 'com_error_files_upload' };
}

function isBetterSuggestion(
  candidate: TModelSpec,
  candidateContext: number,
  current: TModelSpec,
  currentContext: number,
): boolean {
  if (candidateContext !== currentContext) {
    return candidateContext < currentContext;
  }
  const candidateOrder = candidate.order ?? Number.POSITIVE_INFINITY;
  const currentOrder = current.order ?? Number.POSITIVE_INFINITY;
  if (candidateOrder !== currentOrder) {
    return candidateOrder < currentOrder;
  }
  return candidate.label.localeCompare(current.label) < 0;
}

function toPositiveNumber(value: unknown): number | undefined {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num > 0 ? num : undefined;
}

export function resolveCurrentModelLabel(
  specName: string | null | undefined,
  model: string | null | undefined,
  startupConfig: TStartupConfig | undefined,
): string | undefined {
  const spec = getModelSpec({ specName, startupConfig });
  return spec?.label ?? model ?? undefined;
}

export function resolveSpecContext(
  spec: TModelSpec,
  tokenConfig: TTokenConfigMap | undefined,
): number | undefined {
  const preset = spec.preset;
  const fromPreset = toPositiveNumber(preset.maxContextTokens);
  if (fromPreset != null) {
    return fromPreset;
  }
  if (preset.endpoint == null || preset.model == null) {
    return undefined;
  }
  return tokenConfig?.[normalizeTokenConfigKey(preset.endpoint)]?.[preset.model]?.context;
}

export type AttachmentStage = 'uploading' | 'extracting' | 'processing';

export const ATTACHMENT_STAGE_KEYS: Record<AttachmentStage, TranslationKeys> = {
  uploading: 'com_ui_attachment_uploading',
  extracting: 'com_ui_attachment_extracting',
  processing: 'com_ui_attachment_processing',
};

export function getAttachmentStage(
  file: Pick<ExtendedFile, 'progress' | 'stage' | 'tool_resource'>,
): AttachmentStage | null {
  if (file.progress >= 1) {
    return null;
  }
  if (file.stage !== 'processing') {
    return 'uploading';
  }
  return file.tool_resource === EToolResources.context ? 'extracting' : 'processing';
}

export function pickModelSuggestion(
  specs: readonly TModelSpec[],
  currentSpecName: string | null | undefined,
  requiredContextTokens: number,
  contextOf: (spec: TModelSpec) => number | undefined,
): TModelSpec | null {
  let best: TModelSpec | null = null;
  let bestContext = 0;

  for (const spec of specs) {
    if (spec.name === currentSpecName) {
      continue;
    }
    const context = contextOf(spec);
    if (context == null || context < requiredContextTokens) {
      continue;
    }
    if (best == null || isBetterSuggestion(spec, context, best, bestContext)) {
      best = spec;
      bestContext = context;
    }
  }

  return best;
}
