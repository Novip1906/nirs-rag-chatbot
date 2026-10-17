import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createLimitRequestModel } from '../models/limitRequest';
import { createLimitsMethods } from './limits';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await createLimitRequestModel(mongoose).init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.LimitRequest.deleteMany({});
});

describe('Limits methods', () => {
  it('создаёт заявку на повышение лимита', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();

    const request = await methods.createLimitRequest(userId, 'daily', 'нужно больше');

    expect(request.userId.toString()).toBe(userId);
    expect(request.window).toBe('daily');
    expect(request.comment).toBe('нужно больше');
    expect(request.status).toBe('pending');
  });

  it('возвращает существующую открытую заявку того же окна вместо создания второй', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();

    const first = await methods.createLimitRequest(userId, 'daily', 'первая');
    const second = await methods.createLimitRequest(userId, 'daily', 'вторая');

    expect(second._id.toString()).toBe(first._id.toString());
    expect(second.window).toBe('daily');

    const all = await mongoose.models.LimitRequest.find({ userId });
    expect(all).toHaveLength(1);
  });

  it('позволяет новую заявку после того, как предыдущая разрешена', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const first = await methods.createLimitRequest(userId, 'daily');
    await methods.resolveLimitRequest(first._id.toString(), 'approved', adminId);

    const second = await methods.createLimitRequest(userId, 'daily');

    expect(second._id.toString()).not.toBe(first._id.toString());
    expect(second.status).toBe('pending');
  });

  it('партиальный уникальный индекс не пускает вторую открытую заявку того же окна в обход метода', async () => {
    const userId = new mongoose.Types.ObjectId();
    await mongoose.models.LimitRequest.create({ userId, window: 'daily', status: 'pending' });

    await expect(
      mongoose.models.LimitRequest.create({ userId, window: 'daily', status: 'pending' }),
    ).rejects.toThrow();
  });

  it('getPendingLimitRequest возвращает null, если открытых заявок на это окно нет', async () => {
    const methods = createLimitsMethods(mongoose);
    const pending = await methods.getPendingLimitRequest(
      new mongoose.Types.ObjectId().toString(),
      'daily',
    );
    expect(pending).toBeNull();
  });

  it('getPendingLimitRequests отдаёт только заявки указанного сотрудника', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const otherId = new mongoose.Types.ObjectId().toString();

    const daily = await methods.createLimitRequest(userId, 'daily');
    await methods.createLimitRequest(otherId, 'daily');

    const pending = await methods.getPendingLimitRequests(userId);

    expect(pending.map((request) => request._id.toString())).toEqual([daily._id.toString()]);
  });

  it('listLimitRequests без статуса возвращает все заявки, свежие первыми', async () => {
    const methods = createLimitsMethods(mongoose);
    const userA = new mongoose.Types.ObjectId().toString();
    const userB = new mongoose.Types.ObjectId().toString();

    const older = await methods.createLimitRequest(userA, 'daily');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await methods.createLimitRequest(userB, 'daily');

    const all = await methods.listLimitRequests();

    expect(all).toHaveLength(2);
    expect(all[0]._id.toString()).toBe(newer._id.toString());
    expect(all[1]._id.toString()).toBe(older._id.toString());
  });

  it('listLimitRequests фильтрует по статусу', async () => {
    const methods = createLimitsMethods(mongoose);
    const userA = new mongoose.Types.ObjectId().toString();
    const userB = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const toApprove = await methods.createLimitRequest(userA, 'daily');
    await methods.resolveLimitRequest(toApprove._id.toString(), 'approved', adminId);
    await methods.createLimitRequest(userB, 'daily');

    const pending = await methods.listLimitRequests('pending');
    const approved = await methods.listLimitRequests('approved');

    expect(pending).toHaveLength(1);
    expect(pending[0].userId.toString()).toBe(userB);
    expect(approved).toHaveLength(1);
    expect(approved[0].userId.toString()).toBe(userA);
  });

  it('getLimitRequestById находит заявку по id без выгрузки всей очереди', async () => {
    const methods = createLimitsMethods(mongoose);
    const userA = new mongoose.Types.ObjectId().toString();
    const userB = new mongoose.Types.ObjectId().toString();

    await methods.createLimitRequest(userA, 'daily');
    const target = await methods.createLimitRequest(userB, 'daily');

    const found = await methods.getLimitRequestById(target._id.toString());

    expect(found?._id.toString()).toBe(target._id.toString());
    expect(found?.userId.toString()).toBe(userB);
  });

  it('getLimitRequestById возвращает null для несуществующего id', async () => {
    const methods = createLimitsMethods(mongoose);
    const missing = await methods.getLimitRequestById(new mongoose.Types.ObjectId().toString());
    expect(missing).toBeNull();
  });

  it('getLimitRequestById сужает поиск статусом, как listLimitRequests', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const request = await methods.createLimitRequest(userId, 'daily');
    await methods.resolveLimitRequest(request._id.toString(), 'approved', adminId);

    const asPending = await methods.getLimitRequestById(request._id.toString(), 'pending');
    const asApproved = await methods.getLimitRequestById(request._id.toString(), 'approved');

    expect(asPending).toBeNull();
    expect(asApproved?._id.toString()).toBe(request._id.toString());
  });

  it('resolveLimitRequest проставляет статус, автора и время решения', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const created = await methods.createLimitRequest(userId, 'daily');
    const resolved = await methods.resolveLimitRequest(created._id.toString(), 'rejected', adminId);

    expect(resolved?.status).toBe('rejected');
    expect(resolved?.resolvedBy?.toString()).toBe(adminId);
    expect(resolved?.resolvedAt).toBeInstanceOf(Date);
  });

  it('resolveLimitRequest не даёт повторно одобрить уже отклонённую заявку', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const attackerId = new mongoose.Types.ObjectId().toString();

    const created = await methods.createLimitRequest(userId, 'daily');
    const rejected = await methods.resolveLimitRequest(created._id.toString(), 'rejected', adminId);
    expect(rejected?.status).toBe('rejected');

    const secondAttempt = await methods.resolveLimitRequest(
      created._id.toString(),
      'approved',
      attackerId,
    );

    expect(secondAttempt).toBeNull();
    const stored = await mongoose.models.LimitRequest.findById(created._id);
    expect(stored?.status).toBe('rejected');
    expect(stored?.resolvedBy?.toString()).toBe(adminId);
  });

  it('resolveLimitRequest возвращает null для несуществующей заявки', async () => {
    const methods = createLimitsMethods(mongoose);
    const resolved = await methods.resolveLimitRequest(
      new mongoose.Types.ObjectId().toString(),
      'approved',
      new mongoose.Types.ObjectId().toString(),
    );
    expect(resolved).toBeNull();
  });

  it('сохраняет снимок текущего лимита в момент подачи заявки', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();

    const request = await methods.createLimitRequest(userId, 'daily', undefined, 500);

    expect(request.limitBefore).toBe(500);
    expect(request.limitAfter).toBeNull();
  });

  it('записывает одобренное значение лимита при подтверждении заявки', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const created = await methods.createLimitRequest(userId, 'daily', undefined, 500);
    const approved = await methods.resolveLimitRequest(
      created._id.toString(),
      'approved',
      adminId,
      1200,
    );

    expect(approved?.limitBefore).toBe(500);
    expect(approved?.limitAfter).toBe(1200);
  });

  it('не записывает новый лимит при отклонении заявки', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const created = await methods.createLimitRequest(userId, 'daily', undefined, 500);
    const rejected = await methods.resolveLimitRequest(
      created._id.toString(),
      'rejected',
      adminId,
      1200,
    );

    expect(rejected?.limitAfter).toBeNull();
  });

  it('listLimitRequestsByUsers отдаёт заявки только указанных пользователей, новые первыми', async () => {
    const methods = createLimitsMethods(mongoose);
    const userId = new mongoose.Types.ObjectId().toString();
    const otherId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();

    const first = await methods.createLimitRequest(userId, 'daily', undefined, 100);
    await methods.resolveLimitRequest(first._id.toString(), 'approved', adminId, 300);
    const second = await methods.createLimitRequest(userId, 'daily', undefined, 300);
    await methods.createLimitRequest(otherId, 'daily', undefined, 700);

    const history = await methods.listLimitRequestsByUsers([userId]);

    expect(history.map((request) => request._id.toString())).toEqual([
      second._id.toString(),
      first._id.toString(),
    ]);
  });

  it('listLimitRequestsByUsers не ходит в базу за пустым списком', async () => {
    const methods = createLimitsMethods(mongoose);
    await expect(methods.listLimitRequestsByUsers([])).resolves.toEqual([]);
  });
});
