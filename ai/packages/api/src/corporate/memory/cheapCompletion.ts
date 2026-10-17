import { AuthType, Constants, extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Dispatcher } from 'undici';
import type { DlpAuditDeps } from '~/dlp';
import { createDlpFetch, createDlpAudit, resolveDlpConfig, warnDlpAuditMissing } from '~/dlp';
import { getActiveProvider } from '~/corporate/provider';
import { extractCostUsd } from '~/agents/costCapture';
import { getCustomEndpointConfig } from '~/app/config';
import { getEnvProxyDispatcher } from '~/utils/proxy';
import { resolveConfigSecret } from '~/admin/secrets';

export interface CheapCompletionInput {
  appConfig: AppConfig;
  userId: string;
  userName?: string;
  conversationId?: string;
  system: string;
  prompt: string;
  maxTokens: number;
  json?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  recordAuditEntry?: DlpAuditDeps['recordAuditEntry'];
  fetchImpl?: typeof fetch;
}

export interface CheapCompletionResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  truncated: boolean;
}

interface CheapCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  cost_rub?: number;
}

interface CheapCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: CheapCompletionUsage;
}

interface CheapCompletionTarget {
  model: string;
  url: string;
  apiKey: string;
}

function resolveTarget(appConfig: AppConfig, endpointName: string): CheapCompletionTarget | null {
  const endpointConfig = getCustomEndpointConfig({ endpoint: endpointName, appConfig });
  const model = endpointConfig?.titleModel;
  if (!model || model === Constants.CURRENT_MODEL) {
    return null;
  }
  const baseURL = extractEnvVariable(endpointConfig?.baseURL ?? '').replace(/\/+$/, '');
  const apiKey = resolveConfigSecret(endpointConfig?.apiKey);
  if (
    !baseURL ||
    !apiKey ||
    baseURL === AuthType.USER_PROVIDED ||
    apiKey === AuthType.USER_PROVIDED
  ) {
    return null;
  }
  return { model, url: `${baseURL}/chat/completions`, apiKey };
}

function buildSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal != null ? AbortSignal.any([signal, timeout]) : timeout;
}

function selectFetch(input: CheapCompletionInput): typeof fetch {
  const baseFetch = input.fetchImpl ?? fetch;
  const dlpConfig = resolveDlpConfig(input.appConfig.config?.dlp);
  warnDlpAuditMissing(input.recordAuditEntry != null, dlpConfig != null);
  if (!dlpConfig?.enabled || input.recordAuditEntry == null) {
    return baseFetch;
  }
  return createDlpFetch(
    {
      config: dlpConfig,
      userId: input.userId,
      userName: input.userName ?? '',
      conversationId: input.conversationId,
      audit: createDlpAudit({ recordAuditEntry: input.recordAuditEntry }),
    },
    baseFetch,
  );
}

export async function completeCheap(
  input: CheapCompletionInput,
): Promise<CheapCompletionResult | null> {
  const provider = getActiveProvider();
  const target = resolveTarget(input.appConfig, provider.endpointName);
  if (target == null) {
    return null;
  }

  const isOpenRouter = provider.id === 'openrouter';
  const body = {
    model: target.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.prompt },
    ],
    max_tokens: input.maxTokens,
    ...(isOpenRouter
      ? { reasoning: { effort: 'low', exclude: true }, usage: { include: true } }
      : {}),
    ...(input.json ? { response_format: { type: 'json_object' } } : {}),
    ...(input.json && isOpenRouter ? { provider: { require_parameters: true } } : {}),
  };

  const init: RequestInit & { dispatcher?: Dispatcher } = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    dispatcher: getEnvProxyDispatcher(),
    signal: buildSignal(input.timeoutMs, input.signal),
  };

  const response = await selectFetch(input)(target.url, init);
  if (!response.ok) {
    throw new Error(`Cheap completion failed: provider answered ${response.status}`);
  }

  const data = (await response.json()) as CheapCompletionResponse;
  const choice = data?.choices?.[0];
  const truncated = choice?.finish_reason === 'length';
  const content = choice?.message?.content;
  const text = !truncated && typeof content === 'string' ? content.trim() : '';

  return {
    text,
    model: target.model,
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
    costUsd: extractCostUsd(data?.usage, provider) ?? null,
    truncated,
  };
}
