import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ModelAccessFields, { reconcileDefaultModel } from '../ModelAccess';

const mockUseAdminModelsQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminModelsQuery: () => mockUseAdminModelsQuery(),
}));

/**
 * Не голая заглушка: кнопка дальше зовёт `setSelectedValues` так же, как реальный
 * `MultiSelect` при клике по пункту — иначе тест ниже не проходил бы через
 * `handleAllowedChange` и не заметил бы регрессию с затиранием выбора.
 */
jest.mock('~/components/Admin/common/ModelsMultiSelect', () => ({
  __esModule: true,
  default: ({
    selectedValues,
    setSelectedValues,
  }: {
    selectedValues: string[];
    setSelectedValues: (values: string[]) => void;
  }) => (
    <div data-testid="models-multiselect">
      <button type="button" onClick={() => setSelectedValues([...selectedValues, 'a'])}>
        select a
      </button>
    </div>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => {
  const mockReact = jest.requireActual<typeof React>('react');
  return {
    Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) =>
      mockReact.createElement('label', { htmlFor }, children),
    /**
     * Кнопка «fire empty value change» — не выдумка: у Radix `Select` есть скрытый
     * нативный `<select>` для автозаполнения и сброса формы, и при смене набора
     * `option`/`disabled` (ровно то, что происходит при включении тумблера «Личный
     * список») он может прислать нативный `change` с пустым `value` ещё до того, как
     * управляемое значение устоится. Кнопка ниже воспроизводит именно этот вызов
     * `onValueChange('')`, а не выбор пользователем несуществующего пункта.
     */
    Select: ({
      value,
      disabled,
      onValueChange,
      children,
    }: React.PropsWithChildren<{
      value: string;
      disabled?: boolean;
      onValueChange?: (value: string) => void;
    }>) =>
      mockReact.createElement(
        'div',
        {
          'data-testid': 'default-model-select',
          'data-value': value,
          'data-disabled': disabled === true,
        },
        children,
        mockReact.createElement(
          'button',
          { type: 'button', onClick: () => onValueChange?.('') },
          'fire empty value change',
        ),
      ),
    SelectTrigger: ({ children }: React.PropsWithChildren<unknown>) => children,
    SelectValue: () => null,
    SelectContent: ({ children }: React.PropsWithChildren<unknown>) => children,
    SelectItem: ({ value, children }: React.PropsWithChildren<{ value: string }>) =>
      mockReact.createElement(
        'div',
        { 'data-testid': 'select-item', 'data-value': value },
        children,
      ),
  };
});

const CATALOG = [
  { id: 'a', label: 'Model A', description: '' },
  { id: 'b', label: 'Model B', description: '' },
];

function renderFields(
  modelsData: typeof CATALOG | undefined,
  allowedModels: string[],
  defaultModel: string | null,
  onChange: jest.Mock = jest.fn(),
) {
  mockUseAdminModelsQuery.mockReturnValue({ data: modelsData });
  render(
    <ModelAccessFields
      idPrefix="admin-settings"
      allowedModels={allowedModels}
      defaultModel={defaultModel}
      onChange={onChange}
      defaultHelperText="helper"
    />,
  );
}

describe('reconcileDefaultModel', () => {
  it('сбрасывает дефолт, когда список опустел', () => {
    expect(reconcileDefaultModel([], 'a')).toBeNull();
  });

  it('оставляет дефолт, который всё ещё в списке', () => {
    expect(reconcileDefaultModel(['a', 'b'], 'b')).toBe('b');
  });

  it('переключает на первую модель, когда дефолт выпал из списка', () => {
    expect(reconcileDefaultModel(['b', 'c'], 'a')).toBe('b');
  });

  it('подставляет первую модель, когда дефолта не было', () => {
    expect(reconcileDefaultModel(['b', 'c'], null)).toBe('b');
  });
});

describe('ModelAccessFields', () => {
  /**
   * Radix сопоставляет `value` с примонтированными `SelectItem` только при смене `value`.
   * Селект, показанный раньше каталога, залипает на плейсхолдере поверх уже сохранённой
   * модели — ровно то, что ломало /admin/prompts после перезагрузки страницы.
   */
  it('не монтирует селект, пока каталог моделей не загружен', () => {
    renderFields(undefined, ['a'], 'a');

    expect(screen.queryByTestId('default-model-select')).not.toBeInTheDocument();
    expect(screen.queryByText('com_admin_default_model_needs_models')).not.toBeInTheDocument();
  });

  it('монтирует значение и его элемент вместе, когда каталог загружен', () => {
    renderFields(CATALOG, ['a'], 'a');

    const select = screen.getByTestId('default-model-select');
    expect(select).toHaveAttribute('data-value', 'a');
    expect(screen.getByTestId('select-item')).toHaveAttribute('data-value', 'a');
  });

  it('подсказывает выбрать модели, когда каталог загружен, но список пуст', () => {
    renderFields(CATALOG, [], null);

    expect(screen.getByText('com_admin_default_model_needs_models')).toBeInTheDocument();
    expect(screen.getByTestId('default-model-select')).toHaveAttribute('data-disabled', 'true');
    expect(screen.queryByTestId('select-item')).not.toBeInTheDocument();
  });

  /**
   * Регрессия на прод-баг: `allowedModels` и `defaultModel` менялись двумя отдельными
   * сеттерами вызывающей стороны (`UserEditPage`), оба закрытые над одним и тем же
   * `models.value` — второй вызов перезаписывал то, что только что записал первый, и
   * список моделей в форме не менялся вообще. `onChange` собирает оба поля в один вызов,
   * так что такая гонка структурно невозможна.
   */
  it('выбор модели за один клик уходит одним вызовом onChange с обоими полями', () => {
    const onChange = jest.fn();
    renderFields(CATALOG, [], null, onChange);

    fireEvent.click(screen.getByText('select a'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ allowedModels: ['a'], defaultModel: 'a' });
  });

  /**
   * Регрессия на прод-баг: скрытый нативный `<select>` внутри Radix `Select` шлёт
   * `onValueChange('')` при смене набора `option`/`disabled` (ровно момент включения
   * тумблера «Личный список моделей»). Ни один реальный `SelectItem` не может иметь
   * пустой `value` (Radix сам бросает исключение при попытке), так что значение,
   * которого нет в `allowedModels`, — заведомо не выбор пользователя, а такой сброс.
   * Раньше `handleDefaultChange` писал его как есть, стирая унаследованный дефолт
   * до пустой строки: `defaultModel: ''` уходил на сервер и падал 400-кой, а
   * `defaultModel == null` в UserEditPage не ловил пустую строку и не блокировал
   * сохранение с понятной подсказкой.
   */
  it('игнорирует пустое значение от Select, которого нет в allowedModels', () => {
    const onChange = jest.fn();
    renderFields(CATALOG, ['a', 'b'], 'a', onChange);

    fireEvent.click(screen.getByText('fire empty value change'));

    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * Регрессия: `onChange` мог собрать правильную пару значений, но, если вызывающая
   * сторона добросовестно применяет её к состоянию, а `handleDefaultChange` где-то по
   * пути теряет дефолт, поле «Модель по умолчанию» так и осталось бы плейсхолдером
   * поверх выбранной модели. Проверяет весь круг: клик по модели → applied к
   * состоянию → отражено подписью в Select, а не только форму вызова `onChange`.
   */
  it('после выбора модели в списке подпись поля «Модель по умолчанию» показывает её, а не плейсхолдер', () => {
    mockUseAdminModelsQuery.mockReturnValue({ data: CATALOG });

    function Harness() {
      const [value, setValue] = React.useState<{
        allowedModels: string[];
        defaultModel: string | null;
      }>({ allowedModels: [], defaultModel: null });
      return (
        <ModelAccessFields
          idPrefix="admin-settings"
          allowedModels={value.allowedModels}
          defaultModel={value.defaultModel}
          onChange={setValue}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText('select a'));

    expect(screen.getByTestId('default-model-select')).toHaveAttribute('data-value', 'a');
    expect(screen.getByTestId('select-item')).toHaveAttribute('data-value', 'a');
  });
});
