import { expect, test as base } from '@playwright/test';

import { getTargetAdapter } from '../adapters/index.js';
import type { ProjectAdapter } from '../adapters/types.js';
import { bindLivePreview } from '../live-preview.js';

type TestFixtures = {
  adapter: ProjectAdapter;
};

export const test = base.extend<TestFixtures>({
  adapter: async ({}, use) => {
    await use(getTargetAdapter());
  },
  page: async ({ page }, use) => {
    const stopPreview = bindLivePreview(page, 'default-page');
    await use(page);
    stopPreview();
  },
});

export { expect };
