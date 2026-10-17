import { useCallback, useMemo } from 'react';
import { useAdminModelsQuery } from '~/data-provider/Admin';

export function useModelLabel(enabled = true): (id: string) => string {
  const modelsQuery = useAdminModelsQuery({ enabled });

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of modelsQuery.data ?? []) {
      map.set(model.id, model.label);
    }
    return map;
  }, [modelsQuery.data]);

  return useCallback((id: string) => labelById.get(id) ?? id, [labelById]);
}

export function useModelLabelList(): (ids: string[]) => string {
  const getLabel = useModelLabel();
  return useCallback((ids: string[]) => ids.map(getLabel).join(', '), [getLabel]);
}
