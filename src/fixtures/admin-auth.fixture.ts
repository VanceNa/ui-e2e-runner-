import type { Page } from '@playwright/test';

import { loginByPassword } from '../api/auth.js';
import { expect, test as base } from './test.fixture.js';

export interface AdminSession {
  accessToken: string;
  apiBaseURL: string;
  baseURL: string;
}

type AdminAuthFixtures = {
  adminSession?: AdminSession;
  injectAdminSession: (page: Page) => Promise<void>;
};

export const test = base.extend<AdminAuthFixtures>({
  adminSession: async ({ adapter, request }, use) => {
    if (adapter.projectId !== 'admin') {
      await use(undefined);
      return;
    }

    const username = process.env.E2E_LOGIN_USERNAME;
    const password = process.env.E2E_LOGIN_PASSWORD;
    const baseURL = process.env.E2E_BASE_URL || adapter.baseUrl;
    const apiBaseURL = process.env.E2E_API_BASE_URL || adapter.apiBaseUrl;

    if (!username || !password || !baseURL || !apiBaseURL) {
      await use(undefined);
      return;
    }

    const session = await loginByPassword(request, {
      apiBaseURL,
      username,
      password,
      adapter,
    });

    await use({
      accessToken: session.accessToken,
      apiBaseURL,
      baseURL,
    });
  },
  injectAdminSession: async ({ adapter, adminSession }, use) => {
    const injector = async (page: Page) => {
      if (!adminSession) {
        throw new Error('adminSession 不可用，请先配置 E2E 登录相关环境变量');
      }
      await adapter.injectSession(page, adminSession.accessToken);
    };
    await use(injector);
  },
});

export { expect };
