import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, PlaywrightTestConfig } from "@playwright/test";
import { chromium, defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

import { getTargetAdapter } from "./src/adapters/index.js";

const rootDir = dirname(fileURLToPath(import.meta.url));
// 加载顺序：local -> shared；dotenv 默认不会覆盖已存在的 process.env（命令行变量优先级最高）。
loadEnv({ path: resolve(rootDir, ".env.e2e.local"), quiet: true });
loadEnv({ path: resolve(rootDir, ".env.e2e"), quiet: true });

const target = getTargetAdapter();
const enableMobile = process.env.E2E_ENABLE_MOBILE === "1";
const strictMobile = process.env.E2E_MOBILE_STRICT === "1";
const forceMobile = process.env.E2E_FORCE_MOBILE === "1";
const slowMoMs = Number(process.env.E2E_SLOWMO_MS || 0);
const traceMode = (() => {
  const mode = process.env.E2E_TRACE_MODE;
  if (
    mode === "off" ||
    mode === "on" ||
    mode === "retain-on-failure" ||
    mode === "on-first-retry" ||
    mode === "on-all-retries" ||
    mode === "retain-on-first-failure"
  ) {
    return mode;
  }
  return "retain-on-failure";
})();

async function canRunMobileProject(): Promise<boolean> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      ...devices["Pixel 7"],
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    // 只做最小可用性探测，避免把真实业务页面失败误判成“移动端不可运行”。
    await page.goto("data:text/html,<title>mobile-probe</title>", { waitUntil: "load" });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (strictMobile) {
      throw new Error(`移动端预检失败（E2E_MOBILE_STRICT=1）：${reason}`);
    }
    console.warn(`[playwright] 跳过 chromium-mobile：移动浏览器预检失败 -> ${reason}`);
    return false;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

const projects: NonNullable<PlaywrightTestConfig["projects"]> = [
  {
    name: "chromium-desktop",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  },
];

if (enableMobile) {
  const mobileReady = forceMobile ? true : await canRunMobileProject();
  if (mobileReady) {
    projects.push({
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
      },
    });
    projects.push({
      name: "chromium-iphone12",
      use: {
        ...devices["iPhone 12"],
        browserName: "chromium",
      },
    });
  }
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  reporter: [["html", { open: "never" }], ["list"]],
  metadata: {
    e2eProject: target.projectId,
    e2eProjectDescription: target.description,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || target.baseUrl,
    trace: traceMode,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    ...(slowMoMs > 0 ? { launchOptions: { slowMo: slowMoMs } } : {}),
  },
  projects,
  outputDir: "test-results",
});
