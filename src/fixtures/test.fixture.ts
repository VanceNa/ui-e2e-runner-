import { test as base, expect } from "@playwright/test";

import type { ProjectAdapter } from "../adapters/types.js";
import { bindLivePreview } from "../live-preview.js";
import { getProjectAdapter } from "../projects.js";

interface TestFixtures {
  adapter: ProjectAdapter;
}

export const test = base.extend<TestFixtures>({
  adapter: async ({}, use, testInfo) => {
    await use(getProjectAdapter(testInfo.project));
  },
  page: async ({ page }, use) => {
    const stopPreview = bindLivePreview(page, "default-page");
    await use(page);
    stopPreview();
  },
});

export { expect };
