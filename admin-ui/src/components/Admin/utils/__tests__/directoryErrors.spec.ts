import { AxiosError } from 'axios';
import { directoryErrorKey, directoryFieldErrors } from '../directoryErrors';

function axiosErrorWithData(data: unknown, status = 400): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = { data, status, statusText: '', headers: {}, config: {} as never };
  return error;
}

describe('directoryErrorKey', () => {
  it.each([
    'unauthorized',
    'forbidden',
    'not_found',
    'validation_failed',
    'email_taken',
    'department_name_taken',
    'department_not_empty',
    'last_admin',
    'self_admin_revoke',
    'self_block',
    'self_delete',
    'idp_unavailable',
    'idp_rejected',
    'idp_account_missing',
    'already_active',
    'not_activated',
    'reinvite_required',
  ])('maps %s to its own key', (code) => {
    const error = axiosErrorWithData({ error_code: code, message: 'x' });
    expect(directoryErrorKey(error)).toBe(`com_admin_directory_error_${code}`);
  });

  it('maps an unknown code to the unknown key', () => {
    const error = axiosErrorWithData({ error_code: 'brand_new', message: 'x' });
    expect(directoryErrorKey(error)).toBe('com_admin_directory_error_unknown');
  });

  it('maps a missing response to the unknown key', () => {
    expect(directoryErrorKey(new AxiosError('Network Error'))).toBe(
      'com_admin_directory_error_unknown',
    );
    expect(directoryErrorKey(new Error('boom'))).toBe('com_admin_directory_error_unknown');
  });
});

describe('directoryFieldErrors', () => {
  it('maps field reasons to keys and falls back to invalid', () => {
    const error = axiosErrorWithData({
      error_code: 'validation_failed',
      message: 'x',
      fields: { email: 'invalid', first_name: 'required', position: 'weird' },
    });
    expect(directoryFieldErrors(error)).toEqual({
      email: 'com_admin_directory_field_invalid',
      first_name: 'com_admin_directory_field_required',
      position: 'com_admin_directory_field_invalid',
    });
  });

  it('maps the no_department reason', () => {
    const error = axiosErrorWithData({
      error_code: 'validation_failed',
      message: 'x',
      fields: { is_head: 'no_department' },
    });
    expect(directoryFieldErrors(error)).toEqual({
      is_head: 'com_admin_directory_field_no_department',
    });
  });

  it('returns an empty object without fields', () => {
    expect(directoryFieldErrors(new Error('x'))).toEqual({});
  });
});
