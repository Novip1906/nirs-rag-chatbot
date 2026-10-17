import type { RecordUsageInput } from '@librechat/data-schemas';
import type { CorporatePolicyMethods } from '~/corporate/deps';
import type { TranscribeSpeechResult } from './transcribe';
import { resolveDepartmentId } from '~/corporate/deps';
import { buildUsageInput } from '~/corporate/record';

export const SPEECH_SCENARIO: 'stt' = 'stt';

export interface SpeechUsageDeps extends CorporatePolicyMethods {
  recordUsage: (input: RecordUsageInput) => Promise<void>;
}

export async function recordSpeechUsage(
  deps: SpeechUsageDeps,
  userId: string,
  result: TranscribeSpeechResult,
): Promise<void> {
  const departmentId = await resolveDepartmentId(deps, userId);
  await deps.recordUsage(
    buildUsageInput({
      userId,
      departmentId,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      providerUsage: { cost_usd: result.costUsd ?? undefined },
      scenario: SPEECH_SCENARIO,
    }),
  );
}
