import { SystemRoles } from 'librechat-data-provider';
import type { KnowledgeAccessDeps, KnowledgeSpaceSource } from './access';

import { resolveAllowedSpaces, resolveWritableSpaces } from './access';

const spaces: KnowledgeSpaceSource[] = [
  { id: 'общее', name: 'Административное', allowedDepartments: [], enabled: true },
  { id: 'продукт', name: 'Продуктовое', allowedDepartments: ['dep-product'], enabled: true },
  { id: 'юр', name: 'Юридическое', allowedDepartments: ['dep-legal'], enabled: true },
  { id: 'выкл', name: 'Выключенное', allowedDepartments: [], enabled: false },
];

function makeDeps(overrides: Partial<KnowledgeAccessDeps> = {}): KnowledgeAccessDeps {
  return {
    resolvePolicy: async () => ({ departmentId: 'dep-product', blocked: false }),
    listSpaces: async () => spaces,
    getSpaceOverrides: async () => ({ allowedSpaces: [], deniedSpaces: [] }),
    ...overrides,
  };
}

describe('resolveAllowedSpaces', () => {
  it('пустой список отделов у пространства означает «доступно всем»', async () => {
    const result = await resolveAllowedSpaces(makeDeps(), 'u1');
    expect(result.map((s) => s.id)).toEqual(['общее', 'продукт']);
  });

  it('выключенное пространство не выдаётся никому', async () => {
    const result = await resolveAllowedSpaces(makeDeps(), 'u1');
    expect(result.map((s) => s.id)).not.toContain('выкл');
  });

  it('персональное разрешение добавляет пространство сверх отдела', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({ getSpaceOverrides: async () => ({ allowedSpaces: ['юр'], deniedSpaces: [] }) }),
      'u1',
    );
    expect(result.map((s) => s.id)).toEqual(['общее', 'продукт', 'юр']);
  });

  it('персональное разрешение не воскрешает выключенное пространство', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({ getSpaceOverrides: async () => ({ allowedSpaces: ['выкл'], deniedSpaces: [] }) }),
      'u1',
    );
    expect(result.map((s) => s.id)).not.toContain('выкл');
  });

  it('запрет сильнее разрешения по отделу и персонального разрешения', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({
        getSpaceOverrides: async () => ({
          allowedSpaces: ['юр'],
          deniedSpaces: ['юр', 'продукт'],
        }),
      }),
      'u1',
    );
    expect(result.map((s) => s.id)).toEqual(['общее']);
  });

  it('заблокированный сотрудник не видит ничего', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({ resolvePolicy: async () => ({ departmentId: 'dep-product', blocked: true }) }),
      'u1',
    );
    expect(result).toEqual([]);
  });

  it('сотрудник без отдела видит только общедоступные', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({ resolvePolicy: async () => ({ departmentId: null, blocked: false }) }),
      'u1',
    );
    expect(result.map((s) => s.id)).toEqual(['общее']);
  });

  it('админ без отдела читает пространства чужих отделов — симметрично праву записи', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({
        resolvePolicy: async () => ({ departmentId: null, blocked: false, role: SystemRoles.ADMIN }),
      }),
      'u1',
    );
    expect(result.map((s) => s.id)).toEqual(['общее', 'продукт', 'юр']);
  });

  it('персональный запрет сильнее админ-уровневой роли и на чтение', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({
        resolvePolicy: async () => ({ departmentId: null, blocked: false, role: SystemRoles.ADMIN }),
        getSpaceOverrides: async () => ({ allowedSpaces: [], deniedSpaces: ['юр'] }),
      }),
      'u1',
    );
    expect(result.map((s) => s.id)).not.toContain('юр');
  });

  it('выключенное пространство не читает и админ', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({
        resolvePolicy: async () => ({ departmentId: null, blocked: false, role: SystemRoles.OWNER }),
      }),
      'u1',
    );
    expect(result.map((s) => s.id)).not.toContain('выкл');
  });

  it('глава отдела читает только своё и общее — админ-правило на него не распространяется', async () => {
    const result = await resolveAllowedSpaces(
      makeDeps({
        resolvePolicy: async () => ({
          departmentId: 'dep-product',
          blocked: false,
          role: SystemRoles.HEAD,
        }),
      }),
      'u1',
    );
    expect(result.map((s) => s.id)).toEqual(['общее', 'продукт']);
  });
});

