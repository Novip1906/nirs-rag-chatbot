import type { CheapCompletionResult } from './cheapCompletion';
import { recordServiceUsage, CHAT_RECAP_SCENARIO, MEMORY_COMPACT_SCENARIO } from './serviceUsage';
import { usageDeps, departmentId } from './__tests__/helpers/fixtures';

const result: CheapCompletionResult = {
  text: 'Конспект',
  model: 'openai/gpt-5.6-luna',
  promptTokens: 300,
  completionTokens: 40,
  costUsd: 0.0002,
  truncated: false,
};

describe('recordServiceUsage', () => {
  it('пишет служебный расход на сотрудника и отдел с беседой и сообщением', async () => {
    const deps = usageDeps();

    await recordServiceUsage(deps, {
      userId: 'user-1',
      result,
      scenario: CHAT_RECAP_SCENARIO,
      conversationId: 'convo-1',
      messageId: 'msg-1',
    });

    expect(CHAT_RECAP_SCENARIO).toBe('chat_recap');
    expect(MEMORY_COMPACT_SCENARIO).toBe('memory_compact');
    expect(deps.recordUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      departmentId: departmentId.toString(),
      model: 'openai/gpt-5.6-luna',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      promptTokens: 300,
      completionTokens: 40,
      costUsd: 0.0002,
      costSource: 'provider',
      scenario: 'chat_recap',
    });
  });

  it('помечает стоимость неизвестной, когда провайдер её не прислал', async () => {
    const deps = usageDeps();

    await recordServiceUsage(deps, {
      userId: 'user-1',
      result: { ...result, costUsd: null },
      scenario: MEMORY_COMPACT_SCENARIO,
    });

    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0, costSource: 'unknown', scenario: 'memory_compact' }),
    );
  });

  it('не бросает, если запись расхода упала', async () => {
    const deps = usageDeps();
    deps.recordUsage.mockRejectedValueOnce(new Error('db down'));

    await expect(
      recordServiceUsage(deps, { userId: 'user-1', result, scenario: CHAT_RECAP_SCENARIO }),
    ).resolves.toBeUndefined();
  });
});
