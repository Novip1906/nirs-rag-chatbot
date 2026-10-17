import type { CostSource, RecordUsageInput } from '@librechat/data-schemas';

export interface ProviderUsage {
  cost_usd?: number;
}

export interface BuildUsageInputParams {
  userId: string;
  departmentId: string | null;
  model: string;
  conversationId?: string;
  messageId?: string;
  promptTokens: number;
  completionTokens: number;
  providerUsage: ProviderUsage;
  scenario?: string;
}

export function buildUsageInput(params: BuildUsageInputParams): RecordUsageInput {
  const raw = params.providerUsage.cost_usd;
  const valid = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
  const costSource: CostSource = valid ? 'provider' : 'unknown';

  return {
    userId: params.userId,
    departmentId: params.departmentId,
    model: params.model,
    conversationId: params.conversationId,
    messageId: params.messageId,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    costUsd: valid ? raw : 0,
    costSource,
    scenario: params.scenario,
  };
}
