import type { RecentRecap } from './recentRecaps';
import { formatRecentRecapsBlock, loadRecentRecapsBlock } from './recentRecaps';

const now = new Date('2026-09-24T22:30:00Z');

const recaps: RecentRecap[] = [
  {
    conversationId: 'c2',
    title: 'Тариф  для\n«Ромашки»',
    updatedAt: new Date('2026-09-24T20:00:00Z'),
    chatProjectId: null,
    recap: {
      text: 'Посчитали тариф 1,8%\nдля ООО «Ромашка».',
      at: new Date('2026-09-23T21:30:00Z'),
    },
  },
  {
    conversationId: 'c1',
    updatedAt: new Date('2026-09-22T09:00:00Z'),
    chatProjectId: 'p1',
    recap: { text: 'Разобрали договор с банком.', at: new Date('2026-09-20T09:00:00Z') },
  },
];

describe('formatRecentRecapsBlock', () => {
  it('ставит сегодняшнюю дату в поясе сотрудника и строки бесед с датой конспекта', () => {
    const block = formatRecentRecapsBlock({ recaps, now, timezone: 'Asia/Yekaterinburg' });

    expect(block.split('\n')).toEqual([
      '# Today: пятница, 25 сентября 2026 г.',
      '',
      expect.stringMatching(
        /^# Recent conversations with the user .*only the last few.*may still have been discussed.*relevant.*not facts the user asked to keep.*do not save them to memory unless the user explicitly asks/i,
      ),
      '- 24.09 «Тариф для «Ромашки»» — Посчитали тариф 1,8% для ООО «Ромашка».',
      '- 20.09 — Разобрали договор с банком.',
    ]);
  });

  it('без пояса и при неверном поясе берёт Москву', () => {
    const fallback = formatRecentRecapsBlock({ recaps: [], now });
    const broken = formatRecentRecapsBlock({ recaps: [], now, timezone: 'Not/AZone' });

    expect(fallback).toBe('# Today: пятница, 25 сентября 2026 г.');
    expect(broken).toBe(fallback);
  });

  it('без конспектов отдаёт только дату', () => {
    const block = formatRecentRecapsBlock({ recaps: [], now, timezone: 'Europe/London' });

    expect(block).toBe('# Today: четверг, 24 сентября 2026 г.');
  });
});

describe('loadRecentRecapsBlock', () => {
  it('читает последние восемь конспектов раздела без текущей беседы', async () => {
    const getRecentConversationRecaps = jest.fn().mockResolvedValue(recaps);

    const block = await loadRecentRecapsBlock(
      { getRecentConversationRecaps },
      { user: 'user-1', chatProjectId: 'p1', excludeConversationId: 'c3', now },
    );

    expect(getRecentConversationRecaps).toHaveBeenCalledWith({
      user: 'user-1',
      chatProjectId: 'p1',
      excludeConversationId: 'c3',
      limit: 8,
    });
    expect(block).toContain('«Тариф для «Ромашки»»');
  });

  it('в общем чате запрашивает беседы вне проектов', async () => {
    const getRecentConversationRecaps = jest.fn().mockResolvedValue([]);

    await loadRecentRecapsBlock({ getRecentConversationRecaps }, { user: 'user-1' });

    expect(getRecentConversationRecaps).toHaveBeenCalledWith(
      expect.objectContaining({ chatProjectId: null }),
    );
  });

  it('не бросает при сбое чтения', async () => {
    const getRecentConversationRecaps = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(
      loadRecentRecapsBlock({ getRecentConversationRecaps }, { user: 'user-1' }),
    ).resolves.toBeUndefined();
  });
});
