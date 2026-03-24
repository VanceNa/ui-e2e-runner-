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
    // 仅 admin 项目需要账号口令登录，其他项目保持无状态执行。
    if (adapter.projectId !== 'admin') {
      await use(undefined);
      return;
    }

    const username = process.env.E2E_LOGIN_USERNAME;
    const password = process.env.E2E_LOGIN_PASSWORD;
    const baseURL = process.env.E2E_BASE_URL || adapter.baseUrl;
    const apiBaseURL = process.env.E2E_API_BASE_URL || adapter.apiBaseUrl;

    // 缺少登录必要参数时降级为 undefined，让具体用例自行 skip/报错，而不是在 fixture 启动阶段硬失败。
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
      // 会话注入统一通过 adapter，屏蔽不同项目的 token 存储差异（cookie/localStorage/header）。
      await adapter.injectSession(page, adminSession.accessToken);
    };
    await use(injector);
  },
});

export { expect };
