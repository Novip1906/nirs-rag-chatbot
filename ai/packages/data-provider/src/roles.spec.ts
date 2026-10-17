import { Permissions, PermissionTypes, permissionsSchema } from './permissions';
import {
  SystemRoles,
  roleDefaults,
  canAssignRole,
  assignableRoles,
  isAdminLevelRole,
  ADMIN_LEVEL_ROLES,
} from './roles';

const RESOURCE_MANAGEMENT_FIELDS: Permissions[] = [
  Permissions.CREATE,
  Permissions.SHARE,
  Permissions.SHARE_PUBLIC,
];

/**
 * Permission types where CREATE/SHARE/SHARE_PUBLIC must default to false for USER.
 * MEMORIES is excluded: its CREATE/READ/UPDATE apply to the user's own private data.
 * AGENTS/PROMPTS are excluded: CREATE=true is intentional (users own their agents/prompts).
 * Add new types here if they gate shared/multi-user resources.
 */
const RESOURCE_PERMISSION_TYPES: PermissionTypes[] = [
  PermissionTypes.MCP_SERVERS,
  PermissionTypes.REMOTE_AGENTS,
];

describe('roleDefaults', () => {
  describe('USER role', () => {
    const userPerms = roleDefaults[SystemRoles.USER].permissions;

    it('should have explicit values for every field in every multi-field permission type', () => {
      const schemaShape = permissionsSchema.shape;

      for (const [permType, subSchema] of Object.entries(schemaShape)) {
        const fieldNames = Object.keys(subSchema.shape);
        if (fieldNames.length <= 1) {
          continue;
        }

        const userValues = userPerms[permType as PermissionTypes] as Record<string, boolean>;

        for (const field of fieldNames) {
          expect({
            permType,
            field,
            value: userValues[field],
          }).toEqual(
            expect.objectContaining({
              permType,
              field,
              value: expect.any(Boolean),
            }),
          );
        }
      }
    });

    it('should never grant CREATE, SHARE, or SHARE_PUBLIC by default for resource-management types', () => {
      for (const permType of RESOURCE_PERMISSION_TYPES) {
        const permissions = userPerms[permType] as Record<string, boolean>;
        for (const field of RESOURCE_MANAGEMENT_FIELDS) {
          if (permissions[field] === undefined) {
            continue;
          }
          expect({
            permType,
            field,
            value: permissions[field],
          }).toEqual(
            expect.objectContaining({
              permType,
              field,
              value: false,
            }),
          );
        }
      }
    });

    it('should cover every permission type that has CREATE, SHARE, or SHARE_PUBLIC fields', () => {
      const schemaShape = permissionsSchema.shape;
      const restrictedSet = new Set<string>(RESOURCE_PERMISSION_TYPES);

      for (const [permType, subSchema] of Object.entries(schemaShape)) {
        const fieldNames = Object.keys(subSchema.shape);
        const hasResourceFields = fieldNames.some((f) =>
          RESOURCE_MANAGEMENT_FIELDS.includes(f as Permissions),
        );
        if (!hasResourceFields) {
          continue;
        }

        const isTracked =
          restrictedSet.has(permType) ||
          permType === PermissionTypes.MEMORIES ||
          permType === PermissionTypes.PROMPTS ||
          permType === PermissionTypes.AGENTS ||
          permType === PermissionTypes.SKILLS ||
          permType === PermissionTypes.SHARED_LINKS ||
          permType === PermissionTypes.SCHEDULES;

        expect({
          permType,
          tracked: isTracked,
        }).toEqual(
          expect.objectContaining({
            permType,
            tracked: true,
          }),
        );
      }
    });
  });

  describe('ADMIN role', () => {
    const adminPerms = roleDefaults[SystemRoles.ADMIN].permissions;

    it('should have explicit values for every field in every permission type', () => {
      const schemaShape = permissionsSchema.shape;

      for (const [permType, subSchema] of Object.entries(schemaShape)) {
        const fieldNames = Object.keys(subSchema.shape);
        const adminValues = adminPerms[permType as PermissionTypes] as Record<string, boolean>;

        for (const field of fieldNames) {
          expect({
            permType,
            field,
            value: adminValues[field],
          }).toEqual(
            expect.objectContaining({
              permType,
              field,
              value: expect.any(Boolean),
            }),
          );
        }
      }
    });
  });

  describe('SKILLS permission defaults', () => {
    it('grants ADMIN all four skill permissions by default', () => {
      const adminSkills = roleDefaults[SystemRoles.ADMIN].permissions[
        PermissionTypes.SKILLS
      ] as Record<string, boolean>;
      expect(adminSkills).toEqual({
        [Permissions.USE]: true,
        [Permissions.CREATE]: true,
        [Permissions.SHARE]: true,
        [Permissions.SHARE_PUBLIC]: true,
      });
    });

    it('grants USER USE+CREATE but no sharing by default', () => {
      const userSkills = roleDefaults[SystemRoles.USER].permissions[
        PermissionTypes.SKILLS
      ] as Record<string, boolean>;
      expect(userSkills).toEqual({
        [Permissions.USE]: true,
        [Permissions.CREATE]: true,
        [Permissions.SHARE]: false,
        [Permissions.SHARE_PUBLIC]: false,
      });
    });
  });

  describe('MCP_SERVERS.CONFIGURE_OBO defaults', () => {
    it('grants ADMIN CONFIGURE_OBO by default', () => {
      const adminMcp = roleDefaults[SystemRoles.ADMIN].permissions[
        PermissionTypes.MCP_SERVERS
      ] as Record<string, boolean>;
      expect(adminMcp[Permissions.CONFIGURE_OBO]).toBe(true);
    });

    it('does not grant CONFIGURE_OBO to USER by default — gates the OBO config layer', () => {
      const userMcp = roleDefaults[SystemRoles.USER].permissions[
        PermissionTypes.MCP_SERVERS
      ] as Record<string, boolean>;
      expect(userMcp[Permissions.CONFIGURE_OBO]).toBe(false);
    });
  });
});

