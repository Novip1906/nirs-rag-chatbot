import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ILimits } from '../types';
import { createCorporateSettingsModel } from '../models/corporateSettings';
import { createUserPolicyModel } from '../models/userPolicy';
import { createDepartmentModel } from '../models/department';
import { createUserModel } from '../models/user';
import {
  createCorporateMethods,
  NO_DEPARTMENT_FILTER,
  type UpdateGlobalSettingsInput,
  type UpsertUserPolicyInput,
} from './corporate';

let mongoServer: MongoMemoryServer;

/** Lean limits subdocument from .toObject() */
type LeanLimits = ILimits;

const fullLimits: ILimits = {
  dailyCostUsd: 100,
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const models = [
    createDepartmentModel(mongoose),
    createUserPolicyModel(mongoose),
    createCorporateSettingsModel(mongoose),
    createUserModel(mongoose),
  ];
  await Promise.all(models.map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.Department.deleteMany({}),
    mongoose.models.UserPolicy.deleteMany({}),
    mongoose.models.CorporateSettings.deleteMany({}),
    mongoose.models.User.deleteMany({}),
  ]);
});

describe('Corporate AI methods', () => {
  it('создаёт глобальные настройки при первом обращении и возвращает их же потом', async () => {
    const methods = createCorporateMethods(mongoose);
    const first = await methods.getGlobalSettings();
    const second = await methods.getGlobalSettings();
    expect(first.key).toBe('global');
    expect(String(second._id)).toBe(String(first._id));
    expect(await mongoose.models.CorporateSettings.countDocuments({})).toBe(1);
  });

  it('создаёт ровно один singleton при конкурентном первом обращении', async () => {
    const methods = createCorporateMethods(mongoose);
    const [first, second] = await Promise.all([
      methods.getGlobalSettings(),
      methods.getGlobalSettings(),
    ]);
    expect(String(first._id)).toBe(String(second._id));
    expect(await mongoose.models.CorporateSettings.countDocuments({})).toBe(1);
  });

  it('не позволяет затереть ключ singleton через updateGlobalSettings', async () => {
    const methods = createCorporateMethods(mongoose);
    await methods.getGlobalSettings();
    /** Симулирует поля, собранные из req.body без строгой проверки литерала. */
    const untrustedFields = { key: 'not-global' } as unknown as UpdateGlobalSettingsInput;
    await methods.updateGlobalSettings(untrustedFields);

    const settings = await methods.getGlobalSettings();
    expect(settings.key).toBe('global');
    expect(await mongoose.models.CorporateSettings.countDocuments({})).toBe(1);
  });

  it('обновляет дневной лимит, не затирая остальные настройки', async () => {
    const methods = createCorporateMethods(mongoose);
    await methods.getGlobalSettings();
    await methods.updateGlobalSettings({ systemPrompt: 'Будь вежлив', defaultLimits: fullLimits });

    await methods.updateGlobalSettings({ defaultLimits: { dailyCostUsd: 200 } });

    const settings = await methods.getGlobalSettings();
    const plain = settings.toObject() as { defaultLimits: LeanLimits };
    expect(plain.defaultLimits).toEqual({ dailyCostUsd: 200 });
    expect(settings.systemPrompt).toBe('Будь вежлив');
  });

  it('заводит пустую карту modelCapabilities по умолчанию', async () => {
    const methods = createCorporateMethods(mongoose);
    const settings = await methods.getGlobalSettings();
    expect(settings.modelCapabilities).toEqual({});
  });

  /**
   * `modelCapabilities` — `Mixed`, и `$set` заменяет карту целиком, той же семантикой, что
   * и `allowedModels`/`systemPrompt`: вызывающий (админка) шлёт полное состояние формы,
   * а не патч одного ключа. Более раннее значение здесь специально отличается от второго,
   * чтобы падение теста заметило переход на частичный мердж, если кто-то его добавит.
   */
  it('заменяет карту modelCapabilities целиком при обновлении', async () => {
    const methods = createCorporateMethods(mongoose);
    await methods.getGlobalSettings();
    await methods.updateGlobalSettings({
      modelCapabilities: { 'openai/gpt-5.2': { knowledgeBase: true, webSearch: true } },
    });

    await methods.updateGlobalSettings({
      modelCapabilities: {
        'openai/gpt-5.2': { knowledgeBase: true, webSearch: true },
        'google/gemini-3.5-flash-lite': { knowledgeBase: false, webSearch: false },
      },
    });

    const settings = await methods.getGlobalSettings();
    expect(settings.modelCapabilities).toEqual({
      'openai/gpt-5.2': { knowledgeBase: true, webSearch: true },
      'google/gemini-3.5-flash-lite': { knowledgeBase: false, webSearch: false },
    });
  });

  it('обновляет дневной лимит отдела, не затирая остальные настройки отдела', async () => {
    const methods = createCorporateMethods(mongoose);
    const department = await methods.createDepartment({
      name: 'Продажи',
      systemPrompt: 'Работай по скрипту',
      defaultLimits: fullLimits,
    });

    await methods.updateDepartment(String(department._id), {
      defaultLimits: { dailyCostUsd: 42 },
    });

    const updated = await methods.getDepartmentById(String(department._id));
    const plain = updated?.toObject() as { defaultLimits: LeanLimits } | undefined;
    expect(plain?.defaultLimits).toEqual({ dailyCostUsd: 42 });
    expect(updated?.systemPrompt).toBe('Работай по скрипту');
  });

  it('переводит сотрудников удалённого отдела в «без отдела»', async () => {
    const methods = createCorporateMethods(mongoose);
    const department = await methods.createDepartment({ name: 'Маркетинг' });
    const userId = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(userId, { departmentId: String(department._id) });

    const deleted = await methods.deleteDepartment(String(department._id));

    expect(deleted).toBe(true);
    const policy = await methods.getUserPolicy(userId);
    expect(policy?.departmentId).toBeNull();
  });

  it('не падает и ничего не меняет при удалении несуществующего отдела', async () => {
    const methods = createCorporateMethods(mongoose);
    const deleted = await methods.deleteDepartment(new mongoose.Types.ObjectId().toString());
    expect(deleted).toBe(false);
  });

  it('обновляет политику, не создавая вторую для того же пользователя', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(userId, { blocked: false });
    await methods.upsertUserPolicy(userId, { blocked: true });

    expect(await mongoose.models.UserPolicy.countDocuments({})).toBe(1);
    const policy = await methods.getUserPolicy(userId);
    expect(policy?.blocked).toBe(true);
  });

  it('обновляет лимит политики, не затирая прочие поля политики', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(userId, {
      limits: fullLimits,
      allowedModels: ['model-a'],
    });

    await methods.upsertUserPolicy(userId, { limits: { dailyCostUsd: 5 } });

    const policy = await methods.getUserPolicy(userId);
    const plain = policy?.toObject() as { limits: LeanLimits } | undefined;
    expect(plain?.limits).toEqual({ dailyCostUsd: 5 });
    expect(policy?.allowedModels).toEqual(['model-a']);
  });

  it('очищает лимиты политики целиком, если передан limits: null', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(userId, { limits: fullLimits });

    await methods.upsertUserPolicy(userId, { limits: null });

    const policy = await methods.getUserPolicy(userId);
    expect(policy?.limits).toBeNull();
  });

  it('выставляет лимит на политике, созданной без лимитов (limits: null на диске)', async () => {
    const methods = createCorporateMethods(mongoose);
    const department = await methods.createDepartment({ name: 'Финансы' });
    const userId = new mongoose.Types.ObjectId().toString();

    /** Политика создаётся отделом, без лимитов — на диске `limits: null`, дефолт схемы. */
    const created = await methods.upsertUserPolicy(userId, {
      departmentId: String(department._id),
    });
    expect(created.limits).toBeNull();

    /** Спустя время админ ставит дневной лимит — именно здесь падал $set по null-субдокументу. */
    const updated = await methods.upsertUserPolicy(userId, { limits: { dailyCostUsd: 500 } });

    expect(updated.limits?.dailyCostUsd).toBe(500);
    /** departmentId должен остаться ObjectId, а не превратиться в строку через pipeline-update. */
    expect(updated.departmentId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(updated.departmentId?.toString()).toBe(String(department._id));

    const reloaded = await methods.getUserPolicy(userId);
    expect(reloaded?.limits?.dailyCostUsd).toBe(500);
  });

  it('переживает цикл «поставили лимит → очистили → поставили снова»', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();

    await methods.upsertUserPolicy(userId, { limits: { dailyCostUsd: 100 } });
    await methods.upsertUserPolicy(userId, { limits: null });
    const afterClear = await methods.getUserPolicy(userId);
    expect(afterClear?.limits).toBeNull();

    const afterSecondSet = await methods.upsertUserPolicy(userId, {
      limits: { dailyCostUsd: 200 },
    });

    expect(afterSecondSet.limits?.dailyCostUsd).toBe(200);
  });

  it('одобрение заявки на лимит поднимает существующий персональный лимит, не затирая остальные поля', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(userId, { blocked: false, allowedModels: ['model-a'] });

    const approved = await methods.upsertUserPolicy(userId, {
      limits: { dailyCostUsd: 1000 },
    });

    expect(approved.limits?.dailyCostUsd).toBe(1000);
    expect(approved.blocked).toBe(false);
    expect(approved.allowedModels).toEqual(['model-a']);
  });

  it('сохраняет allowedSpaces и deniedSpaces политики', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const spaceA = new mongoose.Types.ObjectId().toString();
    const spaceB = new mongoose.Types.ObjectId().toString();

    const updated = await methods.upsertUserPolicy(userId, {
      allowedSpaces: [spaceA],
      deniedSpaces: [spaceB],
    });

    expect(updated.allowedSpaces.map(String)).toEqual([spaceA]);
    expect(updated.deniedSpaces.map(String)).toEqual([spaceB]);

    const reloaded = await methods.getUserPolicy(userId);
    expect(reloaded?.allowedSpaces.map(String)).toEqual([spaceA]);
    expect(reloaded?.deniedSpaces.map(String)).toEqual([spaceB]);
  });

  it('обновляет allowedSpaces/deniedSpaces одновременно с лимитами, не теряя тип ObjectId', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const spaceA = new mongoose.Types.ObjectId().toString();

    /**
     * `limits` направляет upsertUserPolicy по агрегационному pipeline-обновлению
     * (buildLimitsMergePipeline), которое не проходит автоматическое приведение типов
     * схемы — именно там `departmentId` уже один раз чуть не превратился в строку.
     * allowedSpaces/deniedSpaces — тоже `[ObjectId]` в схеме, тот же риск.
     */
    const updated = await methods.upsertUserPolicy(userId, {
      limits: { dailyCostUsd: 100 },
      allowedSpaces: [spaceA],
      deniedSpaces: [],
    });

    expect(updated.allowedSpaces).toHaveLength(1);
    expect(updated.allowedSpaces[0]).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(updated.allowedSpaces[0].toString()).toBe(spaceA);
    expect(updated.deniedSpaces).toEqual([]);
  });

  it('не трогает allowedSpaces/deniedSpaces, если они не переданы', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const spaceA = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(userId, { allowedSpaces: [spaceA] });

    const updated = await methods.upsertUserPolicy(userId, { blocked: true });

    expect(updated.allowedSpaces.map(String)).toEqual([spaceA]);
  });

  it('игнорирует чужеродный userId, подмешанный в fields', async () => {
    const methods = createCorporateMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const foreignId = new mongoose.Types.ObjectId().toString();
    const fields: UpsertUserPolicyInput & { userId: string } = {
      blocked: true,
      userId: foreignId,
    };

    await methods.upsertUserPolicy(userId, fields);

    expect(await methods.getUserPolicy(userId)).not.toBeNull();
    expect(await methods.getUserPolicy(foreignId)).toBeNull();
  });

  it('listUserPolicies одним запросом возвращает карту только по тем, у кого есть политика', async () => {
    const methods = createCorporateMethods(mongoose);
    const withPolicy = new mongoose.Types.ObjectId().toString();
    const alsoWithPolicy = new mongoose.Types.ObjectId().toString();
    const withoutPolicy = new mongoose.Types.ObjectId().toString();
    await methods.upsertUserPolicy(withPolicy, { blocked: true });
    await methods.upsertUserPolicy(alsoWithPolicy, { blocked: false });

    const policies = await methods.listUserPolicies([withPolicy, alsoWithPolicy, withoutPolicy]);

    expect(policies.size).toBe(2);
    expect(policies.get(withPolicy)?.blocked).toBe(true);
    expect(policies.get(alsoWithPolicy)?.blocked).toBe(false);
    expect(policies.has(withoutPolicy)).toBe(false);
  });

  it('listUserPolicies не ходит в базу на пустом массиве', async () => {
    const methods = createCorporateMethods(mongoose);
    const findSpy = jest.spyOn(mongoose.models.UserPolicy, 'find');

    const policies = await methods.listUserPolicies([]);

    expect(policies.size).toBe(0);
    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });

  describe('listAdminUserPage', () => {
    /**
     * Половина сценариев здесь держится на людях без документа UserPolicy: он создаётся
     * лениво, при первом сохранении карточки, поэтому в свежей базе таких большинство.
     */
    async function seedUser(name: string, email: string, role = 'USER') {
      const created = await mongoose.models.User.create({ name, email, role });
      return created._id.toString();
    }

    async function seedDepartment(name: string) {
      const created = await mongoose.models.Department.create({ name });
      return created._id.toString();
    }

    it('возвращает сотрудника без политики в фильтре «активные»', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('Анна', 'anna@example.com');

      const page = await methods.listAdminUserPage({ blocked: false, limit: 10, offset: 0 });

      expect(page.total).toBe(1);
      expect(page.rows[0].user.name).toBe('Анна');
      expect(page.rows[0].policy).toBeNull();
    });

    it('отдаёт идентификаторы сотрудника и должность', async () => {
      const methods = createCorporateMethods(mongoose);
      await mongoose.models.User.create({
        name: 'Вера',
        email: 'vera@example.com',
        role: 'USER',
        employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        openidId: 'sub-vera',
        position: 'Аналитик',
      });

      const page = await methods.listAdminUserPage({ limit: 10, offset: 0 });

      expect(page.rows[0].user).toMatchObject({
        employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        openidId: 'sub-vera',
        position: 'Аналитик',
      });
    });

    it('возвращает сотрудника без политики в фильтре «без отдела»', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('Борис', 'boris@example.com');

      const page = await methods.listAdminUserPage({
        departmentId: NO_DEPARTMENT_FILTER,
        limit: 10,
        offset: 0,
      });

      expect(page.total).toBe(1);
      expect(page.rows[0].user.name).toBe('Борис');
    });

    it('не показывает сотрудника без политики среди заблокированных', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('Вера', 'vera@example.com');

      const page = await methods.listAdminUserPage({ blocked: true, limit: 10, offset: 0 });

      expect(page.total).toBe(0);
      expect(page.rows).toEqual([]);
    });

    it('разделяет заблокированных и активных по политике', async () => {
      const methods = createCorporateMethods(mongoose);
      const blockedId = await seedUser('Галина', 'galina@example.com');
      await seedUser('Дмитрий', 'dmitry@example.com');
      await methods.upsertUserPolicy(blockedId, { blocked: true });

      const [blocked, active] = await Promise.all([
        methods.listAdminUserPage({ blocked: true, limit: 10, offset: 0 }),
        methods.listAdminUserPage({ blocked: false, limit: 10, offset: 0 }),
      ]);

      expect(blocked.rows.map((row) => row.user.name)).toEqual(['Галина']);
      expect(active.rows.map((row) => row.user.name)).toEqual(['Дмитрий']);
    });

    it('фильтрует по отделу и отдаёт политику вместе со строкой', async () => {
      const methods = createCorporateMethods(mongoose);
      const departmentId = await seedDepartment('Продажи');
      const memberId = await seedUser('Елена', 'elena@example.com');
      await seedUser('Жанна', 'zhanna@example.com');
      await methods.upsertUserPolicy(memberId, { departmentId });

      const page = await methods.listAdminUserPage({ departmentId, limit: 10, offset: 0 });

      expect(page.total).toBe(1);
      expect(page.rows[0].user.name).toBe('Елена');
      expect(page.rows[0].policy?.departmentId?.toString()).toBe(departmentId);
    });

    it('исключает члена отдела из фильтра «без отдела»', async () => {
      const methods = createCorporateMethods(mongoose);
      const departmentId = await seedDepartment('Логистика');
      const memberId = await seedUser('Зоя', 'zoya@example.com');
      await seedUser('Игорь', 'igor@example.com');
      await methods.upsertUserPolicy(memberId, { departmentId });

      const page = await methods.listAdminUserPage({
        departmentId: NO_DEPARTMENT_FILTER,
        limit: 10,
        offset: 0,
      });

      expect(page.rows.map((row) => row.user.name)).toEqual(['Игорь']);
    });

    it('ищет по имени и почте без учёта регистра', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('Кирилл', 'kirill@example.com');
      await seedUser('Лариса', 'larisa@corp.example');

      const [byName, byEmail] = await Promise.all([
        methods.listAdminUserPage({ search: 'кирилл', limit: 10, offset: 0 }),
        methods.listAdminUserPage({ search: 'CORP', limit: 10, offset: 0 }),
      ]);

      expect(byName.rows.map((row) => row.user.name)).toEqual(['Кирилл']);
      expect(byEmail.rows.map((row) => row.user.name)).toEqual(['Лариса']);
    });

    it('трактует спецсимволы поиска как литералы', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('a.*b', 'literal@example.com');
      await seedUser('axxb', 'regex@example.com');

      const page = await methods.listAdminUserPage({ search: 'a.*b', limit: 10, offset: 0 });

      expect(page.rows.map((row) => row.user.name)).toEqual(['a.*b']);
    });

    it('фильтрует по роли точным совпадением', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('Мария', 'maria@example.com', 'ADMIN');
      await seedUser('Никита', 'nikita@example.com', 'USER');

      const page = await methods.listAdminUserPage({ role: 'ADMIN', limit: 10, offset: 0 });

      expect(page.rows.map((row) => row.user.name)).toEqual(['Мария']);
      expect(page.total).toBe(1);
    });

    it('сужает выдачу при комбинации фильтров', async () => {
      const methods = createCorporateMethods(mongoose);
      const departmentId = await seedDepartment('Поддержка');
      const matchId = await seedUser('Ольга Смирнова', 'olga@example.com', 'ADMIN');
      const otherDepartmentId = await seedUser('Ольга Петрова', 'olga.p@example.com', 'ADMIN');
      await methods.upsertUserPolicy(matchId, { departmentId });
      await methods.upsertUserPolicy(otherDepartmentId, { departmentId: null });

      const page = await methods.listAdminUserPage({
        search: 'ольга',
        role: 'ADMIN',
        departmentId,
        blocked: false,
        limit: 10,
        offset: 0,
      });

      expect(page.rows.map((row) => row.user.name)).toEqual(['Ольга Смирнова']);
      expect(page.total).toBe(1);
    });

    it('держит стабильный порядок при одинаковых именах на границе страницы', async () => {
      const methods = createCorporateMethods(mongoose);
      await seedUser('Павел', 'pavel1@example.com');
      await seedUser('Павел', 'pavel2@example.com');

      const [first, second] = await Promise.all([
        methods.listAdminUserPage({ limit: 1, offset: 0 }),
        methods.listAdminUserPage({ limit: 1, offset: 1 }),
      ]);

      expect(first.total).toBe(2);
      expect(second.total).toBe(2);
      expect(first.rows[0].user.email).not.toBe(second.rows[0].user.email);
    });

    it('считает total по отфильтрованной выборке, а не по всей коллекции', async () => {
      const methods = createCorporateMethods(mongoose);
      await Promise.all([
        seedUser('Роман', 'roman@example.com'),
        seedUser('Семён', 'semen@example.com'),
        seedUser('Тимур', 'timur@example.com'),
      ]);

      const page = await methods.listAdminUserPage({ search: 'роман', limit: 1, offset: 0 });

      expect(page.total).toBe(1);
      expect(page.rows).toHaveLength(1);
    });
  });
});
