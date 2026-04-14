# Project Index

## 1. 项目定位

`ui-e2e-runner` 是一个基于 Playwright Test 的多项目 E2E Runner。

- 目标项目：`admin`、`member`、`marketing`
- 核心设计：`公共测试内核 + adapter 收敛项目差异 + fixture 注入上下文`
- 当前额外能力：Playwright UI 调试、dashboard 本地控制台、页面实时截图流

---

## 2. 顶层目录索引

### 核心代码

- `playwright.config.ts`
  - Playwright 全局配置入口
  - 负责加载 `.env.e2e.local` / `.env.e2e`
  - 负责 project 组装、mobile 预检、trace/screenshot/video 配置

- `package.json`
  - 所有测试入口脚本
  - 当前脚本偏多，是后续精简重点

- `src/`
  - 测试运行时核心逻辑

- `tests/`
  - smoke 和 integration 用例

- `dashboard/`
  - 本地测试控制台静态页面

- `scripts/test-dashboard.mjs`
  - dashboard 本地服务
  - 负责执行测试、汇总状态、暴露实时截图与产物

### 配置与文档

- `README.md`
  - 使用说明
  - 当前内容较全，但命令说明偏多

- `.env.e2e.example`
  - E2E 环境变量模板

- `tsconfig.json`
  - TypeScript 配置

- `eslint.config.js`
  - ESLint 配置

### 运行产物

- `playwright-report/`
  - Playwright HTML 报告
  - 运行产物，不是源码

- `test-results/`
  - trace、截图、视频等测试产物
  - 运行产物，不是源码

- `.live-preview/`
  - dashboard 实时截图流临时目录
  - 运行产物，不是源码

---

## 3. `src/` 索引

### `src/adapters/`

作用：收敛不同项目的环境差异。

- `types.ts`
  - adapter 接口定义
  - 项目间统一契约的核心文件

- `index.ts`
  - 根据 `E2E_PROJECT` 选择当前 adapter

- `admin.adapter.ts`
  - admin 项目配置
  - 包含 `CLIENT-TOC`、`TENANT-ID`、sessionStorage 注入、首页校验

- `member.adapter.ts`
  - member 项目配置
  - 包含 Basic Authorization、localStorage 注入、首页校验

- `marketing.adapter.ts`
  - marketing 项目配置
  - 包含 Basic Authorization、localStorage 注入、首页校验

建议：

- 这里是整个项目最应该保持稳定和简洁的目录
- 后续若要扩项目，优先扩 adapter，不要把项目差异散落到 tests 里

### `src/fixtures/`

作用：把 adapter、登录态、page 辅助能力注入到用例里。

- `test.fixture.ts`
  - 基础 fixture
  - 注入 `adapter`
  - 给默认 `page` 绑定 live preview

- `admin-auth.fixture.ts`
  - admin 专用 fixture
  - 负责 API 账号密码登录
  - 注入 `adminSession`
  - 提供 `injectAdminSession(page)`

建议：

- 这里的职责边界是清晰的
- 如果后续 member/marketing 也有登录联动，建议按同样模式拆单独 fixture，不要继续把逻辑堆进现有文件

### `src/api/`

作用：沉淀接口辅助逻辑。

- `auth.ts`
  - 密码登录封装
  - 处理 token URL、admin 密码加密、token 提取

- `scenario.ts`
  - 联动模板用的 API 调用辅助
  - 处理 JSON 环境变量解析和 `Arrange/Assert` 接口调用

建议：

- 目前文件数量少，职责清楚
- 若继续增长，可按 `auth/`, `scenario/`, `health/` 分目录

### `src/live-preview.ts`

作用：给 dashboard 提供实时截图流。

- 周期性截图
- 写入 `live.png` / `meta.json` / `status.json`
- 提供 owner 机制，避免多个 page 抢占

说明：

- 这是 dashboard 特有能力
- 如果以后 dashboard 被移除，这个文件和相关绑定逻辑也可一起下线

---

## 4. `tests/` 索引

### Smoke

- `tests/smoke.ui.spec.ts`
  - 本地页面渲染
  - 当前 adapter 注解打印
  - 业务首页可访问检查

- `tests/smoke.api.spec.ts`
  - API health smoke
  - 依赖 `E2E_API_SMOKE_PATH`

说明：

- smoke 层应该保持少而稳
- 不要把强业务依赖接口继续塞进 smoke

### Integration

- `tests/integration/admin.auth-flow.spec.ts`
  - 最小 admin 联动样例
  - 流程：API 登录 -> 注入会话 -> 首页断言 -> API 校验

- `tests/integration/admin.arrange-act-assert.spec.ts`
  - admin 联动模板
  - 适合作为业务用例脚手架

