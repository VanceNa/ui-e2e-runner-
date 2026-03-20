import { expect, test } from '../src/fixtures/test.fixture.js';

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

  test('可访问指定业务首页（需显式设置 E2E_BASE_URL）', async ({ page, adapter }) => {
    test.skip(!process.env.E2E_BASE_URL, '未设置 E2E_BASE_URL，跳过业务站点冒烟');

    await page.goto('/');
    await adapter.homeReadyCheck(page);
  });
});
