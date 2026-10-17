// file deepcode ignore HardcodedNonCryptoSecret: No hardcoded secrets
import { useTranslation } from 'react-i18next';
import {
  AttachmentErrorCodes,
  ViolationTypes,
  ErrorTypes,
  alternateName,
} from 'librechat-data-provider';
import type { AttachmentErrorParams } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { LocalizeFunction } from '~/common';
import { describeAttachmentError, resolveCurrentModelLabel } from '~/utils/attachments';
import { useLocalize, useClockFormat, useModelSuggestion } from '~/hooks';
import { formatJSON, extractJson, isJson } from '~/utils/json';
import { OFFICE_GENERATION_FAILED } from '~/utils/streamError';
import { useChatContext } from '~/Providers/ChatContext';
import { useGetStartupConfig } from '~/data-provider';
import CodeBlock from './CodeBlock';

const localizedErrorPrefix = 'com_error';
const langChainModelNotFoundUrl = /langchain\.com\/.*\/MODEL_NOT_FOUND(?:\/|\b)/i;

/**
 * `type` values from `api/server/middleware/officeLimits.js`'s `CorporateViolationTypes`
 * (a plain object exported from that Node file, not shared with the client build, so the
 * strings are mirrored here rather than imported).
 */
const CorporateViolationTypes = {
  LIMIT: 'corporate_limit',
  BLOCKED: 'corporate_blocked',
  MODEL_NOT_ALLOWED: 'corporate_model_not_allowed',
  CHECK_FAILED: 'corporate_check_failed',
} as const;

type TOfficeLimit = {
  window: 'daily';
  kind: 'cost';
  used: number;
  limit: number;
  resetAt: string;
};

type TClockFormat = {
  locale: string;
  hour12: boolean;
};

type TOfficeModelNotAllowed = {
  model: string;
};

const officeLimitKindKey: Record<TOfficeLimit['kind'], TranslationKeys> = {
  cost: 'com_error_office_limit_kind_cost',
};

/**
 * Formatted in the `Europe/Moscow` wall clock regardless of the viewer's own timezone —
 * limits reset on Moscow midnight/month-start (the container's `TZ`), so showing any
 * other timezone here would just be a different, wrong number.
 */
function formatOfficeResetAt(resetAt: string, locale: string, hour12: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
    timeZoneName: 'short',
  }).format(new Date(resetAt));
}

type TConcurrent = {
  limit: number;
};

type TMessageLimit = {
  max: number;
  windowInMinutes: number;
};

type TTokenBalance = {
  type: ViolationTypes | ErrorTypes;
  balance: number;
  tokenCost: number;
  promptTokens: number;
  prev_count: number;
  violation_count: number;
  date: Date;
  generations?: unknown[];
};

type TExpiredKey = {
  expiredAt: string;
  endpoint: string;
};

type TGenericError = {
  info: string;
};

type TContextOverflowError = {
  message?: string;
  params?: AttachmentErrorParams;
};

function ContextOverflowMessage({ message, params }: TContextOverflowError) {
  const localize = useLocalize();
  const requiredContextTokens = params?.requiredContextTokens;
  const suggestion = useModelSuggestion(
    typeof requiredContextTokens === 'number' ? requiredContextTokens : 0,
  );
  const { conversation } = useChatContext();
  const { data: startupConfig } = useGetStartupConfig();

  if (params == null || typeof requiredContextTokens !== 'number') {
    return <>{localize('com_error_files_upload')}</>;
  }

  const modelLabel =
    params.modelLabel ??
    resolveCurrentModelLabel(conversation?.spec, conversation?.model, startupConfig);

  const described = describeAttachmentError(
    {
      message: message ?? '',
      errorCode: AttachmentErrorCodes.context_overflow,
      params: { ...params, modelLabel },
    },
    suggestion,
  );

  return <>{described.key == null ? described.text : localize(described.key, described.params)}</>;
}

