import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdminLimits } from '~/api';
import AiDepartmentForm from '../AiDepartmentForm';
import type { AiDepartmentFormValues } from '../AiDepartmentForm';

jest.mock('~/components/Admin/common/ModelAccess', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (next: { allowedModels: string[]; defaultModel: string | null }) => void;
  }) => (
    <button
      type="button"
      data-testid="model-access-fields"
      onClick={() => onChange({ allowedModels: ['m1', 'm2'], defaultModel: 'm2' })}
    />
  ),
}));

jest.mock('~/components/Admin/common/LimitsFields', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (next: AdminLimits) => void }) => (
    <button
      type="button"
      data-testid="limits-fields"
      onClick={() => onChange({ dailyCostUsd: 5 })}
    />
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => {
  const { createEmployeesClientMock } = jest.requireActual('test/employeesClientMock');
  return createEmployeesClientMock();
});

const EMPTY_LIMITS: AdminLimits = {
  dailyCostUsd: null,
};

function renderForm(overrides: Partial<AiDepartmentFormValues> = {}) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(
    <AiDepartmentForm
      initialValues={{
        systemPrompt: '',
        allowedModels: [],
        defaultModel: null,
        defaultLimits: EMPTY_LIMITS,
        ...overrides,
      }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isSaving={false}
    />,
  );
  return { onSubmit, onCancel, save: screen.getByRole('button', { name: 'com_admin_action_save' }) };
}

describe('AiDepartmentForm', () => {
  it('has no name field', () => {
    renderForm();

    expect(screen.queryByLabelText('com_admin_departments_field_name')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('com_admin_departments_field_description'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('com_admin_departments_field_prompt')).toBeInTheDocument();
  });

  it('lays out the prompt and the models and limits in two columns', () => {
    renderForm();

    const grid = screen.getByLabelText('com_admin_departments_field_prompt').closest('section')!
      .parentElement!;
    expect(grid).toHaveClass('grid', 'lg:grid-cols-2', 'max-w-6xl');
    expect(screen.getByTestId('model-access-fields').closest('section')).not.toBe(
      screen.getByLabelText('com_admin_departments_field_prompt').closest('section'),
    );
  });

  it('saves prompt models limits', () => {
    const { onSubmit, save } = renderForm();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_prompt'), {
      target: { value: 'Be precise.' },
    });
    fireEvent.click(screen.getByTestId('model-access-fields'));
    fireEvent.click(screen.getByTestId('limits-fields'));
    fireEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith({
      systemPrompt: 'Be precise.',
      allowedModels: ['m1', 'm2'],
      defaultModel: 'm2',
      defaultLimits: { dailyCostUsd: 5 },
    });
  });

  it('calls onCancel', () => {
    const { onCancel } = renderForm();

    fireEvent.click(screen.getByText('com_admin_action_cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('блокирует сохранение отдела с моделями и без дефолта', () => {
    const { save, onSubmit } = renderForm({ allowedModels: ['a'], defaultModel: null });

    expect(save).toBeDisabled();
    expect(screen.getByText('com_admin_default_model_required')).toBeInTheDocument();

    fireEvent.submit(save);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('не требует дефолта, когда список моделей пуст', () => {
    const { save } = renderForm();

    expect(save).not.toBeDisabled();
    expect(screen.queryByText('com_admin_default_model_required')).not.toBeInTheDocument();
  });
});