describe('role privilege helpers', () => {
  describe('isAdminLevelRole', () => {
    it.each([SystemRoles.OWNER, SystemRoles.ADMIN])('treats %s as admin-level', (role) => {
      expect(isAdminLevelRole(role)).toBe(true);
    });

    it.each([SystemRoles.USER, 'editor', '', undefined, null])(
      'treats %s as not admin-level',
      (role) => {
        expect(isAdminLevelRole(role)).toBe(false);
      },
    );

    it('covers exactly the roles listed in ADMIN_LEVEL_ROLES', () => {
      expect([...ADMIN_LEVEL_ROLES]).toEqual([SystemRoles.OWNER, SystemRoles.ADMIN]);
    });
  });

  describe('canAssignRole', () => {
    const matrix: Array<[string, string, boolean]> = [
      [SystemRoles.OWNER, SystemRoles.OWNER, true],
      [SystemRoles.OWNER, SystemRoles.ADMIN, true],
      [SystemRoles.OWNER, SystemRoles.USER, true],
      [SystemRoles.ADMIN, SystemRoles.OWNER, false],
      [SystemRoles.ADMIN, SystemRoles.ADMIN, true],
      [SystemRoles.ADMIN, SystemRoles.USER, true],
      [SystemRoles.USER, SystemRoles.OWNER, false],
      [SystemRoles.USER, SystemRoles.ADMIN, false],
      [SystemRoles.USER, SystemRoles.USER, false],
    ];

    it.each(matrix)('%s assigning %s is %s', (actor, next, expected) => {
      expect(canAssignRole(actor, next)).toBe(expected);
    });

    it('refuses unknown actors and unknown target roles', () => {
      expect(canAssignRole('editor', SystemRoles.USER)).toBe(false);
      expect(canAssignRole(SystemRoles.OWNER, 'editor')).toBe(false);
      expect(canAssignRole(null, SystemRoles.USER)).toBe(false);
      expect(canAssignRole(SystemRoles.OWNER, null)).toBe(false);
    });
  });

  describe('assignableRoles', () => {
    it('lists roles most privileged first for an owner', () => {
      expect(assignableRoles(SystemRoles.OWNER)).toEqual([
        SystemRoles.OWNER,
        SystemRoles.ADMIN,
        SystemRoles.HEAD,
        SystemRoles.USER,
      ]);
    });

    it('never offers ownership to an admin', () => {
      expect(assignableRoles(SystemRoles.ADMIN)).not.toContain(SystemRoles.OWNER);
    });

    it('offers nothing to a plain user or an unknown role', () => {
      expect(assignableRoles(SystemRoles.USER)).toEqual([]);
      expect(assignableRoles('editor')).toEqual([]);
    });
  });
});

describe('OWNER role defaults', () => {
  it('mirrors the ADMIN permission set exactly', () => {
    expect(roleDefaults[SystemRoles.OWNER].permissions).toEqual(
      roleDefaults[SystemRoles.ADMIN].permissions,
    );
  });

  it('is named after itself', () => {
    expect(roleDefaults[SystemRoles.OWNER].name).toBe(SystemRoles.OWNER);
  });
});

describe('роль главы отдела', () => {
  it('не считается админской: иначе она пройдёт все существующие гварды', () => {
    expect(isAdminLevelRole(SystemRoles.HEAD)).toBe(false);
    expect([...ADMIN_LEVEL_ROLES]).toEqual([SystemRoles.OWNER, SystemRoles.ADMIN]);
  });

  it('назначается владельцем и админом, но сама не назначает никого', () => {
    expect(assignableRoles(SystemRoles.OWNER)).toContain(SystemRoles.HEAD);
    expect(assignableRoles(SystemRoles.ADMIN)).toContain(SystemRoles.HEAD);
    expect(assignableRoles(SystemRoles.HEAD)).toEqual([]);
  });

  it('в чате имеет ровно те же права, что и сотрудник', () => {
    expect(roleDefaults[SystemRoles.HEAD].permissions).toEqual(
      roleDefaults[SystemRoles.USER].permissions,
    );
  });
});
