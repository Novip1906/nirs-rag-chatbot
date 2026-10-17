import axios from 'axios';
import { useDirectoryMeQuery } from '~/data-provider/Directory/queries';
import { useCapabilities } from './useCapabilities';

export interface Access {
  isAdmin: boolean;
  aiCapabilities: Set<string>;
  aiRole: string | null;
  aiDepartmentId: string | null;
  canEnter: boolean;
  isLoading: boolean;
  isAiLoading: boolean;
  aiError: boolean;
  refetchAi: () => void;
  directoryError: boolean;
  refetchDirectory: () => void;
}

function isDenied(error: unknown): boolean {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status === 401 || status === 403;
}

export function useAccess(): Access {
  const me = useDirectoryMeQuery();
  const ai = useCapabilities();

  const isAdmin = me.data?.is_admin === true;
  const malformedMe = me.data != null && typeof me.data.is_admin !== 'boolean';
  const canEnter = isAdmin || ai.capabilities.has('access:admin');

  return {
    isAdmin,
    aiCapabilities: ai.capabilities,
    aiRole: ai.role,
    aiDepartmentId: ai.departmentId,
    canEnter,
    isLoading: me.isLoading || (!isAdmin && ai.isLoading),
    isAiLoading: ai.isLoading,
    aiError: ai.isError && !isDenied(ai.error),
    refetchAi: ai.refetch,
    directoryError: me.isError || malformedMe,
    refetchDirectory: () => {
      void me.refetch();
    },
  };
}
