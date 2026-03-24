import { loginByPassword } from '../../src/api/auth.js';
import { expect, test } from '../../src/fixtures/admin-auth.fixture.js';
import { bindLivePreview } from '../../src/live-preview.js';

function uniqueId() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${y}${m}${d}${h}${min}${s}${ms}`;
}

function toUpperLetters(seed: string) {
  return seed
    .split('')
    .map((ch) => {
      const n = Number(ch);
      if (Number.isNaN(n)) return 'A';
      return String.fromCharCode(65 + (n % 26));
    })
    .join('');
}

function toChineseNumeral(seed: string) {
  const map = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const n = Number(seed);
  if (Number.isNaN(n)) return '零';
  return map[n % 10];
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function hashUrl(baseUrl: string, path: string) {
  const cleanBase = trimSlash(baseUrl);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}/#${cleanPath}`;
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDefaultPasswordByPhone(phone: string) {
  return `${phone.slice(0, 3)}Hxj${phone.slice(-4)}@`;
}

async function assertLoginPageByCodeDesign(page: any, baseUrl: string) {
  await page.goto(hashUrl(baseUrl, '/login'));
  await page.waitForURL(/#\/login(?:\?.*)?$/, { timeout: 20_000 }).catch(() => {});
  const reloginDialog = page.getByRole('dialog', { name: '系统提示' }).first();
  await reloginDialog.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await reloginDialog.isVisible().catch(() => false)) {
    const confirmBtn = page.getByRole('button', { name: '确认' }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click({ force: true });
    await reloginDialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForURL(/#\/login(?:\?.*)?$/, { timeout: 20_000 }).catch(() => {});
  }
  const phoneTab = page.getByRole('tab', { name: '手机登录' });
  const passwordTab = page.getByRole('tab', { name: '密码登录' });
  await expect(phoneTab).toBeVisible({ timeout: 20_000 });
  await expect(passwordTab).toBeVisible({ timeout: 20_000 });
  await passwordTab.click();
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
  const headers = {
    Authorization: `Bearer ${token}`,
    'CLIENT-TOC': 'MG',
    'TENANT-ID': process.env.E2E_TENANT_ID || '1',
    'Content-Type': 'application/json',
  };
  const [ivResp, saltResp] = await Promise.all([
    request.post(`${apiBaseURL}/admin/secret/vector`, { headers, data: {} }),
    request.post(`${apiBaseURL}/admin/secret/salt`, { headers, data: {} }),
  ]);

  const parseSecret = async (resp: any) => {
    if (!resp.ok()) return '';
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      const value = json?.data ?? json;
      if (typeof value === 'string') return value;
      return '';
    } catch {
      return text;
    }
  };

  const iv = await parseSecret(ivResp);
  const salt = await parseSecret(saltResp);
  return { iv, salt };
}

async function createRole(page: any, roleName: string, roleCode: string) {
  await page.getByRole('button', { name: '新增' }).first().click();
  const dialog = page.locator('.el-dialog').last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('新增', { exact: true })).toBeVisible();

  // 表单基础校验：关键字段和占位文案存在
  await expect(dialog.getByRole('textbox', { name: '角色名称' })).toBeVisible();
  await expect(dialog.getByPlaceholder('请输入角色编码')).toBeVisible();
  await expect(dialog.getByPlaceholder('请输入角色描述')).toBeVisible();

  await dialog.getByRole('textbox', { name: '角色名称' }).fill(roleName);
  // 角色类型默认已选“平台角色”，避免对不稳定下拉做强依赖点击
  await expect(dialog.getByText('平台角色')).toBeVisible();

  await dialog.getByPlaceholder('请输入角色编码').fill(roleCode);
  await dialog.getByPlaceholder('请输入角色描述').fill(`自动化创建-${roleName}`);
  await expect(dialog.getByText('本级及子级')).toBeVisible();

  // 表单校验：确认提交前关键输入值已写入
  await expect(dialog.getByRole('textbox', { name: '角色名称' })).toHaveValue(roleName);
  await expect(dialog.getByPlaceholder('请输入角色编码')).toHaveValue(roleCode);

  await dialog.getByRole('button', { name: '确认' }).click();
  await expect(dialog.locator('.el-form-item__error:visible')).toHaveCount(0);
  await expect(page.getByText('添加成功')).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // 稳定校验：通过查询区精确检索新增角色，再断言列表行出现
  const roleNameQuery = page.getByRole('textbox', { name: '角色名称' }).first();
  await roleNameQuery.fill(roleName);
  await page.getByRole('button', { name: '查询' }).first().click();
  await expect(page.locator('tr').filter({ hasText: roleName }).first()).toBeVisible({ timeout: 20_000 });
}

