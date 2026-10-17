import { useQuery } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type { UsageMeResponse } from './types';
import { UsageQueryKeys } from './keys';

const USAGE_ME_PATH = '/api/office/usage/me';

const getUsageMe = (): Promise<UsageMeResponse> => request.get<UsageMeResponse>(USAGE_ME_PATH);

export const useUsageMeQuery = (
  config?: UseQueryOptions<UsageMeResponse>,
): QueryObserverResult<UsageMeResponse> =>
  useQuery<UsageMeResponse>([UsageQueryKeys.usageMe], getUsageMe, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    ...config,
  });
