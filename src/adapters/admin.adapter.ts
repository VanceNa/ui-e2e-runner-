import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { BootstrapSecrets, ProjectAdapter } from './types.js';

export const adminAdapter: ProjectAdapter = {
  projectId: 'admin',
  description: '心易贷PC管理后台',
  baseUrl: 'https://xydb-dev.local.hzzxf.com',
  apiBaseUrl: 'https://xydb-dev.local.hzzxf.com/api',
  loginMode: 'password',
  clientToc: 'MG',
  defaultViewport: 'desktop',
  buildAuthHeaders(token?: string) {
    const oauthClient = process.env.E2E_OAUTH2_CLIENT || '';
    const headers: Record<string, string> = {
      'CLIENT-TOC': 'MG',
      'TENANT-ID': process.env.E2E_TENANT_ID || '',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else if (oauthClient) {
      headers.Authorization = oauthClient;
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
  async injectSession(page: Page, token: string, salt?: string, iv?: string): Promise<void> {
    const payload: [string, string | undefined, string | undefined] = [token, salt, iv];
    const writeSession = (args: (string | undefined)[]) => {
      const [accessToken, sessionSalt, sessionIv] = args;
      if (!accessToken) return;
      window.sessionStorage.setItem('token', JSON.stringify(accessToken));
      if (sessionSalt) {
        window.sessionStorage.setItem('salt', JSON.stringify(sessionSalt));
      }
      if (sessionIv) {
        window.sessionStorage.setItem('iv', JSON.stringify(sessionIv));
      }
    };

    // For future document loads.
    await page.addInitScript(
      writeSession,
      payload,
    );

    // For current document (hash navigation won't trigger addInitScript), but
    // Playwright UI may still be sitting on about:blank where sessionStorage
    // is not accessible.
    const url = page.url();
    if (!url || url === 'about:blank') {
      return;
    }
    await page.evaluate(writeSession, payload).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/sessionStorage|Access is denied|SecurityError/i.test(message)) {
        return;
      }
      throw error;
    });
  },
  async homeReadyCheck(page: Page): Promise<void> {
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveTitle(/.+/);
  },
};
