import type { APIRequestContext } from '@playwright/test';

import type { ProjectAdapter } from '../adapters/types.js';

export interface ScenarioApiStep {
  path: string;
  body?: unknown;
}

function normalizePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

export function parseJsonEnv<T>(raw: string | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function callScenarioApi(
  request: APIRequestContext,
  adapter: ProjectAdapter,
  apiBaseURL: string,
  token: string,
  step: ScenarioApiStep,
) {
  const url = `${apiBaseURL}${normalizePath(step.path)}`;
  return request.post(url, {
    headers: {
      ...adapter.buildAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    data: step.body ?? {},
  });
}
