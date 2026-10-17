import React from 'react';

const TabsMockContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
}>({});

/**
 * Настоящая сборка `@librechat/client` тянет `@react-spring/web`, который в этом
 * чекауте отсюда не резолвится (давняя особенность окружения, см. `AdminLayout.spec.tsx`).
 * Примитивы сведены к обычным DOM-элементам, пробрасывающим `onClick`/`className`, —
 * ровно то, что проверяют тесты списка.
 */
export function createLibrechatClientMock(showToast: (...args: unknown[]) => void) {
  return {
    Table: ({ children }: React.PropsWithChildren<unknown>) => <table>{children}</table>,
    TableHeader: ({ children }: React.PropsWithChildren<unknown>) => <thead>{children}</thead>,
    TableBody: ({ children }: React.PropsWithChildren<unknown>) => <tbody>{children}</tbody>,
    TableRow: ({
      children,
      onClick,
      className,
    }: React.PropsWithChildren<{ onClick?: () => void; className?: string }>) => (
      <tr onClick={onClick} className={className}>
        {children}
      </tr>
    ),
    TableHead: ({ children }: React.PropsWithChildren<unknown>) => <th>{children}</th>,
    TableRowHeader: ({ children }: React.PropsWithChildren<unknown>) => <th>{children}</th>,
    TableCell: ({ children }: React.PropsWithChildren<unknown>) => <td>{children}</td>,
    Tag: ({ label }: { label: string }) => <span>{label}</span>,
    Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
      <label htmlFor={htmlFor}>{children}</label>
    ),
    Button: ({
      children,
      asChild,
      ...props
    }: React.PropsWithChildren<{ asChild?: boolean } & Record<string, unknown>>) =>
      asChild === true ? <>{children}</> : <button {...props}>{children}</button>,
    IconButton: ({
      children,
      label,
      onClick,
      disabled,
      title,
    }: React.PropsWithChildren<{
      label: string;
      onClick?: (event: React.MouseEvent) => void;
      disabled?: boolean;
      title?: string;
    }>) => (
      <button aria-label={label} onClick={onClick} disabled={disabled} title={title}>
        {children}
      </button>
    ),
    EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
    FilterInput: ({
      inputId,
      label,
      value,
      onChange,
    }: {
      inputId: string;
      label: string;
      value?: string;
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    }) => <input id={inputId} aria-label={label} value={value} onChange={onChange} />,
    /**
     * Radix Select сводится к нативному `<select>`. Идентификатор объявлен на триггере, а
     * `<label htmlFor>` ссылается именно на него, поэтому мок поднимает id с триггера на
     * сам `<select>` — иначе поле нельзя было бы найти по подписи.
     */
    Select: ({
      children,
      value,
      onValueChange,
    }: React.PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) => {
      const triggerId = React.Children.toArray(children).reduce<string | undefined>(
        (found, child) =>
          found ?? (React.isValidElement<{ id?: string }>(child) ? child.props.id : undefined),
        undefined,
      );
      return (
        <select
          id={triggerId}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: React.PropsWithChildren<unknown>) => <>{children}</>,
    SelectItem: ({ children, value }: React.PropsWithChildren<{ value: string }>) => (
      <option value={value}>{children}</option>
    ),
    /**
     * Radix связывает триггер со значением через контекст; мок повторяет ровно это, иначе
     * клик по вкладке ничего бы не менял и тест переключения был бы бессмысленным.
     */
    Tabs: ({
      children,
      value,
      onValueChange,
    }: React.PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) => (
      <TabsMockContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </TabsMockContext.Provider>
    ),
    TabsList: ({ children }: React.PropsWithChildren<{ 'aria-label'?: string }>) => (
      <div role="tablist">{children}</div>
    ),
    TabsTrigger: ({ children, value }: React.PropsWithChildren<{ value: string }>) => {
      const tabs = React.useContext(TabsMockContext);
      return (
        <button
          role="tab"
          aria-selected={tabs.value === value}
          onClick={() => tabs.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    useToastContext: () => ({ showToast }),
    AlertDialog: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) =>
      open === true ? <div role="alertdialog">{children}</div> : null,
    AlertDialogContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: React.PropsWithChildren<unknown>) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: React.PropsWithChildren<unknown>) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: React.PropsWithChildren<unknown>) => (
      <button>{children}</button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: React.PropsWithChildren<{ onClick?: () => void }>) => (
      <button onClick={onClick}>{children}</button>
    ),
  };
}
