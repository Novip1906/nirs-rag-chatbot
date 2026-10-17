import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TemporaryPasswordDialog from '../TemporaryPasswordDialog';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('~/ui');
  return { ...actual, useToastContext: () => ({ showToast: jest.fn() }) };
});

describe('TemporaryPasswordDialog', () => {
  it('does not close on Escape or on a click outside', () => {
    const onClose = jest.fn();
    render(<TemporaryPasswordDialog password="Tmp-Pass-1" onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Tmp-Pass-1')).toBeInTheDocument();
  });

  it('closes only with the done button', () => {
    const onClose = jest.fn();
    render(<TemporaryPasswordDialog password="Tmp-Pass-1" onClose={onClose} />);

    fireEvent.click(screen.getByText('com_admin_action_done'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
