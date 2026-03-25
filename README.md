# ui-e2e-runner

前端 UI + 接口自动化测试通用 Runner，基于 Playwright Test，采用「公共内核 + 项目 Adapter」结构，兼容 Playwright Test for VSCode。

## 1. 快速开始

```bash
nvm use 20.19.0
npm install
npm run test:ui:install
npm run test:ui
npx playwright test --ui
```

## 2. 目录（当前实现）

```text
src/
  adapters/
    types.ts
    marketing.adapter.ts
    member.adapter.ts
    admin.adapter.ts
    index.ts
  fixtures/
    test.fixture.ts
    admin-auth.fixture.ts
tests/
  smoke.ui.spec.ts
  smoke.api.spec.ts
```

说明：

- `adapters`：收敛项目差异（base/api 地址、CLIENT-TOC、登录模式、首页就绪检查）
- `fixtures`：向用例注入统一 `adapter`
- `admin-auth.fixture`：封装 admin 的 API 登录与会话注入，给联动场景复用
- `tests`：测试仅依赖 adapter 接口，不直接耦合单一项目细节

## 3. 运行命令

```bash
# 默认 admin
npm run test:ui

# 指定项目
npm run test:ui:admin
npm run test:ui:member
npm run test:ui:marketing

# VSCode 可视化 / 调试
npm run test:ui:ui
npm run test:ui:debug
npm run test:ui:headed

# 启用移动端项目（先做浏览器预检，失败自动跳过 mobile，仅跑 desktop）
npm run test:ui:mobile

# 移动端项目（预检失败直接报错）
npm run test:ui:mobile:strict

# admin 联动 POC（API登录 -> 注入会话 -> 首页断言 -> API校验）
npm run test:ui:admin:authflow

# admin 联动模板（Arrange -> Act -> Assert）
npm run test:ui:admin:scenario

# admin 账号角色联动（UI+API）
npm run test:ui:admin:onboarding

# admin 账号角色联动（有头可视化）
npm run test:ui:admin:onboarding:headed

# admin 账号角色联动（Playwright Inspector 调试）
npm run test:ui:admin:onboarding:debug

# admin 账号角色联动（release 环境，可视化观察）
npm run onboarding:observe

# admin 账号角色联动（release 环境，Playwright UI 点击执行）
npm run onboarding:ui

# marketing HSD 表单（移动端）
npm run test:ui:marketing:login
npm run test:ui:marketing:hsd-priority
npm run test:ui:marketing:hsd-forms
npm run test:ui:marketing:hsd-forms:headed

# 本地测试控制台（点击执行 + 页面内实时截图流）
npm run dashboard
```

### 3.1 有头 / 无头模式说明

- 无头模式（headless）：不显示浏览器窗口，后台执行；速度通常更快，适合 CI 和批量回归。
- 有头模式（headed）：显示真实浏览器窗口；便于观察页面行为和调试 UI 问题。

本项目对应命令：

- 无头（默认）：`npm run test:ui`、`npm run test:ui:admin:onboarding`
- 有头：`npm run test:ui:headed`、`npm run test:ui:admin:onboarding:headed`
- Inspector 调试：`npm run test:ui:debug`、`npm run test:ui:admin:onboarding:debug`
- Playwright UI 点击执行：`npm run onboarding:ui`

针对 release 环境的简化命令：

- `npm run onboarding`：release 环境无头执行
- `npm run onboarding:observe`：release 环境有头观察执行
- `npm run onboarding:ui`：打开 Playwright UI，可在页面里点击单独执行该用例
- `npm run dashboard`：打开本地测试控制台，按项目/用例点击执行，并在页面内查看实时截图与日志

说明：

- `执行文件`：执行整个 spec 文件
- 文件卡片里的浅色按钮：执行该文件中的单条 case

建议：

1. 先用有头/Inspector定位问题。
2. 修复后再用无头模式回归，确保 CI 行为一致。

常见误区（有头通过、无头失败）：

- 选择器依赖“可见文本但未等待稳定渲染”，无头更快，容易在元素尚未可操作时点击失败。
- 用固定 `waitForTimeout` 替代状态等待，机器性能或网络波动会导致时序不稳定。
- 弹窗/下拉定位过宽（匹配到隐藏节点），有头下偶然命中正确节点，无头下更易命中错误节点。
- 依赖焦点、hover、动画结束等交互细节，但没有显式断言可交互状态（如 `toBeVisible` / `toBeEnabled`）。
- 本地手工运行与 CI 分辨率、资源、并发不同，导致边界时序问题被放大。

排查建议：

1. 先用 `:headed` 或 `:debug` 复现并观察真实页面行为。
2. 打开 trace/video，对失败步骤前后 DOM 和网络请求做对照。
3. 把“固定等待”改为“状态等待”（元素可见、可点击、接口返回、路由完成）。

### 3.2 Playwright UI 画面为什么不会实时变动

结论：

- Playwright UI 右侧的 `Action / Before / After` 是步骤快照，不是实时浏览器画面
- 点击不同步骤时，右侧只会切换到该步骤对应的静态页面状态

想看实时画面，使用：

- `npm run onboarding:observe`
- `npm run test:ui:admin:onboarding:headed`
- `npm run dashboard`

使用建议：

1. 用 `Playwright UI` 做单条 case 执行、步骤排查、trace 对照。
2. 用 `:headed` / `:observe` 看浏览器真实连续变化。

## 4. 环境变量

