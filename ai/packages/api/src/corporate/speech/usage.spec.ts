import { Types } from 'mongoose';
import type { RecordUsageInput } from '@librechat/data-schemas';
import type { TranscribeSpeechResult } from './transcribe';
import type { SpeechUsageDeps } from './usage';
import { recordSpeechUsage, SPEECH_SCENARIO } from './usage';

const departmentId = new Types.ObjectId();
const userId = new Types.ObjectId().toString();
const NO_LIMITS = { dailyCostUsd: null };

const result: TranscribeSpeechResult = {
  text: 'Привет',
  costUsd: 0.000123,
  model: 'google/gemini-3.7-flash',
  promptTokens: 160,
  completionTokens: 12,
};

function createDeps(userPolicy: 'department' | 'none') {
  const recordUsage = jest.fn(async (_input: RecordUsageInput): Promise<void> => undefined);
  const deps: SpeechUsageDeps = {
    getGlobalSettings: async () => ({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    getUserPolicy: async () =>
      userPolicy === 'none'
        ? null
        : { departmentId, limits: null, allowedModels: null, defaultModel: null, blocked: false },
    getDepartmentById: async () => ({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    recordUsage,
  };
  return { deps, recordUsage };
}

describe('recordSpeechUsage', () => {
  it('пишет расход диктовки на сотрудника и его отдел со сценарием stt', async () => {
    const { deps, recordUsage } = createDeps('department');

    await recordSpeechUsage(deps, userId, result);

    expect(SPEECH_SCENARIO).toBe('stt');
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith({
      userId,
      departmentId: departmentId.toString(),
      model: 'google/gemini-3.7-flash',
      promptTokens: 160,
      completionTokens: 12,
      costUsd: 0.000123,
      costSource: 'provider',
      scenario: 'stt',
    });
  });

  it('помечает стоимость неизвестной, когда провайдер её не прислал', async () => {
    const { deps, recordUsage } = createDeps('department');

    await recordSpeechUsage(deps, userId, { ...result, costUsd: null });

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0, costSource: 'unknown', scenario: 'stt' }),
    );
  });

  it('пишет расход без отдела, когда у сотрудника нет своей политики', async () => {
    const { deps, recordUsage } = createDeps('none');

    await recordSpeechUsage(deps, userId, result);

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId, departmentId: null, scenario: 'stt' }),
    );
  });
});
