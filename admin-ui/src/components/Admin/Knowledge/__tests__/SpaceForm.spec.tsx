import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SpaceForm from '../SpaceForm';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/Admin/common/DepartmentsMultiSelect', () => ({
  __esModule: true,
  default: ({ selectedValues }: { selectedValues: string[] }) => (
    <div data-testid="departments-multi-select">{selectedValues.join(',')}</div>
  ),
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

const EMPTY_VALUES = {
  name: '',
  description: '',
  allowedDepartments: [] as string[],
  enabled: true,
};

function renderForm(headDepartmentId: string | null = null, headDepartmentName: string | null = null) {
  const onSubmit = jest.fn();
  render(
    <SpaceForm
      initialValues={EMPTY_VALUES}
      isSaving={false}
      onCancel={jest.fn()}
      onSubmit={onSubmit}
      headDepartmentId={headDepartmentId}
      headDepartmentName={headDepartmentName}
    />,
  );
  return { onSubmit };
}

describe('SpaceForm — admin/владелец (headDepartmentId = null)', () => {
  it('показывает многозначный выбор отделов', () => {
    renderForm(null);

    expect(screen.getByTestId('departments-multi-select')).toBeInTheDocument();
  });

  it('отправляет allowedDepartments вместе с остальными полями', () => {
    const { onSubmit } = renderForm(null);

    fireEvent.change(screen.getByLabelText('com_admin_knowledge_field_name'), {
      target: { value: 'Общее' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_action_save' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Общее', allowedDepartments: [] }),
    );
  });
});

/**
 * Название отдела приходит через проп `headDepartmentName`, а не через
 * `useAdminDepartmentsQuery` — этот запрос требует админ-уровня и главе всегда отвечает
 * 403 (см. `packages/api/src/admin/corporate/departments.ts`), так что раньше сюда никогда
 * не приходило ни одного отдела и глава видела сырой id вместо названия.
 */
describe('SpaceForm — глава отдела (headDepartmentId задан)', () => {
  it('не показывает многозначный выбор отделов, а показывает название своего отдела статично', () => {
    renderForm('dept-1', 'Юридический');

    expect(screen.queryByTestId('departments-multi-select')).not.toBeInTheDocument();
    expect(screen.getByText('Юридический')).toBeInTheDocument();
    expect(screen.queryByText('dept-1')).not.toBeInTheDocument();
  });

  it('не отправляет allowedDepartments вовсе — сервер сам решает, что с ним делать', () => {
    const { onSubmit } = renderForm('dept-1', 'Юридический');

    fireEvent.change(screen.getByLabelText('com_admin_knowledge_field_name'), {
      target: { value: 'Отдел продаж' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_action_save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted).not.toHaveProperty('allowedDepartments');
    expect(submitted).toEqual(expect.objectContaining({ name: 'Отдел продаж' }));
  });

  it('падает обратно на id отдела, если название ещё не подгрузилось (капабилити ещё загружаются)', () => {
    renderForm('dept-unknown', null);

    expect(screen.getByText('dept-unknown')).toBeInTheDocument();
  });
});
