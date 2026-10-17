import { useCallback, useMemo } from 'react';
import { MultiSelect } from '@librechat/client';
import type { KnowledgeSpaceItem } from '~/api';
import { useKnowledgeSpacesQuery } from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';

const MAX_INLINE_SPACE_LABELS = 2;

interface SpacesMultiSelectProps {
  selectedValues: string[];
  setSelectedValues: (values: string[]) => void;
  label: string;
  placeholderKey: TranslationKeys;
  helperText?: string;
  disabled?: boolean;
  /** Ограничивает выбор конкретным подмножеством пространств вместо всего каталога. */
  spaces?: KnowledgeSpaceItem[];
}

export default function SpacesMultiSelect({
  selectedValues,
  setSelectedValues,
  label,
  placeholderKey,
  helperText,
  disabled = false,
  spaces: providedSpaces,
}: SpacesMultiSelectProps): JSX.Element {
  const localize = useLocalize();
  const spacesQuery = useKnowledgeSpacesQuery({ enabled: providedSpaces == null });

  const spaces = providedSpaces ?? spacesQuery.data ?? [];
  const items = useMemo(
    () => spaces.map((space) => ({ label: space.name, value: space.id })),
    [spaces],
  );
  const nameById = useMemo(() => new Map(spaces.map((space) => [space.id, space.name])), [spaces]);

  /**
   * Same reasoning as `ModelsMultiSelect`/`DepartmentsMultiSelect`: the default
   * "N items selected" summary comes from `@librechat/client` untranslated, and
   * `sameWidth` in Ariakit crops it further. Showing the real space names keeps the
   * admin from having to open the dropdown to see what's already selected.
   */
  const renderSelectedSpaces = useCallback(
    (values: string[], placeholderText?: string) => {
      if (values.length === 0) {
        return placeholderText;
      }
      const labels = values.map((id) => nameById.get(id) ?? id);
      if (labels.length <= MAX_INLINE_SPACE_LABELS) {
        return labels.join(', ');
      }
      return localize('com_admin_allowed_models_selected_more', {
        shown: labels.slice(0, MAX_INLINE_SPACE_LABELS).join(', '),
        count: labels.length - MAX_INLINE_SPACE_LABELS,
      });
    },
    [localize, nameById],
  );

  return (
    <div>
      <MultiSelect
        items={items}
        label={label}
        placeholder={localize(placeholderKey)}
        selectedValues={selectedValues}
        setSelectedValues={setSelectedValues}
        renderSelectedValues={renderSelectedSpaces}
        disabled={disabled}
        className="w-full"
        selectClassName="w-full"
        popoverClassName="!min-w-[20rem]"
      />
      {helperText != null && <p className="mt-1 text-xs text-text-secondary">{helperText}</p>}
    </div>
  );
}
