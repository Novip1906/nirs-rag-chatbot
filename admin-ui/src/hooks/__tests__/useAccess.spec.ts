import { renderHook } from '@testing-library/react';
import { AxiosError } from 'axios';
import { useAccess } from '../useAccess';

const mockMe = jest.fn();
const mockCapabilities = jest.fn();

jest.mock('~/data-provider/Directory/queries', () => ({
  useDirectoryMeQuery: () => mockMe(),
}));

jest.mock('../useCapabilities', () => ({
  useCapabilities: () => mockCapabilities(),
}));

const refetch = jest.fn();

const refetchMe = jest.fn();

function me(partial: object) {
  mockMe.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMe,
    ...partial,
  });
}

function ai(partial: object) {
  mockCapabilities.mockReturnValue({
    capabilities: new Set<string>(),
    role: null,
    departmentId: null,
    departmentName: null,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
    ...partial,
  });
}

function statusError(status: number): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data: {},
  });
}

describe('useAccess', () => {
  it('admin with ai capabilities', () => {
    me({ data: { employee: null, is_admin: true } });
    ai({
      capabilities: new Set(['access:admin', 'read:users']),
      role: 'ADMIN',
      departmentId: 'd1',
    });

    const { result } = renderHook(() => useAccess());

    expect(result.current).toMatchObject({
      isAdmin: true,
      aiRole: 'ADMIN',
      aiDepartmentId: 'd1',
      canEnter: true,
      isLoading: false,
      aiError: false,
    });
    expect(result.current.aiCapabilities.has('read:users')).toBe(true);
  });

  it('head without admin flag', () => {
    me({ data: { employee: null, is_admin: false } });
    ai({ capabilities: new Set(['access:admin']), role: 'HEAD', departmentId: 'd1' });

    const { result } = renderHook(() => useAccess());

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canEnter).toBe(true);
    expect(result.current.aiRole).toBe('HEAD');
  });

  it('plain employee cannot enter', () => {
    me({ data: { employee: null, is_admin: false } });
    ai({ capabilities: new Set(), role: 'USER' });

    const { result } = renderHook(() => useAccess());

    expect(result.current.canEnter).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('admin enters when capabilities request fails', () => {
    me({ data: { employee: null, is_admin: true } });
    ai({ isError: true, error: statusError(503) });

    const { result } = renderHook(() => useAccess());

    expect(result.current.canEnter).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.aiError).toBe(true);

    result.current.refetchAi();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('treats a network failure without a response as an ai error', () => {
    me({ data: { employee: null, is_admin: true } });
    ai({ isError: true, error: new Error('Network Error') });

    const { result } = renderHook(() => useAccess());

    expect(result.current.aiError).toBe(true);
  });

  it('403 from ai is not an error', () => {
    me({ data: { employee: null, is_admin: true } });
    ai({ isError: true, error: statusError(403) });

    const { result } = renderHook(() => useAccess());

    expect(result.current.aiError).toBe(false);
    expect(result.current.aiCapabilities.size).toBe(0);
    expect(result.current.canEnter).toBe(true);
  });

  it('401 from ai is not an error', () => {
    me({ data: { employee: null, is_admin: false } });
    ai({ isError: true, error: statusError(401) });

    const { result } = renderHook(() => useAccess());

    expect(result.current.aiError).toBe(false);
    expect(result.current.canEnter).toBe(false);
  });

  it('is loading until the service answers', () => {
    me({ isLoading: true });
    ai({ isLoading: true });

    const { result } = renderHook(() => useAccess());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.canEnter).toBe(false);
  });

  it('does not wait for ai when the service already says admin', () => {
    me({ data: { employee: null, is_admin: true } });
    ai({ isLoading: true });

    const { result } = renderHook(() => useAccess());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.canEnter).toBe(true);
    expect(result.current.isAiLoading).toBe(true);
  });

  it('waits for ai while the service says not admin', () => {
    me({ data: { employee: null, is_admin: false } });
    ai({ isLoading: true });

    const { result } = renderHook(() => useAccess());

    expect(result.current.isLoading).toBe(true);
  });

  it('reports a directory error for a 5xx answer and exposes refetch', () => {
    me({ isError: true, error: statusError(503) });
    ai({ capabilities: new Set(), role: 'USER' });

    const { result } = renderHook(() => useAccess());

    expect(result.current.directoryError).toBe(true);
    expect(result.current.canEnter).toBe(false);
    expect(result.current.isLoading).toBe(false);

    result.current.refetchDirectory();
    expect(refetchMe).toHaveBeenCalledTimes(1);
  });

  it('reports a directory error for a network failure', () => {
    me({ isError: true, error: new Error('Network Error') });
    ai({});

    const { result } = renderHook(() => useAccess());

    expect(result.current.directoryError).toBe(true);
  });

  it('401 from directory is a directory error, not a non-admin', () => {
    me({ isError: true, error: statusError(401) });
    ai({});

    const { result } = renderHook(() => useAccess());

    expect(result.current.directoryError).toBe(true);
    expect(result.current.isAdmin).toBe(false);
  });

  it('403 from directory is a directory error', () => {
    me({ isError: true, error: statusError(403) });
    ai({});

    const { result } = renderHook(() => useAccess());

    expect(result.current.directoryError).toBe(true);
  });

  it.each([[undefined], ['yes'], [1], [null]])(
    'reports a directory error when is_admin is %p',
    (isAdmin) => {
      me({ data: { employee: null, is_admin: isAdmin } });
      ai({ capabilities: new Set(['access:admin']), role: 'ADMIN' });

      const { result } = renderHook(() => useAccess());

      expect(result.current.directoryError).toBe(true);
      expect(result.current.isAdmin).toBe(false);
    },
  );

  it('has no directory error when the service answers', () => {
    me({ data: { employee: null, is_admin: true } });
    ai({});

    const { result } = renderHook(() => useAccess());

    expect(result.current.directoryError).toBe(false);
  });
});
