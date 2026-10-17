import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelCapabilitiesFields, {
  isKnowledgeBaseEnabled,
  isWebSearchEnabled,
  setModelCapabilityFlag,
  setModelOverrideText,
} from '../ModelCapabilitiesFields';

const mockUseAdminModelsQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminModelsQuery: () => mockUseAdminModelsQuery(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) => {
    if (options != null) {
      return `${key}:${JSON.stringify(options)}`;
    }
    return key;
  },
}));

jest.mock('@librechat/client', () => {
  const mockReact = jest.requireActual<typeof React>('react');
  return {
    Label: ({ children }: React.PropsWithChildren<unknown>) =>
      mockReact.createElement('label', null, children),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      mockReact.createElement('input', { type: 'text', ...props }),
    Checkbox: ({
      checked,
      onCheckedChange,
      'aria-label': ariaLabel,
    }: {
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
      'aria-label': string;
    }) =>
      mockReact.createElement('input', {
        type: 'checkbox',
        role: 'checkbox',
        'aria-label': ariaLabel,
        checked,
        onChange: () => onCheckedChange(!checked),
      }),
  };
});

beforeEach(() => {
  mockUseAdminModelsQuery.mockReturnValue({
    data: [
      { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: '' },
      {
        id: 'openai/gpt-5.2',
        label: 'GPT-5.2',
        description: '',
        shortDescription: 'Быстрая и недорогая модель',
      },
    ],
  });
});

describe('isKnowledgeBaseEnabled / isWebSearchEnabled', () => {
  it('defaults to enabled when the model has no entry', () => {
    expect(isKnowledgeBaseEnabled({}, 'a')).toBe(true);
    expect(isWebSearchEnabled({}, 'a')).toBe(true);
  });

  it('respects an explicit false', () => {
    expect(isKnowledgeBaseEnabled({ a: { knowledgeBase: false } }, 'a')).toBe(false);
    expect(isWebSearchEnabled({ a: { webSearch: false } }, 'a')).toBe(false);
  });

  it('treats an explicit true the same as no entry', () => {
    expect(isKnowledgeBaseEnabled({ a: { knowledgeBase: true } }, 'a')).toBe(true);
  });
});

describe('setModelCapabilityFlag', () => {
  it('sets a flag for a model with no prior entry, without touching other models', () => {
    const result = setModelCapabilityFlag({ b: { webSearch: false } }, 'a', 'knowledgeBase', false);

    expect(result).toEqual({ b: { webSearch: false }, a: { knowledgeBase: false } });
  });

  it('merges into an existing entry rather than replacing it', () => {
    const result = setModelCapabilityFlag(
      { a: { knowledgeBase: false } },
      'a',
      'webSearch',
      false,
    );

    expect(result).toEqual({ a: { knowledgeBase: false, webSearch: false } });
  });
});

describe('ModelCapabilitiesFields', () => {
  it('renders nothing when no model is allowed yet', () => {
    const { container } = render(
      <ModelCapabilitiesFields allowedModels={[]} capabilities={{}} setCapabilities={jest.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists only allowed models, by their catalog label', () => {
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{}}
        setCapabilities={jest.fn()}
      />,
    );

    expect(screen.getByText('GPT-5.2')).toBeInTheDocument();
    expect(screen.queryByText('Gemini 3.5 Flash Lite')).not.toBeInTheDocument();
  });

  it('checks both boxes by default', () => {
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{}}
        setCapabilities={jest.fn()}
      />,
    );

    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeChecked();
    }
  });

  it('unchecks a box the admin previously turned off', () => {
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{ 'openai/gpt-5.2': { webSearch: false } }}
        setCapabilities={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('com_admin_model_capabilities_web_search')).not.toBeChecked();
    expect(screen.getByLabelText('com_admin_model_capabilities_knowledge_base')).toBeChecked();
  });

  it('toggling a checkbox reports the updated map for that model only', async () => {
    const setCapabilities = jest.fn();
    const user = userEvent.setup();
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{}}
        setCapabilities={setCapabilities}
      />,
    );

    await user.click(screen.getByLabelText('com_admin_model_capabilities_web_search'));

    expect(setCapabilities).toHaveBeenCalledWith({ 'openai/gpt-5.2': { webSearch: false } });
  });

  it('shows the catalog label and short description as placeholders when there is no override', () => {
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{}}
        setCapabilities={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('com_admin_model_capabilities_label_field')).toHaveAttribute(
      'placeholder',
      'com_admin_model_capabilities_label_placeholder:{"current":"GPT-5.2"}',
    );
    expect(
      screen.getByLabelText('com_admin_model_capabilities_description_field'),
    ).toHaveAttribute(
      'placeholder',
      'com_admin_model_capabilities_description_placeholder:{"current":"Быстрая и недорогая модель"}',
    );
  });

  it('falls back to a generic placeholder when the catalog has no short description', () => {
    render(
      <ModelCapabilitiesFields
        allowedModels={['google/gemini-3.5-flash-lite']}
        capabilities={{}}
        setCapabilities={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText('com_admin_model_capabilities_description_field'),
    ).toHaveAttribute('placeholder', 'com_admin_model_capabilities_description_placeholder_fallback');
  });

  it('prefills the inputs with a previously saved override', () => {
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{ 'openai/gpt-5.2': { label: 'Своё имя', description: 'Своё описание' } }}
        setCapabilities={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('com_admin_model_capabilities_label_field')).toHaveValue(
      'Своё имя',
    );
    expect(screen.getByLabelText('com_admin_model_capabilities_description_field')).toHaveValue(
      'Своё описание',
    );
  });

  it('typing into the name override reports the updated map for that model only', async () => {
    const setCapabilities = jest.fn();
    const user = userEvent.setup();
    render(
      <ModelCapabilitiesFields
        allowedModels={['openai/gpt-5.2']}
        capabilities={{}}
        setCapabilities={setCapabilities}
      />,
    );

    await user.type(screen.getByLabelText('com_admin_model_capabilities_label_field'), 'X');

    expect(setCapabilities).toHaveBeenLastCalledWith({ 'openai/gpt-5.2': { label: 'X' } });
  });
});

describe('setModelOverrideText', () => {
  it('sets a text override for a model with no prior entry, without touching other models', () => {
    const result = setModelOverrideText({ b: { label: 'B' } }, 'a', 'label', 'A');

    expect(result).toEqual({ b: { label: 'B' }, a: { label: 'A' } });
  });

  it('merges into an existing entry rather than replacing it', () => {
    const result = setModelOverrideText({ a: { knowledgeBase: false } }, 'a', 'description', 'X');

    expect(result).toEqual({ a: { knowledgeBase: false, description: 'X' } });
  });
});
