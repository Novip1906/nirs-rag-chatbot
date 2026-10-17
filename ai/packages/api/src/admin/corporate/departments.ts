import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type { IDepartment, PartialLimits } from '@librechat/data-schemas';
import type { AdminUpdateDepartmentRequest } from 'librechat-data-provider';
import type { AdminDepartment } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { validateModelSelection } from './selection';
import { validatePartialLimits } from './limitsValidation';
import { toAdminLimits } from './serialize';

export interface DepartmentFieldsInput {
  systemPrompt?: string;
  allowedModels?: string[];
  defaultModel?: string | null;
  defaultLimits?: PartialLimits;
}

export interface CorporateDepartmentsDeps {
  listDepartments: () => Promise<IDepartment[]>;
  getDepartmentById: (id: string) => Promise<IDepartment | null>;
  updateDepartment: (id: string, fields: DepartmentFieldsInput) => Promise<IDepartment | null>;
}

const DEPARTMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIRECTORY_FIELDS_MESSAGE = 'This field is managed in the employee directory';

function toAdminDepartment(department: IDepartment): AdminDepartment {
  return {
    id: department._id.toString(),
    name: department.name,
    description: department.description,
    systemPrompt: department.systemPrompt ?? '',
    allowedModels: department.allowedModels,
    defaultModel: department.defaultModel ?? null,
    defaultLimits: toAdminLimits(department.defaultLimits),
    directoryId: department.directoryId ?? null,
    createdAt: department.createdAt?.toISOString() ?? new Date(0).toISOString(),
    updatedAt: department.updatedAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

export function createCorporateDepartmentsHandlers(deps: CorporateDepartmentsDeps): {
  listDepartments: (req: ServerRequest, res: Response) => Promise<Response>;
  updateDepartment: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function listDepartmentsHandler(req: ServerRequest, res: Response) {
    try {
      /**
       * Отдел — это сама единица разграничения, а не что-то ей принадлежащее: сузить
       * список «до одного отдела» этим методом нечем, а показывать главе чужие отделы
       * (их модели, лимиты, системный промпт) нельзя. Маршрут закрыт целиком.
       */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const departments = await deps.listDepartments();
      return res.status(200).json({ departments: departments.map(toAdminDepartment) });
    } catch (error) {
      logger.error('[corporateDepartments] listDepartments error:', error);
      return res.status(500).json({ error: 'Failed to list departments' });
    }
  }

  async function resolveDepartmentId(idParam: string): Promise<string | null | undefined> {
    if (isValidObjectIdString(idParam)) {
      return idParam;
    }
    if (!DEPARTMENT_ID_PATTERN.test(idParam)) {
      return undefined;
    }
    const departments = await deps.listDepartments();
    const found = departments.find((department) => department.directoryId === idParam);
    return found ? found._id.toString() : null;
  }

  async function updateDepartmentHandler(req: ServerRequest, res: Response) {
    try {
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { id: idParam } = req.params as { id: string };
      const id = await resolveDepartmentId(idParam);
      if (id === undefined) {
        return res.status(400).json({ error: 'Invalid department ID format' });
      }

      const body = req.body as AdminUpdateDepartmentRequest & {
        name?: string;
        description?: string;
      };
      const deniedFields = (['name', 'description'] as const).filter(
        (field) => body[field] !== undefined,
      );
      if (deniedFields.length > 0) {
        return res.status(400).json({
          error: DIRECTORY_FIELDS_MESSAGE,
          error_code: 'FIELD_NOT_EDITABLE',
          fields: deniedFields,
        });
      }
      if (id === null) {
        return res.status(404).json({ error: 'Department not found' });
      }

      const { systemPrompt, allowedModels, defaultModel, defaultLimits } = body;

      const touchesModels = allowedModels !== undefined || defaultModel !== undefined;
      const current = touchesModels ? await deps.getDepartmentById(id) : null;
      if (touchesModels && !current) {
        return res.status(404).json({ error: 'Department not found' });
      }

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

      const fields: DepartmentFieldsInput = {};
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

      let updated: IDepartment | null;
      try {
        updated = await deps.updateDepartment(id, fields);
      } catch (error) {
        logger.error('[corporateDepartments] updateDepartment error:', error);
        return res.status(500).json({ error: 'Failed to update department' });
      }
      if (!updated) {
        return res.status(404).json({ error: 'Department not found' });
      }

      return res.status(200).json({ department: toAdminDepartment(updated) });
    } catch (error) {
      logger.error('[corporateDepartments] updateDepartment error:', error);
      return res.status(500).json({ error: 'Failed to update department' });
    }
  }

  return {
    listDepartments: listDepartmentsHandler,
    updateDepartment: updateDepartmentHandler,
  };
}
