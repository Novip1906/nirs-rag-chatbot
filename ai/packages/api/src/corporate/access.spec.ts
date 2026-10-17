import { isUserBlocked, invalidateBlockedUser } from './access';

describe('isUserBlocked', () => {
  afterEach(() => {
    invalidateBlockedUser('u1');
  });

  it('без пользователя ничего не читает', async () => {
    const getUserPolicy = jest.fn();
    expect(await isUserBlocked({ getUserPolicy }, null)).toBe(false);
    expect(getUserPolicy).not.toHaveBeenCalled();
  });

  it('возвращает флаг политики', async () => {
    const getUserPolicy = jest.fn().mockResolvedValue({ blocked: true });
    expect(await isUserBlocked({ getUserPolicy }, 'u1')).toBe(true);
  });

  it('считает отсутствующую политику незаблокированной', async () => {
    const getUserPolicy = jest.fn().mockResolvedValue(null);
    expect(await isUserBlocked({ getUserPolicy }, 'u1')).toBe(false);
  });

  it('читает базу один раз на окно кэша', async () => {
    const getUserPolicy = jest.fn().mockResolvedValue({ blocked: true });
    await isUserBlocked({ getUserPolicy }, 'u1');
    await isUserBlocked({ getUserPolicy }, 'u1');
    expect(getUserPolicy).toHaveBeenCalledTimes(1);
  });

  it('перечитывает базу после сброса кэша', async () => {
    const getUserPolicy = jest.fn().mockResolvedValue({ blocked: true });
    await isUserBlocked({ getUserPolicy }, 'u1');
    invalidateBlockedUser('u1');
    getUserPolicy.mockResolvedValue({ blocked: false });
    expect(await isUserBlocked({ getUserPolicy }, 'u1')).toBe(false);
    expect(getUserPolicy).toHaveBeenCalledTimes(2);
  });

  it('не запирает платформу при сбое чтения политики', async () => {
    const getUserPolicy = jest.fn().mockRejectedValue(new Error('mongo down'));
    expect(await isUserBlocked({ getUserPolicy }, 'u1')).toBe(false);
  });
});
