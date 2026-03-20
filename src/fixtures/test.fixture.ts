import { expect, test as base } from '@playwright/test';

import { getTargetAdapter } from '../adapters/index.js';
import type { ProjectAdapter } from '../adapters/types.js';

type TestFixtures = {
  adapter: ProjectAdapter;
};

export const test = base.extend<TestFixtures>({
  adapter: async ({}, use) => {
    await use(getTargetAdapter());
  },
});

export { expect };
