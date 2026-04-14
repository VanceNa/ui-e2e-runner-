import { expect, test } from '../src/fixtures/test.fixture.js';
import { getAdapterBaseURL } from '../src/env.js';

test.describe('UI Smoke', () => {
  test('本地页面可完成基础渲染（MVP默认用例）', async ({ page }) => {
    await page.setContent(`
      <main>
        <h1 data-testid="title">ui-e2e-runner</h1>
        <button type="button" data-testid="action">Run</button>
      </main>
    `);

    await expect(page.getByTestId('title')).toHaveText('ui-e2e-runner');
    await expect(page.getByTestId('action')).toBeEnabled();
  });

  test('打印当前目标项目信息', async ({ adapter }) => {
    test.info().annotations.push({
      type: 'target-project',
      description: `${adapter.projectId} | ${adapter.description} | ${adapter.baseUrl}`,
    });
    expect(adapter.projectId).toBeTruthy();
  });

  test('可访问当前项目配置的业务首页', async ({ page, adapter }) => {
    const baseURL = getAdapterBaseURL(adapter);
    test.skip(!baseURL, '未设置业务 baseURL，跳过业务站点冒烟');

    await page.goto(baseURL);
    await adapter.homeReadyCheck(page);
  });
});
