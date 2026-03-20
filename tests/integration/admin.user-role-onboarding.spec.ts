import { loginByPassword } from '../../src/api/auth.js';
import { expect, test } from '../../src/fixtures/admin-auth.fixture.js';

function uniqueId() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function hashUrl(baseUrl: string, path: string) {
  const cleanBase = trimSlash(baseUrl);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}/#${cleanPath}`;
}

async function assertLoginPageByCodeDesign(page: any, baseUrl: string) {
  await page.goto(hashUrl(baseUrl, '/login'));
  await expect(page.locator('.login-title-zh')).toHaveText('登录', { timeout: 20_000 });
  await expect(page.getByRole('tab', { name: '手机登录' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '密码登录' })).toBeVisible();
  await page.getByRole('tab', { name: '密码登录' }).click();
  await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
  await expect(page.getByPlaceholder('请输入密码')).toBeVisible();
  await expect(page.getByPlaceholder('请输入验证码')).toBeVisible();
  await expect(page.getByRole('button', { name: '立即登录' })).toBeVisible();
}

async function fillPasswordLogin(page: any, username: string, password: string, imageCode: string) {
  await page.getByPlaceholder('请输入用户名').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByPlaceholder('请输入验证码').fill(imageCode);
  await page.getByRole('button', { name: '立即登录' }).click();
  await page.waitForTimeout(1500);
}

async function fetchAdminSecrets(request: any, apiBaseURL: string, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const [ivResp, saltResp] = await Promise.all([
    request.post(`${apiBaseURL}/admin/secret/vector`, { headers, data: {} }),
    request.post(`${apiBaseURL}/admin/secret/salt`, { headers, data: {} }),
  ]);
  const iv = ivResp.ok() ? (await ivResp.text()) : '';
  const salt = saltResp.ok() ? (await saltResp.text()) : '';
  return { iv, salt };
}

async function createRole(page: any, roleName: string, roleCode: string) {
  await page.getByRole('button', { name: '新增' }).first().click();
  await page.getByRole('textbox', { name: '角色名称' }).fill(roleName);
  await page.getByRole('combobox', { name: '角色类型' }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('textbox', { name: '角色编码' }).fill(roleCode);
  await page.getByRole('textbox', { name: '角色描述' }).fill(`自动化创建-${roleName}`);
  await page.getByRole('combobox', { name: '数据权限' }).click();
  await page.getByRole('option', { name: '本级及子级' }).click();
  await page.getByRole('button', { name: '确认' }).last().click();
  await expect(page.getByText('添加成功')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('cell', { name: roleName })).toBeVisible({ timeout: 20_000 });
}

async function grantAllPermissions(page: any, roleName: string) {
  const row = page.locator('tr').filter({ hasText: roleName }).first();
  await row.getByRole('button', { name: '授权' }).click();
  const drawer = page.locator('.el-drawer').last();
  await expect(drawer).toBeVisible({ timeout: 15_000 });

  for (let i = 0; i < 3; i += 1) {
    const expanders = drawer.locator('.el-tree-node__expand-icon:not(.expanded)');
    const count = await expanders.count();
    for (let idx = 0; idx < count; idx += 1) {
      await expanders.nth(idx).click().catch(() => {});
    }
  }

  const unchecked = drawer.locator('.el-tree .el-checkbox:not(.is-checked)');
  const uncheckedCount = await unchecked.count();
  for (let i = 0; i < uncheckedCount; i += 1) {
    await unchecked.nth(i).click().catch(() => {});
  }

  const menuLabels = drawer.locator('.custom-tree-node');
  const menuCount = await menuLabels.count();
  for (let i = 0; i < Math.min(menuCount, 200); i += 1) {
    await menuLabels.nth(i).click().catch(() => {});
    const checkAll = drawer.locator('.permission-list .check-all .el-checkbox__input:not(.is-checked)').first();
    if (await checkAll.isVisible().catch(() => false)) {
      await checkAll.click().catch(() => {});
    }
  }

  await drawer.getByRole('button', { name: '更新' }).click();
  await expect(page.getByText('修改成功')).toBeVisible({ timeout: 20_000 });
}

async function createUser(page: any, username: string, phone: string, roleName: string) {
  await page.getByRole('button', { name: '新增' }).first().click();
  const dialog = page.locator('.el-dialog').last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByRole('textbox', { name: '用户名' }).fill(username);
  await dialog.getByRole('textbox', { name: '姓名' }).fill(username);
  await dialog.getByRole('textbox', { name: '手机号' }).fill(phone);

  await dialog.getByRole('combobox', { name: '角色' }).click();
  await page.getByRole('option', { name: roleName }).click();

  await dialog.getByRole('combobox', { name: '机构' }).click();
  await page.locator('.el-tree-select__popper .el-tree-node[aria-disabled="false"]').first().click();

  await dialog.getByRole('textbox', { name: '邮箱' }).fill(`${username}@autotest.local`);
  await dialog.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('添加成功')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('cell', { name: username })).toBeVisible({ timeout: 20_000 });
}

