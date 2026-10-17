import { createDirectoryClient } from './client';

const ENV = {
  ADMIN_API_URL: 'http://admin-api.local',
  ADMIN_API_CLIENT_SECRET: 'shh',
  OPENID_ISSUER: 'http://sso.local/realms/corporate',
} as NodeJS.ProcessEnv;

const TOKEN_URL = 'http://sso.local/realms/corporate/protocol/openid-connect/token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse(token: string, expiresIn = 300): Response {
  return json(200, { access_token: token, expires_in: expiresIn });
}

const employee = {
  id: 'e1',
  sub: 's1',
  email: 'a@b.c',
  first_name: 'A',
  last_name: 'B',
  position: '',
  department_id: null,
  is_admin: false,
  blocked: false,
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
};

describe('directory client', () => {
  it('returns not_configured without env', async () => {
    const fetchFn = jest.fn();
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: {} as never });
    expect(client.isConfigured()).toBe(false);
    expect(await client.listEmployees()).toEqual({ ok: false, reason: 'not_configured' });
    expect(await client.listDepartments()).toEqual({ ok: false, reason: 'not_configured' });
    expect(await client.getEmployee('x')).toEqual({ ok: false, reason: 'not_configured' });
    expect(await client.getEmployeeBySub('x')).toEqual({ ok: false, reason: 'not_configured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requests include_deleted and parses items', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(200, { items: [employee] }))
      .mockResolvedValueOnce(json(200, { items: [{ id: 'd1', name: 'N' }] }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    expect(client.isConfigured()).toBe(true);

    const employees = await client.listEmployees();
    expect(employees).toEqual({ ok: true, value: [employee] });
    const departments = await client.listDepartments();
    expect(departments).toEqual({ ok: true, value: [{ id: 'd1', name: 'N' }] });

    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0];
    expect(tokenUrl).toBe(TOKEN_URL);
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('ai-admin-api');
    expect(form.get('client_secret')).toBe('shh');

    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://admin-api.local/v1/employees?include_deleted=true',
    );
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
    expect(fetchFn.mock.calls[2][0]).toBe(
      'http://admin-api.local/v1/departments?include_deleted=true',
    );
    expect(fetchFn.mock.calls[2][1].headers.Authorization).toBe('Bearer tok');
  });

  it('uses single-record paths with encoded ids', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(200, employee))
      .mockResolvedValueOnce(json(200, employee));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });

    expect(await client.getEmployee('e1')).toEqual({ ok: true, value: employee });
    expect(await client.getEmployeeBySub('a/b')).toEqual({ ok: true, value: employee });
    expect(fetchFn.mock.calls[1][0]).toBe('http://admin-api.local/v1/employees/e1');
    expect(fetchFn.mock.calls[2][0]).toBe('http://admin-api.local/v1/employees/by-sub/a%2Fb');
    expect(fetchFn.mock.calls[2][1].headers.Authorization).toBe('Bearer tok');
  });

  it('caches service token across calls', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(200, { items: [] }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    await client.listEmployees();
    await client.listDepartments();
    const tokenCalls = fetchFn.mock.calls.filter(([url]) => url === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    expect(fetchFn.mock.calls[2][1].headers.Authorization).toBe('Bearer tok');
  });

  it('refetches token when it is about to expire', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('old', 20))
      .mockResolvedValueOnce(json(200, { items: [] }))
      .mockResolvedValueOnce(tokenResponse('new'))
      .mockResolvedValueOnce(json(200, { items: [] }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    await client.listEmployees();
    await client.listEmployees();
    expect(fetchFn.mock.calls[3][1].headers.Authorization).toBe('Bearer new');
  });

  it('refreshes token once on 401', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('old'))
      .mockResolvedValueOnce(json(401, { error_code: 'unauthorized' }))
      .mockResolvedValueOnce(tokenResponse('new'))
      .mockResolvedValueOnce(json(200, { items: [employee] }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    expect(await client.listEmployees()).toEqual({ ok: true, value: [employee] });
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer old');
    expect(fetchFn.mock.calls[3][1].headers.Authorization).toBe('Bearer new');
  });

  it('does not retry a second 401', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('old'))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(tokenResponse('new'))
      .mockResolvedValueOnce(json(401, {}));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    expect(await client.listEmployees()).toEqual({ ok: false, reason: 'unavailable' });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('maps 404 to not_found', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(404, { error_code: 'not_found' }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    expect(await client.getEmployee('missing')).toEqual({ ok: false, reason: 'not_found' });
    expect(fetchFn.mock.calls[1][0]).toBe('http://admin-api.local/v1/employees/missing');
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('maps network error and 5xx to unavailable', async () => {
    const networkFetch = jest.fn().mockRejectedValue(new Error('down'));
    const networkClient = createDirectoryClient({ fetchFn: networkFetch as never, env: ENV });
    expect(await networkClient.listEmployees()).toEqual({ ok: false, reason: 'unavailable' });

    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(503, { error_code: 'idp_unavailable' }))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    expect(await client.listDepartments()).toEqual({ ok: false, reason: 'unavailable' });
    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://admin-api.local/v1/departments?include_deleted=true',
    );
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
    expect(await client.listEmployees()).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('maps token endpoint rejection to unavailable', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(json(401, { error: 'unauthorized_client' }));
    const client = createDirectoryClient({ fetchFn: fetchFn as never, env: ENV });
    expect(await client.listEmployees()).toEqual({ ok: false, reason: 'unavailable' });
    expect(fetchFn.mock.calls[0][0]).toBe(TOKEN_URL);
  });

  it('honours ADMIN_API_CLIENT_ID and trims trailing slash', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(200, { items: [] }));
    const client = createDirectoryClient({
      fetchFn: fetchFn as never,
      env: { ...ENV, ADMIN_API_CLIENT_ID: 'custom', ADMIN_API_URL: 'http://admin-api.local/' },
    });
    await client.listEmployees();
    expect(new URLSearchParams(fetchFn.mock.calls[0][1].body as string).get('client_id')).toBe(
      'custom',
    );
    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://admin-api.local/v1/employees?include_deleted=true',
    );
  });

  it('normalizes the issuer and is not configured with a blank one', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce(json(200, { items: [] }));
    const client = createDirectoryClient({
      fetchFn: fetchFn as never,
      env: { ...ENV, OPENID_ISSUER: ' http://sso.local/realms/corporate/ ' },
    });
    await client.listEmployees();
    expect(fetchFn.mock.calls[0][0]).toBe(TOKEN_URL);
    const blank = createDirectoryClient({
      fetchFn: fetchFn as never,
      env: { ...ENV, OPENID_ISSUER: '  ' },
    });
    expect(blank.isConfigured()).toBe(false);
  });
});