const errorMessages = {
  [ErrorTypes.MODERATION]: 'com_error_moderation',
  [ErrorTypes.NO_USER_KEY]: 'com_error_no_user_key',
  [ErrorTypes.INVALID_USER_KEY]: 'com_error_invalid_user_key',
  [ErrorTypes.NO_BASE_URL]: 'com_error_no_base_url',
  [ErrorTypes.INVALID_BASE_URL]: 'com_error_invalid_base_url',
  [ErrorTypes.INVALID_ACTION]: `com_error_${ErrorTypes.INVALID_ACTION}`,
  [ErrorTypes.INVALID_REQUEST]: `com_error_${ErrorTypes.INVALID_REQUEST}`,
  [ErrorTypes.REFUSAL]: 'com_error_refusal',
  [ErrorTypes.MISSING_MODEL]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info: endpoint } = json;
    const provider = (alternateName[endpoint ?? ''] as string | undefined) ?? endpoint ?? 'unknown';
    return localize('com_error_missing_model', { 0: provider });
  },
  [ErrorTypes.MODELS_NOT_LOADED]: 'com_error_models_not_loaded',
  [ErrorTypes.ENDPOINT_MODELS_NOT_LOADED]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info: endpoint } = json;
    const provider = (alternateName[endpoint ?? ''] as string | undefined) ?? endpoint ?? 'unknown';
    return localize('com_error_endpoint_models_not_loaded', { 0: provider });
  },
  [ErrorTypes.NO_SYSTEM_MESSAGES]: `com_error_${ErrorTypes.NO_SYSTEM_MESSAGES}`,
  [ErrorTypes.EXPIRED_USER_KEY]: (json: TExpiredKey, localize: LocalizeFunction) => {
    const { expiredAt, endpoint } = json;
    return localize('com_error_expired_user_key', { 0: endpoint, 1: expiredAt });
  },
  [ErrorTypes.INPUT_LENGTH]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    return localize('com_error_input_length', { 0: info });
  },
  [ErrorTypes.INVALID_AGENT_PROVIDER]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    const provider = (alternateName[info] as string | undefined) ?? info;
    return localize('com_error_invalid_agent_provider', { 0: provider });
  },
  [ErrorTypes.GOOGLE_ERROR]: (json: TGenericError) => {
    const { info } = json;
    return info;
  },
  [ErrorTypes.GOOGLE_TOOL_CONFLICT]: 'com_error_google_tool_conflict',
  [ErrorTypes.GOOGLE_VIDEO_UNPROCESSABLE]: 'com_error_google_video_unprocessable',
  [ErrorTypes.RESOURCE_RECOVERY_REQUIRED]: 'com_error_resource_recovery_required',
  [ErrorTypes.STREAM_EXPIRED]: 'com_error_stream_expired',
  [ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW]: (json: TContextOverflowError) => (
    <ContextOverflowMessage message={json.message} params={json.params} />
  ),
  [ViolationTypes.BAN]:
    'Your account has been temporarily banned due to violations of our service.',
  [ViolationTypes.ILLEGAL_MODEL_REQUEST]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    const [endpoint, model = 'unknown'] = info?.split('|') ?? [];
    const provider = (alternateName[endpoint ?? ''] as string | undefined) ?? endpoint ?? 'unknown';
    return localize('com_error_illegal_model_request', { 0: model, 1: provider });
  },
  invalid_api_key:
    'Invalid API key. Please check your API key and try again. You can do this by clicking on the model logo in the left corner of the textbox and selecting "Set Token" for the current selected endpoint. Thank you for your understanding.',
  insufficient_quota:
    'We apologize for any inconvenience caused. The default API key has reached its limit. To continue using this service, please set up your own API key. You can do this by clicking on the model logo in the left corner of the textbox and selecting "Set Token" for the current selected endpoint. Thank you for your understanding.',
  concurrent: (json: TConcurrent) => {
    const { limit } = json;
    const plural = limit > 1 ? 's' : '';
    return `Only ${limit} message${plural} at a time. Please allow any other responses to complete before sending another message, or wait one minute.`;
  },
  message_limit: (json: TMessageLimit) => {
    const { max, windowInMinutes } = json;
    const plural = max > 1 ? 's' : '';
    return `You hit the message limit. You have a cap of ${max} message${plural} per ${
      windowInMinutes > 1 ? `${windowInMinutes} minutes` : 'minute'
    }.`;
  },
  [CorporateViolationTypes.LIMIT]: (
    json: TOfficeLimit,
    localize: LocalizeFunction,
    clockFormat: TClockFormat,
  ) => (
    <>
      {localize('com_error_office_limit_exceeded', {
        window: localize('com_error_office_limit_window_daily'),
        kind: localize(officeLimitKindKey[json.kind]),
        resetAt: formatOfficeResetAt(json.resetAt, clockFormat.locale, clockFormat.hour12),
      })}
      <br />
      <br />
      {localize('com_error_office_limit_hint')}
    </>
  ),
  [CorporateViolationTypes.BLOCKED]: 'com_error_office_blocked',
  [CorporateViolationTypes.MODEL_NOT_ALLOWED]: (
    json: TOfficeModelNotAllowed,
    localize: LocalizeFunction,
  ) => localize('com_error_office_model_not_allowed', { 0: json.model }),
  [CorporateViolationTypes.CHECK_FAILED]: 'com_error_office_check_failed',
  [OFFICE_GENERATION_FAILED]: 'com_error_office_generation_failed',
  token_balance: (json: TTokenBalance, localize: LocalizeFunction) => {
    const { balance, tokenCost, promptTokens, generations } = json;
    const message = localize('com_error_token_balance', {
      0: balance,
      1: promptTokens,
      2: tokenCost,
    });
    return (
      <>
        {message}
        {generations && (
          <>
            <br />
            <br />
          </>
        )}
        {generations && (
          <CodeBlock
            lang="Generations"
            error={true}
            codeChildren={formatJSON(JSON.stringify(generations))}
          />
        )}
      </>
    );
  },
};

const Error = ({ text }: { text: string }) => {
  const localize = useLocalize();
  const hour12 = useClockFormat();
  const { i18n } = useTranslation();
  const clockFormat: TClockFormat = { locale: i18n.language, hour12 };
  const jsonString = extractJson(text);
  const errorMessage = text.length > 512 ? text.slice(0, 512) + '...' : text;
  const defaultResponse = (
    <>
      {localize('com_error_office_generation_failed')}
      <br />
      <br />
      <span className="text-xs opacity-60">{errorMessage}</span>
    </>
  );

  if (langChainModelNotFoundUrl.test(text)) {
    return localize('com_error_model_not_found');
  }

  if (!isJson(jsonString)) {
    return defaultResponse;
  }

  const json = JSON.parse(jsonString);
  const errorKey = json.code || json.type;
  const keyExists = errorKey && errorMessages[errorKey];

  if (keyExists && typeof errorMessages[errorKey] === 'function') {
    return errorMessages[errorKey](json, localize, clockFormat);
  } else if (keyExists && keyExists.startsWith(localizedErrorPrefix)) {
    return localize(errorMessages[errorKey]);
  } else if (keyExists) {
    return errorMessages[errorKey];
  } else {
    return defaultResponse;
  }
};

export default Error;
