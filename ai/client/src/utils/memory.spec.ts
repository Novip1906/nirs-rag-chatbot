import type { MemoriesResponse, TUserMemory, MemoryArtifact } from 'librechat-data-provider';
import {
  getMemoryApiErrorMessage,
  getMemoryDisplayTitle,
  getRequiredFieldError,
  handleMemoryArtifact,
  searchMemories,
} from './memory';

describe('getRequiredFieldError', () => {
  it('flags a blank value as required', () => {
    expect(getRequiredFieldError('   ')).toBe('com_ui_field_required');
  });

  it('accepts a non-blank value', () => {
    expect(getRequiredFieldError('Favorite color')).toBeNull();
  });
});

describe('getMemoryDisplayTitle', () => {
  it('prefers the saved title over the value', () => {
    expect(getMemoryDisplayTitle({ title: 'Favorite color', value: 'The user likes blue' })).toBe(
      'Favorite color',
    );
  });

  it('falls back to the first line of the value for an old record without a title', () => {
    expect(getMemoryDisplayTitle({ value: 'First line\nSecond line' })).toBe('First line');
  });

  it('shortens a long fallback to 60 characters with an ellipsis', () => {
    const value = 'A'.repeat(80);
    expect(getMemoryDisplayTitle({ value })).toBe(`${'A'.repeat(60)}…`);
  });

  it('returns an empty string for an empty record', () => {
    expect(getMemoryDisplayTitle({ value: '' })).toBe('');
  });
});

describe('handleMemoryArtifact title handling', () => {
  const baseCurrentData: MemoriesResponse = {
    memories: [],
    totalTokens: 0,
    tokenLimit: null,
    usagePercentage: null,
  };

  it('saves the title carried by an update artifact', () => {
    const memoryArtifact: MemoryArtifact = {
      type: 'update',
      key: 'favorite_color',
      value: 'The user likes blue',
      title: 'Favorite color',
      tokenCount: 5,
    };

    const result = handleMemoryArtifact({ memoryArtifact, currentData: baseCurrentData });

    expect(result?.memories[0].title).toBe('Favorite color');
  });

  it('keeps the previous title when the update artifact carries none', () => {
    const existingMemory: TUserMemory = {
      key: 'favorite_color',
      value: 'The user likes blue',
      title: 'Favorite color',
      updated_at: '2026-01-01T00:00:00.000Z',
      tokenCount: 5,
    };
    const currentData: MemoriesResponse = { ...baseCurrentData, memories: [existingMemory] };
    const memoryArtifact: MemoryArtifact = {
      type: 'update',
      key: 'favorite_color',
      value: 'The user likes navy blue now',
      tokenCount: 6,
    };

    const result = handleMemoryArtifact({ memoryArtifact, currentData });

    expect(result?.memories[0].title).toBe('Favorite color');
  });
});

describe('getMemoryApiErrorMessage', () => {
  it('preserves an actionable server error', () => {
    const error = Object.assign(new Error('Request failed'), {
      response: { data: { error: 'Value exceeds the configured character limit.' } },
    });

    expect(getMemoryApiErrorMessage(error, 'Error')).toBe(
      'Value exceeds the configured character limit.',
    );
  });

  it('falls back when the server does not provide an error', () => {
    expect(getMemoryApiErrorMessage(new Error('Request failed'), 'Error')).toBe('Error');
  });
});

describe('searchMemories', () => {
  const memory = (key: string, title: string, value: string, updatedAt: string) =>
    ({ key, title, value, tokenCount: 1, updated_at: updatedAt }) as TUserMemory;
  const memories = [
    memory(
      'contracts',
      'Договоры с партнёрами',
      'Юрист отдела партнёрств',
      '2026-09-25T10:00:00.000Z',
    ),
    memory('alpha_lawyer', 'Юрист Альфы', 'Смирнов Андрей', '2026-09-25T11:00:00.000Z'),
    memory(
      'big_mac',
      'Любовь к Биг Маку',
      'Пользователь любит Биг Мак',
      '2026-09-27T09:00:00.000Z',
    ),
    memory('beta_lawyer', 'Юрист Беты', 'Волков Сергей', '2026-09-26T12:00:00.000Z'),
  ];

  it('lists newest first, including memories appended to the cache at the end', () => {
    expect(searchMemories(memories, '').map((m) => m.key)).toEqual([
      'big_mac',
      'beta_lawyer',
      'alpha_lawyer',
      'contracts',
    ]);
    expect(searchMemories(memories, '   ').map((m) => m.key)).toEqual([
      'big_mac',
      'beta_lawyer',
      'alpha_lawyer',
      'contracts',
    ]);
  });

  it('breaks ties between equal matches by recency, not alphabetically', () => {
    expect(
      searchMemories(memories, 'юрист')
        .slice(0, 2)
        .map((m) => m.key),
    ).toEqual(['beta_lawyer', 'alpha_lawyer']);
  });

  it('ignores surrounding spaces in the query', () => {
    expect(searchMemories(memories, 'биг мак ').map((m) => m.key)).toEqual(['big_mac']);
  });
});
