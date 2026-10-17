import { request as httpRequest, apiBaseUrl } from '~/api';
import type { AdminCapabilitiesResponse } from '~/api';
import { getAdminCapabilities } from '../capabilities';

jest.mock('~/api', () => ({
  ...jest.requireActual('~/api'),
  request: {
    get: jest.fn(),
  },
}));

const mockedRequest = httpRequest as unknown as { get: jest.Mock };

describe('getAdminCapabilities', () => {
  it('fetches the capabilities of the signed-in user and returns the response as-is', async () => {
    const response: AdminCapabilitiesResponse = {
      capabilities: ['access:admin', 'read:users'],
      role: 'HEAD',
      departmentId: 'dept-1',
      departmentName: 'IT',
    };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminCapabilities();

    expect(mockedRequest.get).toHaveBeenCalledWith(
      `${apiBaseUrl()}/api/office/admin/me/capabilities`,
      { timeout: 15_000 },
    );
    expect(result).toEqual(response);
  });
});
