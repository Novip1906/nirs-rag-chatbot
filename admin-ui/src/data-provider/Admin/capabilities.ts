import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import { apiBaseUrl, request } from '~/api';
import type { AdminCapabilitiesResponse } from '~/api';
import { adminKeys } from './keys';
import { retrySkipping4xx } from '../retry';

const CAPABILITIES_TIMEOUT_MS = 15_000;

export const getAdminCapabilities = (): Promise<AdminCapabilitiesResponse> =>
  request.get(`${apiBaseUrl()}/api/office/admin/me/capabilities`, { timeout: CAPABILITIES_TIMEOUT_MS });

export const useAdminCapabilitiesQuery = (
  config?: UseQueryOptions<AdminCapabilitiesResponse>,
): QueryObserverResult<AdminCapabilitiesResponse> =>
  useQuery<AdminCapabilitiesResponse>(adminKeys.capabilities, getAdminCapabilities, {
    refetchOnWindowFocus: false,
    retry: retrySkipping4xx,
    ...config,
  });
