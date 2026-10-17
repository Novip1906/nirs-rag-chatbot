import { collectPayloadTexts } from './payload';

describe('collectPayloadTexts', () => {
  it('находит строковое содержимое сообщения', () => {
    const payload = { messages: [{ role: 'user', content: 'привет' }] };
    expect(collectPayloadTexts(payload).map((f) => f.get())).toEqual(['привет']);
  });

  it('пишет значение обратно', () => {
    const payload = { messages: [{ role: 'user', content: 'привет' }] };
    collectPayloadTexts(payload)[0].set('пока');
    expect(payload.messages[0].content).toBe('пока');
  });

  it('находит текстовые части массива содержимого', () => {
    const payload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'первый' },
            { type: 'image_url', image_url: { url: 'https://x/y.png' } },
            { type: 'text', text: 'второй' },
          ],
        },
      ],
    };
    expect(collectPayloadTexts(payload).map((f) => f.get())).toEqual(['первый', 'второй']);
  });

  it('находит аргументы вызова инструмента', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          tool_calls: [{ function: { name: 'search', arguments: '{"q":"карта"}' } }],
        },
      ],
    };
    expect(collectPayloadTexts(payload).map((f) => f.get())).toEqual(['{"q":"карта"}']);
  });

  it('находит содержимое сообщения с ролью tool', () => {
    const payload = {
      messages: [{ role: 'tool', tool_call_id: 'a', content: 'выборка транзакций' }],
    };
    expect(collectPayloadTexts(payload).map((f) => f.get())).toEqual(['выборка транзакций']);
  });

  it('находит системную инструкцию верхнего уровня', () => {
    const payload = { instructions: 'ты помощник', messages: [] };
    expect(collectPayloadTexts(payload).map((f) => f.get())).toEqual(['ты помощник']);
  });

  it('возвращает пустой список для неожиданной формы', () => {
    expect(collectPayloadTexts(null)).toEqual([]);
    expect(collectPayloadTexts({ messages: 'нет' })).toEqual([]);
  });
});
