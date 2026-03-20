# ui-e2e-runner

前端 UI + 接口自动化测试通用 Runner，基于 Playwright Test，采用「公共内核 + 项目 Adapter」结构，兼容 Playwright Test for VSCode。

## 1. 快速开始

```bash
nvm use 20.19.0
npm install
npm run test:ui:install
npm run test:ui
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
```

## 4. 环境变量

- `E2E_PROJECT`：`admin` | `member` | `marketing`，默认 `admin`
- `E2E_BASE_URL`：覆盖 UI 地址（用于业务首页冒烟）
- `E2E_API_BASE_URL`：覆盖 API 地址（用于业务 API 冒烟）
- `E2E_OAUTH2_CLIENT`：管理端登录 client（`Authorization: Basic ...`）
- `E2E_TENANT_ID`：管理端租户头
- `E2E_ENABLE_MOBILE=1`：启用 `chromium-mobile` 项目
- `E2E_MOBILE_STRICT=1`：移动端预检失败时不降级，直接失败
- `E2E_LOGIN_USERNAME`：联动用例登录账号
- `E2E_LOGIN_PASSWORD`：联动用例登录密码
- `E2E_AUTH_TOKEN_URL`：可选，直接指定 token 接口完整 URL
- `E2E_AUTH_TOKEN_PATH`：可选，默认 `/auth/oauth2/token`
- `E2E_PWD_ENC_KEY`：admin 密码模式加密 key（默认 `xydxydxydxydhdkj`）
- `E2E_NEW_USER_PASSWORD`：新增账号默认密码（默认 `Abcd1234@`）
- `E2E_LOGIN_IMAGE_CODE`：可选，登录页图形验证码（默认 `1234`，用例会始终点击“立即登录”做一次真实 UI 登录尝试）
- `E2E_SCENARIO_PREPARE_PATH`：联动模板准备接口路径（必填）
- `E2E_SCENARIO_VERIFY_PATH`：联动模板校验接口路径（必填）
- `E2E_SCENARIO_UI_PATH`：联动模板 UI 页面路径，默认 `/`
- `E2E_SCENARIO_UI_EXPECT_SELECTOR`：可选，UI 额外可见性断言选择器
- `E2E_SCENARIO_PREPARE_BODY`：可选，JSON 字符串
- `E2E_SCENARIO_VERIFY_BODY`：可选，JSON 字符串

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
  - `/admin/secret/systemTime` 可访问检查（需设置 `E2E_API_BASE_URL`）
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
E2E_PROJECT=admin \
E2E_BASE_URL='https://xydb-release.local.hzzxf.com' \
E2E_API_BASE_URL='https://xydb-release.local.hzzxf.com/api' \
E2E_OAUTH2_CLIENT='Basic xxxxx' \
E2E_LOGIN_USERNAME='demo' \
E2E_LOGIN_PASSWORD='demo' \
E2E_SCENARIO_PREPARE_PATH='/demo/prepare' \
E2E_SCENARIO_VERIFY_PATH='/demo/verify' \
E2E_SCENARIO_UI_PATH='/dashboard' \
npm run test:ui:admin:scenario
```
