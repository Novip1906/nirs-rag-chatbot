import { AxiosError } from 'axios';
import { getAdminErrorMessage } from '../format';

const localize = ((key: string) => key) as Parameters<typeof getAdminErrorMessage>[1];

function axiosErrorWithData(data: unknown, status = 500): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    data,
    status,
    statusText: '',
    headers: {},
    config: {} as never,
  };
  return error;
}

describe('getAdminErrorMessage', () => {
  it('reads the backend error field — the convention almost every admin endpoint uses', () => {
    const error = axiosErrorWithData({ error: 'Провайдер моделей не отвечает.' });

    expect(getAdminErrorMessage(error, localize)).toBe('Провайдер моделей не отвечает.');
  });

  it('falls back to a message field for the few endpoints that use it', () => {
    const error = axiosErrorWithData({ message: 'Forbidden' });

    expect(getAdminErrorMessage(error, localize)).toBe('Forbidden');
  });

  it('prefers error over message when a response somehow has both', () => {
    const error = axiosErrorWithData({ error: 'Specific reason', message: 'Generic' });

    expect(getAdminErrorMessage(error, localize)).toBe('Specific reason');
  });

  it('falls back to the axios error message when the response body has neither field', () => {
    const error = axiosErrorWithData({ ok: false });

    expect(getAdminErrorMessage(error, localize)).toBe('Request failed');
  });

  it('falls back to the axios error message when there is no response at all', () => {
    const error = new AxiosError('Network Error');

    expect(getAdminErrorMessage(error, localize)).toBe('Network Error');
  });

  it('falls back to the fully generic toast text only when there is truly nothing to show', () => {
    const error = axiosErrorWithData({ ok: false });
    error.message = '';

    expect(getAdminErrorMessage(error, localize)).toBe('com_admin_toast_error');
  });

  it('reads .message off a plain (non-axios) Error', () => {
    expect(getAdminErrorMessage(new Error('Something broke'), localize)).toBe('Something broke');
  });

  it('falls back to the generic toast text for a non-object, non-Error value', () => {
    expect(getAdminErrorMessage('nope', localize)).toBe('com_admin_toast_error');
    expect(getAdminErrorMessage(null, localize)).toBe('com_admin_toast_error');
    expect(getAdminErrorMessage(undefined, localize)).toBe('com_admin_toast_error');
  });

  it.each([
    ['FIELD_NOT_EDITABLE', 'com_admin_ai_error_field_not_editable'],
  ])('maps the backend code %s to a translation key', (code, key) => {
    const error = axiosErrorWithData({ error: 'Raw server text', error_code: code }, 400);

    expect(getAdminErrorMessage(error, localize)).toBe(key);
  });

  it('maps a 403 to a translation key instead of the raw server text', () => {
    const error = axiosErrorWithData(
      { error: 'Department heads cannot edit their own account' },
      403,
    );

    expect(getAdminErrorMessage(error, localize)).toBe('com_admin_ai_error_forbidden');
  });

  it('shows the server message of a 403 when it is not empty', () => {
    const error = axiosErrorWithData({ message: 'Учётная запись заблокирована' }, 403);

    expect(getAdminErrorMessage(error, localize)).toBe('Учётная запись заблокирована');
  });

  it('falls back to the generic forbidden text for a 403 with an empty message', () => {
    const error = axiosErrorWithData({ message: '' }, 403);

    expect(getAdminErrorMessage(error, localize)).toBe('com_admin_ai_error_forbidden');
  });

  it('keeps the raw text for an unknown code', () => {
    const error = axiosErrorWithData({ error: 'Raw server text', error_code: 'OTHER' }, 400);

    expect(getAdminErrorMessage(error, localize)).toBe('Raw server text');
  });
});
