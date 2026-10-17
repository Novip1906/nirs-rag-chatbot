import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdminSettings } from '~/api';
import PromptsView, { collectCapabilityModelIds } from '../PromptsView';

const mockUseAdminSettingsQuery = jest.fn();
const mockMutate = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminSettingsQuery: () => mockUseAdminSettingsQuery(),
  useAdminDepartmentsQuery: () => ({ data: [], isLoading: false, isError: false }),
  useUpdateAdminSettingsMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('~/components/Admin/common/ModelAccess', () => ({
  __esModule: true,
  default: () => <div data-testid="model-access-fields" />,
}));

jest.mock('~/components/Admin/common/ModelCapabilitiesFields', () => ({
  __esModule: true,
  default: () => <div data-testid="model-capabilities-fields" />,
}));

jest.mock('~/components/Admin/common/LimitsFields', () => ({
  __esModule: true,
  default: () => <div data-testid="limits-fields" />,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

const EMPTY_LIMITS = {
  dailyCostUsd: null,
};

function renderView(settings: AdminSettings) {
  mockUseAdminSettingsQuery.mockReturnValue({
    data: settings,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });

  render(
    <MemoryRouter>
      <PromptsView />
    </MemoryRouter>,
  );

  return screen.getByRole('button', { name: 'com_admin_action_save' });
}

describe('collectCapabilityModelIds', () => {
  it('adds models allowed by a department but absent from the global list', () => {
    const ids = collectCapabilityModelIds(['a'], [{ allowedModels: ['a', 'b'] }]);

    expect(ids).toEqual(['a', 'b']);
  });

  it('does not duplicate a model allowed both globally and by a department', () => {
    const ids = collectCapabilityModelIds(['a', 'b'], [{ allowedModels: ['b', 'c'] }]);

    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('returns the global list unchanged when there are no departments', () => {
    expect(collectCapabilityModelIds(['a'], [])).toEqual(['a']);
  });
});

describe('PromptsView', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('не даёт сохранить непустой список без дефолтной модели', () => {
    const save = renderView({
      systemPrompt: '',
      allowedModels: ['a'],
      defaultModel: null,
      defaultLimits: EMPTY_LIMITS,
      modelCapabilities: {},
    });

    expect(save).toBeDisabled();
    expect(screen.getByText('com_admin_default_model_required')).toBeInTheDocument();

    fireEvent.submit(save);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('отправляет дефолтную модель вместе со списком', () => {
    const save = renderView({
      systemPrompt: 'Промпт',
      allowedModels: ['a', 'b'],
      defaultModel: 'b',
      defaultLimits: EMPTY_LIMITS,
      modelCapabilities: {},
    });

    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ allowedModels: ['a', 'b'], defaultModel: 'b' }),
    );
  });

  it('не требует дефолта, когда глобальный список пуст', () => {
    const save = renderView({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: EMPTY_LIMITS,
      modelCapabilities: {},
    });

    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ allowedModels: [], defaultModel: null }),
    );
  });

  /**
   * Списком, а не картой: идентификатор модели в ключе объекта не доезжает до сервера —
   * защита от инъекций вырезает из тела запроса ключи с точкой, а она есть почти в каждом
   * идентификаторе модели.
   */
  it('отправляет настройки моделей списком, а не картой', () => {
    const save = renderView({
      systemPrompt: '',
      allowedModels: ['openai/gpt-5.6-luna'],
      defaultModel: 'openai/gpt-5.6-luna',
      defaultLimits: EMPTY_LIMITS,
      modelCapabilities: { 'openai/gpt-5.6-luna': { webSearch: false, description: 'Быстрая' } },
    });

    fireEvent.click(save);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelCapabilities: [
          { modelId: 'openai/gpt-5.6-luna', webSearch: false, description: 'Быстрая' },
        ],
      }),
    );
  });
});
