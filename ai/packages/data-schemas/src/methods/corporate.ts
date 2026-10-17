import type { Model, FilterQuery, PipelineStage } from 'mongoose';
import type { IUser } from '~/types/user';
import type { ICorporateSettings, IDepartment, IUserPolicy, PartialLimits, ILimits } from '~/types';
import { limitsDefaults } from '~/schema/department';
import { escapeRegExp } from '~/utils/string';
import logger from '~/config/winston';

/** Sentinel for "no department", distinct from an absent filter. */
export const NO_DEPARTMENT_FILTER = 'none';

export type AdminUserListUser = Pick<
  IUser,
  '_id' | 'name' | 'email' | 'role' | 'employeeId' | 'openidId' | 'position'
>;

export interface AdminUserPageQuery {
  search?: string;
  role?: string;
  departmentId?: string;
  blocked?: boolean;
  limit: number;
  offset: number;
}

export interface AdminUserPageRow {
  user: AdminUserListUser;
  policy: IUserPolicy | null;
}

export interface AdminUserPage {
  rows: AdminUserPageRow[];
  total: number;
}

export interface CreateDepartmentInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  allowedModels?: string[];
  defaultModel?: string | null;
  defaultLimits?: PartialLimits;
  directoryId?: string;
}

export interface UpsertUserPolicyInput {
  departmentId?: string | null;
  limits?: PartialLimits | null;
  allowedModels?: string[] | null;
  defaultModel?: string | null;
  blocked?: boolean;
  allowedSpaces?: string[];
  deniedSpaces?: string[];
  canUploadKnowledge?: boolean;
}

/**
 * `Partial<ICorporateSettings>`/`Partial<IDepartment>` типизируют `defaultLimits` как
 * полный `ILimits`, потому что в самих интерфейсах это обязательная под-схема, а не
 * `PartialLimits`. Здесь тип поля сужен до `PartialLimits`, чтобы вызывающий код мог
 * реально передать частичный набор лимитов, а не только либо ничего, либо все четыре.
 */
export type UpdateGlobalSettingsInput = Omit<Partial<ICorporateSettings>, 'defaultLimits'> & {
  defaultLimits?: PartialLimits;
};

export type UpdateDepartmentInput = Omit<Partial<IDepartment>, 'defaultLimits'> & {
  defaultLimits?: PartialLimits;
};

/**
 * `defaultLimits`/`limits` — вложенные под-схемы. `$set` на путь целого субдокумента
 * заменяет его целиком, доливая незатронутые поля дефолтами схемы (`null`), а не
 * сохраняя ранее записанные значения. Разворачивает частичный объект лимитов в
 * плоские dot-path ключи (`defaultLimits.dailyCostUsd`), чтобы `$set` трогал только
 * перечисленные поля субдокумента.
 */
function flattenLimits(prefix: string, limits: PartialLimits): Record<string, number | null> {
  const flattened: Record<string, number | null> = {};
  for (const key of Object.keys(limits) as Array<keyof ILimits>) {
    const value = limits[key];
    if (value !== undefined) {
      flattened[`${prefix}.${key}`] = value;
    }
  }
  return flattened;
}

/**
 * `limits` defaults to `null` on the schema (not an empty-limits object), so a plain
 * `$set: {'limits.dailyCostUsd': N}` fails with "Cannot create field 'dailyCostUsd' in
 * element {limits: null}" the first time anyone sets a limit on a policy that never had
 * one. An aggregation-pipeline update sidesteps that: `$mergeObjects` treats a missing/
 * null `limits` as the schema's empty-limits shape before merging the partial values in,
 * so the field always ends up an object regardless of what was on disk.
 *
 * Pipeline updates bypass Mongoose's automatic path casting (only classic
 * `{ $set: {...} }` updates get walked against the schema), so `departmentId`/`userId`
 * are cast to `ObjectId` by hand here — left as plain strings, they'd be written as
 * strings on disk, breaking every `$lookup`/populate against this collection.
 */
function buildLimitsMergePipeline(
  mongoose: typeof import('mongoose'),
  userId: string,
  fields: UpsertUserPolicyInput,
  limits: PartialLimits,
): PipelineStage[] {
  const set: PipelineStage.Set['$set'] = {
    userId: new mongoose.Types.ObjectId(userId),
    limits: { $mergeObjects: [{ $ifNull: ['$limits', limitsDefaults] }, limits] },
  };
  if (fields.departmentId !== undefined) {
    set.departmentId =
      fields.departmentId === null ? null : new mongoose.Types.ObjectId(fields.departmentId);
  }
  if (fields.allowedModels !== undefined) {
    set.allowedModels = fields.allowedModels;
  }
  if (fields.defaultModel !== undefined) {
    set.defaultModel = fields.defaultModel;
  }
  if (fields.blocked !== undefined) {
    set.blocked = fields.blocked;
  }
  if (fields.allowedSpaces !== undefined) {
    set.allowedSpaces = fields.allowedSpaces.map((id) => new mongoose.Types.ObjectId(id));
  }
  if (fields.deniedSpaces !== undefined) {
    set.deniedSpaces = fields.deniedSpaces.map((id) => new mongoose.Types.ObjectId(id));
  }
  if (fields.canUploadKnowledge !== undefined) {
    set.canUploadKnowledge = fields.canUploadKnowledge;
  }
  return [{ $set: set }];
}

