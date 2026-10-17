import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';
import type { UseMutationOptions } from '@tanstack/react-query';
import type { LimitRequestItem, LimitRequestResponse, RequestLimitBody } from './types';
import { UsageQueryKeys } from './keys';

const REQUEST_LIMIT_PATH = '/api/office/usage/request-limit';

const postRequestLimit = async (body: RequestLimitBody): Promise<LimitRequestItem> => {
  const response: LimitRequestResponse = await request.post(REQUEST_LIMIT_PATH, body);
  return response.request;
};

export const useRequestLimitMutation = (
  options?: UseMutationOptions<LimitRequestItem, Error, RequestLimitBody>,
) => {
  const queryClient = useQueryClient();
  return useMutation<LimitRequestItem, Error, RequestLimitBody>(postRequestLimit, {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries([UsageQueryKeys.usageMe]);
      options?.onSuccess?.(data, variables, context);
    },
  });
};