describe('resolveWritableSpaces', () => {
  const sales = {
    id: 'space-sales',
    name: 'Продажи',
    allowedDepartments: ['dep-sales'],
    enabled: true,
  };
  const everyone = { id: 'space-all', name: 'Общее', allowedDepartments: [], enabled: true };

  const deps = (
    policy: Partial<Parameters<typeof buildPolicy>[0]> = {},
    spaces = [sales, everyone],
  ) => ({
    resolveWritePolicy: jest.fn().mockResolvedValue(buildPolicy(policy)),
    listSpaces: jest.fn().mockResolvedValue(spaces),
    getSpaceOverrides: jest.fn().mockResolvedValue({ allowedSpaces: [], deniedSpaces: [] }),
  });

  function buildPolicy(overrides: {
    departmentId?: string | null;
    blocked?: boolean;
    role?: string;
    canUploadKnowledge?: boolean;
  }) {
    return {
      departmentId: 'dep-sales',
      blocked: false,
      role: 'USER',
      canUploadKnowledge: false,
      ...overrides,
    };
  }

  it('без галочки не даёт ничего', async () => {
    expect(await resolveWritableSpaces(deps(), 'u1')).toEqual([]);
  });

  it('с галочкой открывает пространство своего отдела', async () => {
    const result = await resolveWritableSpaces(deps({ canUploadKnowledge: true }), 'u1');
    expect(result.map((s) => s.id)).toEqual(['space-sales']);
  });

  it('никогда не открывает пространство «для всех»: пустой список отделов означает доступ всем на чтение, но не на запись', async () => {
    const result = await resolveWritableSpaces(deps({ canUploadKnowledge: true }), 'u1');
    expect(result.map((s) => s.id)).not.toContain('space-all');
  });

  it('главе отдела галочка не нужна', async () => {
    const result = await resolveWritableSpaces(deps({ role: 'HEAD' }), 'u1');
    expect(result.map((s) => s.id)).toEqual(['space-sales']);
  });

  it('главе чужого отдела не даёт ничего', async () => {
    const result = await resolveWritableSpaces(
      deps({ role: 'HEAD', departmentId: 'dep-hr' }),
      'u1',
    );
    expect(result).toEqual([]);
  });

  it('без отдела не даёт ничего даже с галочкой', async () => {
    const result = await resolveWritableSpaces(
      deps({ canUploadKnowledge: true, departmentId: null }),
      'u1',
    );
    expect(result).toEqual([]);
  });

  it('заблокированному не даёт ничего', async () => {
    const result = await resolveWritableSpaces(
      deps({ canUploadKnowledge: true, blocked: true }),
      'u1',
    );
    expect(result).toEqual([]);
  });

  it('выключенное пространство не отдаёт даже админу', async () => {
    const disabled = { ...sales, enabled: false };
    const result = await resolveWritableSpaces(deps({ role: 'ADMIN' }, [disabled]), 'u1');
    expect(result).toEqual([]);
  });

  it('персонально запрещённое пространство не отдаёт', async () => {
    const d = deps({ canUploadKnowledge: true });
    d.getSpaceOverrides = jest
      .fn()
      .mockResolvedValue({ allowedSpaces: [], deniedSpaces: ['space-sales'] });
    expect(await resolveWritableSpaces(d, 'u1')).toEqual([]);
  });

  it('персональный запрет действует и на админ-уровневую роль', async () => {
    const d = deps({ role: 'ADMIN' });
    d.getSpaceOverrides = jest
      .fn()
      .mockResolvedValue({ allowedSpaces: [], deniedSpaces: ['space-sales'] });
    const result = await resolveWritableSpaces(d, 'u1');
    expect(result.map((s) => s.id)).toEqual(['space-all']);
  });

  it('персональный доступ к чужому пространству права записи не даёт', async () => {
    const hrSpace = {
      id: 'space-hr',
      name: 'Кадры',
      allowedDepartments: ['dep-hr'],
      enabled: true,
    };
    const d = deps({ canUploadKnowledge: true }, [hrSpace]);
    d.getSpaceOverrides = jest
      .fn()
      .mockResolvedValue({ allowedSpaces: ['space-hr'], deniedSpaces: [] });
    expect(await resolveWritableSpaces(d, 'u1')).toEqual([]);
  });
});
