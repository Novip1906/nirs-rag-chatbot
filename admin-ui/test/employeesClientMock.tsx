import React from 'react';
import { createLibrechatClientMock } from './adminClientMock';

export function createEmployeesClientMock(
  showToast: (...args: unknown[]) => void = () => undefined,
) {
  const base = createLibrechatClientMock(showToast);
  return {
    ...base,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
    Switch: ({
      id,
      checked,
      onCheckedChange,
      disabled,
      'aria-label': ariaLabel,
    }: {
      id?: string;
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
      disabled?: boolean;
      'aria-label'?: string;
    }) => (
      <input
        type="checkbox"
        role="switch"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    ),
    Checkbox: ({
      id,
      checked,
      disabled,
      onCheckedChange,
      'aria-label': ariaLabel,
    }: {
      id?: string;
      checked?: boolean;
      disabled?: boolean;
      onCheckedChange?: (checked: boolean) => void;
      'aria-label'?: string;
    }) => (
      <input
        type="checkbox"
        id={id}
        checked={checked === true}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
      />
    ),
    Alert: ({ children }: React.PropsWithChildren<unknown>) => <div role="alert">{children}</div>,
    Spinner: () => <div />,
    OGDialog: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) =>
      open === true ? <div role="dialog">{children}</div> : null,
    OGDialogContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    OGDialogHeader: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    OGDialogTitle: ({ children }: React.PropsWithChildren<unknown>) => <h2>{children}</h2>,
    OGDialogDescription: ({ children }: React.PropsWithChildren<unknown>) => <p>{children}</p>,
    OGDialogFooter: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  };
}
