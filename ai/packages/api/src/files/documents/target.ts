import { FetchTokenConfig } from 'librechat-data-provider';
import type { EndpointTokenConfig, ServerRequest } from '~/types';
import type { DocumentBudget } from './fit';
import { resolveUploadBudget, resolveDocumentModelTarget } from './fit';
import { getTokenConfigKey } from '~/endpoints/custom/initialize';
import { getCustomEndpointConfig } from '~/app/config';
import { tokenConfigCache } from '~/cache';

function fetchesTokenConfig(endpoint: string): boolean {
  const name = endpoint.toLowerCase();
  return Object.values(FetchTokenConfig).some((value) => value === name);
}

async function loadEndpointTokenConfig(
  req: ServerRequest,
  endpoint?: string,
): Promise<EndpointTokenConfig | undefined> {
  if (!endpoint || !req.config) {
    return undefined;
  }
  const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig: req.config });
  if (!endpointConfig) {
    return undefined;
  }
  if (endpointConfig.tokenConfig != null) {
    return endpointConfig.tokenConfig;
  }
  if (!fetchesTokenConfig(endpoint)) {
    return undefined;
  }
  const tokenKey = getTokenConfigKey(
    endpointConfig,
    endpoint,
    req.user?.id ?? '',
    req.user?.tenantId,
  );
  const cached: EndpointTokenConfig | undefined = await tokenConfigCache().get(tokenKey);
  return cached ?? undefined;
}

export async function resolveUploadDocumentBudget(
  req: ServerRequest,
): Promise<DocumentBudget | undefined> {
  const input = {
    spec: req.body?.spec,
    endpoint: req.body?.endpoint,
    model: req.body?.model,
    appConfig: req.config,
  };
  const target = resolveDocumentModelTarget(input);
  if (!target.model && target.maxContextTokens == null) {
    return undefined;
  }
  const tokenConfig = await loadEndpointTokenConfig(req, target.endpoint);
  return resolveUploadBudget({ ...input, tokenConfig });
}
