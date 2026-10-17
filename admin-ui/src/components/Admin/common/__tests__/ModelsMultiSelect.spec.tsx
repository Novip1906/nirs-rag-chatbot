import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelsMultiSelect, { sortSelectedFirst } from '../ModelsMultiSelect';

const mockUseAdminModelsQuery = jest.fn();
const mockLocalize = jest.fn((key: string) => key);

jest.mock('~/data-provider/Admin', () => ({
  useAdminModelsQuery: () => mockUseAdminModelsQuery(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => mockLocalize,
}));

jest.mock('~/components/Admin/common/ModelDetailsDialog', () => ({
  __esModule: true,
  default: ({ model, onOpenChange }: { model: { id: string }; onOpenChange: (open: boolean) => void }) => (
    <div data-testid="model-details-dialog" data-model-id={model.id}>
      <button type="button" onClick={() => onOpenChange(false)}>
        close
      </button>
    </div>
  ),
}));

/**
 * The real `@librechat/client` bundle pulls in `@react-spring/web`, which this checkout
 * can't resolve from here (pre-existing environment gap, not this component's doing, see
 * `AdminLayout.spec.tsx`). Stubbed down to the item/selection contract this test cares about,
 * but still invokes `renderSelectedValues` and `renderItemContent` the way the real
 * `MultiSelect` does, so the custom summary renderer and per-row content are both exercised.
 * The clickable wrapper is a `role="option"` div, not a `<button>` — the real component's
 * row also renders a nested "details" trigger, and nesting interactive elements inside a
 * native `<button>` produces invalid markup.
 */
jest.mock('@librechat/client', () => ({
  MultiSelect: ({
    items,
    selectedValues,
    setSelectedValues,
    placeholder,
    renderSelectedValues,
    renderItemContent,
  }: {
    items: { label: string; value: string }[];
    selectedValues: string[];
    setSelectedValues: (values: string[]) => void;
    placeholder?: string;
    renderSelectedValues?: (
      values: string[],
      placeholderText?: string,
      items?: { label: string; value: string }[],
    ) => React.ReactNode;
    renderItemContent?: (
      value: string,
      defaultContent: React.ReactNode,
      isSelected: boolean,
    ) => React.ReactNode;
  }) => (
    <div>
      {renderSelectedValues != null && (
        <div data-testid="selected-summary">
          {renderSelectedValues(selectedValues, placeholder, items)}
        </div>
      )}
      {items.map((item) => {
        const isSelected = selectedValues.includes(item.value);
        const content = renderItemContent
          ? renderItemContent(item.value, item.label, isSelected)
          : item.label;
        return (
          <div
            key={item.value}
            role="option"
            aria-selected={isSelected}
            onClick={() =>
              setSelectedValues(
                isSelected
                  ? selectedValues.filter((value) => value !== item.value)
                  : [...selectedValues, item.value],
              )
            }
          >
            {content}
          </div>
        );
      })}
    </div>
  ),
}));

describe('ModelsMultiSelect', () => {
  beforeEach(() => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: '' },
        { id: 'gpt-4o', label: 'GPT-4o', description: '' },
      ],
    });
  });

  it('renders human-readable labels from the admin catalog, not raw ids', () => {
    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);

    expect(screen.getByText('Gemini 3.5 Flash Lite')).toBeInTheDocument();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.queryByText('google/gemini-3.5-flash-lite')).not.toBeInTheDocument();
  });

  it('reports the underlying model id, not the label, when a selection changes', async () => {
    const setSelectedValues = jest.fn();
    const user = userEvent.setup();
    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={setSelectedValues} />);

    await user.click(screen.getByText('Gemini 3.5 Flash Lite'));

    expect(setSelectedValues).toHaveBeenCalledWith(['google/gemini-3.5-flash-lite']);
  });

  it('renders an empty field while the catalog is still loading', () => {
    mockUseAdminModelsQuery.mockReturnValue({ data: undefined });

    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('shows the selected model names instead of a generic "N items selected" count', () => {
    render(
      <ModelsMultiSelect
        selectedValues={['google/gemini-3.5-flash-lite', 'gpt-4o']}
        setSelectedValues={jest.fn()}
      />,
    );

    expect(screen.getByTestId('selected-summary')).toHaveTextContent(
      'Gemini 3.5 Flash Lite, GPT-4o',
    );
  });

  it('falls back to the placeholder text when nothing is selected', () => {
    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);

    expect(screen.getByTestId('selected-summary')).toHaveTextContent(
      'com_admin_allowed_models_placeholder',
    );
  });

  it('collapses to a "+N more" summary once too many models are selected', () => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: '' },
        { id: 'gpt-4o', label: 'GPT-4o', description: '' },
        { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', description: '' },
      ],
    });

    render(
      <ModelsMultiSelect
        selectedValues={['google/gemini-3.5-flash-lite', 'gpt-4o', 'claude-haiku-4.5']}
        setSelectedValues={jest.fn()}
      />,
    );

    expect(mockLocalize).toHaveBeenCalledWith('com_admin_allowed_models_selected_more', {
      shown: 'Gemini 3.5 Flash Lite, GPT-4o',
      count: 1,
    });
  });

  it('shows the raw id for a selected model that has since been removed from the catalog', () => {
    render(
      <ModelsMultiSelect
        selectedValues={['gpt-4o', 'retired/old-model']}
        setSelectedValues={jest.fn()}
      />,
    );

    expect(screen.getByTestId('selected-summary')).toHaveTextContent('GPT-4o, retired/old-model');
  });

  it('lists an already-selected model before the rest of a hundreds-strong catalog', () => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: '' },
        { id: 'gpt-4o', label: 'GPT-4o', description: '' },
      ],
    });

    render(<ModelsMultiSelect selectedValues={['gpt-4o']} setSelectedValues={jest.fn()} />);

    const options = screen.getAllByRole('option');
    const order = options.map((option) =>
      option.textContent?.includes('GPT-4o') ? 'GPT-4o' : 'Gemini 3.5 Flash Lite',
    );
    expect(order).toEqual(['GPT-4o', 'Gemini 3.5 Flash Lite']);
  });

  it('shows the missing-price message for a model with no pricing', () => {
    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);

    const option = screen.getByRole('option', { name: /GPT-4o/ });
    expect(option).toHaveTextContent('com_admin_allowed_models_price_missing');
  });

  it('shows the formatted price row for a model with pricing', () => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          description: '',
          pricing: {
            promptPerMillion: 17.83,
            completionPerMillion: 106.98,
            imageInputPerMillion: null,
            audioPerMillion: null,
            webSearchPerThousand: null,
            inputCacheReadPerMillion: null,
            inputCacheWritePerMillion: null,
            currency: 'RUB',
          },
        },
      ],
    });

    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);

    expect(screen.getByRole('option')).toHaveTextContent('com_admin_allowed_models_price_row');
    expect(screen.queryByText('com_admin_allowed_models_price_missing')).not.toBeInTheDocument();
  });

  it('shows only the icons for modalities the model actually accepts', () => {
    mockUseAdminModelsQuery.mockReturnValue({
      data: [
        { id: 'a', label: 'Model A', description: '', inputModalities: ['text', 'image'] },
        { id: 'b', label: 'Model B', description: '', inputModalities: ['text', 'file'] },
        { id: 'c', label: 'Model C', description: '', inputModalities: ['text'] },
      ],
    });

    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);

    expect(
      screen.getByTitle('com_admin_allowed_models_modality_image').closest('[role="option"]'),
    ).toHaveTextContent('Model A');
    expect(
      screen.getByTitle('com_admin_allowed_models_modality_file').closest('[role="option"]'),
    ).toHaveTextContent('Model B');
    const modelCOption = screen.getByRole('option', { name: /Model C/ });
    expect(modelCOption.querySelector('.lucide-image')).not.toBeInTheDocument();
    expect(modelCOption.querySelector('.lucide-paperclip')).not.toBeInTheDocument();
  });

  it('opens the details dialog for the clicked model without toggling its selection', () => {
    const setSelectedValues = jest.fn();
    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={setSelectedValues} />);

    expect(screen.queryByTestId('model-details-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('com_admin_model_details_open')[0]);

    expect(screen.getByTestId('model-details-dialog')).toHaveAttribute(
      'data-model-id',
      'google/gemini-3.5-flash-lite',
    );
    expect(setSelectedValues).not.toHaveBeenCalled();
  });

  it('closes the details dialog', () => {
    render(<ModelsMultiSelect selectedValues={[]} setSelectedValues={jest.fn()} />);
    fireEvent.click(screen.getAllByLabelText('com_admin_model_details_open')[0]);
    expect(screen.getByTestId('model-details-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close'));

    expect(screen.queryByTestId('model-details-dialog')).not.toBeInTheDocument();
  });
});

describe('sortSelectedFirst', () => {
  const catalog = [
    { id: 'a', label: 'A', description: '' },
    { id: 'b', label: 'B', description: '' },
    { id: 'c', label: 'C', description: '' },
  ];

  it('moves selected models to the front, keeping catalog order within each group', () => {
    expect(sortSelectedFirst(catalog, ['c']).map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(sortSelectedFirst(catalog, ['b', 'c']).map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns the catalog unchanged when nothing is selected', () => {
    expect(sortSelectedFirst(catalog, []).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a selected id that is not in the catalog', () => {
    expect(sortSelectedFirst(catalog, ['not-in-catalog']).map((m) => m.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
