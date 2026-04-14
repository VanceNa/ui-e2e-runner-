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
  };
}

async function switchToPasswordMode(page: any) {
  const usernameInput = page.getByPlaceholder('请输入账号');
  if (await usernameInput.isVisible().catch(() => false)) return;
  await page.locator('.login-switch span').first().click();
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
}

async function loginByPasswordUI(page: any, env: ReturnType<typeof readMarketingEnv>) {
  test.skip(!env.username || !env.password, '密码登录模式需配置 marketing 账号密码（支持 E2E_MARKETING_LOGIN_USERNAME / E2E_MARKETING_LOGIN_PASSWORD）');
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
    throw new Error(`登录后仍停留在登录页，且检测到滑块验证码。当前地址：${env.baseURL}`);
  }

  throw new Error(`登录后 15 秒内未跳转，且未检测到明确验证码。当前地址：${env.baseURL}`);
}

async function loginBySmsUI(page: any, env: ReturnType<typeof readMarketingEnv>) {
  await page.goto(`${trimSlash(env.baseURL)}/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('验证码登录').first()).toBeVisible({ timeout: 10_000 });
  const phoneInput = page.getByPlaceholder('请输入手机号').first();
  await expect(phoneInput).toBeVisible({ timeout: 10_000 });
  await phoneInput.fill(env.phone);
  const smsLoginBtn = page.getByRole('button', { name: '验证码登录' });
  await expect(smsLoginBtn).toBeEnabled();
  await smsLoginBtn.click();
  await page.waitForURL((url: URL) => url.pathname.includes('/smscode'), { timeout: 30_000 });
  const codeInput = page.locator('.codeInput .van-field input').first();
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  await codeInput.fill(env.smsCode);
  const loginButton = page.getByRole('button', { name: '登录' }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click().catch(() => {});
  }
  await page.waitForURL((url: URL) => !url.pathname.includes('/login') && !url.pathname.includes('/smscode'), {
    timeout: 120_000,
  });
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

async function openPreAuditEntry(page: any, baseURL: string) {
  await page.goto(`${trimSlash(baseURL)}/application/index?productCode=HSD`, { waitUntil: 'domcontentloaded' });
  const preAuditEntry = page.locator('.menu-card .menu-item', { hasText: '客户预审' }).first();
  await expect(preAuditEntry).toBeVisible({ timeout: 20_000 });
  await preAuditEntry.click();
  await page.waitForURL((url: URL) => url.pathname.includes('/application/list'), { timeout: 20_000 });
}

function jsonResponse(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 0,
      msg: 'success',
      ok: true,
      data,
    }),
  };
}

const baseRecord = {
  id: 'pre-1001',
  orderPreCreditApplyExtraId: 88001,
  orderMainId: 'order-main-1001',
  preCreditApplyNo: 'PA20260325001',
  productId: 1,
  productShowName: '惠时代网商',
  memberId: 101,
  certName: '张三',
  certCode: '330100199001011234',
  phone: '13800001111',
  marketingId: 501,
  marketingName: '客户经理A',
  customerType: 1,
  customerTypeStr: '主借人',
  applyDate: '2026-03-25 10:00:00',
  state: 3,
  stateStr: '通过',
  slaveState: 0,
  slaveStateStr: '预审中',
  belongId: 1,
  belongName: '杭州分部',
  applyDueDate: '2026-03-30 23:59:59',
  useFlag: 0,
  useFlagStr: '未使用',
  refuseReason: '',
  tenantId: 1,
  createBy: 'system',
  updateBy: 'system',
  updateByName: '系统',
  createTime: '2026-03-25 10:00:00',
  updateTime: '2026-03-25 10:00:00',
  delFlag: '0',
  fristAmount: '300000',
  smsRecordFlag: true,
  preCreditDetailFlag: true,
  effectiveStatus: 0,
  closeOrder: 0,
  auditTime: '2026-03-25 10:10:00',
  userInfoMaskEnhance: 1,
  hsdPreLoanVoList: [
    {
      orderPreCreditApplyId: 'loan-main-1',
      certName: '张三',
      certCode: '330100199001011234',
      phone: '13800001111',
      customerType: 1,
      state: 3,
      refuseReason: '',
      shortChainParam: 'main-short',
      preCreditUrl: 'https://example.com/preaudit/main',
      productName: '惠时代网商',
      identity: true,
    },
    {
      orderPreCreditApplyId: 'loan-co-1',
      certName: '李四',
      certCode: '330100199202021234',
      phone: '13800002222',
      customerType: 3,
      state: 0,
      refuseReason: '',
      shortChainParam: 'co-short',
      preCreditUrl: 'https://example.com/preaudit/co',
      productName: '惠时代网商',
      identity: false,
    },
  ],
};

const detailPayload = {
  id: 88001,
  orderMainId: 'order-main-1001',
  customerName: '张三',
  idCard: '330100199001011234',
  phone: '13800001111',
  marriageState: 1,
  spouseName: '',
  spouseIdCard: '',
  spousePhone: '',
  loanAmount: '50',
  province: 330000,
  city: 330100,
  district: 330102,
  address: '浙江省杭州市上城区',
  addressDetail: '解放东路 88 号',
  landArea: '89.5',
  firstAmount: '300000',
  masterLoanState: 3,
  slaveLoanState: 0,
  creditSignStatus: '已授权',
  auditTime: '2026-03-25 10:10:00',
  preCreditState: 3,
  preCreditStateStr: '通过',
  refuseReason: '',
  idCardFront: '',
  idCardBack: '',
  livePhoto: '',
  companyInfoName: '杭州示例科技有限公司',
  immovableType: 1,
  mortgageLoan: 1,
  mortgageLoanBalance: 120000,
  mortgageLoanBalanceTenThousand: 12,
  housePrice: 500000,
  immovableTypeStr: '住宅',
  quota: 1,
  coBorrowerList: [
    {
      title: '共借人1',
      customerName: '李四',
      idCard: '330100199202021234',
      phone: '13800002222',
      relationType: 1,
      relationTypeStr: '配偶',
      creditSignStatus: '待授权',
      auditTime: '2026-03-25 10:10:00',
      preCreditState: 0,
      preCreditStateStr: '预审中',
      refuseReason: '',
      idCardFront: '',
      idCardBack: '',
      livePhoto: '',
    },
  ],
};

test.describe('Marketing PreAudit', () => {
  test('客户预审列表支持搜索和筛选', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 项目执行该用例');
    const env = readMarketingEnv(adapter);

    const listResponses = [
      {
        records: [baseRecord],
        total: 1,
      },
      {
        records: [{ ...baseRecord, id: 'pre-1002', certName: '李搜索', phone: '13900003333' }],
        total: 1,
      },
      {
        records: [{ ...baseRecord, id: 'pre-1003', certName: '王筛选', stateStr: '预审中', state: 0 }],
        total: 1,
      },
    ];
    let listHit = 0;
    await page.route('**/order/front/order_pre_credit_hsd/page', async (route) => {
      const payload = listResponses[Math.min(listHit, listResponses.length - 1)];
      listHit += 1;
      await route.fulfill(jsonResponse(payload));
    });

    await loginByPreferredMethod(page, env);
    await openPreAuditEntry(page, env.baseURL);

    await expect(page.locator('.card-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('客户:张三')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('客户手机号:13800001111')).toBeVisible();
    await expect(page.getByRole('button', { name: '预审详情' }).first()).toBeVisible();

    const keywordInput = page.getByPlaceholder('请输入客户姓名/手机号');
    await keywordInput.fill('李搜索');
    await page.getByText('搜索').click();
    await expect(page.getByText('客户:李搜索')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('客户:张三')).toHaveCount(0);

    await page.locator('.page-header .search-icon').click();
    await expect(page.getByText('筛选')).toBeVisible({ timeout: 20_000 });
    await page.locator('.search-box').filter({ hasText: '预审状态(主借人）' }).getByText('预审中').click();
    await page.getByRole('button', { name: '确定' }).click();

    await expect(page.getByText('客户:王筛选')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('预审中')).toBeVisible();
  });

  test('客户预审可进入详情查看主借人和贷款信息', async ({ adapter, page }) => {
    test.skip(adapter.projectId !== 'marketing', '仅 marketing 项目执行该用例');
    const env = readMarketingEnv(adapter);

    await page.route('**/order/front/order_pre_credit_hsd/page', async (route) => {
      await route.fulfill(jsonResponse({ records: [baseRecord], total: 1 }));
    });
    await page.route('**/order/front/order_pre_credit_hsd/getPreApplyInfo', async (route) => {
      await route.fulfill(jsonResponse(detailPayload));
    });

    await loginByPreferredMethod(page, env);
    await openPreAuditEntry(page, env.baseURL);

    const detailBtn = page.getByRole('button', { name: '预审详情' }).first();
    await expect(detailBtn).toBeVisible({ timeout: 20_000 });
    await detailBtn.click();

    await page.waitForURL((url: URL) => url.pathname.includes('/application/detail'), { timeout: 20_000 });
    await expect(page.getByText('预审额度(元）')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('300,000')).toBeVisible();
    await expect(page.getByText('贷款信息')).toBeVisible();
    await expect(page.getByText('杭州示例科技有限公司')).toBeVisible();
    await expect(page.getByText('浙江省杭州市上城区')).toBeVisible();
    await expect(page.getByText('主借人')).toBeVisible();
    await expect(page.getByText('张三')).toBeVisible();
    await expect(page.getByText('已授权')).toBeVisible();
    await expect(page.getByRole('button', { name: '额度计算明细' })).toBeVisible();
  });
});
