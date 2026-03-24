import { expect, test } from '../../src/fixtures/test.fixture.js';
import { captureLivePreview } from '../../src/live-preview.js';

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function readMemberEnv(adapter: any) {
  return {
    baseURL: process.env.E2E_BASE_URL || adapter.baseUrl,
    phone: process.env.E2E_LOGIN_PHONE || '13212344321',
    smsCode: process.env.E2E_LOGIN_CODE || String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
  };
}

async function visualPause(page: any, ms = 1200) {
  if (!process.env.E2E_LIVE_PREVIEW_DIR) return;
  await page.waitForTimeout(ms);
}

async function gotoMemberLoginViaMine(page: any, baseURL: string) {
  await page.goto(`${trimSlash(baseURL)}/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url: URL) => url.pathname.includes('/home'), { timeout: 20_000 });
  await captureLivePreview(page, 'member-home');

  const mineTab = page.locator('.van-tabbar .tabbar-text', { hasText: '我的' }).first();
  await expect(mineTab).toBeVisible({ timeout: 20_000 });
  await mineTab.click();
  await page.waitForURL((url: URL) => url.pathname.includes('/mine'), { timeout: 20_000 });
  await captureLivePreview(page, 'member-mine');

  const loginEntry = page.getByText('立即登录').first();
  await expect(loginEntry).toBeVisible({ timeout: 20_000 });
  await loginEntry.click();
  await page.waitForURL((url: URL) => url.pathname.includes('/login'), { timeout: 20_000 });
  await captureLivePreview(page, 'member-login-page');

  await expect(page.getByText('心易贷客户端')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '获取短信验证码' })).toBeVisible({ timeout: 20_000 });
}

async function loginBySms(page: any, env: ReturnType<typeof readMemberEnv>) {
  const phoneInput = page.getByPlaceholder('请输入手机号').first();
  await expect(phoneInput).toBeVisible({ timeout: 10_000 });
  await phoneInput.fill(env.phone);
  await captureLivePreview(page, 'member-login-phone-filled');

  const agreementIcon = page.locator('.login-checkbox .van-checkbox__icon').first();
  await expect(agreementIcon).toBeVisible({ timeout: 10_000 });
  await agreementIcon.click({ force: true });
  await captureLivePreview(page, 'member-login-agreement-checked');

  const smsBtn = page.getByRole('button', { name: '获取短信验证码' });
  await expect(smsBtn).toBeEnabled({ timeout: 10_000 });

  const checkPhoneReq = page.waitForRequest(
    (req: any) => req.method() === 'POST' && req.url().includes('/member/front/member/phone/status/check'),
    { timeout: 20_000 },
  );
  const smsCodePageReady = page.waitForURL((url: URL) => url.pathname.includes('/smscode'), { timeout: 30_000 });
  await smsBtn.click();
  await Promise.all([checkPhoneReq, smsCodePageReady]);
  await captureLivePreview(page, 'member-smscode-page');

  await expect(page.getByText('请输入验证码')).toBeVisible({ timeout: 15_000 });
  const codeInput = page.locator('.codeInput input').first();
  await expect(codeInput).toBeVisible({ timeout: 10_000 });

  const tokenReq = page.waitForRequest(
    (req: any) => req.method() === 'POST' && req.url().includes('/auth/oauth2/token'),
    { timeout: 20_000 },
  );
  const homeReady = page.waitForURL(
    (url: URL) => !url.pathname.includes('/login') && !url.pathname.includes('/smscode'),
    { timeout: 120_000 },
  );
  await codeInput.fill(env.smsCode);
  await Promise.all([tokenReq, homeReady]);
  await captureLivePreview(page, 'member-login-success');
}

test.describe('Member Login', () => {
  test.setTimeout(300_000);

  test('进入首页 -> 点击我的 -> 立即登录 -> 手机号验证码登录', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'member', '仅 member 执行');
    const env = readMemberEnv(adapter);

    await gotoMemberLoginViaMine(page, env.baseURL);
    await loginBySms(page, env);

    await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('立即登录');
    await expect(page.locator('.van-tabbar .tabbar-text', { hasText: '首页' }).first()).toBeVisible({ timeout: 20_000 });
    await visualPause(page);
  });
});
