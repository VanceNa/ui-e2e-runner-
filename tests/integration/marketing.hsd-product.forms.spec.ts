import { expect, test } from '../../src/fixtures/test.fixture.js';

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function readMarketingEnv(adapter: any) {
  return {
    baseURL: process.env.E2E_BASE_URL || adapter.baseUrl,
    loginMethod: (process.env.E2E_LOGIN_METHOD || 'sms').toLowerCase(),
    phone: process.env.E2E_LOGIN_PHONE || '13212344321',
    smsCode: process.env.E2E_LOGIN_CODE || String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    username: process.env.E2E_LOGIN_USERNAME || '',
    password: process.env.E2E_LOGIN_PASSWORD || '',
    contractStateName: process.env.E2E_HSD_CONTRACT_STATE_NAME || '合同开立',
    contractButtonText: process.env.E2E_HSD_CONTRACT_BUTTON_TEXT || '开立',
    offlineStateName: process.env.E2E_HSD_OFFLINE_STATE_NAME || '线下面签录入',
    offlineButtonText: process.env.E2E_HSD_OFFLINE_BUTTON_TEXT || '录入',
    uploadStateName: process.env.E2E_HSD_UPLOAD_STATE_NAME || '用信审批',
    uploadButtonText: process.env.E2E_HSD_UPLOAD_BUTTON_TEXT || '用信资料',
  };
}

function randomSixDigits() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

async function switchToPasswordMode(page: any) {
  const usernameInput = page.getByPlaceholder('请输入账号');
  if (await usernameInput.isVisible().catch(() => false)) return;
  await page.locator('.login-switch span').first().click();
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
}

async function loginByPasswordUI(page: any, env: ReturnType<typeof readMarketingEnv>) {
  await page.goto(`${trimSlash(env.baseURL)}/login`, { waitUntil: 'domcontentloaded' });
  await switchToPasswordMode(page);

  await page.getByPlaceholder('请输入账号').fill(env.username);
  await page.getByPlaceholder('请输入密码').fill(env.password);

  const loginBtn = page.getByRole('button', { name: '密码登录' });
  await expect(loginBtn).toBeEnabled();

  const loginReq = page.waitForRequest(
    (req: any) => req.method() === 'POST' && req.url().includes('/auth/oauth2/token'),
    { timeout: 20_000 },
  );
  await loginBtn.click();
  await loginReq;
  const hasCaptcha = await page.frameLocator('iframe').getByText('拖动下方滑块完成拼图').isVisible().catch(() => false);
  if (hasCaptcha) {
    throw new Error(
      `当前环境出现滑块验证码，非预期登录路径。请确认 E2E_BASE_URL（当前: ${env.baseURL}）是否为你日常手工登录且无需验证码的环境。`,
    );
  }
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 120_000 });
}

async function loginBySmsUI(page: any, env: ReturnType<typeof readMarketingEnv>) {
  await page.goto(`${trimSlash(env.baseURL)}/login`, { waitUntil: 'domcontentloaded' });
  const smsModeLabel = page.getByText('验证码登录').first();
  await expect(smsModeLabel).toBeVisible({ timeout: 10_000 });

  const phoneInput = page.getByPlaceholder('请输入手机号').first();
  await expect(phoneInput).toBeVisible({ timeout: 10_000 });
  await phoneInput.fill(env.phone);

  const smsLoginBtn = page.getByRole('button', { name: '验证码登录' });
  await expect(smsLoginBtn).toBeEnabled();

  const checkManagerReq = page.waitForRequest(
    (req: any) => req.method() === 'POST' && req.url().includes('/marketing/front/market/check'),
    { timeout: 20_000 },
  );
  const smsCodePageReady = page.waitForURL((url: URL) => url.pathname.includes('/smscode'), { timeout: 30_000 });
  await smsLoginBtn.click();
  await Promise.all([checkManagerReq, smsCodePageReady]);
  await expect(page.getByText('请输入验证码')).toBeVisible({ timeout: 15_000 });

  const codeInput = page.locator('.codeInput .van-field input').first();
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  const tokenReq = page.waitForRequest(
    (req: any) => req.method() === 'POST' && req.url().includes('/auth/oauth2/token'),
    { timeout: 20_000 },
  );
  const homeReady = page.waitForURL(
    (url: URL) => !url.pathname.includes('/login') && !url.pathname.includes('/smscode'),
    { timeout: 120_000 },
  );
  await codeInput.fill(env.smsCode || randomSixDigits());

  // 兼容两种实现：
  // 1. 输入满 6 位后自动登录跳首页
  // 2. 输入满 6 位后仍需点击“登录”
  const loginButton = page.getByRole('button', { name: '登录' }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click().catch(() => {});
  }

  await Promise.all([tokenReq, homeReady]);
}

