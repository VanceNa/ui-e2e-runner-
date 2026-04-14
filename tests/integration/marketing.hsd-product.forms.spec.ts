import { expect, test } from '../../src/fixtures/test.fixture.js';
import { getAdapterBaseURL, getAdapterEnv } from '../../src/env.js';

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function readMarketingEnv(adapter: any) {
  return {
    baseURL: getAdapterBaseURL(adapter),
    loginMethod: (getAdapterEnv(adapter, 'LOGIN_METHOD') || 'sms').toLowerCase(),
    phone: getAdapterEnv(adapter, 'LOGIN_PHONE') || '13212344321',
    smsCode: getAdapterEnv(adapter, 'LOGIN_CODE') || String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    username: getAdapterEnv(adapter, 'LOGIN_USERNAME') || '',
    password: getAdapterEnv(adapter, 'LOGIN_PASSWORD') || '',
    contractStateName: getAdapterEnv(adapter, 'HSD_CONTRACT_STATE_NAME') || '合同开立',
    contractButtonText: getAdapterEnv(adapter, 'HSD_CONTRACT_BUTTON_TEXT') || '开立',
    offlineStateName: getAdapterEnv(adapter, 'HSD_OFFLINE_STATE_NAME') || '线下面签录入',
    offlineButtonText: getAdapterEnv(adapter, 'HSD_OFFLINE_BUTTON_TEXT') || '录入',
    uploadStateName: getAdapterEnv(adapter, 'HSD_UPLOAD_STATE_NAME') || '用信审批',
    uploadButtonText: getAdapterEnv(adapter, 'HSD_UPLOAD_BUTTON_TEXT') || '用信资料',
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

  const leftLoginPage = await page
    .waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (leftLoginPage) {
    return;
  }

  const hasCaptcha = await page
    .frameLocator('iframe')
    .getByText('拖动下方滑块完成拼图')
    .isVisible()
    .catch(() => false);
  if (hasCaptcha) {
    throw new Error(
      `登录后仍停留在登录页，且检测到滑块验证码。请确认当前 marketing baseURL（${env.baseURL}）是否会触发安全验证。`,
    );
  }

  throw new Error(`登录后 15 秒内未跳转，且未检测到明确验证码，请检查登录接口返回和页面错误提示。当前地址：${env.baseURL}`);
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
    try {
      await loginByPasswordUI(page, env);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canFallback = Boolean(env.phone);
      const shouldFallback = /未跳转|验证码|安全验证|timed out|Timeout/i.test(message);
      if (!canFallback || !shouldFallback) {
        throw error;
      }
      await loginBySmsUI(page, env);
      return;
    }
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

async function scrollFieldRowIntoView(page: any, fieldRow: any, maxScrolls = 8) {
  const exists = (await fieldRow.count().catch(() => 0)) > 0;
  if (!exists) {
    return false;
  }

  await fieldRow.scrollIntoViewIfNeeded().catch(() => {});
  if (await fieldRow.isVisible().catch(() => false)) {
    return true;
  }

  for (let i = 0; i < maxScrolls; i += 1) {
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(120);
    if (await fieldRow.isVisible().catch(() => false)) {
      await fieldRow.scrollIntoViewIfNeeded().catch(() => {});
      return true;
    }
  }

  return await fieldRow.isVisible().catch(() => false);
}

async function selectActionSheetOption(page: any, fieldRow: any, optionMatcher: string | RegExp) {
  const rowVisible = await fieldRow.isVisible().catch(() => false);
  if (!rowVisible) {
    return false;
  }
  const sheet = page.locator('.van-action-sheet:visible').last();
  await fieldRow.click({ force: true });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  const options = sheet.locator('.sheet-filter-item');
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    const text = ((await option.textContent().catch(() => '')) || '').trim();
    const matched = typeof optionMatcher === 'string' ? text === optionMatcher : optionMatcher.test(text);
    if (!matched) continue;
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click({ force: true });
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

async function visualPause(page: any, ms = 500) {
  if (!process.env.E2E_LIVE_PREVIEW_DIR) return;
  await page.waitForTimeout(ms);
}

async function ensureSelectFieldValue(page: any, fieldRow: any, preferredOption?: string | RegExp) {
  const rowVisible = await fieldRow.isVisible().catch(() => false);
  if (!rowVisible) {
    return '';
  }
  const input = fieldRow.locator('input, textarea').first();
  const value = await input.inputValue().catch(() => '');
  if (value) {
    return value;
  }
  const selected = await selectActionSheetOption(page, fieldRow, preferredOption || /.*/);
  if (!selected) {
    return '';
  }
  return (await input.inputValue().catch(() => '')) || '';
}

async function expectSelectFieldReady(fieldRow: any, expectedValuePattern?: RegExp) {
  const input = fieldRow.locator('input, textarea').first();
  const inputExists = (await input.count().catch(() => 0)) > 0;
  if (!inputExists) {
    return;
  }
  const value = await input.inputValue().catch(() => '');
  if (expectedValuePattern && value) {
    await expect(input).toHaveValue(expectedValuePattern);
    return;
  }
  if (value) {
    return;
  }
  await expect(input).toHaveAttribute('placeholder', /请选择|已完善|去完善/);
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
      test.skip(!env.username || !env.password, '密码登录模式需配置 marketing 账号密码（支持 E2E_MARKETING_LOGIN_USERNAME / E2E_MARKETING_LOGIN_PASSWORD）');
    } else {
      test.skip(!env.phone, '短信登录模式需配置 E2E_LOGIN_PHONE');
    }

    await loginByPreferredMethod(page, env);
  });

  test('合同开立: 列表进入 + 字段校验 + 提交接口', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 执行');
    const env = readMarketingEnv(adapter);
    if (env.loginMethod === 'password') {
      test.skip(!env.username || !env.password, '密码登录模式需配置 marketing 账号密码（支持 E2E_MARKETING_LOGIN_USERNAME / E2E_MARKETING_LOGIN_PASSWORD）');
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
      test.skip(!env.username || !env.password, '密码登录模式需配置 marketing 账号密码（支持 E2E_MARKETING_LOGIN_USERNAME / E2E_MARKETING_LOGIN_PASSWORD）');
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
    await expect(entrustedField).toBeVisible({ timeout: 20_000 });
    const entrustedInput = entrustedField.locator('input, textarea').first();
    const entrustedValue = await entrustedInput.inputValue().catch(() => '');
    if (entrustedValue) {
      await expect(entrustedInput).toHaveValue(/已完善/);
    } else {
      await expect(entrustedInput).toHaveAttribute('placeholder', /已完善|去完善/);
    }
    await expect(getPrimarySubmitButton(page)).toBeVisible({ timeout: 20_000 });

    const offlinePageUrl = page.url();
    await entrustedField.click();
    await page.waitForURL((url: URL) => url.href !== offlinePageUrl, { timeout: 20_000 }).catch(() => {});
    await expect(page.getByText('受托支付信息').first()).toBeVisible({ timeout: 20_000 });

    const otherEntrustedRow = getFieldRow(page, '受托支付是否他行');
    const accTypeRow = getFieldRow(page, '受托支付账户类型');
    const bankNameInput = getFieldInput(page, '开户行名');
    const accNameInput = getFieldInput(page, '受托支付账户户名');
    const accNoInput = getFieldInput(page, '受托支付账户账号');
    const bankDeptInput = getFieldInput(page, '受托支付联行号');
    const payeeEntNameInput = getFieldInput(page, '收款方企业名称');
    const payeeRoleRow = getFieldRow(page, '收款人角色');
    const evaluationMethodRow = getFieldRow(page, '评估方式');
    const faceResultRow = getFieldRow(page, '面签结果');
    const loadTypeRows = getFieldRows(page, '入库依据');
    const loadTypeRow = loadTypeRows.first();
    await scrollFieldRowIntoView(page, loadTypeRow);
    const loadTypeLabelVisible = await page.getByText('入库依据', { exact: true }).first().isVisible().catch(() => false);
    const hasLoadTypeField =
      loadTypeLabelVisible &&
      (await loadTypeRow.isVisible().catch(() => false)) &&
      (await loadTypeRow.locator('input, textarea').count().catch(() => 0)) > 0;

    // 当前单据可能是“待完善”态，先确认基础字段存在；入库依据在信用贷场景会被隐藏。
    await expect(otherEntrustedRow).toBeVisible({ timeout: 10_000 });
    await expect(accTypeRow).toBeVisible({ timeout: 10_000 });
    await expect(payeeRoleRow).toBeVisible({ timeout: 10_000 });
    await expect(evaluationMethodRow).toBeVisible({ timeout: 10_000 });
    await expect(faceResultRow).toBeVisible({ timeout: 10_000 });
    if (!hasLoadTypeField) {
      await expect(getFieldRows(page, '受理单号')).toHaveCount(0);
      await expect(getFieldRows(page, '他项权利证书编号')).toHaveCount(0);
      await expect(getFieldRows(page, '他项登记机关')).toHaveCount(0);
      await expect(getFieldRows(page, '他项登记起始日')).toHaveCount(0);
      await expect(getFieldRows(page, '他项登记到期日')).toHaveCount(0);
    }
    await visualPause(page, 800);

    const originalBankName = await bankNameInput.inputValue();
    const originalAccName = await accNameInput.inputValue();
    const originalAccNo = await accNoInput.inputValue();
    const originalBankDept = await bankDeptInput.inputValue();
    const originalPayeeEntName = await payeeEntNameInput.inputValue();

    // 当前数据可能是“待完善”态，先把下拉型必填项补齐，再继续做校验和联动。
    await ensureSelectFieldValue(page, accTypeRow);
    await ensureSelectFieldValue(page, payeeRoleRow);
    await ensureSelectFieldValue(page, evaluationMethodRow);
    await ensureSelectFieldValue(page, faceResultRow, '成功');
    if (hasLoadTypeField) {
      await ensureSelectFieldValue(page, loadTypeRow);
    }
    if (!(await bankNameInput.inputValue())) {
      await bankNameInput.fill('杭州测试支行');
    }
    if (!(await accNameInput.inputValue())) {
      await accNameInput.fill('杭州测试收款户');
    }
    if (!(await accNoInput.inputValue())) {
      await accNoInput.fill('6217000012345678901');
    }
    if (!(await bankDeptInput.inputValue())) {
      await bankDeptInput.fill('105100000001');
    }
    if (!(await payeeEntNameInput.inputValue())) {
      await payeeEntNameInput.fill('杭州测试企业有限公司');
    }

    // 补齐后再做一次断言，保证后续联动和提交流程都建立在“表单已可操作”的前提上。
    await expectSelectFieldReady(otherEntrustedRow, /是|否/);
    await expectSelectFieldReady(accTypeRow);
    await expectSelectFieldReady(payeeRoleRow);
    await expectSelectFieldReady(evaluationMethodRow);
    await expectSelectFieldReady(faceResultRow);
    if (hasLoadTypeField) {
      await expectSelectFieldReady(loadTypeRow);
    }
    await expect(bankNameInput).not.toHaveValue('');
    await expect(accNameInput).not.toHaveValue('');
    await expect(accNoInput).not.toHaveValue('');
    await expect(bankDeptInput).not.toHaveValue('');
    await expect(payeeEntNameInput).not.toHaveValue('');
    await visualPause(page, 800);

    const requiredChecks = [
      { input: bankNameInput, original: originalBankName, message: '请输入开户行名' },
      { input: accNameInput, original: originalAccName, message: '请输入受托支付账户户名' },
      { input: accNoInput, original: originalAccNo, message: '请输入受托支付账户账号' },
      { input: bankDeptInput, original: originalBankDept, message: '请输入受托支付联行号' },
      { input: payeeEntNameInput, original: originalPayeeEntName, message: '请输入收款方企业名称' },
    ];
    for (const field of requiredChecks) {
      await field.input.fill('');
      await visualPause(page, 500);
      await getPrimarySubmitButton(page).click({ force: true });
      await expect(page.getByText(field.message)).toBeVisible({ timeout: 10_000 });
      await field.input.fill(field.original);
      await expect(field.input).toHaveValue(field.original);
    }

    await accNoInput.fill('acct-9988xy');
    await visualPause(page, 500);
    expect(await accNoInput.inputValue()).toMatch(/^\d+$/);

    await bankDeptInput.fill('dept-12345ab');
    await visualPause(page, 500);
    expect(await bankDeptInput.inputValue()).toMatch(/^\d+$/);

    if (hasLoadTypeField) {
      // 入库依据联动：切到“受理单”后展示受理单字段，并隐藏他项权证相关字段；切到“他项权证”后恢复。
      await scrollFieldRowIntoView(page, loadTypeRow);
      const loadTypeInput = loadTypeRow.locator('input, textarea').first();
      const originalLoadType = await loadTypeInput.inputValue().catch(() => '');
      const switchedToAcceptance = await selectActionSheetOption(page, loadTypeRow, '受理单');
      expect(switchedToAcceptance).toBeTruthy();
      await expect(getFieldRow(page, '受理单号')).toBeVisible({ timeout: 10_000 });
      await expect(getFieldRows(page, '他项权利证书编号')).toHaveCount(0);
      await expect(getFieldRows(page, '他项登记机关')).toHaveCount(0);
      await expect(getFieldRows(page, '他项登记起始日')).toHaveCount(0);
      await visualPause(page, 800);

      const switchedToOtherCert = await selectActionSheetOption(page, loadTypeRow, /他项权证/);
      expect(switchedToOtherCert).toBeTruthy();
      await expect(getFieldRow(page, '他项权利证书编号')).toBeVisible({ timeout: 10_000 });
      await expect(getFieldRow(page, '他项登记机关')).toBeVisible({ timeout: 10_000 });
      await expect(getFieldRow(page, '他项登记起始日')).toBeVisible({ timeout: 10_000 });
      await expect(getFieldRow(page, '他项登记到期日')).toBeVisible({ timeout: 10_000 });
      await visualPause(page, 800);

      // 若原值不是当前值，切回原始入库依据，避免影响最终提交。
      if (originalLoadType && !originalLoadType.includes('他项权证')) {
        await selectActionSheetOption(page, loadTypeRow, originalLoadType);
        await visualPause(page, 500);
      }
    }

    // 面签结果联动：历史版本在失败时会隐藏“用信资料”，新版本可能保留展示。
    // 这里兼容两种实现，但仍要求“成功后”必须可见。
    await selectActionSheetOption(page, faceResultRow, '失败');
    await expect(faceResultRow.locator('input, textarea').first()).toHaveValue(/失败/);
    await visualPause(page, 800);
    await submitAndAssertRequest(page, '/order/front/order_access/addOrderCreditApplyOfflineSign');
    await page.waitForURL((url: URL) => url.href === offlinePageUrl, { timeout: 20_000 }).catch(() => {});
    await expect(page.getByText('线下面签补录').first()).toBeVisible({ timeout: 20_000 });
    const creditDocRowsAfterFail = getFieldRows(page, '用信资料');
    const creditDocCountAfterFail = await creditDocRowsAfterFail.count();
    if (creditDocCountAfterFail > 0) {
      await expect(creditDocRowsAfterFail.first()).toBeVisible({ timeout: 20_000 });
    }

    const entrustedFieldAgain = page.locator('.van-field').filter({ hasText: '受托支付信息' }).first();
    await entrustedFieldAgain.click();
    await page.waitForURL((url: URL) => url.href !== offlinePageUrl, { timeout: 20_000 }).catch(() => {});
    await expect(page.getByText('受托支付信息').first()).toBeVisible({ timeout: 20_000 });
    await selectActionSheetOption(page, faceResultRow, '成功');
    await expect(faceResultRow.locator('input, textarea').first()).toHaveValue(/成功/);
    await visualPause(page, 800);

    await submitAndAssertRequest(page, '/order/front/order_access/addOrderCreditApplyOfflineSign');
    await page.waitForURL((url: URL) => url.href === offlinePageUrl, { timeout: 20_000 }).catch(() => {});
    const creditDocRowAfterSuccess = getFieldRow(page, '用信资料');
    await expect(creditDocRowAfterSuccess).toBeVisible({ timeout: 20_000 });
    if (creditDocCountAfterFail === 0) {
      await expect(getFieldRows(page, '用信资料')).toHaveCount(1);
    }
  });

  test('资料上传: 列表进入 + 提交接口', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 执行');
    const env = readMarketingEnv(adapter);
    if (env.loginMethod === 'password') {
      test.skip(!env.username || !env.password, '密码登录模式需配置 marketing 账号密码（支持 E2E_MARKETING_LOGIN_USERNAME / E2E_MARKETING_LOGIN_PASSWORD）');
    } else {
      test.skip(!env.phone, '短信登录模式需配置 E2E_LOGIN_PHONE');
    }

    await loginByPreferredMethod(page, env);
    await gotoHsdListViaMenu(page, env.baseURL);
    await filterByState(page, env.uploadStateName);
    await openFormFromCard(page, env.uploadButtonText);

    await expect(page.getByText('用信资料').first()).toBeVisible({ timeout: 20_000 });

    const requiredUploadItems = ['产调', '抵押受理单', '房管办押用合同', '他证/电子他证'];
    for (const item of requiredUploadItems) {
      await expect(page.getByText(item).first()).toBeVisible({ timeout: 20_000 });
    }

    const chooseFileButtons = page.getByRole('button', { name: 'Choose File' });
    await expect(chooseFileButtons.first()).toBeVisible({ timeout: 20_000 });

    // 已有资料回显校验：至少应存在一个“已上传 x /20”的文案。
    await expect(page.locator('text=/已上传\\s+\\d+\\s*\\/20/').first()).toBeVisible({ timeout: 20_000 });

    // 驳回态下会出现驳回原因卡片，这里只做兼容性校验，不强制要求当前数据一定存在。
    const rejectReason = page.locator('.audit-result .reason').first();
    if (await rejectReason.isVisible().catch(() => false)) {
      await expect(rejectReason).toContainText('驳回原因');
    }

    // 条件材料显隐：其他材料仅在指定 state 下保留，这里按当前页面真实结果断言 UI 一致性。
    const otherMaterialRows = page.getByText('其他材料');
    const otherMaterialVisible = (await otherMaterialRows.count().catch(() => 0)) > 0;
    if (otherMaterialVisible) {
      await expect(otherMaterialRows.first()).toBeVisible({ timeout: 10_000 });
    }

    await visualPause(page, 800);
    await expect(getPrimarySubmitButton(page)).toBeVisible({ timeout: 20_000 });
    await submitAndAssertRequest(page, '/order/front/order_access/addOrderImgInformation');
  });
});
