import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { BootstrapSecrets, ProjectAdapter } from './types.js';

const BASIC_CLIENT = 'Basic bWVtYmVyOm1lbWJlcg==';

export const memberAdapter: ProjectAdapter = {
  projectId: 'member',
  description: '心易贷移动用户端',
  baseUrl: 'https://xydc-release.local.hzzxf.com',
  apiBaseUrl: 'https://xydb-dev.local.hzzxf.com/api',
  loginMode: 'sms',
  clientToc: 'Y',
  defaultViewport: 'mobile',
  buildAuthHeaders(token?: string) {
    const headers: Record<string, string> = {
      'CLIENT-TOC': 'Y',
      Authorization: BASIC_CLIENT,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  },
  async encryptPayload<T>(payload: T): Promise<T> {
    return payload;
  },
  async getBootstrapSecrets(apiContext: APIRequestContext): Promise<BootstrapSecrets> {
    const response = await apiContext.post('/admin/secret/systemTime', { data: {} });
    if (!response.ok()) {
      return {};
    }
    return {
      systemTime: Number(await response.text()) || undefined,
    };
  },
  async injectSession(page: Page, token: string): Promise<void> {
    await page.addInitScript(
      ([accessToken]) => {
        window.localStorage.setItem('token', accessToken);
      },
      [token],
    );
  },
  async homeReadyCheck(page: Page): Promise<void> {
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveTitle(/.+/);
  },
};
