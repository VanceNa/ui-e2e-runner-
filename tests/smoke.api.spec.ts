import { expect, test } from '../src/fixtures/test.fixture.js';

test.describe('API Smoke', () => {
  test('可访问指定 API（需显式设置 E2E_API_BASE_URL）', async ({ request, adapter }, testInfo) => {
    const apiBaseURL = process.env.E2E_API_BASE_URL;
    test.skip(!apiBaseURL, '未设置 E2E_API_BASE_URL，跳过业务 API 冒烟');

    const headers = adapter.buildAuthHeaders();
    testInfo.annotations.push({
      type: 'api-client',
      description: `${adapter.projectId} | CLIENT-TOC=${headers['CLIENT-TOC'] || '-'}`,
    });

    const response = await request.post(`${apiBaseURL}/admin/secret/systemTime`, {
      headers,
      data: {},
    });

    expect(response.ok(), `请求失败: ${response.status()} ${response.statusText()}`).toBeTruthy();
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });
});
