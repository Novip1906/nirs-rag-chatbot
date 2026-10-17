import * as React from 'react';
import { cn } from '../utils';

export interface SegmentedItem<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Обязателен для пункта без текстовой подписи — иначе кнопку нечем назвать. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /**
   * `tablist` — когда переключение меняет содержимое страницы, `radiogroup` — когда это
   * выбор значения настройки. Роль слышна скринридеру и задаёт разные ожидания: у вкладки
   * дальше по странице есть панель, у радиокнопки — нет.
   */
  role?: 'tablist' | 'radiogroup';
  size?: 'sm' | 'md';
  className?: string;
}

const sizeClasses = {
  sm: { item: 'px-2.5 py-1 text-xs', iconOnly: 'px-2 py-1', icon: 'size-3.5' },
  md: { item: 'px-3.5 py-1.5 text-sm', iconOnly: 'px-2.5 py-1.5', icon: 'size-4' },
} as const;

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  role = 'tablist',
  size = 'md',
  className,
}: SegmentedControlProps<T>): JSX.Element {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef(new Map<T, HTMLButtonElement>());
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);
  const itemKeys = items.map((item) => item.value).join(',');

  /**
   * Подсветка активного пункта — отдельный слой, который едет к кнопке, а не фон самой
   * кнопки: только так переключение видно как движение, а не как мгновенная перекраска.
   * Значит, её геометрию приходится мерить у настоящего DOM-узла — ширина зависит от
   * длины подписи, а та меняется и от языка, и от подгрузившегося шрифта.
   */
  React.useLayoutEffect(() => {
    const list = listRef.current;
    const active = itemRefs.current.get(value);
    if (list == null || active == null) {
      return;
    }
    const measure = () => {
      const left = active.offsetLeft;
      const width = active.offsetWidth;
      setIndicator((prev) =>
        prev != null && prev.left === left && prev.width === width ? prev : { left, width },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, itemKeys]);

  const moveTo = (index: number) => {
    const item = items[index];
    if (item == null) {
      return;
    }
    itemRefs.current.get(item.value)?.focus();
    onChange(item.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.value === value);
    if (current < 0) {
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo((current + 1) % items.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo((current - 1 + items.length) % items.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(items.length - 1);
    }
  };

  const classes = sizeClasses[size];

  return (
    <div
      ref={listRef}
      role={role}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative inline-flex items-center rounded-full border border-border-light bg-surface-secondary p-1',
        className,
      )}
    >
      {indicator != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1 left-0 top-1 rounded-full bg-surface-primary shadow-sm ring-1 ring-border-light transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:bg-surface-tertiary"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}
      {items.map((item) => {
        const isActive = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node == null) {
                itemRefs.current.delete(item.value);
              } else {
                itemRefs.current.set(item.value, node);
              }
            }}
            type="button"
            role={role === 'tablist' ? 'tab' : 'radio'}
            aria-selected={role === 'tablist' ? isActive : undefined}
            aria-checked={role === 'radiogroup' ? isActive : undefined}
            aria-label={item.ariaLabel}
            title={item.ariaLabel}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative z-10 flex items-center gap-1.5 rounded-full font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
              item.label == null ? classes.iconOnly : classes.item,
              isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {Icon != null && <Icon className={classes.icon} />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
