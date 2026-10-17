import React from 'react';
import { ErrorTypes } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import type { TModelSpec, TStartupConfig } from 'librechat-data-provider';
import translation from '~/locales/en/translation.json';
import Error from '../Error';

jest.mock('~/locales/i18n', () => ({ __esModule: true, default: { language: 'en' } }));

/**
 * Resolves keys against the real English catalog rather than a stub, so a typed error whose
 * localization key is missing or misspelled fails here instead of reaching users as a raw key.
 * Interpolates `{{token}}` placeholders the way i18next does, since the office-limit message
 * composes its wording from `{{window}}`/`{{kind}}`/`{{resetAt}}`.
 */
let mockHour12 = true;
let mockLanguage = 'en';
let mockSuggestion: TModelSpec | null = null;
let mockConversation: { spec?: string | null; model?: string | null } | null = null;
let mockStartupConfig: Partial<TStartupConfig> | undefined;

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      const template =
        (jest.requireActual('~/locales/en/translation.json') as Record<string, string>)[key] ?? key;
      if (options == null) {
        return template;
      }
      return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, token) => {
        const value = options[token];
        return value == null ? match : String(value);
      });
    },
  useClockFormat: () => mockHour12,
  useModelSuggestion: () => mockSuggestion,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({ conversation: mockConversation }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

/**
 * `CodeBlock` only renders for the `token_balance` "generations" branch, which none of
 * these tests exercise. Mocked so importing it doesn't pull in `~/utils`'s full barrel
 * (and the `@react-spring/web` dependency `@librechat/client`'s bundle needs, which this
 * checkout doesn't have resolvable from here) just to load this suite.
 */
jest.mock('../CodeBlock', () => ({
  __esModule: true,
  default: () => null,
}));

const catalog = translation as Record<string, string>;

describe('Error — typed provider errors', () => {
  it('renders the localized copy for a rejected Google video', () => {
    /** The exact payload `resolveGoogleVideoError` emits from the server. */
    const payload = JSON.stringify({ type: ErrorTypes.GOOGLE_VIDEO_UNPROCESSABLE });
    render(<Error text={payload} />);

    expect(screen.getByText(catalog.com_error_google_video_unprocessable)).toBeInTheDocument();
  });

  it('names video length, the dominant cause, in the copy', () => {
    expect(catalog.com_error_google_video_unprocessable).toMatch(/too long/i);
  });

  it('replaces LangChain model-not-found attribution with localized guidance', () => {
    const raw =
      'An error occurred while processing the request: 404 404 page not found Troubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/MODEL_NOT_FOUND/';
    render(<Error text={raw} />);

    expect(screen.getByText(catalog.com_error_model_not_found)).toBeInTheDocument();
    expect(screen.queryByText(/langchain\.com/i)).not.toBeInTheDocument();
  });

  it('falls back to the raw provider text for an unmapped error', () => {
    const raw =
      '[GoogleGenerativeAI Error]: [400 Bad Request] Request contains an invalid argument';
    render(<Error text={raw} />);

    expect(
      screen.getByText(new RegExp(raw.slice(0, 30).replace(/[[\]]/g, '\\$&'))),
    ).toBeInTheDocument();
  });
});

describe('Error — Corporate AI denials', () => {
  beforeEach(() => {
    mockHour12 = true;
    mockLanguage = 'en';
  });

  it('formats the office reset time in a 24-hour clock, without AM/PM, for the ru interface language', () => {
    mockHour12 = false;
    mockLanguage = 'ru';
    const payload = JSON.stringify({
      type: 'corporate_limit',
      window: 'daily',
      kind: 'cost',
      resetAt: '2026-09-13T20:31:00.000Z',
    });
    render(<Error text={payload} />);

    expect(screen.getByText(/23:31/)).toBeInTheDocument();
    expect(screen.queryByText(/\bAM\b|\bPM\b/)).not.toBeInTheDocument();
  });

  it('formats the office reset time with a meridiem for the en interface language', () => {
    mockHour12 = true;
    mockLanguage = 'en';
    const payload = JSON.stringify({
      type: 'corporate_limit',
      window: 'daily',
      kind: 'cost',
      resetAt: '2026-09-13T20:31:00.000Z',
    });
    render(<Error text={payload} />);

    expect(screen.getByText(/11:31\s?PM/)).toBeInTheDocument();
  });

  /**
   * `api/server/middleware/officeLimits.js` now sends `{ type: 'corporate_limit', window,
   * kind, resetAt, ... }` — a structured payload like every other error here, not the
   * Russian sentence it used to. Without this mapping, an unrecognized `type` falls into
   * `defaultResponse` and every employee who hits a limit sees "Something went wrong...".
   */
  it('renders the daily spending-limit message instead of the generic wrapper', () => {
    const payload = JSON.stringify({
      type: 'corporate_limit',
      window: 'daily',
      kind: 'cost',
      used: 120,
      limit: 100,
      resetAt: '2026-08-26T00:00:00.000Z',
    });
    render(<Error text={payload} />);

    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText(/daily spending limit/i)).toBeInTheDocument();
  });

  it('points the employee at the sidebar usage widget when a limit was exhausted', () => {
    const payload = JSON.stringify({
      type: 'corporate_limit',
      window: 'daily',
      kind: 'cost',
      resetAt: '2026-08-26T00:00:00.000Z',
    });
    render(<Error text={payload} />);

    expect(screen.getByText(/usage widget/i)).toBeInTheDocument();
  });

  /**
   * A blocked account isn't a limit, and there's nothing to wait out — requesting a
   * higher limit wouldn't restore access, so this must NOT carry the usage-widget hint.
   */
  it('tells a blocked employee to contact their administrator, without the limit hint', () => {
    const payload = JSON.stringify({
      type: 'corporate_blocked',
      message: 'Доступ к Corporate AI для вашей учётной записи заблокирован администратором.',
    });
    render(<Error text={payload} />);

    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText(/contact your administrator/i)).toBeInTheDocument();
    expect(screen.queryByText(/usage widget/i)).not.toBeInTheDocument();
  });

  /** A disallowed model isn't a limit either — offering "request a higher limit" here
   *  would send the employee down the wrong path entirely. */
  it('names the disallowed model without suggesting a limit increase', () => {
    const payload = JSON.stringify({
      type: 'corporate_model_not_allowed',
      model: 'gpt-4o',
      message: 'Модель «gpt-4o» недоступна для вашей учётной записи в Corporate AI.',
    });
    render(<Error text={payload} />);

    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument();
    expect(screen.queryByText(/usage widget/i)).not.toBeInTheDocument();
  });

  it('asks the employee to retry when the limit check itself failed, without the limit hint', () => {
    const payload = JSON.stringify({
      type: 'corporate_check_failed',
      message:
        'Не удалось проверить лимиты Corporate AI. Попробуйте отправить сообщение ещё раз позже.',
    });
    render(<Error text={payload} />);

    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText(/try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/usage widget/i)).not.toBeInTheDocument();
  });

  /**
   * Emitted by the stream handlers when reconnect retries are exhausted on a generation
   * that never produced an answer.
   */
  it('renders localized copy for a lost generation', () => {
    const payload = JSON.stringify({ type: 'corporate_generation_failed' });
    render(<Error text={payload} />);

    expect(screen.queryByText(/specific error message/i)).not.toBeInTheDocument();
    expect(screen.getByText(catalog.com_error_office_generation_failed)).toBeInTheDocument();
  });

  /**
   * Anything this component cannot localize used to reach the employee as an English
   * wrapper around the raw payload. The localized sentence now leads; the raw text stays
   * below it in muted type, because support reads it off the employee's screenshot.
   */
  it('leads with the localized card for an unrecognized plain-text error', () => {
    render(<Error text="No model spec selected" />);

    expect(screen.getByText(catalog.com_error_office_generation_failed)).toBeInTheDocument();
    expect(screen.getByText(/No model spec selected/)).toBeInTheDocument();
  });

  it('leads with the localized card for an ingress error page', () => {
    render(<Error text="<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>" />);

    expect(screen.getByText(catalog.com_error_office_generation_failed)).toBeInTheDocument();
  });

  it('leads with the localized card for a JSON error carrying no recognizable type', () => {
    render(<Error text={JSON.stringify({ message: 'failed to start' })} />);

    expect(screen.getByText(catalog.com_error_office_generation_failed)).toBeInTheDocument();
  });
});

