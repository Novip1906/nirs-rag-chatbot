import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AdminModelOption } from '~/api';
import ModelDetailsDialog from '../ModelDetailsDialog';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) => {
    if (options != null) {
      return `${key}:${JSON.stringify(options)}`;
    }
    return key;
  },
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  OGDialog: ({ open, children }: React.PropsWithChildren<{ open: boolean }>) =>
    open ? <div>{children}</div> : null,
  OGDialogContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  OGDialogHeader: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  OGDialogTitle: ({ children }: React.PropsWithChildren<unknown>) => <h2>{children}</h2>,
}));

function model(overrides: Partial<AdminModelOption> = {}): AdminModelOption {
  return {
    id: 'qwen/qwen3.8-flash',
    label: 'Qwen: Qwen3.8 Flash',
    description: '',
    vendor: 'qwen',
    contextLength: 1_000_000,
    inputModalities: ['text', 'image'],
    pricing: {
      promptPerMillion: 17.83,
      completionPerMillion: 55.88,
      imageInputPerMillion: null,
      audioPerMillion: null,
      webSearchPerThousand: null,
      inputCacheReadPerMillion: null,
      inputCacheWritePerMillion: null,
      currency: 'RUB',
    },
    ...overrides,
  };
}

describe('ModelDetailsDialog', () => {
  it('shows the model name, vendor and internal id', () => {
    render(<ModelDetailsDialog model={model()} onOpenChange={jest.fn()} />);

    expect(screen.getByText('Qwen: Qwen3.8 Flash')).toBeInTheDocument();
    expect(screen.getByText('qwen')).toBeInTheDocument();
    expect(screen.getByText('qwen/qwen3.8-flash')).toBeInTheDocument();
  });

  it('shows the context length', () => {
    render(<ModelDetailsDialog model={model({ contextLength: 128_000 })} onOpenChange={jest.fn()} />);

    // Matched with a predicate, not an exact string: `toLocaleString('ru-RU')` uses a
    // non-breaking space for thousands, which testing-library's whitespace normalizer
    // collapses, so a literal expected string with the same character still fails to match.
    expect(
      screen.getByText((content) => content.startsWith('com_admin_allowed_models_meta_context:')),
    ).toHaveTextContent('128');
  });

  it('shows a missing-context message rather than a blank value', () => {
    render(<ModelDetailsDialog model={model({ contextLength: null })} onOpenChange={jest.fn()} />);

    expect(screen.getByText('com_admin_model_details_context_missing')).toBeInTheDocument();
  });

  it('lists every accepted modality, including plain text', () => {
    render(
      <ModelDetailsDialog
        model={model({ inputModalities: ['text', 'image', 'file'] })}
        onOpenChange={jest.fn()}
      />,
    );

    expect(
      screen.getByText(
        [
          'com_admin_allowed_models_modality_text',
          'com_admin_allowed_models_modality_image',
          'com_admin_allowed_models_modality_file',
        ].join(', '),
      ),
    ).toBeInTheDocument();
  });

  it('lists every pricing field, not just prompt/completion', () => {
    render(
      <ModelDetailsDialog
        model={model({
          pricing: {
            promptPerMillion: 10,
            completionPerMillion: 20,
            imageInputPerMillion: 30,
            audioPerMillion: null,
            webSearchPerThousand: null,
            inputCacheReadPerMillion: 1,
            inputCacheWritePerMillion: 2,
            currency: 'RUB',
          },
        })}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText('com_admin_model_details_price_image_input')).toBeInTheDocument();
    expect(screen.getByText('com_admin_model_details_price_cache_write')).toBeInTheDocument();
    // audio and web search have no price — both rows fall back to the same message
    expect(screen.getAllByText('com_admin_allowed_models_price_missing')).toHaveLength(2);
  });

  it('closes when the close button is clicked', () => {
    const onOpenChange = jest.fn();
    render(<ModelDetailsDialog model={model()} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText('com_admin_action_close'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
