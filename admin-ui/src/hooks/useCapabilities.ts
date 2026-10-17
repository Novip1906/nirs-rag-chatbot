import { useMemo } from 'react';
import { useAdminCapabilitiesQuery } from '~/data-provider/Admin/capabilities';

export interface CapabilitiesState {
  capabilities: Set<string>;
  role: string | null;
  departmentId: string | null;
  departmentName: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

const EMPTY_CAPABILITIES = new Set<string>();

/**
 * Единая точка доступа к полномочиям вошедшего. Импортирует запрос напрямую из
 * `data-provider/Admin/capabilities`, а не через общий барель `data-provider/Admin` —
 * тот тянет мутации, которые сами используют `~/hooks`, и барель создал бы циклический
 * импорт с этим файлом.
 *
 * `isError`/`refetch` пробрасываются наружу, а не проглатываются: без этого отказ запроса
 * оставлял бы вызывающего с пустым набором — неотличимым от главы без единого полномочия —
 * и без способа повторить попытку, кроме перезагрузки страницы.
 */
export function useCapabilities(): CapabilitiesState {
  const query = useAdminCapabilitiesQuery();

  const capabilities = useMemo(
    () => (query.data != null ? new Set(query.data.capabilities) : EMPTY_CAPABILITIES),
    [query.data],
  );

  return {
    capabilities,
    role: query.data?.role ?? null,
    departmentId: query.data?.departmentId ?? null,
    departmentName: query.data?.departmentName ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
