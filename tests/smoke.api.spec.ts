import { expect, test } from '../src/fixtures/test.fixture.js';
import { getAdapterApiBaseURL, getAdapterEnv } from '../src/env.js';

test.describe('API Smoke', () => {
  test('可访问指定 API', async ({ request, adapter }, testInfo) => {
    const apiBaseURL = getAdapterApiBaseURL(adapter);
    const smokePath = getAdapterEnv(adapter, 'API_SMOKE_PATH');
    const smokeMethod = (getAdapterEnv(adapter, 'API_SMOKE_METHOD') || 'GET').toUpperCase();
    test.skip(!smokePath, '未设置 E2E_API_SMOKE_PATH，跳过 API health smoke');
    const normalizedSmokePath = smokePath || '';

    const headers = adapter.buildAuthHeaders();
    const url = `${apiBaseURL}${normalizedSmokePath.startsWith('/') ? normalizedSmokePath : `/${normalizedSmokePath}`}`;

    testInfo.annotations.push({
      type: 'api-client',
      description: `${adapter.projectId} | ${smokeMethod} ${url} | CLIENT-TOC=${headers['CLIENT-TOC'] || '-'}`,
    });

    const response = await request.fetch(url, {
      method: smokeMethod,
      headers,
      ...(smokeMethod === 'GET' || smokeMethod === 'HEAD' ? {} : { data: {} }),
    });

    await expect(response, `请求失败: ${response.status()} ${response.statusText()}`).toBeOK();
    if (smokeMethod !== 'HEAD') {
      const text = await response.text();
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