describe('Error — document context overflow', () => {
  const numberText = (value: number) => value.toLocaleString('en');

  const overflowPayload = (params: Record<string, unknown>) =>
    JSON.stringify({
      type: ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW,
      message: 'The document is too large.',
      errorCode: 'context_overflow',
      params,
    });

  beforeEach(() => {
    mockSuggestion = null;
    mockConversation = null;
    mockStartupConfig = undefined;
  });

  it('explains the refusal with the file name and formatted token counts when a stronger model exists', () => {
    mockSuggestion = {
      name: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      preset: {},
    } as TModelSpec;
    const payload = overflowPayload({
      filename: 'report.pdf',
      tokens: 950000,
      contextTokens: 600000,
      requiredContextTokens: 1000000,
    });

    render(<Error text={payload} />);

    expect(screen.getByText(/report\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(numberText(950000)))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(numberText(600000)))).toBeInTheDocument();
    expect(screen.getByText(/Claude Sonnet 5/)).toBeInTheDocument();
  });

  it('names the current model when its spec label resolves from the conversation', () => {
    mockSuggestion = {
      name: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      preset: {},
    } as TModelSpec;
    mockConversation = { spec: 'current-spec' };
    mockStartupConfig = {
      modelSpecs: {
        list: [{ name: 'current-spec', label: 'GPT Classic', preset: {} } as TModelSpec],
      },
    } as Partial<TStartupConfig>;
    const payload = overflowPayload({
      filename: 'report.pdf',
      tokens: 950000,
      contextTokens: 600000,
      requiredContextTokens: 1000000,
    });

    render(<Error text={payload} />);

    expect(screen.getByText(/GPT Classic/)).toBeInTheDocument();
    expect(screen.getByText(/Claude Sonnet 5/)).toBeInTheDocument();
  });

  it('falls back to the "any available model" wording when no stronger model is available', () => {
    mockSuggestion = null;
    const payload = overflowPayload({
      filename: 'report.pdf',
      tokens: 950000,
      requiredContextTokens: 1000000,
    });

    render(<Error text={payload} />);

    expect(screen.getByText(/any available model/i)).toBeInTheDocument();
  });

  it('falls back to the generic upload error text without throwing when params are missing', () => {
    const payload = JSON.stringify({
      type: ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW,
      message: 'The document is too large.',
      errorCode: 'context_overflow',
    });

    expect(() => render(<Error text={payload} />)).not.toThrow();
    expect(screen.getByText(catalog.com_error_files_upload)).toBeInTheDocument();
  });
});
