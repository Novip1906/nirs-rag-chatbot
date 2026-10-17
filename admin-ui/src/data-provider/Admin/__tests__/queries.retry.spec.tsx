import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { ReactNode } from 'react';
import { useAdminDepartmentsQuery, useAdminUserQuery } from '../queries';

const mockGetUser = jest.fn();
const mockGetDepartments = jest.fn();

jest.mock('../request', () => ({
  ...jest.requireActual('../request'),
  getAdminUser: (...args: unknown[]) => mockGetUser(...args),
  getAdminDepartments: (...args: unknown[]) => mockGetDepartments(...args),
}));

function clientError(status: number): AxiosError {
  const error = new AxiosError('failed');
  error.response = { status, data: {}, statusText: '', headers: {}, config: {} as never };
  return error;
}

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('ai layer queries', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetDepartments.mockReset();
  });

  it.each([403, 404])('does not retry a %s for the ai user card', async (status) => {
    mockGetUser.mockRejectedValue(clientError(status));

    const { result } = renderHook(() => useAdminUserQuery('u1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 403 for the ai departments list', async () => {
    mockGetDepartments.mockRejectedValue(clientError(403));

    const { result } = renderHook(() => useAdminDepartmentsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGetDepartments).toHaveBeenCalledTimes(1);
  });
});
