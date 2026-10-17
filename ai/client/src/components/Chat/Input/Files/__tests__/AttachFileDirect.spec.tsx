import React from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { EToolResources } from 'librechat-data-provider';
import AttachFileDirect from '../AttachFileDirect';

const mockHandleFiles = jest.fn();
const mockSetFilesLoading = jest.fn();
let mockContextEnabled = true;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useGetAgentsConfig: () => ({ agentsConfig: null }),
  useAgentCapabilities: () => ({ contextEnabled: mockContextEnabled }),
  useFileHandlingNoChatContext: () => ({ handleFiles: mockHandleFiles }),
}));

jest.mock('~/hooks/useKeyboardShortcuts', () => ({
  useShortcutHint: (_key: string, fallback: string) => fallback,
  useShortcutAriaKey: () => undefined,
}));

function renderComponent(disabled = false) {
  return render(
    <AttachFileDirect
      disabled={disabled}
      files={new Map()}
      setFiles={() => {}}
      setFilesLoading={mockSetFilesLoading}
      conversation={null}
    />,
  );
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (input == null) {
    throw new Error('file input not rendered');
  }
  return input as HTMLInputElement;
}

const wordFile = () =>
  new File(['текст'], 'reglament.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
const pdfFile = () => new File(['%PDF'], 'instrukciya.pdf', { type: 'application/pdf' });
const imageFile = () => new File(['png'], 'screenshot.png', { type: 'image/png' });

describe('AttachFileDirect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContextEnabled = true;
  });

  it('opens the OS file picker on the first click, with no menu in between', async () => {
    const user = userEvent.setup();
    renderComponent();
    const clickSpy = jest.spyOn(fileInput(), 'click');

    await user.click(screen.getByRole('button', { name: 'com_sidepanel_attach_files' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not narrow the picker to selected formats — anything can be chosen', () => {
    renderComponent();
    expect(fileInput().getAttribute('accept')).toBeFalsy();
  });

  it('sends an image straight to the model, untouched', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.upload(fileInput(), imageFile());

    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
    expect(mockHandleFiles.mock.calls[0][1]).toBeUndefined();
  });

  it('sends a PDF straight to the model, untouched', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.upload(fileInput(), pdfFile());

    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
    expect(mockHandleFiles.mock.calls[0][1]).toBeUndefined();
  });

  it('routes a Word file through text extraction, which is the only path that accepts it', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.upload(fileInput(), wordFile());

    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
    expect(mockHandleFiles.mock.calls[0][1]).toBe(EToolResources.context);
  });

  it('splits a mixed selection so neither lane rejects the other lane files', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.upload(fileInput(), [imageFile(), wordFile()]);

    expect(mockHandleFiles).toHaveBeenCalledTimes(2);
    const [providerBatch, providerResource] = mockHandleFiles.mock.calls[0];
    const [textBatch, textResource] = mockHandleFiles.mock.calls[1];
    expect(providerBatch.map((f: File) => f.name)).toEqual(['screenshot.png']);
    expect(providerResource).toBeUndefined();
    expect(textBatch.map((f: File) => f.name)).toEqual(['reglament.docx']);
    expect(textResource).toBe(EToolResources.context);
  });

  it('sends everything to the model when text extraction is switched off', async () => {
    mockContextEnabled = false;
    const user = userEvent.setup();
    renderComponent();

    await user.upload(fileInput(), wordFile());

    expect(mockHandleFiles).toHaveBeenCalledTimes(1);
    expect(mockHandleFiles.mock.calls[0][1]).toBeUndefined();
  });

  it('does nothing when the picker is dismissed without a choice', () => {
    renderComponent();

    fileInput().dispatchEvent(new Event('change', { bubbles: true }));

    expect(mockHandleFiles).not.toHaveBeenCalled();
    expect(mockSetFilesLoading).not.toHaveBeenCalled();
  });

  it('cannot be opened while uploads are disabled', () => {
    renderComponent(true);
    expect(screen.getByRole('button', { name: 'com_sidepanel_attach_files' })).toBeDisabled();
  });
});
