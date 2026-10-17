import { useCallback, useMemo, useState } from 'react';
import { SelectItemCheck } from '@ariakit/react';
import { Image, Info, Paperclip } from 'lucide-react';
import { MultiSelect } from '@librechat/client';
import type { MultiSelectItem } from '@librechat/client';
import type { AdminModelOption } from '~/api';
import { useAdminModelsQuery } from '~/data-provider/Admin';
import { useModelLabel } from '~/components/Admin/utils/modelLabels';
import { formatModelPriceRow, getRowModalityFlags } from '~/components/Admin/utils/modelMeta';
import ModelDetailsDialog from '~/components/Admin/common/ModelDetailsDialog';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const MAX_INLINE_MODEL_LABELS = 2;
/** Стабильная ссылка на пустой массив — `data ?? []` создавал бы новый на каждый
 *  рендер и инвалидировал `useMemo` ниже, пока каталог ещё грузится. */
const EMPTY_CATALOG: AdminModelOption[] = [];

interface ModelsMultiSelectProps {
  selectedValues: string[];
  setSelectedValues: (values: string[]) => void;
  helperText?: string;
  disabled?: boolean;
}

/**
 * Выбранные модели идут первыми, а не по порядку каталога: список — сотни моделей, и
 * администратор, вернувшийся к уже настроенному набору, иначе искал бы свой выбор
 * прокруткой всего каталога.
 */
export function sortSelectedFirst(
  catalog: AdminModelOption[],
  selectedValues: string[],
): AdminModelOption[] {
  const selectedSet = new Set(selectedValues);
  const selected: AdminModelOption[] = [];
  const rest: AdminModelOption[] = [];
  for (const model of catalog) {
    (selectedSet.has(model.id) ? selected : rest).push(model);
  }
  return [...selected, ...rest];
}

export default function ModelsMultiSelect({
  selectedValues,
  setSelectedValues,
  helperText,
  disabled = false,
}: ModelsMultiSelectProps): JSX.Element {
  const localize = useLocalize();
  const modelsQuery = useAdminModelsQuery();
  const modelLabel = useModelLabel();
  const catalog = modelsQuery.data ?? EMPTY_CATALOG;
  const [detailsModelId, setDetailsModelId] = useState<string | null>(null);

  const modelById = useMemo(() => new Map(catalog.map((model) => [model.id, model])), [catalog]);
  const detailsModel = detailsModelId != null ? (modelById.get(detailsModelId) ?? null) : null;

  const items = useMemo(() => {
    const sorted = sortSelectedFirst(catalog, selectedValues);
    return sorted.map((model) => ({ label: model.label, value: model.id }));
  }, [catalog, selectedValues]);

  const getItemSearchValue = useCallback(
    (item: MultiSelectItem<string>) => {
      const label = typeof item === 'string' ? item : item.label;
      const value = typeof item === 'string' ? item : item.value;
      const vendor = modelById.get(value)?.vendor;
      return vendor ? `${label} ${vendor}` : label;
    },
    [modelById],
  );

  const openDetails = useCallback((event: React.SyntheticEvent, value: string) => {
    event.stopPropagation();
    setDetailsModelId(value);
  }, []);

  /**
   * Строка каталога — только то, что решает выбор среди 313 моделей: название,
   * вендор, значки принимаемых картинок/файлов и цена входа/выхода. Остальное
   * (контекст, полный прайс, id) — в `ModelDetailsDialog` по значку «подробнее».
   */
  const renderModelItem = useCallback(
    (value: string, defaultContent: React.ReactNode, isSelected: boolean) => {
      const model = modelById.get(value);
      if (!model) {
        return defaultContent;
      }
      const priceText = formatModelPriceRow(model.pricing, localize);
      const { image, file } = getRowModalityFlags(model);

      return (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
              isSelected
                ? 'border-surface-submit bg-surface-submit text-text-on-status'
                : 'border-border-medium bg-surface-primary',
            )}
          >
            <SelectItemCheck className="text-current [&>svg]:size-3 [&>svg]:stroke-[3]" />
          </span>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2 py-0.5">
            <span className="min-w-0">
              <span className="block truncate">{modelLabel(value)}</span>
              <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                {model.vendor != null && model.vendor !== '' && (
                  <span className="truncate">{model.vendor}</span>
                )}
                {image && (
                  <span
                    className="shrink-0"
                    title={localize('com_admin_allowed_models_modality_image')}
                  >
                    <Image className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                {file && (
                  <span
                    className="shrink-0"
                    title={localize('com_admin_allowed_models_modality_file')}
                  >
                    <Paperclip className="size-3.5" aria-hidden="true" />
                  </span>
                )}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="whitespace-nowrap text-xs font-medium tabular-nums text-text-primary">
                {priceText}
              </span>
              {/* `role="button"` on a span, not a nested `<button>`: this sits inside the
                  select option's own clickable row, and a real `<button>` would produce
                  invalid nested-interactive-content markup. */}
              <span
                role="button"
                tabIndex={0}
                aria-label={localize('com_admin_model_details_open')}
                className="rounded p-0.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                onClick={(event) => openDetails(event, value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openDetails(event, value);
                  }
                }}
              >
                <Info className="size-3.5" aria-hidden="true" />
              </span>
            </span>
          </span>
        </>
      );
    },
    [localize, modelById, modelLabel, openDetails],
  );

  /**
   * Replaces `MultiSelect`'s default "3 items selected" with the actual model names, so the
   * admin can tell what's selected without opening the dropdown. Falls back to a "+N" tail
   * once too many are selected to fit inline, rather than truncating names mid-word.
   */
  const renderSelectedModels = useCallback(
    (values: string[], placeholderText?: string) => {
      if (values.length === 0) {
        return placeholderText;
      }
      const labels = values.map(modelLabel);
      if (labels.length <= MAX_INLINE_MODEL_LABELS) {
        return labels.join(', ');
      }
      return localize('com_admin_allowed_models_selected_more', {
        shown: labels.slice(0, MAX_INLINE_MODEL_LABELS).join(', '),
        count: labels.length - MAX_INLINE_MODEL_LABELS,
      });
    },
    [localize, modelLabel],
  );

  return (
    <div>
      <MultiSelect
        items={items}
        label={localize('com_admin_allowed_models')}
        placeholder={localize('com_admin_allowed_models_placeholder')}
        selectedValues={selectedValues}
        setSelectedValues={setSelectedValues}
        renderSelectedValues={renderSelectedModels}
        renderItemContent={renderModelItem}
        searchable
        searchPlaceholder={localize('com_admin_allowed_models_search_placeholder')}
        getItemSearchValue={getItemSearchValue}
        emptyStateText={localize('com_admin_allowed_models_search_empty')}
        disabled={disabled}
        className="w-full"
        selectClassName="w-full"
        itemClassName="items-start"
        popoverClassName="!min-w-[28rem]"
      />
      {helperText != null && <p className="mt-1 text-xs text-text-secondary">{helperText}</p>}
      {detailsModel != null && (
        <ModelDetailsDialog
          model={detailsModel}
          onOpenChange={(open) => {
            if (!open) {
              setDetailsModelId(null);
            }
          }}
        />
      )}
    </div>
  );
}
