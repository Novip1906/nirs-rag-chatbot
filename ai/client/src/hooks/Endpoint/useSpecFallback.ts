import { useRef, useEffect } from 'react';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';

export interface SpecSelection {
  endpoint?: string | null;
  model?: string | null;
  spec?: string | null;
}

/**
 * Спеки приходят с сервера уже отфильтрованными по политике пользователя, поэтому
 * выбор беседы, которого в списке нет, — это модель, доступ к которой отозвали.
 * Дефолт ищется в том же порядке, что и `getDefaultModelSpec`: явный флаг политики,
 * затем мягкий дефолт конфига, затем первый доступный спек.
 */
export function resolveFallbackSpec(
  modelSpecs: TModelSpec[],
  selection: SpecSelection,
  enforced: boolean,
): TModelSpec | null {
  if (modelSpecs.length === 0) {
    return null;
  }
  if (isAgentsEndpoint(selection.endpoint) || isAssistantsEndpoint(selection.endpoint)) {
    return null;
  }

  const spec = selection.spec ?? '';
  if (spec !== '') {
    if (modelSpecs.some((modelSpec) => modelSpec.name === spec)) {
      return null;
    }
  } else {
    const model = selection.model ?? '';
    if (!enforced || model === '') {
      return null;
    }
    if (modelSpecs.some((modelSpec) => modelSpec.preset?.model === model)) {
      return null;
    }
  }

  return (
    modelSpecs.find((modelSpec) => modelSpec.default) ??
    modelSpecs.find((modelSpec) => modelSpec.softDefault) ??
    modelSpecs[0]
  );
}

export default function useSpecFallback({
  modelSpecs,
  enforced,
  selection,
  selectSpec,
}: {
  modelSpecs: TModelSpec[];
  enforced: boolean;
  selection: SpecSelection;
  selectSpec: (spec: TModelSpec) => void;
}) {
  const appliedRef = useRef<string | null>(null);
  const { endpoint, model, spec } = selection;

  useEffect(() => {
    if (!endpoint) {
      return;
    }

    const fallback = resolveFallbackSpec(modelSpecs, { endpoint, model, spec }, enforced);
    if (!fallback) {
      appliedRef.current = null;
      return;
    }

    const attempt = `${spec ?? ''}|${model ?? ''}`;
    if (appliedRef.current === attempt) {
      return;
    }
    appliedRef.current = attempt;
    selectSpec(fallback);
  }, [modelSpecs, enforced, endpoint, model, spec, selectSpec]);
}
