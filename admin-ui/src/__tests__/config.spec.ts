import { chatUrl, adminApiUrl, oidcClientId, oidcIssuer } from '../config';

const KEYS = [
  'VITE_CHAT_URL',
  'VITE_OIDC_ISSUER',
  'VITE_OIDC_CLIENT_ID',
  'VITE_ADMIN_API_URL',
];

describe('config defaults', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    KEYS.forEach((key) => {
      saved[key] = process.env[key];
    });
  });

  afterEach(() => {
    KEYS.forEach((key) => {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    });
  });

  it('falls back to defaults on empty strings', () => {
    KEYS.forEach((key) => {
      process.env[key] = '';
    });

    expect(chatUrl()).toBe('http://localhost:3090');
    expect(oidcIssuer()).toBe('http://localhost:8080/realms/corporate');
    expect(oidcClientId()).toBe('admin');
    expect(adminApiUrl()).toBe('/api');
  });

  it('keeps provided values', () => {
    process.env.VITE_OIDC_CLIENT_ID = 'custom';

    expect(oidcClientId()).toBe('custom');
  });
});