async function grantAllPermissions(page: any, roleName: string) {
  const row = page.locator('tr').filter({ hasText: roleName }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.scrollIntoViewIfNeeded();

  const authAction = row
    .locator('button:has-text("授权"), .el-button:has-text("授权"), [role="button"]:has-text("授权")')
    .first();
  await expect(authAction).toBeVisible({ timeout: 20_000 });
  await authAction.click();

  const drawer = page.locator('.el-drawer:visible').first();
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  const pcTab = drawer.getByRole('tab', { name: 'PC端' });
  await pcTab.click();
  const panel = drawer.getByRole('tabpanel', { name: 'PC端' });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('.menu-tree-container .el-tree')).toBeVisible({ timeout: 20_000 });

  const locateMenu = (menu: string) =>
    panel
      .locator('.menu-tree-container .custom-tree-node', { hasText: new RegExp(`^\\s*${escapeRegExp(menu)}\\s*$`) })
      .first();

  const ensureExpanded = async (menu: string) => {
    const menuLabel = locateMenu(menu);
    if (!(await menuLabel.isVisible().catch(() => false))) return;
    const node = menuLabel.locator('xpath=ancestor::*[contains(@class,"el-tree-node")]').first();
    const expander = node.locator('.el-tree-node__content .el-tree-node__expand-icon').first();
    if (!(await expander.isVisible().catch(() => false))) return;
    const cls = (await expander.getAttribute('class')) || '';
    if (!cls.includes('expanded')) {
      await expander.click({ force: true }).catch(() => {});
    }
  };

  const ensureChecked = async (menu: string) => {
    const menuLabel = locateMenu(menu);
    if (!(await menuLabel.isVisible().catch(() => false))) return;
    const nodeContent = menuLabel.locator('xpath=ancestor::*[contains(@class,"el-tree-node__content")]').first();
    const checkbox = nodeContent.locator('.el-checkbox__input').first();
    if (!(await checkbox.isVisible().catch(() => false))) return;
    for (let i = 0; i < 3; i += 1) {
      const cls = (await checkbox.getAttribute('class')) || '';
      if (cls.includes('is-checked')) return;
      if (cls.includes('is-disabled')) return;
      await checkbox.click({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await expect(checkbox).toHaveClass(/is-checked/);
  };

  await ensureExpanded('权限后台');
  await ensureChecked('权限后台');

  const permissionRoot = locateMenu('权限后台');
  await expect(permissionRoot).toBeVisible({ timeout: 20_000 });
  await permissionRoot.click({ force: true });

  const checkAll = drawer.locator('.permission-list .check-all .el-checkbox__input:not(.is-checked)').first();
  if (await checkAll.isVisible().catch(() => false)) {
    await checkAll.click({ force: true }).catch(() => {});
  }

  const uncheckedOps = drawer.locator('.permission-list .el-checkbox-group .el-checkbox__input:not(.is-checked)');
  const opCount = await uncheckedOps.count();
  const maxOps = Math.min(opCount, 20);
  for (let j = 0; j < maxOps; j += 1) {
    await uncheckedOps.nth(j).click({ force: true }).catch(() => {});
  }

  // 更新前再次确认“权限后台”根节点已勾选，避免点击没生效却继续保存。
  await ensureChecked('权限后台');

  const updateBtn = drawer.getByRole('button', { name: '更新' });
  await updateBtn.scrollIntoViewIfNeeded();
  await expect(updateBtn).toBeVisible({ timeout: 20_000 });
  await updateBtn.click().catch(async () => {
    await updateBtn.click({ force: true });
  });
  await expect(page.getByText('修改成功')).toBeVisible({ timeout: 20_000 });
}

async function createUser(page: any, username: string, name: string, phone: string, roleName: string) {
  const addBtn = page.locator('.main-box-right .operation-box .el-button:has-text("新增")').first();
  await expect(addBtn).toBeVisible({ timeout: 30_000 });

  // 重试打开“新增用户”弹窗：以“可见弹窗内用户名输入”出现作为唯一成功标准
  const usernameInput = page.locator('.el-dialog:visible input[placeholder="请输入用户名"]').first();
  const visibleDialogs = page.locator('.el-dialog:visible');
  const beforeCount = await visibleDialogs.count();
  let opened = false;
  for (let i = 0; i < 5; i += 1) {
    await addBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    if (await usernameInput.isVisible().catch(() => false)) {
      opened = true;
      break;
    }
    const afterCount = await visibleDialogs.count().catch(() => beforeCount);
    if (afterCount > beforeCount) {
      await page.waitForTimeout(500);
      if (await usernameInput.isVisible().catch(() => false)) {
        opened = true;
        break;
      }
    }
    // 兜底：再试一次普通 click
    await addBtn.click().catch(() => {});
    await page.waitForTimeout(600);
  }
  if (!opened) {
    throw new Error('点击“新增”后未打开人员新增弹窗（请输入用户名未出现）');
  }

  // 以已可见的“用户名输入框”为锚点，反向定位所属弹窗，避免 filter({ has }) 在复杂弹窗场景下偶发失配。
  const dialog = usernameInput.locator('xpath=ancestor::*[contains(@class,"el-dialog")]').first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  await usernameInput.fill(username);
  await dialog.getByPlaceholder('请输入姓名').fill(name);
  await dialog.getByPlaceholder('请输入手机号').fill(phone);

  const roleWrapper = dialog.locator('.el-form-item:has(label:has-text("角色")) .el-select__wrapper').first();
  await roleWrapper.scrollIntoViewIfNeeded();
  await roleWrapper.click({ force: true });
  const roleDropdown = page.locator('.el-select-dropdown:visible').last();
  await expect(roleDropdown).toBeVisible({ timeout: 10_000 });
  const roleOption = roleDropdown.locator('.el-select-dropdown__item').filter({ hasText: roleName }).first();
  await expect(roleOption).toBeVisible({ timeout: 10_000 });
  await roleOption.click({ force: true });
  await dialog.getByText('新增', { exact: true }).click({ force: true });
  await expect(dialog.locator('.el-form-item:has(label:has-text("角色")) .el-tag, .el-form-item:has(label:has-text("角色")) .el-select__selected-item').first()).toContainText(roleName);

  const deptWrapper = dialog.locator('.el-form-item:has(label:has-text("机构")) .el-select__wrapper').first();
  await deptWrapper.scrollIntoViewIfNeeded();
  await deptWrapper.click({ force: true });
  const deptTreeNode = page.locator('.el-tree-select__popper:visible .el-tree-node[aria-disabled="false"]').first();
  await expect(deptTreeNode).toBeVisible({ timeout: 10_000 });
  await deptTreeNode.click();
  await dialog.getByText('新增', { exact: true }).click({ force: true });

  await dialog.getByRole('textbox', { name: '邮箱' }).fill(`${username}@autotest.local`);
  await expect(dialog.getByPlaceholder('请输入用户名')).toHaveValue(username);
  await expect(dialog.getByPlaceholder('请输入姓名')).toHaveValue(name);
  await expect(dialog.getByPlaceholder('请输入手机号')).toHaveValue(phone);
  await dialog.getByRole('button', { name: '确认' }).click();

  const formErrors = dialog.locator('.el-form-item__error:visible');
  const errorToast = page.locator('.el-message--error .el-message__content').first();
  const successToast = page.getByText('添加成功');

  for (let i = 0; i < 50; i += 1) {
    if (await successToast.isVisible().catch(() => false)) {
      break;
    }
    const errorCount = await formErrors.count();
    if (errorCount > 0) {
      const messages = (await formErrors.allTextContents()).map((x: string) => x.trim()).filter(Boolean);
      throw new Error(`新增用户表单校验失败: ${messages.join(' | ')}`);
    }
    if (await errorToast.isVisible().catch(() => false)) {
      const msg = ((await errorToast.textContent()) || '').trim();
      throw new Error(`新增用户接口失败: ${msg}`);
    }
    await page.waitForTimeout(400);
  }

  await expect(successToast).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('cell', { name: username })).toBeVisible({ timeout: 20_000 });
}

test.describe('Admin Onboarding E2E', () => {
  test.setTimeout(600_000);
  test(
    'UI+API: 账号密码登录 -> 新增角色 -> 授权全权限 -> 新增账号 -> 新账号登录',
    async ({ adapter, page, request, adminSession, browser }, testInfo) => {
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
      const shortId = id.slice(-8);
      const roleName = `ar${shortId}`;
      const roleCode = `AR_${toUpperLetters(shortId)}`;
      const username = `auto${id}`.slice(0, 20);
      const displayName = `测试员${toChineseNumeral(id.slice(-3))}`;
      const phone = `13${id.slice(-9).replace(/\D/g, '0')}`;
      const userPassword = buildDefaultPasswordByPhone(phone);
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
      await createUser(page, username, displayName, phone, roleName);
      testInfo.annotations.push({
        type: 'default-password',
        description: '使用默认密码规则登录：手机号前3位 + Hxj + 后4位 + @',
      });

      // 纯 UI 校验：使用全新浏览器上下文登录新账号，避免旧 admin 会话污染。
      const verifyContext = await browser.newContext({ ignoreHTTPSErrors: true });
      const verifyPage = await verifyContext.newPage();
      const stopVerifyPreview = bindLivePreview(verifyPage, 'verify-page');
      try {
        const newUserSession = await loginByPassword(request, {
          apiBaseURL: adminSession.apiBaseURL,
          username,
          password: userPassword,
          adapter,
        });
        expect(newUserSession.accessToken).toBeTruthy();

        await assertLoginPageByCodeDesign(verifyPage, adminSession.baseURL);
        await fillPasswordLogin(verifyPage, username, userPassword, uiCaptchaCode);
        await verifyPage.goto(hashUrl(adminSession.baseURL, '/'));
        await adapter.homeReadyCheck(verifyPage).catch(() => {});
        const landedOnHome = await verifyPage
          .waitForURL(/#\/(home\/index|\/|home)/, { timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (!landedOnHome) {
          throw new Error(
            `新账号 API 登录成功，但 UI 登录后仍停留在 ${verifyPage.url()}。这通常表示新账号缺少首页/菜单权限，或前端会话初始化未完成。`,
          );
        }
        await expect(verifyPage.locator('body')).not.toContainText('登录');
        await expect(verifyPage.getByText(displayName).first()).toBeVisible({ timeout: 20_000 });
      } finally {
        stopVerifyPreview();
        if (process.env.E2E_PAUSE_ON_END === '1') {
          await verifyPage.pause();
        }
        await verifyContext.close();
      }

    },
  );
});
