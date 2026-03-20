import { adminAdapter } from './admin.adapter.js';
import { marketingAdapter } from './marketing.adapter.js';
import { memberAdapter } from './member.adapter.js';
import type { ProjectAdapter, ProjectId } from './types.js';

const ADAPTERS: Record<ProjectId, ProjectAdapter> = {
  marketing: marketingAdapter,
  member: memberAdapter,
  admin: adminAdapter,
};

export function getTargetProjectId(): ProjectId {
  const id = process.env.E2E_PROJECT as ProjectId | undefined;
  if (!id || !ADAPTERS[id]) {
    return 'admin';
  }
  return id;
}

export function getTargetAdapter(): ProjectAdapter {
  return ADAPTERS[getTargetProjectId()];
}

export function getAllAdapters(): ProjectAdapter[] {
  return Object.values(ADAPTERS);
}

export type { ProjectAdapter, ProjectId } from './types.js';
