import { AxiosError } from 'axios';
import { retrySkipping4xx } from '../retry';

function errorWithStatus(status: number): AxiosError {
  const error = new AxiosError('failed');
  error.response = { status, data: {}, statusText: '', headers: {}, config: {} as never };
  return error;
}

describe('retrySkipping4xx', () => {
  it('does not retry client errors', () => {
    expect(retrySkipping4xx(0, errorWithStatus(404))).toBe(false);
    expect(retrySkipping4xx(0, errorWithStatus(403))).toBe(false);
  });

  it('retries server and network errors twice', () => {
    expect(retrySkipping4xx(0, errorWithStatus(502))).toBe(true);
    expect(retrySkipping4xx(1, new Error('Network Error'))).toBe(true);
    expect(retrySkipping4xx(2, errorWithStatus(502))).toBe(false);
  });
});