export interface CorporateMethods {
  getGlobalSettings: () => Promise<ICorporateSettings>;
  updateGlobalSettings: (fields: UpdateGlobalSettingsInput) => Promise<ICorporateSettings>;
  listDepartments: () => Promise<IDepartment[]>;
  getDepartmentById: (id: string) => Promise<IDepartment | null>;
  createDepartment: (fields: CreateDepartmentInput) => Promise<IDepartment>;
  updateDepartment: (id: string, fields: UpdateDepartmentInput) => Promise<IDepartment | null>;
  deleteDepartment: (id: string) => Promise<boolean>;
  countDepartmentMembers: (departmentId: string) => Promise<number>;
  getUserPolicy: (userId: string) => Promise<IUserPolicy | null>;
  listUserPolicies: (userIds: string[]) => Promise<Map<string, IUserPolicy>>;
  listAdminUserPage: (query: AdminUserPageQuery) => Promise<AdminUserPage>;
  upsertUserPolicy: (userId: string, fields: UpsertUserPolicyInput) => Promise<IUserPolicy>;
  deleteUserPolicy: (userId: string) => Promise<void>;
}

export function createCorporateMethods(mongoose: typeof import('mongoose')): CorporateMethods {
  const settingsModel = () => mongoose.models.CorporateSettings as Model<ICorporateSettings>;
  const departmentModel = () => mongoose.models.Department as Model<IDepartment>;
  const policyModel = () => mongoose.models.UserPolicy as Model<IUserPolicy>;
  const userModel = () => mongoose.models.User as Model<IUser>;

  async function getGlobalSettings(): Promise<ICorporateSettings> {
    const settings = await settingsModel().findOneAndUpdate(
      { key: 'global' },
      { $setOnInsert: { key: 'global' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!settings) {
      throw new Error('Не удалось создать глобальные настройки');
    }
    return settings;
  }

  async function updateGlobalSettings(
    fields: UpdateGlobalSettingsInput,
  ): Promise<ICorporateSettings> {
    await getGlobalSettings();
    const { key: _key, defaultLimits, ...rest } = fields;
    const updated = await settingsModel().findOneAndUpdate(
      { key: 'global' },
      {
        $set: { ...rest, ...(defaultLimits ? flattenLimits('defaultLimits', defaultLimits) : {}) },
      },
      { new: true },
    );
    if (!updated) {
      throw new Error('Не удалось обновить глобальные настройки');
    }
    return updated;
  }

  async function listDepartments(): Promise<IDepartment[]> {
    return departmentModel().find({}).sort({ name: 1 });
  }

  async function getDepartmentById(id: string): Promise<IDepartment | null> {
    return departmentModel().findById(id);
  }

  async function createDepartment(fields: CreateDepartmentInput): Promise<IDepartment> {
    return departmentModel().create(fields);
  }

  async function updateDepartment(
    id: string,
    fields: UpdateDepartmentInput,
  ): Promise<IDepartment | null> {
    const { defaultLimits, ...rest } = fields;
    return departmentModel().findByIdAndUpdate(
      id,
      {
        $set: { ...rest, ...(defaultLimits ? flattenLimits('defaultLimits', defaultLimits) : {}) },
      },
      { new: true },
    );
  }

  /**
   * Без транзакции: в проде MongoDB развёрнут одиночным StatefulSet без
   * реплика-сета, `session.withTransaction` там недоступен. Порядок операций
   * специально такой — сначала отвязать политики, затем удалить отдел, — чтобы
   * при обрыве между шагами в худшем случае остались отвязанные политики, а не
   * политики, ссылающиеся на уже несуществующий отдел.
   */
  async function deleteDepartment(id: string): Promise<boolean> {
    const department = await departmentModel().findById(id);
    if (!department) {
      return false;
    }
    await policyModel().updateMany({ departmentId: id }, { $set: { departmentId: null } });
    await departmentModel().findByIdAndDelete(id);
    return true;
  }

  async function countDepartmentMembers(departmentId: string): Promise<number> {
    return policyModel().countDocuments({ departmentId });
  }

  async function getUserPolicy(userId: string): Promise<IUserPolicy | null> {
    return policyModel().findOne({ userId });
  }

  async function listUserPolicies(userIds: string[]): Promise<Map<string, IUserPolicy>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const policies = await policyModel().find({ userId: { $in: userIds } });
    return new Map(policies.map((policy) => [policy.userId.toString(), policy]));
  }

  /**
   * Name, email and role live on `User`; department and blocked live on the separate
   * `UserPolicy` document, which is created lazily on the first save from the admin
   * panel — so most people have none at all.
   *
   * That rules out pre-selecting ids from `UserPolicy`: "no department" and "active"
   * would have to be expressed as `$nin` over nearly the whole user base, blowing past
   * the 16MB query-document limit. Matching `policy.departmentId` against `null` inside
   * the pipeline covers both an explicit null and a missing lookup result in one
   * expression, and `$facet` keeps rows and total derived from the same stages.
   *
   * Direction matters: `User` carries the tenant-isolation plugin, whose `pre('aggregate')`
   * hook prepends the tenant `$match`. Aggregating from `UserPolicy` instead would leak
   * across tenants. If `UserPolicy` ever gains a `tenantId`, this `$lookup` stops being
   * tenant-filtered and must move to the explicit `pipeline` form.
   */
  async function listAdminUserPage(query: AdminUserPageQuery): Promise<AdminUserPage> {
    const userMatch: FilterQuery<IUser> = {};
    if (query.search) {
      const pattern = { $regex: escapeRegExp(query.search), $options: 'i' };
      userMatch.$or = [{ name: pattern }, { email: pattern }];
    }
    if (query.role) {
      userMatch.role = query.role;
    }

    const policyMatch: Record<string, unknown> = {};
    if (query.departmentId !== undefined) {
      policyMatch['policy.departmentId'] =
        query.departmentId === NO_DEPARTMENT_FILTER
          ? null
          : new mongoose.Types.ObjectId(query.departmentId);
    }
    if (query.blocked !== undefined) {
      /** `{ blocked: false }` would not match a missing policy; `$ne: true` does. */
      policyMatch['policy.blocked'] = query.blocked ? true : { $ne: true };
    }

    const pipeline: PipelineStage[] = [
      { $match: userMatch },
      { $project: { name: 1, email: 1, role: 1, employeeId: 1, openidId: 1, position: 1 } },
      {
        $lookup: {
          from: 'userpolicies',
          localField: '_id',
          foreignField: 'userId',
          as: 'policy',
        },
      },
      { $set: { policy: { $first: '$policy' } } },
      ...(Object.keys(policyMatch).length > 0 ? [{ $match: policyMatch }] : []),
      /** `_id` breaks ties so equal names cannot reshuffle between page requests. */
      { $sort: { name: 1, _id: 1 } },
      {
        $facet: {
          rows: [{ $skip: query.offset }, { $limit: query.limit }],
          total: [{ $count: 'value' }],
        },
      },
    ];

    const [result] = await userModel().aggregate<{
      rows: Array<AdminUserListUser & { policy?: IUserPolicy | null }>;
      total: Array<{ value: number }>;
    }>(pipeline);

    const rows = (result?.rows ?? []).map(({ policy, ...user }) => ({
      user: user as AdminUserListUser,
      policy: policy ?? null,
    }));

    return { rows, total: result?.total?.[0]?.value ?? 0 };
  }

  async function upsertUserPolicy(
    userId: string,
    fields: UpsertUserPolicyInput,
  ): Promise<IUserPolicy> {
    const setFields: Record<string, string | string[] | boolean | number | null> = {};
    if (fields.departmentId !== undefined) {
      setFields.departmentId = fields.departmentId;
    }
    if (fields.allowedModels !== undefined) {
      setFields.allowedModels = fields.allowedModels;
    }
    if (fields.defaultModel !== undefined) {
      setFields.defaultModel = fields.defaultModel;
    }
    if (fields.blocked !== undefined) {
      setFields.blocked = fields.blocked;
    }
    if (fields.allowedSpaces !== undefined) {
      setFields.allowedSpaces = fields.allowedSpaces;
    }
    if (fields.deniedSpaces !== undefined) {
      setFields.deniedSpaces = fields.deniedSpaces;
    }
    if (fields.canUploadKnowledge !== undefined) {
      setFields.canUploadKnowledge = fields.canUploadKnowledge;
    }
    if (fields.limits === null) {
      setFields.limits = null;
    }

    const updated = fields.limits
      ? await policyModel().findOneAndUpdate(
          { userId },
          buildLimitsMergePipeline(mongoose, userId, fields, fields.limits),
          { new: true, upsert: true },
        )
      : await policyModel().findOneAndUpdate(
          { userId },
          { $set: setFields, $setOnInsert: { userId } },
          { new: true, upsert: true },
        );
    if (!updated) {
      logger.error('[upsertUserPolicy] Политика не создана', { userId });
      throw new Error('Не удалось сохранить политику пользователя');
    }
    return updated;
  }

  async function deleteUserPolicy(userId: string): Promise<void> {
    await policyModel().deleteOne({ userId });
  }

  return {
    getGlobalSettings,
    updateGlobalSettings,
    listDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    countDepartmentMembers,
    getUserPolicy,
    listUserPolicies,
    listAdminUserPage,
    upsertUserPolicy,
    deleteUserPolicy,
  };
}