async function setUserPassword(page: any, username: string, password: string) {
  const row = page.locator('tr').filter({ hasText: username }).first();
  await row.getByRole('button', { name: '密码' }).click();
  const dialog = page.locator('.el-dialog').filter({ hasText: '修改密码' }).last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByPlaceholder('请输入新密码').fill(password);
  await dialog.getByPlaceholder('请重复密码').fill(password);
  await dialog.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('密码修改成功')).toBeVisible({ timeout: 20_000 });
}

test.describe('Admin Onboarding E2E', () => {
  test(
    'UI+API: 账号密码登录 -> 新增角色 -> 授权全权限 -> 新增账号 -> 新账号登录',
    async ({ adapter, page, request, adminSession }, testInfo) => {
      test.skip(adapter.projectId !== 'admin', '仅 admin 执行');
      test.skip(testInfo.project.name !== 'chromium-desktop', '仅 desktop 执行');
      test.skip(!adminSession, '未配置 admin 登录环境变量');
      if (!adminSession) return;
      const hostKeyword = process.env.E2E_ADMIN_HOST_KEYWORD || 'xydb';
      if (!adminSession.baseURL.includes(hostKeyword)) {
        throw new Error(
          `当前 E2E_BASE_URL=${adminSession.baseURL} 不是 PC 运营端域名（应包含 ${hostKeyword}），请改为例如 https://xydb-release.local.hzzxf.com`,
        );
      }

      const id = uniqueId();
      const roleName = `auto-role-${id}`;
      const roleCode = `AUTO_ROLE_${id}`;
      const username = `auto${id}`.slice(0, 20);
      const userPassword = process.env.E2E_NEW_USER_PASSWORD || 'Abcd1234@';
      const phone = `13${id.slice(-9)}`;
      const uiCaptchaCode = process.env.E2E_LOGIN_IMAGE_CODE || '1234';

      await assertLoginPageByCodeDesign(page, adminSession.baseURL);
      await fillPasswordLogin(
        page,
        process.env.E2E_LOGIN_USERNAME || '',
        process.env.E2E_LOGIN_PASSWORD || '',
        uiCaptchaCode,
      );
      const secrets = await fetchAdminSecrets(request, adminSession.apiBaseURL, adminSession.accessToken);
      await adapter.injectSession(page, adminSession.accessToken, secrets.salt, secrets.iv);
      await page.goto(hashUrl(adminSession.baseURL, '/'));
      await adapter.homeReadyCheck(page);

      await page.goto(hashUrl(adminSession.baseURL, '/admin/system/role/index'));
      await createRole(page, roleName, roleCode);
      await grantAllPermissions(page, roleName);

      await page.goto(hashUrl(adminSession.baseURL, '/admin/system/user/index'));
      await createUser(page, username, phone, roleName);
      await setUserPassword(page, username, userPassword);

      const newUserSession = await loginByPassword(request, {
        apiBaseURL: adminSession.apiBaseURL,
        username,
        password: userPassword,
        adapter,
      });
      expect(newUserSession.accessToken).toBeTruthy();

      const newUserSecrets = await fetchAdminSecrets(request, adminSession.apiBaseURL, newUserSession.accessToken);
      await adapter.injectSession(page, newUserSession.accessToken, newUserSecrets.salt, newUserSecrets.iv);
      await page.goto(hashUrl(adminSession.baseURL, '/'));
      await adapter.homeReadyCheck(page);

      if (process.env.E2E_PAUSE_ON_END === '1') {
        await page.pause();
      }
    },
  );
});
