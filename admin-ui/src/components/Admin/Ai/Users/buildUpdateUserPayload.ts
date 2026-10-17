import type { AdminLimits, AdminUpdateUserRequest } from '~/api';

export interface BuildUpdateUserPayloadInput {
  modelsTouched: boolean;
  modelsOverrideEnabled: boolean;
  selectedModels: string[];
  selectedDefaultModel: string | null;
  limitsTouched: boolean;
  limitsOverrideEnabled: boolean;
  limits: AdminLimits;
  spacesTouched: boolean;
  allowedSpaces: string[];
  deniedSpaces: string[];
  uploadTouched: boolean;
  canUploadKnowledge: boolean;
}

export function buildUpdateUserPayload(input: BuildUpdateUserPayloadInput): AdminUpdateUserRequest {
  const {
    modelsTouched,
    modelsOverrideEnabled,
    selectedModels,
    selectedDefaultModel,
    limitsTouched,
    limitsOverrideEnabled,
    limits,
    spacesTouched,
    allowedSpaces,
    deniedSpaces,
    uploadTouched,
    canUploadKnowledge,
  } = input;

  return {
    ...(modelsTouched
      ? {
          allowedModels: modelsOverrideEnabled ? selectedModels : null,
          defaultModel: modelsOverrideEnabled ? selectedDefaultModel : null,
        }
      : {}),
    ...(limitsTouched ? { limits: limitsOverrideEnabled ? limits : null } : {}),
    ...(spacesTouched ? { allowedSpaces, deniedSpaces } : {}),
    ...(uploadTouched ? { canUploadKnowledge } : {}),
  };
}