async function loginByPreferredMethod(page: any, env: ReturnType<typeof readMarketingEnv>) {
  if (env.loginMethod === 'password') {
    await loginByPasswordUI(page, env);
    return;
  }
  await loginBySmsUI(page, env);
}

async function gotoHsdListViaMenu(page: any, baseURL: string) {
  await page.goto(`${trimSlash(baseURL)}/home`, { waitUntil: 'domcontentloaded' });
  const entryTab = page.locator('.van-tabbar .tabbar-text', { hasText: '进件' }).first();
  await expect(entryTab).toBeVisible({ timeout: 20_000 });
  await entryTab.click();
  await page.waitForURL((url: URL) => url.pathname.includes('/application/index'), { timeout: 20_000 });

  // application 页里可能存在多个“客户进件”入口，这里优先命中带“惠时代”语义的卡片。
  const hsdEntryCandidates = [
    page.locator('.menu-card .menu-item', { hasText: /惠时代.*客户进件|客户进件.*惠时代/ }).first(),
    page.locator('.menu-card .menu-item').filter({ hasText: '客户进件' }).first(),
  ];
  let hsdEntry = hsdEntryCandidates[0];
  for (const candidate of hsdEntryCandidates) {
    if (await candidate.isVisible().catch(() => false)) {
      hsdEntry = candidate;
      break;
    }
  }
  await expect(hsdEntry).toBeVisible({ timeout: 20_000 });
  await hsdEntry.click();
  await page.waitForURL((url: URL) => url.pathname.includes('/directedProduct/list/hsd'), { timeout: 20_000 });

  await expect(page.locator('.hsd-hsdProductList .card-list, .hsd-hsdProductList .van-empty')).toBeVisible({
    timeout: 20_000,
  });
}

async function filterByState(page: any, stateName: string) {
  const stateFilterBtn = page.locator('.hsd-filter-buttons .van-button').first();
  await expect(stateFilterBtn).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_000);
  await stateFilterBtn.click();

  const allStateOption = page.locator('.hsd-sheet-filter .sheet-filter-item', { hasText: '全部状态' }).first();
  if (await allStateOption.isVisible().catch(() => false)) {
    await allStateOption.click();
    await page.waitForTimeout(500);
    await stateFilterBtn.click();
  }

  const stateOption = page.locator('.hsd-sheet-filter .sheet-filter-item', { hasText: stateName }).first();
  await expect(stateOption).toBeVisible({ timeout: 10_000 });
  await stateOption.click();
  // 状态切换后列表接口偶发较慢，等待筛选弹层消失并给列表刷新留出时间。
  await page.locator('.hsd-sheet-filter').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
}

async function openFormFromCard(page: any, actionText: string) {
  const cardActionBtn = page
    .locator('.hsd-order-card .van-button')
    .filter({ hasText: actionText })
    .first();
  await expect(cardActionBtn).toBeVisible({ timeout: 20_000 });
  await cardActionBtn.click();
  await page.waitForTimeout(500);
}

function getPrimarySubmitButton(page: any) {
  return page.getByRole('button', { name: /确认无误，提交|提交/ }).first();
}