推荐使用配置文件，避免每次命令行手动拼接：

1. 复制模板：`cp .env.e2e.example .env.e2e.local`
2. 在 `.env.e2e.local` 填入真实值（该文件会被 `*.local` 忽略）
3. 直接执行测试命令（`playwright.config.ts` 会自动加载 `.env.e2e.local`，其次加载 `.env.e2e`）

admin 联动场景最少只需要配置：

- `E2E_LOGIN_USERNAME`
- `E2E_LOGIN_PASSWORD`
- `E2E_OAUTH2_CLIENT`（如当前环境需要）
- `E2E_TENANT_ID`（如当前环境需要）

这样你后续就不需要每次手工输入：

```bash
npm run onboarding:observe
```

如果你想在一个本地页面里点按钮执行，并看到页面内实时画面，使用：

```bash
npm run dashboard
```

默认地址：

- `http://127.0.0.1:4328`
- 如果 `4328` 被占用，dashboard 会自动尝试 `4329` 到 `4337`

优先级（高 -> 低）：

- 命令行临时环境变量（如 `E2E_LOGIN_USERNAME=... npm run ...`）
- `.env.e2e.local`
- `.env.e2e`

- `E2E_PROJECT`：`admin` | `member` | `marketing`，默认 `admin`
- `E2E_BASE_URL`：覆盖 UI 地址（用于业务首页冒烟）
- `E2E_API_BASE_URL`：覆盖 API 地址（用于 API 冒烟）
- `E2E_API_SMOKE_PATH`：API health smoke 路径，例如 `/health`、`/actuator/health`
- `E2E_API_SMOKE_METHOD`：API health smoke 请求方法，默认 `GET`
- `E2E_OAUTH2_CLIENT`：管理端登录 client（`Authorization: Basic ...`）
- `E2E_TENANT_ID`：管理端租户头
- `E2E_ENABLE_MOBILE=1`：启用 `chromium-mobile` 项目
- `E2E_MOBILE_STRICT=1`：移动端预检失败时不降级，直接失败
- `E2E_TRACE_MODE`：覆盖 Playwright trace 策略，支持 `off` / `on` / `retain-on-failure` / `on-first-retry` / `on-all-retries` / `retain-on-first-failure`
- `E2E_LOGIN_USERNAME`：联动用例登录账号
- `E2E_LOGIN_PASSWORD`：联动用例登录密码
- `E2E_AUTH_TOKEN_URL`：可选，直接指定 token 接口完整 URL
- `E2E_AUTH_TOKEN_PATH`：可选，默认 `/auth/oauth2/token`
- `E2E_PWD_ENC_KEY`：admin 密码模式加密 key（默认 `xydxydxydxydhdkj`）
- `E2E_LOGIN_IMAGE_CODE`：可选，登录页图形验证码（默认 `1234`，用例会始终点击“立即登录”做一次真实 UI 登录尝试）
- `E2E_SCENARIO_PREPARE_PATH`：联动模板准备接口路径（必填）
- `E2E_SCENARIO_VERIFY_PATH`：联动模板校验接口路径（必填）
- `E2E_SCENARIO_UI_PATH`：联动模板 UI 页面路径，默认 `/`
- `E2E_SCENARIO_UI_EXPECT_SELECTOR`：可选，UI 额外可见性断言选择器
- `E2E_SCENARIO_PREPARE_BODY`：可选，JSON 字符串
- `E2E_SCENARIO_VERIFY_BODY`：可选，JSON 字符串
- `E2E_HSD_ORDER_MAIN_ID`：marketing HSD 表单测试订单主键（必填）
- `E2E_HSD_ORDER_ACCESS_APPLY_ID`：marketing HSD 表单测试订单申请ID（必填）
- `E2E_HSD_FINISH_STATUS`：表单完善状态，默认 `1`（已完善）

## 5. VSCode 插件

1. 安装 `Playwright Test for VSCode`（`ms-playwright.playwright`）
2. 打开 VSCode Testing 面板
3. 直接点击 `tests/*.spec.ts` 的 Run / Debug
4. 失败后在测试详情查看 Trace/截图/视频

## 6. 当前 Smoke

- UI Smoke
  - 本地渲染冒烟（零环境依赖）
  - adapter 项目注解打印
  - 业务首页可访问检查（需设置 `E2E_BASE_URL`）
- API Smoke
  - 显式配置的 health endpoint 可访问检查（需设置 `E2E_API_SMOKE_PATH`）
- Admin Integration
  - `API登录 -> 注入会话 -> 首页断言 -> API状态校验`（需配置 admin 凭据和 client）
  - `Arrange(API) -> Act(UI) -> Assert(API)` 可配置模板（可快速复制成具体业务用例）
  - `UI 创建角色/授权/创建账号 + API 新账号登录 + UI 新账号首页验证`

## 7. 复用方式（admin 联动）

在需要 admin 联动的用例中直接引入：

```ts
import { test, expect } from '../src/fixtures/admin-auth.fixture.js';
```

可直接使用：

- `adminSession`：已登录会话信息（无配置时为 `undefined`）
- `injectAdminSession(page)`：向页面注入已登录会话

联动模板示例：

```bash
npm run test:ui:admin:scenario
```

如需临时覆盖（仅本次执行）：

```bash
E2E_LOGIN_USERNAME='demo' E2E_LOGIN_PASSWORD='demo' npm run test:ui:admin:scenario
```
