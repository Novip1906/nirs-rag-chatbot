import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import { apiBaseUrl, request } from '~/api';

export type TModelsConfig = Record<string, string[]>;

export const getModels = (): Promise<TModelsConfig> => request.get(`${apiBaseUrl()}/api/models`);

export const useModelsQuery = (
  config?: UseQueryOptions<TModelsConfig>,
): QueryObserverResult<TModelsConfig> =>
  useQuery<TModelsConfig>(['models'], getModels, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: Infinity,
    ...config,
  });
