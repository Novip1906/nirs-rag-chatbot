export function chatUrl(): string {
  return import.meta.env.VITE_CHAT_URL || 'http://localhost:3090';
}

export function navigateExternal(url: string): void {
  window.location.href = url;
}

export function oidcIssuer(): string {
  return import.meta.env.VITE_OIDC_ISSUER || 'http://localhost:8080/realms/corporate';
}

export function oidcClientId(): string {
  return import.meta.env.VITE_OIDC_CLIENT_ID || 'admin';
}

export function adminApiUrl(): string {
  return import.meta.env.VITE_ADMIN_API_URL || '/api';
}
