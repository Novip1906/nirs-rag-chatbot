import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentUploadForm from '../DocumentUploadForm';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) => {
    if (values != null) {
      return `${key}:${JSON.stringify(values)}`;
    }
    return key;
  },
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Select: ({
    children,
    onValueChange,
  }: React.PropsWithChildren<{ onValueChange?: (value: string) => void }>) => (
    <div data-testid="status-select" data-onchange={onValueChange != null}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren<unknown>) => <div>{children}</div>,
}));

function renderForm() {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(
    <DocumentUploadForm isSaving={false} onSubmit={onSubmit} onCancel={onCancel} />,
  );
  return {
    onSubmit,
    onCancel,
    submitButton: screen.getByRole('button', { name: 'com_admin_knowledge_upload_submit' }),
  };
}

function selectFile(name = 'reglament.pdf') {
  const file = new File(['content'], name, { type: 'application/pdf' });
  const fileInput = document.getElementById('admin-knowledge-upload-file') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });
  return file;
}

describe('DocumentUploadForm', () => {
  it('не отправляется без названия документа, даже если файл выбран', () => {
    const { submitButton, onSubmit } = renderForm();
    selectFile();

    expect(submitButton).toBeDisabled();
    fireEvent.submit(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('не отправляется без файла, даже если название заполнено', () => {
    const { submitButton, onSubmit } = renderForm();
    fireEvent.change(screen.getByLabelText('com_admin_knowledge_field_document_title'), {
      target: { value: 'Регламент' },
    });

    expect(submitButton).toBeDisabled();
    fireEvent.submit(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('отправляет файл и метаданные, когда название и файл заполнены', () => {
    const { submitButton, onSubmit } = renderForm();
    const file = selectFile();
    fireEvent.change(screen.getByLabelText('com_admin_knowledge_field_document_title'), {
      target: { value: 'Регламент' },
    });

    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ title: 'Регламент', status: 'active', effectiveDate: null }),
    );
  });

  it('показывает, какой документ заменяет новая версия', () => {
    render(
      <DocumentUploadForm
        replacingTitle="Положение об отпусках"
        isSaving={false}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(
      screen.getByText(/com_admin_knowledge_upload_replaces/),
    ).toBeInTheDocument();
  });
});
