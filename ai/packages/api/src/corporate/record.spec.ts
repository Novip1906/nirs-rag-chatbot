import { buildUsageInput } from './record';

describe('buildUsageInput', () => {
  it('берёт стоимость из ответа провайдера', () => {
    const input = buildUsageInput({
      userId: 'user-1',
      departmentId: 'dep-1',
      model: 'google/gemini-3.5-flash-lite',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      promptTokens: 4,
      completionTokens: 2,
      providerUsage: { cost_usd: 0.00072196 },
    });

    expect(input.costUsd).toBeCloseTo(0.00072196);
    expect(input.costSource).toBe('provider');
    expect(input.model).toBe('google/gemini-3.5-flash-lite');
  });

  it('помечает расход как unknown, когда провайдер не вернул стоимость', () => {
    const input = buildUsageInput({
      userId: 'user-1',
      departmentId: null,
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 10,
      completionTokens: 5,
      providerUsage: {},
    });

    expect(input.costUsd).toBe(0);
    expect(input.costSource).toBe('unknown');
  });

  it('не принимает отрицательную стоимость', () => {
    const input = buildUsageInput({
      userId: 'user-1',
      departmentId: null,
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 1,
      completionTokens: 1,
      providerUsage: { cost_usd: -5 },
    });

    expect(input.costUsd).toBe(0);
    expect(input.costSource).toBe('unknown');
  });

  it('прокидывает scenario в результат', () => {
    const input = buildUsageInput({
      userId: 'user-1',
      departmentId: null,
      model: 'google/gemini-3.5-flash-lite',
      promptTokens: 1,
      completionTokens: 1,
      providerUsage: { cost_usd: 0.1 },
      scenario: 'title',
    });

    expect(input.scenario).toBe('title');
  });

  it('не принимает нечисловую стоимость (NaN)', () => {
    const input = buildUsageInput({
      userId: 'user-1',
      departmentId: null,
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 1,
      completionTokens: 1,
      providerUsage: { cost_usd: Number('не число') },
    });

    expect(input.costUsd).toBe(0);
    expect(input.costSource).toBe('unknown');
  });
});
