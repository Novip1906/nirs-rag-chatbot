import type { KnowledgeSpaceItem } from '~/api';
import { splitSpaceOptions, pruneRedundantGrants } from '../spaces';

function space(overrides: Partial<KnowledgeSpaceItem> = {}): KnowledgeSpaceItem {
  return {
    id: 'space-1',
    name: 'Space',
    description: '',
    allowedDepartments: [],
    embeddingModel: 'baai/bge-m3',
    enabled: true,
    documentCount: 0,
    ...overrides,
  };
}

describe('splitSpaceOptions', () => {
  it('offers a department-restricted space for extra access to outsiders', () => {
    const restricted = space({ id: 'restricted', allowedDepartments: ['dept-2'] });

    const options = splitSpaceOptions([restricted], 'dept-1');

    expect(options.additional.map((item) => item.id)).toEqual(['restricted']);
    expect(options.blockable).toEqual([]);
  });

  it('offers that same space for blocking once the department grants it', () => {
    const restricted = space({ id: 'restricted', allowedDepartments: ['dept-1'] });

    const options = splitSpaceOptions([restricted], 'dept-1');

    expect(options.blockable.map((item) => item.id)).toEqual(['restricted']);
    expect(options.additional).toEqual([]);
  });

  /** Пустой список отделов значит «открыто всем» — добавлять такое сверху нечего. */
  it('treats an open space as already granted, never as extra access', () => {
    const options = splitSpaceOptions([space({ id: 'open' })], null);

    expect(options.blockable.map((item) => item.id)).toEqual(['open']);
    expect(options.additional).toEqual([]);
  });

  it('keeps a disabled space out of both lists', () => {
    const options = splitSpaceOptions([space({ id: 'off', enabled: false })], 'dept-1');

    expect(options.additional).toEqual([]);
    expect(options.blockable).toEqual([]);
  });

  it('never puts the same space in both lists', () => {
    const spaces = [
      space({ id: 'open' }),
      space({ id: 'mine', allowedDepartments: ['dept-1'] }),
      space({ id: 'theirs', allowedDepartments: ['dept-2'] }),
    ];

    const options = splitSpaceOptions(spaces, 'dept-1');
    const additional = new Set(options.additional.map((item) => item.id));

    expect(options.blockable.every((item) => !additional.has(item.id))).toBe(true);
    expect(options.additional.map((item) => item.id)).toEqual(['theirs']);
    expect(options.blockable.map((item) => item.id)).toEqual(['open', 'mine']);
  });

  it('treats every restricted space as extra access when there is no department', () => {
    const options = splitSpaceOptions([space({ id: 'x', allowedDepartments: ['dept-1'] })], null);

    expect(options.additional.map((item) => item.id)).toEqual(['x']);
  });
});

describe('pruneRedundantGrants', () => {
  it('drops a grant the new department already covers', () => {
    const spaces = [space({ id: 'shared', allowedDepartments: ['dept-1'] })];

    expect(pruneRedundantGrants(['shared'], spaces, 'dept-1')).toEqual([]);
  });

  it('keeps a grant the department does not cover', () => {
    const spaces = [space({ id: 'shared', allowedDepartments: ['dept-2'] })];

    expect(pruneRedundantGrants(['shared'], spaces, 'dept-1')).toEqual(['shared']);
  });

  it('drops grants for spaces open to everyone', () => {
    expect(pruneRedundantGrants(['open'], [space({ id: 'open' })], null)).toEqual([]);
  });

  it('leaves ids it knows nothing about alone', () => {
    expect(pruneRedundantGrants(['ghost'], [], 'dept-1')).toEqual(['ghost']);
  });
});
