import axios from 'axios';

export const retrySkipping4xx = (failureCount: number, error: unknown): boolean => {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status != null && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 2;
};