function getFieldInput(page: any, label: string) {
  return page
    .locator('.van-field')
    .filter({ hasText: label })
    .first()
    .locator('textarea, input')
    .first();
}

function getFieldRow(page: any, label: string) {
  return page.locator('.van-field').filter({ hasText: label }).first();
}

function getFieldRows(page: any, label: string) {
  return page.locator('.van-field').filter({ hasText: label });
}

async function visualPause(page: any, ms = 500) {
  if (!process.env.E2E_LIVE_PREVIEW_DIR) return;
  await page.waitForTimeout(ms);
}

async function submitAndAssertRequest(page: any, endpointPath: string) {
  const submitBtn = getPrimarySubmitButton(page);
  await expect(submitBtn).toBeVisible({ timeout: 20_000 });
  await expect(submitBtn).toBeEnabled({ timeout: 20_000 });

  const submitReq = page.waitForRequest(
    (req: any) => req.method() === 'POST' && req.url().includes(endpointPath),
    { timeout: 20_000 },
  );
  await submitBtn.click({ force: true });

  await page
    .getByRole('button', { name: '确认' })
    .last()
    .click({ timeout: 1_500 })
    .catch(() => {});

  await submitReq;
}

test.describe('Marketing HSD Product Forms', () => {
  test.setTimeout(600_000);

  test('登录页校验与密码登录接口', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 执行');
    const env = readMarketingEnv(adapter);
    if (env.loginMethod === 'password') {
      test.skip(!env.username || !env.password, '密码登录模式需配置 E2E_LOGIN_USERNAME / E2E_LOGIN_PASSWORD');
    } else {
      test.skip(!env.phone, '短信登录模式需配置 E2E_LOGIN_PHONE');
    }

    await loginByPreferredMethod(page, env);
  });

  test('合同开立: 列表进入 + 字段校验 + 提交接口', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 执行');
    const env = readMarketingEnv(adapter);
    if (env.loginMethod === 'password') {
      test.skip(!env.username || !env.password, '密码登录模式需配置 E2E_LOGIN_USERNAME / E2E_LOGIN_PASSWORD');
    } else {
      test.skip(!env.phone, '短信登录模式需配置 E2E_LOGIN_PHONE');
    }

    await loginByPreferredMethod(page, env);
    await gotoHsdListViaMenu(page, env.baseURL);
    await filterByState(page, env.contractStateName);
    await openFormFromCard(page, env.contractButtonText);

    await expect(page.getByText('合同开立')).toBeVisible({ timeout: 20_000 });

    const payModeRow = getFieldRow(page, '支付方式');
    const payModeInput = payModeRow.locator('input, textarea').first();
    const linkedLabels = ['受托支付是否他行', '受托支付账户类型', '受托支付账户户名', '受托支付账户账号', '受托支付联行号'];

    await expect(payModeInput).toHaveValue(/受托支付/);
    for (const linkedLabel of linkedLabels) {
      await expect(getFieldRow(page, linkedLabel)).toBeVisible({ timeout: 10_000 });
    }
    await visualPause(page, 800);

    // 支付方式联动：切到非“受托支付”后，受托相关字段应隐藏；切回“受托支付”后应恢复显示。
    const payModeSheet = page.locator('.van-action-sheet:visible').last();
    await payModeRow.click({ force: true });
    await expect(payModeSheet).toBeVisible({ timeout: 10_000 });
    const payModeOptions = payModeSheet.locator('.sheet-filter-item');
    await expect(payModeOptions.first()).toBeVisible({ timeout: 10_000 });
    const optionCount = await payModeOptions.count();
    let switched = false;
    for (let i = 0; i < optionCount; i += 1) {
      const option = payModeOptions.nth(i);
      const text = ((await option.textContent()) || '').trim();
      if (!text || text.includes('受托支付')) continue;
      await option.click();
      switched = true;
      break;
    }
    if (switched) {
      await expect(payModeInput).not.toHaveValue(/受托支付/);
      for (const linkedLabel of linkedLabels) {
        await expect(getFieldRows(page, linkedLabel)).toHaveCount(0);
      }
      await visualPause(page, 800);

      await payModeRow.click({ force: true });
      await expect(payModeSheet).toBeVisible({ timeout: 10_000 });
      const entrustedOption = payModeSheet.locator('.sheet-filter-item', { hasText: '受托支付' }).first();
      await expect(entrustedOption).toBeVisible({ timeout: 10_000 });
      await entrustedOption.click();
      await expect(payModeInput).toHaveValue(/受托支付/);
      for (const linkedLabel of linkedLabels) {
        await expect(getFieldRow(page, linkedLabel)).toBeVisible({ timeout: 10_000 });
      }
      await visualPause(page, 800);
    }

    const loanAccInput = getFieldInput(page, '放款账号');
    const loanAccNameInput = getFieldInput(page, '放款账号户名');
    const repayAccInput = getFieldInput(page, '还款账号');
    const repayAccNameInput = getFieldInput(page, '还款账号户名');
    const entrustedAccNameInput = getFieldInput(page, '受托支付账户户名');
    const entrustedAccInput = getFieldInput(page, '受托支付账户账号');
    const entrustedBankDeptInput = getFieldInput(page, '受托支付联行号');

    const originalLoanAcc = await loanAccInput.inputValue();
    const originalLoanAccName = await loanAccNameInput.inputValue();
    const originalRepayAcc = await repayAccInput.inputValue();
    const originalRepayAccName = await repayAccNameInput.inputValue();
    const originalEntrustedAccName = await entrustedAccNameInput.inputValue();
    const originalEntrustedAcc = await entrustedAccInput.inputValue();
    const originalEntrustedBankDept = await entrustedBankDeptInput.inputValue();

    const requiredFieldChecks = [
      { label: '放款账号', input: loanAccInput, original: originalLoanAcc, message: '请输入放款账号' },
      { label: '放款账号户名', input: loanAccNameInput, original: originalLoanAccName, message: '请输入放款账号户名' },
      { label: '还款账号', input: repayAccInput, original: originalRepayAcc, message: '请输入还款账号' },
      { label: '还款账号户名', input: repayAccNameInput, original: originalRepayAccName, message: '请输入还款账号户名' },
      { label: '受托支付账户户名', input: entrustedAccNameInput, original: originalEntrustedAccName, message: '请输入受托支付账户户名' },
      { label: '受托支付账户账号', input: entrustedAccInput, original: originalEntrustedAcc, message: '请输入受托支付账户账号' },
      { label: '受托支付联行号', input: entrustedBankDeptInput, original: originalEntrustedBankDept, message: '请输入受托支付联行号' },
    ];

    for (const field of requiredFieldChecks) {
      await field.input.fill('');
      await visualPause(page, 600);
      await getPrimarySubmitButton(page).click({ force: true });
      await expect(page.getByText(field.message)).toBeVisible({ timeout: 10_000 });
      await field.input.fill(field.original);
      await expect(field.input).toHaveValue(field.original);
      await visualPause(page, 500);
    }

    // 数字字段校验：非数字字符应被过滤，且长度不超过配置值。
    await loanAccInput.fill('abc12345678901234567890');
    await visualPause(page, 600);
    const normalizedLoanAcc = await loanAccInput.inputValue();
    expect(normalizedLoanAcc).toMatch(/^\d+$/);
    expect(normalizedLoanAcc.length).toBeLessThanOrEqual(19);
    expect(normalizedLoanAcc.length).toBeGreaterThan(0);

    await repayAccInput.fill('repay-62223344xyz');
    await visualPause(page, 600);
    const normalizedRepayAcc = await repayAccInput.inputValue();
    expect(normalizedRepayAcc).toMatch(/^\d+$/);
    expect(normalizedRepayAcc).toContain('62223344');

    await entrustedAccInput.fill('acct-9988xy');
    await visualPause(page, 600);
    const normalizedEntrustedAcc = await entrustedAccInput.inputValue();
    expect(normalizedEntrustedAcc).toMatch(/^\d+$/);
    expect(normalizedEntrustedAcc).toContain('9988');

    // 文本字段校验：允许修改并成功回填。
    const updatedLoanAccName = `${originalLoanAccName}-测`;
    await loanAccNameInput.fill(updatedLoanAccName);
    await expect(loanAccNameInput).toHaveValue(updatedLoanAccName);
    await visualPause(page, 600);

    // 回填关键字段，保证后续提交接口仍走通。
    await loanAccInput.fill(originalLoanAcc);
    await repayAccInput.fill(originalRepayAcc);
    await repayAccNameInput.fill(originalRepayAccName);
    await entrustedAccNameInput.fill(originalEntrustedAccName);
    await entrustedAccInput.fill(originalEntrustedAcc);
    await entrustedBankDeptInput.fill(originalEntrustedBankDept);
    await loanAccNameInput.fill(originalLoanAccName);
    await visualPause(page, 800);

    await submitAndAssertRequest(page, '/order/front/order_access/addOrderCreditApplyContract');
  });

  test('线下面签: 列表进入 + 受托支付字段校验 + 提交接口', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 执行');
    const env = readMarketingEnv(adapter);
    if (env.loginMethod === 'password') {
      test.skip(!env.username || !env.password, '密码登录模式需配置 E2E_LOGIN_USERNAME / E2E_LOGIN_PASSWORD');
    } else {
      test.skip(!env.phone, '短信登录模式需配置 E2E_LOGIN_PHONE');
    }

    await loginByPreferredMethod(page, env);
    await gotoHsdListViaMenu(page, env.baseURL);
    await filterByState(page, env.offlineStateName);
    await openFormFromCard(page, env.offlineButtonText);

    const offlineTitle = page.locator('.formHeader-text-title', { hasText: '线下面签补录' }).first();
    await expect(offlineTitle).toBeVisible({
      timeout: 20_000,
    });
    const entrustedField = page.locator('.van-field').filter({ hasText: '受托支付信息' }).first();
    await expect(entrustedField).toHaveClass(/finished/);
    await expect(entrustedField.locator('input, textarea').first()).toHaveValue(/已完善/);
    await expect(getPrimarySubmitButton(page)).toBeVisible({ timeout: 20_000 });

    const currentUrl = page.url();
    await entrustedField.click();
    await page.waitForURL((url: URL) => url.href !== currentUrl, { timeout: 20_000 }).catch(() => {});
    await expect(page.getByText('受托支付信息').first()).toBeVisible({ timeout: 20_000 });

    const bankNameInput = page
      .locator('.van-field')
      .filter({ hasText: '开户行名' })
      .first()
      .locator('textarea, input')
      .first();
    await bankNameInput.fill('');

    await getPrimarySubmitButton(page).click({ force: true });
    await expect(page.getByText('请输入开户行名')).toBeVisible({ timeout: 10_000 });

    await submitAndAssertRequest(page, '/order/front/order_access/addOrderCreditApplyOfflineSign');
  });

  test('资料上传: 列表进入 + 提交接口', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 执行');
    const env = readMarketingEnv(adapter);
    if (env.loginMethod === 'password') {
      test.skip(!env.username || !env.password, '密码登录模式需配置 E2E_LOGIN_USERNAME / E2E_LOGIN_PASSWORD');
    } else {
      test.skip(!env.phone, '短信登录模式需配置 E2E_LOGIN_PHONE');
    }

    await loginByPreferredMethod(page, env);
    await gotoHsdListViaMenu(page, env.baseURL);
    await filterByState(page, env.uploadStateName);
    await openFormFromCard(page, env.uploadButtonText);

    await expect(page.getByText('用信资料').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('产调').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('抵押受理单').first()).toBeVisible({ timeout: 20_000 });
    await expect(getPrimarySubmitButton(page)).toBeVisible({ timeout: 20_000 });
    await submitAndAssertRequest(page, '/order/front/order_access/addOrderImgInformation');
  });
});
