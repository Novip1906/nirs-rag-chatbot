import { useCallback } from 'react';
import {
  Label,
  Select,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
} from '@librechat/client';
import { useAdminModelsQuery } from '~/data-provider/Admin';
import ModelsMultiSelect from '~/components/Admin/common/ModelsMultiSelect';
import { useLocalize } from '~/hooks';

export interface ModelSelectionValue {
  allowedModels: string[];
  defaultModel: string | null;
}

interface ModelAccessFieldsProps {
  idPrefix: string;
  allowedModels: string[];
  defaultModel: string | null;
  /**
   * Единая точка записи вместо пары `setAllowedModels`/`setDefaultModel`: список моделей и
   * дефолт меняются вместе (см. `reconcileDefaultModel`), а два отдельных сеттера, пишущих
   * в один и тот же внешний объект-черновик, читают его из одного и того же замыкания —
   * второй вызов в обработчике перезаписывает то, что успел сделать первый (React батчит
   * оба `setState` в одном событии, и побеждает последний). Один вызов на одно действие
   * пользователя убирает саму возможность так наступить.
   */
  onChange: (next: ModelSelectionValue) => void;
  helperText?: string;
  defaultHelperText?: string;
  disabled?: boolean;
}

/**
 * Дефолт обязателен ровно тогда, когда список непустой, — то же правило, что и в
 * `validateModelSelection` на бэкенде. Держит выбор внутри списка: администратор снимает
 * галочку с модели, которая была дефолтом, и без этого форма молча уехала бы в состояние,
 * которое сервер отвергнет.
 */
export function reconcileDefaultModel(
  allowedModels: string[],
  defaultModel: string | null,
): string | null {
  if (allowedModels.length === 0) {
    return null;
  }
  if (defaultModel != null && allowedModels.includes(defaultModel)) {
    return defaultModel;
  }
  return allowedModels[0];
}

export default function ModelAccessFields({
  idPrefix,
  allowedModels,
  defaultModel,
  onChange,
  helperText,
  defaultHelperText,
  disabled = false,
}: ModelAccessFieldsProps): JSX.Element {
  const localize = useLocalize();
  const modelsQuery = useAdminModelsQuery();
  const catalog = modelsQuery.data ?? [];

  const handleAllowedChange = useCallback(
    (values: string[]) => {
      onChange({ allowedModels: values, defaultModel: reconcileDefaultModel(values, defaultModel) });
    },
    [defaultModel, onChange],
  );

  const handleDefaultChange = useCallback(
    (value: string) => {
      /*
       * У Radix `Select` есть скрытый нативный `<select>` для автозаполнения и сброса
       * формы; при смене набора `option`/`disabled` (ровно то, что происходит при
       * включении тумблера «Личный список моделей») он может прислать нативный change
       * с пустым `value` ещё до того, как управляемое значение устоится. Пустая строка
       * никогда не бывает валидным выбором — ни один `SelectItem` не может иметь такой
       * `value` (Radix сам бросает исключение), а значения ниже всегда рендерятся из
       * `allowedModels`. Записывать такой сброс — значит молча стирать унаследованный
       * или уже выбранный дефолт до пустой строки.
       */
      if (!allowedModels.includes(value)) {
        return;
      }
      onChange({ allowedModels, defaultModel: value });
    },
    [allowedModels, onChange],
  );

  const options = catalog.filter((model) => allowedModels.includes(model.id));
  const selectId = `${idPrefix}-default-model`;
  /**
   * Radix Select определяет текст триггера, сопоставляя `value` с примонтированными
   * `SelectItem`, и делает это только при смене `value`. Каталог моделей приезжает
   * отдельным запросом: смонтировать селект раньше него — значит показать плейсхолдер
   * поверх уже выбранной модели и не восстановиться, когда элементы наконец появятся.
   * Поэтому селект ждёт каталог, чтобы значение и элементы монтировались вместе.
   */
  const catalogLoaded = modelsQuery.data != null;

  return (
    <div className="space-y-4">
      <ModelsMultiSelect
        selectedValues={allowedModels}
        setSelectedValues={handleAllowedChange}
        helperText={helperText}
        disabled={disabled}
      />
      <div className="space-y-1.5">
        <Label htmlFor={selectId}>
          {localize('com_admin_default_model')}
          <span aria-hidden="true" className="ml-0.5 text-text-secondary">
            *
          </span>
        </Label>
        {catalogLoaded ? (
          <Select
            value={defaultModel ?? ''}
            onValueChange={handleDefaultChange}
            disabled={disabled || options.length === 0}
          >
            <SelectTrigger id={selectId} aria-label={localize('com_admin_default_model')}>
              <SelectValue placeholder={localize('com_admin_default_model_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div
            className="h-9 w-full animate-pulse rounded-md bg-surface-secondary"
            aria-hidden="true"
          />
        )}
        {(defaultHelperText != null || (catalogLoaded && options.length === 0)) && (
          <p className="text-xs text-text-secondary">
            {catalogLoaded && options.length === 0
              ? localize('com_admin_default_model_needs_models')
              : defaultHelperText}
          </p>
        )}
      </div>
    </div>
  );
}
