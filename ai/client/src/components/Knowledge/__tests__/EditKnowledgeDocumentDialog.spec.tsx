import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeDocumentItem } from 'librechat-data-provider';
import EditKnowledgeDocumentDialog from '../EditKnowledgeDocumentDialog';
import { useUpdateEmployeeKnowledgeDocumentMutation } from '~/data-provider/Knowledge';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) => {
    const translations = jest.requireActual('~/locales/ru/translation.json') as Record<
      string,
      string
    >;
    const template = translations[key] ?? key;
    if (values == null) {
      return template;
    }
    return template.replace(/{{\s*(\w+)\s*}}/g, (match: string, name: string) =>
      name in values ? String(values[name]) : match,
    );
  },
}));

jest.mock('~/data-provider/Knowledge', () => ({
  useUpdateEmployeeKnowledgeDocumentMutation: jest.fn(),
}));

const mockUseUpdateMutation = useUpdateEmployeeKnowledgeDocumentMutation as jest.Mock;

const DOC: KnowledgeDocumentItem = {
  id: 'd1',
  spaceId: 's1',
  fileId: 'f1',
  title: 'Регламент эквайринга',
  description: '',
  filename: '',
  source: '',
  owner: '',
  uploadedBy: 'user-1',
  version: '',
  effectiveDate: null,
  status: 'active',
  embeddingModel: '',
  bytes: 0,
  mimetype: '',
  embedded: false,
  createdAt: new Date(0).toISOString(),
};

function renderDialog(update = jest.fn()) {
  mockUseUpdateMutation.mockReturnValue({ mutate: update, isLoading: false });
  render(<EditKnowledgeDocumentDialog open onOpenChange={jest.fn()} doc={DOC} spaceId="s1" />);
  return update;
}

describe('EditKnowledgeDocumentDialog', () => {
  beforeEach(() => {
    mockUseUpdateMutation.mockReset();
  });

  it('не даёт сохранить, если название очищено полностью', async () => {
    const update = renderDialog();
    const title = screen.getByLabelText(/название/i);
    await userEvent.clear(title);

    expect(screen.getByRole('button', { name: /^сохранить$/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));
    expect(update).not.toHaveBeenCalled();
  });

  it('не даёт сохранить, если название состоит из одних пробелов', async () => {
    renderDialog();
    const title = screen.getByLabelText(/название/i);
    await userEvent.clear(title);
    await userEvent.type(title, '   ');

    expect(screen.getByRole('button', { name: /^сохранить$/i })).toBeDisabled();
  });

  it('разрешает сохранить непустое название', async () => {
    const update = renderDialog();
    const title = screen.getByLabelText(/название/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Новое название');

    expect(screen.getByRole('button', { name: /^сохранить$/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /^сохранить$/i }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'd1',
        payload: expect.objectContaining({ title: 'Новое название' }),
      }),
    );
  });
});
