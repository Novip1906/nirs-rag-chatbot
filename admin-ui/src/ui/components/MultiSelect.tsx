import React, { useMemo, useRef, useState } from 'react';
import {
  Select,
  SelectArrow,
  SelectItem,
  SelectItemCheck,
  SelectLabel,
  SelectPopover,
  SelectProvider,
} from '@ariakit/react';
import { matchSorter } from 'match-sorter';
import { Search } from 'lucide-react';
import './AnimatePopover.css';
import { JSX } from 'react/jsx-runtime';
import { cn } from '../utils';

export type MultiSelectItem<T extends string> = T | { label: string; value: T };

function getItemValue<T extends string>(item: MultiSelectItem<T>): T {
  return typeof item === 'string' ? item : item.value;
}

function getItemLabel<T extends string>(item: MultiSelectItem<T>): string {
  return typeof item === 'string' ? item : item.label;
}

interface MultiSelectProps<T extends string> {
  items: MultiSelectItem<T>[];
  label?: string;
  placeholder?: string;
  onSelectedValuesChange?: (values: T[]) => void;
  renderSelectedValues?: (
    values: T[],
    placeholder?: string,
    items?: MultiSelectItem<T>[],
  ) => React.ReactNode;
  className?: string;
  itemClassName?: string;
  labelClassName?: string;
  selectClassName?: string;
  selectIcon?: React.ReactNode;
  popoverClassName?: string;
  selectItemsClassName?: string;
  selectedValues: T[];
  setSelectedValues: (values: T[]) => void;
  /** Keeps the current selection visible while refusing edits, the way a disabled input does. */
  disabled?: boolean;
  renderItemContent?: (
    value: T,
    defaultContent: React.ReactNode,
    isSelected: boolean,
  ) => React.ReactNode;
  /** Показывает строку поиска над списком — для каталогов из сотен пунктов. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** По умолчанию поиск фильтрует по `label`; здесь можно добавить в него, например, вендора. */
  getItemSearchValue?: (item: MultiSelectItem<T>) => string;
  emptyStateText?: string;
}

function defaultRender<T extends string>(
  values: T[],
  placeholder?: string,
  items?: MultiSelectItem<T>[],
) {
  if (values.length === 0) {
    return placeholder || 'Select...';
  }
  if (values.length === 1) {
    // Find the item to get its label
    if (items) {
      const item = items.find((item) => getItemValue(item) === values[0]);
      if (item) {
        return getItemLabel(item);
      }
    }
    return values[0];
  }
  return `${values.length} items selected`;
}

