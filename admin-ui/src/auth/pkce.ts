const VERIFIER_STORAGE_KEY = 'admin.pkce.verifier';
const STATE_STORAGE_KEY = 'admin.pkce.state';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64Url(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export function generateCodeVerifier(): string {
  return randomHex(32);
}

export function generateState(): string {
  return randomHex(16);
}

export async function computeCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(digest);
}

export function storeAuthRequest(verifier: string, state: string): void {
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  sessionStorage.setItem(STATE_STORAGE_KEY, state);
}

function consume(key: string): string | undefined {
  try {
    const value = sessionStorage.getItem(key) ?? undefined;
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return undefined;
  }
}

export function consumeVerifier(): string | undefined {
  return consume(VERIFIER_STORAGE_KEY);
}

export function consumeState(): string | undefined {
  return consume(STATE_STORAGE_KEY);
}
