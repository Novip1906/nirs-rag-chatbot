import React from 'react';

/**
 * Общий мок `@librechat/client` для тестов `UserEditPage` — здесь важна форма, а не
 * поведение Ariakit-примитивов. Вынесен из `UserEditPage.spec.tsx` и
 * `UserEditPage.head.spec.tsx`: оба рендерят один и тот же компонент целиком и раньше
 * держали по копии одного и того же мока.
 */
export function mockAiUserEditPageLibrechatClient(
  showToast: (...args: unknown[]) => void = () => undefined,
) {
  const ReactActual = jest.requireActual('react');
  return {
    useToastContext: () => ({ showToast }),
    AlertDialog: ({ open, children }: React.PropsWithChildren<{ open: boolean }>) =>
      open ? <div>{children}</div> : null,
    AlertDialogContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: React.PropsWithChildren<unknown>) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: React.PropsWithChildren<unknown>) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: React.PropsWithChildren<unknown>) => (
      <button type="button">{children}</button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: React.PropsWithChildren<{ onClick?: () => void }>) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    Button: ({
      children,
      asChild,
      ...props
    }: React.PropsWithChildren<{ asChild?: boolean } & Record<string, unknown>>) =>
      asChild === true ? <>{children}</> : <button {...props}>{children}</button>,
    Label: ({
      children,
      htmlFor,
      id,
    }: React.PropsWithChildren<{ htmlFor?: string; id?: string }>) => (
      <label htmlFor={htmlFor} id={id}>
        {children}
      </label>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Select: ({
      children,
      value,
      onValueChange,
      disabled,
    }: React.PropsWithChildren<{
      value?: string;
      onValueChange?: (value: string) => void;
      disabled?: boolean;
    }>) => {
      const triggerId = ReactActual.Children.toArray(children).reduce(
        (found: string | undefined, child: React.ReactNode) =>
          found ??
          (ReactActual.isValidElement(child)
            ? (child as React.ReactElement<{ id?: string }>).props.id
            : undefined),
        undefined,
      );
      return (
        <select
          id={triggerId}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: React.PropsWithChildren<unknown>) => <>{children}</>,
    SelectItem: ({
      children,
      value,
      disabled,
    }: React.PropsWithChildren<{ value: string; disabled?: boolean }>) => (
      <option value={value} disabled={disabled}>
        {children}
      </option>
    ),
    Switch: ({
      id,
      checked,
      onCheckedChange,
      disabled,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
    }: {
      id?: string;
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
      disabled?: boolean;
      'aria-label'?: string;
      'aria-labelledby'?: string;
    }) => (
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    ),
    Alert: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div role="alert" {...props}>
        {children}
      </div>
    ),
    Spinner: ({ className }: { className?: string }) => <div className={className} />,
    Checkbox: ({
      checked,
      disabled,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean;
      disabled?: boolean;
      onCheckedChange?: (checked: boolean) => void;
      'aria-label'?: string;
    }) => (
      <input
        type="checkbox"
        checked={checked === true}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        {...props}
      />
    ),
  };
}
