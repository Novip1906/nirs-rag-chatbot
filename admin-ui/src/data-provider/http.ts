import axios, { AxiosError } from 'axios';
import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getSession, notifyUnauthorized, refreshSession } from '../auth/tokenStore';

const REFRESH_LEEWAY_MS = 30_000;

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3080';
}

const client = axios.create();

client.interceptors.request.use(async (config) => {
  const session = getSession();
  if (session != null && session.expiresAt - Date.now() < REFRESH_LEEWAY_MS) {
    await refreshSession();
  }
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config: RetriableConfig | undefined = error.config;
    if (error.response?.status !== 401 || config == null) {
      return Promise.reject(error);
    }
    if (config._retried === true) {
      return Promise.reject(error);
    }
    const usedToken = String(config.headers?.Authorization ?? '').replace(/^Bearer /, '');
    const latestToken = getAccessToken();
    const rotated = latestToken != null && latestToken !== usedToken;
    const result = rotated ? 'ok' : await refreshSession();
    if (result === 'ok') {
      config._retried = true;
      return client.request(config);
    }
    if (result === 'unavailable') {
      return Promise.reject(
        new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, error.request),
      );
    }
    notifyUnauthorized();
    return Promise.reject(error);
  },
);

async function get<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await client.get(url, options);
  return response.data;
}

async function getResponse(url: string, options?: AxiosRequestConfig): Promise<AxiosResponse> {
  return client.get(url, options);
}

async function post<T>(url: string, data?: unknown, options?: AxiosRequestConfig): Promise<T> {
  const response = await client.post(url, data, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  return response.data;
}

async function postMultiPart<T>(
  url: string,
  formData: FormData,
  options?: AxiosRequestConfig,
): Promise<T> {
  const response = await client.post(url, formData, {
    ...options,
    headers: { 'Content-Type': 'multipart/form-data', ...options?.headers },
  });
  return response.data;
}

async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await client.put(url, data, {
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
}

async function patch<T>(url: string, data?: unknown): Promise<T> {
  const response = await client.patch(url, data, {
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
}

async function del<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await client.delete(url, options);
  return response.data;
}

export const request = {
  get,
  getResponse,
  post,
  postMultiPart,
  put,
  patch,
  delete: del,
};

export const rawClient = client;
