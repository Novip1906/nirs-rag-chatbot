import { renderHook } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TStartupConfig, TEndpointsConfig } from 'librechat-data-provider';
import { useEndpoints } from '../useEndpoints';

const mockUseGetModelsQuery = jest.fn();
const mockUseGetEndpointsQuery = jest.fn();
const mockUseHasAccess = jest.fn();
const mockUseShowMarketplace = jest.fn();

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => mockUseGetModelsQuery(),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => mockUseGetEndpointsQuery(),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => mockUseHasAccess(),
  useShowMarketplace: () => mockUseShowMarketplace(),
}));

const ENDPOINTS_CONFIG: TEndpointsConfig = {
  [EModelEndpoint.google]: { order: 0 },
  [EModelEndpoint.custom]: { order: 1 },
};

function makeStartupConfig(
  modelSpecs?: Partial<NonNullable<TStartupConfig['modelSpecs']>>,
): TStartupConfig | undefined {
  return {
    modelSpecs: modelSpecs && { list: [], ...modelSpecs },
  } as TStartupConfig;
}

describe('useEndpoints — enforce hides raw endpoints', () => {
  beforeEach(() => {
    mockUseGetModelsQuery.mockReturnValue({
      data: { [EModelEndpoint.google]: ['gemini'], [EModelEndpoint.custom]: ['some-model-id'] },
    });
    mockUseGetEndpointsQuery.mockReturnValue({
      data: [EModelEndpoint.google, EModelEndpoint.custom],
    });
    mockUseHasAccess.mockReturnValue(true);
    mockUseShowMarketplace.mockReturnValue(false);
  });

  /**
   * Regression: `enforce: true` is meant to restrict the employee to the named model
   * specs. Before this fix, an empty `addedEndpoints` (the common case — nobody sets it
   * on purpose) fell through to "show every endpoint," so a raw custom-endpoint submenu
   * (e.g. "Corporate AI") reopened into the exact same models by id, defeating enforce.
   */
  it('hides every endpoint when enforce is true and addedEndpoints is empty', () => {
    const startupConfig = makeStartupConfig({ enforce: true });
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig: ENDPOINTS_CONFIG, startupConfig }),
    );

    expect(result.current.mappedEndpoints).toEqual([]);
  });

  it('hides every endpoint when enforce is true and addedEndpoints is unset', () => {
    const startupConfig = makeStartupConfig({ enforce: true, addedEndpoints: undefined });
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig: ENDPOINTS_CONFIG, startupConfig }),
    );

    expect(result.current.mappedEndpoints).toEqual([]);
  });

  /**
   * An explicit, non-empty `addedEndpoints` under `enforce: true` was requested on
   * purpose — "these endpoints too, alongside the specs" — and must keep working.
   */
  it('keeps exactly the listed endpoints when enforce is true and addedEndpoints is non-empty', () => {
    const startupConfig = makeStartupConfig({
      enforce: true,
      addedEndpoints: [EModelEndpoint.google],
    });
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig: ENDPOINTS_CONFIG, startupConfig }),
    );

    expect(result.current.mappedEndpoints.map((endpoint) => endpoint.value)).toEqual([
      EModelEndpoint.google,
    ]);
  });

  it('shows every endpoint when enforce is false, regardless of addedEndpoints', () => {
    const startupConfig = makeStartupConfig({ enforce: false });
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig: ENDPOINTS_CONFIG, startupConfig }),
    );

    expect(result.current.mappedEndpoints.map((endpoint) => endpoint.value)).toEqual([
      EModelEndpoint.google,
      EModelEndpoint.custom,
    ]);
  });

  it('preserves prior addedEndpoints filtering when enforce is not set at all', () => {
    const startupConfig = makeStartupConfig({ addedEndpoints: [EModelEndpoint.custom] });
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig: ENDPOINTS_CONFIG, startupConfig }),
    );

    expect(result.current.mappedEndpoints.map((endpoint) => endpoint.value)).toEqual([
      EModelEndpoint.custom,
    ]);
  });

  it('shows every endpoint when there is no modelSpecs config at all', () => {
    const startupConfig = makeStartupConfig(undefined);
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig: ENDPOINTS_CONFIG, startupConfig }),
    );

    expect(result.current.mappedEndpoints.map((endpoint) => endpoint.value)).toEqual([
      EModelEndpoint.google,
      EModelEndpoint.custom,
    ]);
  });
});
