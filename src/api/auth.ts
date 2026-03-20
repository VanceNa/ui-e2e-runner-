import type { APIRequestContext } from '@playwright/test';
import { createCipheriv } from 'node:crypto';

import type { ProjectAdapter } from '../adapters/types.js';

export interface PasswordLoginInput {
  apiBaseURL: string;
  username: string;
  password: string;
  adapter: ProjectAdapter;
  basicAuth?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  raw: unknown;
}

function resolveAuthTokenUrl(apiBaseURL: string): string {
  if (process.env.E2E_AUTH_TOKEN_URL) {
    return process.env.E2E_AUTH_TOKEN_URL;
  }
  const authPath = process.env.E2E_AUTH_TOKEN_PATH || '/auth/oauth2/token';
  const normalizedPath = authPath.startsWith('/') ? authPath : `/${authPath}`;
  return `${apiBaseURL}${normalizedPath}`;
}

function tryExtractToken(json: any): { accessToken?: string; refreshToken?: string } {
  const accessToken =
    json?.access_token ||
    json?.accessToken ||
    json?.data?.access_token ||
    json?.data?.accessToken ||
    json?.result?.access_token ||
    json?.result?.accessToken;
  const refreshToken =
    json?.refresh_token ||
    json?.refreshToken ||
    json?.data?.refresh_token ||
    json?.data?.refreshToken ||
    json?.result?.refresh_token ||
    json?.result?.refreshToken;
  return { accessToken, refreshToken };
}

function encryptPasswordForAdmin(password: string): string {
  const key = (process.env.E2E_PWD_ENC_KEY || 'xydxydxydxydhdkj').replace(/^['"]|['"]$/g, '');
  const keyBuffer = Buffer.from(key, 'utf8');
  const cipher = createCipheriv('aes-128-cfb', keyBuffer, keyBuffer);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.from(password, 'utf8')), cipher.final()]).toString('base64');
}

export async function loginByPassword(
  request: APIRequestContext,
  input: PasswordLoginInput,
): Promise<AuthSession> {
  const tokenUrl = resolveAuthTokenUrl(input.apiBaseURL);
  const fallbackBasicAuth = process.env.E2E_OAUTH2_CLIENT || 'Basic cGlnOnBpZw==';
  const headerAuth = input.basicAuth || input.adapter.buildAuthHeaders().Authorization || fallbackBasicAuth;
  const headers = {
    ...input.adapter.buildAuthHeaders(),
    Authorization: headerAuth,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const form: Record<string, string | number | boolean> = {
    grant_type: 'password',
    username: input.username,
    password: input.password,
  };
  if (input.adapter.projectId === 'admin') {
    form.scope = 'server';
    form.randomStr = 'blockPuzzle';
    form.code = '0';
    form.password = encryptPasswordForAdmin(input.password);
  }
  const response = await request.post(tokenUrl, {
    headers,
    form,
  });

  if (!response.ok()) {
    throw new Error(`登录失败: ${response.status()} ${response.statusText()}`);
  }

  const json = await response.json().catch(() => ({}));
  const { accessToken, refreshToken } = tryExtractToken(json);
  if (!accessToken) {
    throw new Error('登录响应中未找到 access token，请检查账号、加密签名或响应结构');
  }

  return {
    accessToken,
    refreshToken,
    raw: json,
  };
}
