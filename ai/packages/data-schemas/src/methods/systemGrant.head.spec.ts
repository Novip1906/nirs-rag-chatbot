import { SystemCapabilities, HEAD_CAPABILITIES } from '~/admin/capabilities';

describe('набор capability главы отдела', () => {
  it('даёт вход в админку и чтение по своему отделу', () => {
    expect(HEAD_CAPABILITIES).toEqual(
      expect.arrayContaining([
        SystemCapabilities.ACCESS_ADMIN,
        SystemCapabilities.READ_USERS,
        SystemCapabilities.READ_USAGE,
        SystemCapabilities.MANAGE_KNOWLEDGE_DOCUMENTS,
        SystemCapabilities.MANAGE_DEPARTMENT_MEMBERS,
        SystemCapabilities.MANAGE_LIMIT_REQUESTS,
      ]),
    );
  });

  /**
   * `getActivity` не умеет фильтровать по отделу (общекорпоративная агрегация в
   * data-schemas) и потому закрыт для главы целиком на уровне обработчика — но
   * админка строит меню по набору capability, и оставленный READ_INSIGHTS отрисовал
   * бы пункт меню, ведущий в гарантированный отказ.
   */
  it('не даёт READ_INSIGHTS: раздел активности главе не открыт', () => {
    expect(HEAD_CAPABILITIES).not.toContain(SystemCapabilities.READ_INSIGHTS);
  });

  it('не даёт ничего, что меняет систему за пределами отдела', () => {
    const forbidden = [
      SystemCapabilities.MANAGE_USERS,
      SystemCapabilities.MANAGE_ROLES,
      SystemCapabilities.MANAGE_CONFIGS,
      SystemCapabilities.MANAGE_GROUPS,
      SystemCapabilities.READ_AUDIT_LOG,
    ];
    for (const capability of forbidden) {
      expect(HEAD_CAPABILITIES).not.toContain(capability);
    }
  });

  it('состоит только из существующих capability', () => {
    const known = new Set<string>(Object.values(SystemCapabilities));
    for (const capability of HEAD_CAPABILITIES) {
      expect(known.has(capability)).toBe(true);
    }
  });
});
