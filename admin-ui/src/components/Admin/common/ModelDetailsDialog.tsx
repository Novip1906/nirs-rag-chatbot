import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import type { AdminModelOption } from '~/api';
import {
  buildAllModalityLabels,
  buildPricingDetails,
  formatContextLength,
} from '~/components/Admin/utils/modelMeta';
import { useLocalize } from '~/hooks';

interface ModelDetailsDialogProps {
  model: AdminModelOption;
  onOpenChange: (open: boolean) => void;
}

/**
 * Развёрнутая карточка модели — то, что не поместилось в строку списка (там —
 * только название, вендор, цена входа/выхода и значки картинок/файлов, список из
 * 313 моделей не резиновый). Здесь — длина контекста, полный прайс и служебный id
 * для обращений в поддержку.
 */
export default function ModelDetailsDialog({
  model,
  onOpenChange,
}: ModelDetailsDialogProps): JSX.Element {
  const localize = useLocalize();
  const pricingRows = buildPricingDetails(model.pricing, localize);
  const modalityLabels = buildAllModalityLabels(model, localize);

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogHeader>
          <OGDialogTitle>{model.label}</OGDialogTitle>
        </OGDialogHeader>
        <div className="space-y-4 px-6 pb-6">
          {model.vendor != null && model.vendor !== '' && (
            <p className="text-sm text-text-secondary">{model.vendor}</p>
          )}

          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
            <span className="text-sm text-text-secondary">
              {localize('com_admin_model_details_context_label')}
            </span>
            <span className="text-sm font-medium tabular-nums text-text-primary">
              {formatContextLength(model.contextLength, localize)}
            </span>
          </div>

          {modalityLabels.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-text-primary">
                {localize('com_admin_model_details_modalities_label')}
              </p>
              <p className="text-sm text-text-secondary">{modalityLabels.join(', ')}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-text-primary">
              {localize('com_admin_model_details_pricing_label')}
            </p>
            <ul className="divide-y divide-border-light rounded-lg border border-border-light">
              {pricingRows.map((row) => (
                <li
                  key={row.label}
                  className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                >
                  <span className="text-text-secondary">{row.label}</span>
                  <span className="tabular-nums text-text-primary">{row.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">
              {localize('com_admin_model_details_id_label')}
            </p>
            <p className="select-all break-all rounded-lg bg-surface-secondary px-3 py-1.5 font-mono text-xs text-text-secondary">
              {model.id}
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {localize('com_admin_action_close')}
            </Button>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
