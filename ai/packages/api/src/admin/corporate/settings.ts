import { logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type {
  ICorporateSettings,
  ModelCapabilitiesMap,
  PartialLimits,
} from '@librechat/data-schemas';
import type { AdminUpdateSettingsRequest, AdminSettings } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { validateModelSelection } from './selection';
import { validatePartialLimits } from './limitsValidation';
import { validateModelCapabilities } from './modelCapabilitiesValidation';
import { toAdminLimits } from './serialize';

export interface SettingsFieldsInput {
  systemPrompt?: string;
  allowedModels?: string[];
  defaultModel?: string | null;
  defaultLimits?: PartialLimits;
  modelCapabilities?: ModelCapabilitiesMap;
}

export interface CorporateSettingsDeps {
  getGlobalSettings: () => Promise<ICorporateSettings>;
  updateGlobalSettings: (fields: SettingsFieldsInput) => Promise<ICorporateSettings>;
}

function toAdminSettings(settings: ICorporateSettings): AdminSettings {
  return {
    systemPrompt: settings.systemPrompt,
    allowedModels: settings.allowedModels,
    defaultModel: settings.defaultModel ?? null,
    defaultLimits: toAdminLimits(settings.defaultLimits),
    modelCapabilities: settings.modelCapabilities ?? {},
  };
}

export function createCorporateSettingsHandlers(deps: CorporateSettingsDeps): {
  getSettings: (req: ServerRequest, res: Response) => Promise<Response>;
  updateSettings: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function getSettingsHandler(req: ServerRequest, res: Response) {
    try {
      /** Глобальные настройки не принадлежат отделу — сузить нечего, маршрут закрыт целиком. */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const settings = await deps.getGlobalSettings();
      return res.status(200).json({ settings: toAdminSettings(settings) });
    } catch (error) {
      logger.error('[corporateSettings] getSettings error:', error);
      return res.status(500).json({ error: 'Failed to load settings' });
    }
  }

  async function updateSettingsHandler(req: ServerRequest, res: Response) {
    try {
      /** Как и чтение — правка общих настроек вне capability главы. */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { systemPrompt, allowedModels, defaultModel, defaultLimits, modelCapabilities } =
        req.body as AdminUpdateSettingsRequest;

      const current =
        allowedModels !== undefined || defaultModel !== undefined
          ? await deps.getGlobalSettings()
          : null;
      const selection = validateModelSelection(
        { allowedModels, defaultModel },
        {
          allowedModels: current?.allowedModels ?? null,
          defaultModel: current?.defaultModel ?? null,
        },
      );
      if (!selection.ok) {
        return res.status(400).json({ error: selection.error });
      }

      const fields: SettingsFieldsInput = {};
      if (systemPrompt !== undefined) {
        fields.systemPrompt = systemPrompt;
      }
      if (selection.fields.allowedModels != null) {
        fields.allowedModels = selection.fields.allowedModels;
      }
      if (selection.fields.defaultModel !== undefined) {
        fields.defaultModel = selection.fields.defaultModel;
      }
      if (defaultLimits !== undefined) {
        const validation = validatePartialLimits(defaultLimits);
        if (!validation.ok) {
          return res.status(400).json({ error: validation.error });
        }
        fields.defaultLimits = validation.limits;
      }
      if (modelCapabilities !== undefined) {
        const validation = validateModelCapabilities(modelCapabilities);
        if (!validation.ok) {
          return res.status(400).json({ error: validation.error });
        }
        fields.modelCapabilities = validation.capabilities;
      }

      const updated = await deps.updateGlobalSettings(fields);
      return res.status(200).json({ settings: toAdminSettings(updated) });
    } catch (error) {
      logger.error('[corporateSettings] updateSettings error:', error);
      return res.status(500).json({ error: 'Failed to update settings' });
    }
  }

  return {
    getSettings: getSettingsHandler,
    updateSettings: updateSettingsHandler,
  };
}
