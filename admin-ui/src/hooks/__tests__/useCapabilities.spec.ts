import { renderHook } from '@testing-library/react';
import { useCapabilities } from '../useCapabilities';

const mockUseAdminCapabilitiesQuery = jest.fn();

jest.mock('~/data-provider/Admin/capabilities', () => ({
  useAdminCapabilitiesQuery: () => mockUseAdminCapabilitiesQuery(),
}));

describe('useCapabilities', () => {
  it('reports loading with an empty capability set before the query resolves', () => {
    mockUseAdminCapabilitiesQuery.mockReturnValue({ data: undefined, isLoading: true });

    const { result } = renderHook(() => useCapabilities());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.capabilities.size).toBe(0);
    expect(result.current.role).toBeNull();
    expect(result.current.departmentId).toBeNull();
    expect(result.current.departmentName).toBeNull();
  });

  /**
   * Без `isError`/`refetch` отказ запроса неотличим снаружи от «у вошедшего нет ни
   * одного полномочия» — пустой набор в обоих случаях, и единственный выход был
   * перезагрузить страницу.
   */
  it('propagates a failed query as isError, with a working refetch', () => {
    const mockRefetch = jest.fn();
    mockUseAdminCapabilitiesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });

    const { result } = renderHook(() => useCapabilities());

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.capabilities.size).toBe(0);

    result.current.refetch();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the resolved capabilities as a set, plus role, department id and name', () => {
    mockUseAdminCapabilitiesQuery.mockReturnValue({
      data: {
        capabilities: ['access:admin', 'read:users'],
        role: 'HEAD',
        departmentId: 'dept-1',
        departmentName: 'IT',
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useCapabilities());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.capabilities.has('access:admin')).toBe(true);
    expect(result.current.capabilities.has('manage:configs')).toBe(false);
    expect(result.current.role).toBe('HEAD');
    expect(result.current.departmentId).toBe('dept-1');
    expect(result.current.departmentName).toBe('IT');
  });
});