export default function MultiSelect<T extends string>({
  items,
  label,
  placeholder = 'Select...',
  onSelectedValuesChange,
  renderSelectedValues = defaultRender,
  className,
  selectIcon,
  itemClassName,
  labelClassName,
  selectClassName,
  popoverClassName,
  selectItemsClassName,
  selectedValues = [],
  setSelectedValues,
  renderItemContent,
  disabled = false,
  searchable = false,
  searchPlaceholder,
  getItemSearchValue,
  emptyStateText = 'No results found',
}: MultiSelectProps<T>): JSX.Element {
  const selectRef = useRef<HTMLButtonElement>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const handleValueChange = (values: T[]) => {
    setSelectedValues(values);
    if (onSelectedValuesChange) {
      onSelectedValuesChange(values);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    if (!open) {
      setSearchValue('');
    }
  };

  const visibleItems = useMemo(() => {
    if (!searchable || searchValue.trim() === '') {
      return items;
    }
    return matchSorter(items, searchValue, {
      keys: [(item) => getItemSearchValue?.(item) ?? getItemLabel(item)],
    });
  }, [searchable, searchValue, items, getItemSearchValue]);

  return (
    <div className={className}>
      <SelectProvider
        value={selectedValues}
        setValue={handleValueChange}
        open={isPopoverOpen}
        setOpen={handleOpenChange}
      >
        {label && (
          <SelectLabel className={cn('mb-1 block text-sm text-text-primary', labelClassName)}>
            {label}
          </SelectLabel>
        )}
        <Select
          ref={selectRef}
          disabled={disabled}
          aria-disabled={disabled}
          className={cn(
            'flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm',
            'bg-surface-tertiary text-text-primary shadow-sm outline-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
            disabled
              ? 'cursor-not-allowed opacity-50'
              : 'hover:cursor-pointer hover:bg-surface-hover',
            selectClassName,
            selectedValues.length > 0 && selectItemsClassName != null && selectItemsClassName,
          )}
          onChange={(e) => e.stopPropagation()}
        >
          {selectIcon && <span>{selectIcon as React.JSX.Element}</span>}
          <span className="mr-auto block min-w-0 truncate text-left">
            {renderSelectedValues(selectedValues, placeholder, items)}
          </span>
          <SelectArrow
            className={cn(
              'ml-1 block shrink-0 stroke-1 text-base opacity-75 transition-transform duration-300',
              isPopoverOpen && 'rotate-180',
            )}
          />
        </Select>
        <SelectPopover
          gutter={4}
          sameWidth
          modal
          unmountOnHide
          finalFocus={selectRef}
          className={cn(
            'animate-popover z-40 flex max-h-[300px]',
            /* Сама popover-коробка больше не скроллится: иначе прилипшая шапка
               поиска прилипает к её padding-box, и верхний padding контейнера
               прокручивается вместе со списком, оставляя щель, сквозь которую
               просвечивает уже проскроллённый пункт. Скроллится только список
               пунктов ниже, шапка поиска — неподвижная соседняя часть колонки. */
            'flex-col overflow-hidden rounded-xl',
            'bg-surface-secondary text-text-primary shadow-lg',
            'border border-border-light',
            'outline-none',
            popoverClassName,
          )}
        >
          {searchable && (
            <div className="shrink-0 bg-surface-secondary px-1.5 pb-1.5 pt-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
                <input
                  autoFocus
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-lg border border-border-light bg-surface-primary py-1.5 pl-8 pr-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                />
              </div>
            </div>
          )}
          <div className="overflow-auto overscroll-contain px-1.5 pb-1.5 pt-1.5">
            {searchable && visibleItems.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-text-secondary">{emptyStateText}</div>
            )}
            {visibleItems.map((item) => {
              const value = getItemValue(item);
              const label = getItemLabel(item);
              const isCurrentItemSelected = selectedValues.includes(value);
              /*
                Отметка выбранного пункта — та же коробочка, что и у обычного чекбокса в
                формах: список с множественным выбором и набор чекбоксов делают одно и то
                же, и выглядеть они должны одинаково. Голая галочка вместо коробочки этого
                не показывает — по ней не видно, что не отмеченный пункт вообще отмечаем.
              */
              const defaultContent = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
                      isCurrentItemSelected
                        ? 'border-surface-submit bg-surface-submit text-text-on-status'
                        : 'border-border-medium bg-surface-primary',
                    )}
                  >
                    <SelectItemCheck className="text-current [&>svg]:size-3 [&>svg]:stroke-[3]" />
                  </span>
                  <span className="truncate">{label}</span>
                </>
              );
              return (
                <SelectItem
                  key={value}
                  value={value}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:cursor-pointer',
                    'scroll-m-1 outline-none transition-colors',
                    'hover:bg-surface-hover',
                    'data-[active-item]:bg-surface-active',
                    'w-full min-w-0 text-sm',
                    itemClassName,
                  )}
                >
                  {renderItemContent
                    ? (renderItemContent(
                        value,
                        defaultContent,
                        isCurrentItemSelected,
                      ) as React.JSX.Element)
                    : (defaultContent as React.JSX.Element)}
                </SelectItem>
              );
            })}
          </div>
        </SelectPopover>
      </SelectProvider>
    </div>
  );
}
