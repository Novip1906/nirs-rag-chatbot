import { logger } from '@librechat/data-schemas';
import type { RecordUsageInput } from '@librechat/data-schemas';
import type { CheapCompletionResult } from './cheapCompletion';
import type { CorporatePolicyMethods } from '~/corporate/deps';
import { getSafeErrorMetadata } from '~/utils/errors';
import { resolveDepartmentId } from '~/corporate/deps';
import { buildUsageInput } from '~/corporate/record';

export const CHAT_RECAP_SCENARIO = 'chat_recap' as const;

export const MEMORY_COMPACT_SCENARIO = 'memory_compact' as const;

export interface ServiceUsageDeps extends CorporatePolicyMethods {
  recordUsage: (input: RecordUsageInput) => Promise<void>;
}

export async function recordServiceUsage(
  deps: ServiceUsageDeps,
  p: {
    userId: string;
    result: CheapCompletionResult;
    scenario: string;
    conversationId?: string;
    messageId?: string;
  },
): Promise<void> {
  try {
    const departmentId = await resolveDepartmentId(deps, p.userId);
    await deps.recordUsage(
      buildUsageInput({
        userId: p.userId,
        departmentId,
        model: p.result.model,
        conversationId: p.conversationId,
        messageId: p.messageId,
        promptTokens: p.result.promptTokens,
        completionTokens: p.result.completionTokens,
        providerUsage: { cost_usd: p.result.costUsd ?? undefined },
        scenario: p.scenario,
      }),
    );
  } catch (error) {
    logger.error(
      `[recordServiceUsage] Failed to record ${p.scenario} usage`,
      getSafeErrorMetadata(error),
    );
  }
}
