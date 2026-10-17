import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteLinkDialog from '../InviteLinkDialog';

const mockShowToast = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('~/ui');
  return { ...actual, useToastContext: () => ({ showToast: mockShowToast }) };
});

const LINK = `https://auth.example.test/realms/corporate/login-actions/action-token?key=${'a'.repeat(900)}`;

function renderDialog(emailSent = true, onClose = jest.fn()) {
  render(
    <InviteLinkDialog
      link={LINK}
      email="ivan@example.test"
      emailSent={emailSent}
      onClose={onClose}
    />,
  );
  return screen.getByLabelText('com_admin_employees_invite_link_label') as HTMLInputElement;
}

describe('InviteLinkDialog', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('keeps a long link inside a read-only field', () => {
    const field = renderDialog();

    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(LINK);
    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
  });

  it('selects the link when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const field = renderDialog();
    const select = jest.spyOn(field, 'select');

    fireEvent.click(screen.getByText('com_admin_employees_invite_copy'));

    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_admin_employees_invite_copy_failed' }),
    );
  });

  it('copies the link', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDialog();

    fireEvent.click(screen.getByText('com_admin_employees_invite_copy'));

    await waitFor(() =>
      expect(screen.getByText('com_admin_employees_invite_copied')).toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('warns when the email was not sent', () => {
    renderDialog(false);

    expect(screen.getByRole('alert')).toHaveTextContent('com_admin_employees_invite_not_sent');
  });

  it('has no alert when the email was sent', () => {
    renderDialog(true);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_employees_invite_sent')).toBeInTheDocument();
  });

  it('does not close on Escape or on a click outside', () => {
    const onClose = jest.fn();
    renderDialog(true, onClose);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();
  });

  it('closes only with the done button', () => {
    const onClose = jest.fn();
    renderDialog(true, onClose);

    fireEvent.click(screen.getByText('com_admin_action_done'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
