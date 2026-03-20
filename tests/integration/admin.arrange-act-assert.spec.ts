import { callScenarioApi, parseJsonEnv } from '../../src/api/scenario.js';
import { expect, test } from '../../src/fixtures/admin-auth.fixture.js';

test.describe('Admin Integration Template', () => {
  test('Arrange(API) -> Act(UI) -> Assert(API)', async ({ adapter, page, request, adminSession }, testInfo) => {
    test.skip(adapter.projectId !== 'admin', '仅 admin 项目执行该联动模板');
    test.skip(testInfo.project.name !== 'chromium-desktop', '仅 desktop 项目执行该联动模板');
    test.skip(!adminSession, '未配置联动登录变量');

    const preparePath = process.env.E2E_SCENARIO_PREPARE_PATH;
    const verifyPath = process.env.E2E_SCENARIO_VERIFY_PATH;
    test.skip(!preparePath || !verifyPath, '未设置 E2E_SCENARIO_PREPARE_PATH / E2E_SCENARIO_VERIFY_PATH');
    if (!adminSession || !preparePath || !verifyPath) {
      return;
    }

    const uiPath = process.env.E2E_SCENARIO_UI_PATH || '/';
    const uiExpectSelector = process.env.E2E_SCENARIO_UI_EXPECT_SELECTOR;
    const prepareBody = parseJsonEnv(process.env.E2E_SCENARIO_PREPARE_BODY, {});
    const verifyBody = parseJsonEnv(process.env.E2E_SCENARIO_VERIFY_BODY, {});

    const prepareResponse = await callScenarioApi(
      request,
      adapter,
      adminSession.apiBaseURL,
      adminSession.accessToken,
      {
        path: preparePath,
        body: prepareBody,
      },
    );
    expect(prepareResponse.ok(), `Prepare 失败: ${prepareResponse.status()} ${prepareResponse.statusText()}`).toBeTruthy();

    await adapter.injectSession(page, adminSession.accessToken);
    await page.goto(`${adminSession.baseURL}${uiPath}`);
    await adapter.homeReadyCheck(page);
    if (uiExpectSelector) {
      await expect(page.locator(uiExpectSelector)).toBeVisible();
    }

    const verifyResponse = await callScenarioApi(
      request,
      adapter,
      adminSession.apiBaseURL,
      adminSession.accessToken,
      {
        path: verifyPath,
        body: verifyBody,
      },
    );
    expect(verifyResponse.ok(), `Verify 失败: ${verifyResponse.status()} ${verifyResponse.statusText()}`).toBeTruthy();
  });
});