- `tests/integration/admin.user-role-onboarding.spec.ts`
  - 当前最重的 admin E2E 用例
  - 流程：创建角色 -> 授权 -> 创建账号 -> 新账号登录
  - 当前包含较多稳定性处理，是复杂度最高的测试文件

- `tests/integration/member.login.spec.ts`
  - member 登录链路

- `tests/integration/marketing.hsd-product.forms.spec.ts`
  - marketing HSD 表单链路
  - 当前也是偏重型 spec

建议：

- `admin.user-role-onboarding.spec.ts`
  - 可继续拆 helper，避免 spec 文件过长

- `marketing.hsd-product.forms.spec.ts`
  - 可按业务节点拆成多个 spec 或提取 page/helper

---

## 5. 运行入口索引

### 全局入口

- `npm run test:ui`
  - 默认测试入口

- `npm run test:ui:ui`
  - Playwright UI

- `npm run test:ui:debug`
  - Inspector 调试

- `npm run test:ui:headed`
  - 有头执行

- `npm run dashboard`
  - 本地测试控制台

### 项目入口

- `test:ui:admin`
- `test:ui:member`
- `test:ui:marketing`

### 业务入口

- `test:ui:admin:authflow`
- `test:ui:admin:scenario`
- `test:ui:admin:onboarding`
- `test:ui:marketing:hsd-forms`

说明：

- 目前 `package.json` 存在较多“别名脚本”和“强环境绑定脚本”
- 后续精简时建议保留“全局入口 + 少量高频业务入口”

---

## 6. 环境变量索引

### 基础变量

- `E2E_PROJECT`
- `E2E_BASE_URL`
- `E2E_API_BASE_URL`

### Smoke 相关

- `E2E_API_SMOKE_PATH`
- `E2E_API_SMOKE_METHOD`

### admin 登录相关

- `E2E_LOGIN_USERNAME`
- `E2E_LOGIN_PASSWORD`
- `E2E_OAUTH2_CLIENT`
- `E2E_TENANT_ID`
- `E2E_PWD_ENC_KEY`
- `E2E_LOGIN_IMAGE_CODE`

### 联动模板相关

- `E2E_SCENARIO_PREPARE_PATH`
- `E2E_SCENARIO_VERIFY_PATH`
- `E2E_SCENARIO_UI_PATH`
- `E2E_SCENARIO_UI_EXPECT_SELECTOR`
- `E2E_SCENARIO_PREPARE_BODY`
- `E2E_SCENARIO_VERIFY_BODY`

### 移动端与调试相关

- `E2E_ENABLE_MOBILE`
- `E2E_MOBILE_STRICT`
- `E2E_FORCE_MOBILE`
- `E2E_SLOWMO_MS`
- `E2E_TRACE_MODE`

### dashboard / live preview

- `E2E_DASHBOARD_PORT`
- `E2E_DASHBOARD_HOST`
- `E2E_LIVE_PREVIEW_DIR`

---

## 7. 当前最值得优化的地方

### 必须优先优化

- `package.json` 脚本过多
  - 同一能力存在多个别名和 release 变体
  - 建议收敛为“基础入口 + 高频业务入口 + 临时命令行覆盖”

- `README.md` 偏长
  - 文档中命令清单和解释过密
  - 建议 README 只保留入门、常用命令、环境变量、调试方式
  - 更细的索引和维护说明可放独立文档

- 重型 spec 过长
  - `admin.user-role-onboarding.spec.ts`
  - `marketing.hsd-product.forms.spec.ts`
  - 建议抽 helper 或按业务阶段拆 spec

### 可以考虑去掉

- `package.json` 中低频、强环境绑定、纯别名脚本
- README 中过细的命令枚举
- 若 dashboard 后续使用率不高，可整体下线 `dashboard/ + scripts/test-dashboard.mjs + src/live-preview.ts`

### 当前不建议动

- adapter 结构
- fixture 结构
- `playwright.config.ts` 的 mobile 预检思路
- smoke / integration 分层方式

---

## 8. 新人阅读顺序

1. 先看 `README.md`
2. 再看 `playwright.config.ts`
3. 再看 `src/adapters/types.ts` 和 `src/adapters/index.ts`
4. 再看 `src/fixtures/test.fixture.ts` / `src/fixtures/admin-auth.fixture.ts`
5. 最后看 `tests/smoke.*` 和具体 integration spec

---

## 9. 一句话判断每个目录该不该动

- `src/adapters/`
  - 项目差异放这里，应该动

- `src/fixtures/`
  - 测试上下文放这里，按需扩

- `src/api/`
  - 通用接口辅助放这里，应该动

- `tests/`
  - 业务行为和断言放这里，应该动

- `dashboard/`
  - 本地调试辅助，按使用频率决定保留或下线

- `playwright-report/` / `test-results/` / `.live-preview/`
  - 运行产物，不要手工维护
