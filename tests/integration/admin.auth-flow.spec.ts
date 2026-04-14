import { expect, test } from '../../src/fixtures/admin-auth.fixture.js';
import { isDesktopProject } from '../../src/projects.js';

test.describe('Admin Integration', () => {
  test(
    'API登录 -> 注入会话 -> 首页断言 -> API状态校验',
    async ({ adapter, page, request, adminSession, injectAdminSession }, testInfo) => {
    test.skip(adapter.projectId !== 'admin', '仅 admin 项目执行该联动用例');
    test.skip(!isDesktopProject(testInfo.project), '仅 desktop 项目执行该联动用例');
    test.skip(!adminSession, '未配置 admin 联动登录变量（支持 E2E_ADMIN_OAUTH2_CLIENT / E2E_ADMIN_LOGIN_USERNAME / E2E_ADMIN_LOGIN_PASSWORD）');

    if (!adminSession) {
      return;
    }

    await injectAdminSession(page);
    await page.goto(adminSession.baseURL);
    await adapter.homeReadyCheck(page);

    const response = await request.post(`${adminSession.apiBaseURL}/admin/secret/systemTime`, {
      headers: adapter.buildAuthHeaders(adminSession.accessToken),
      data: {},
    });

    expect(response.ok(), `状态校验失败: ${response.status()} ${response.statusText()}`).toBeTruthy();
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
    },
  );
});
