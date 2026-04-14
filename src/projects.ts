import type { FullProject } from '@playwright/test';

import { getAdapterById } from './adapters/index.js';
import type { ProjectAdapter, ProjectId } from './adapters/types.js';

export type DeviceKind = 'desktop' | 'mobile';

export interface E2EProjectMetadata {
  adapterId: ProjectId;
  deviceKind: DeviceKind;
}

export function getProjectMetadata(project: FullProject): E2EProjectMetadata {
  const metadata = (project.metadata || {}) as Partial<E2EProjectMetadata>;
  if (!metadata.adapterId || !metadata.deviceKind) {
    throw new Error(`project ${project.name} 缺少 e2e metadata，请检查 playwright.config.ts`);
  }
  return metadata as E2EProjectMetadata;
}

export function getProjectAdapter(project: FullProject): ProjectAdapter {
  return getAdapterById(getProjectMetadata(project).adapterId);
}

export function isDesktopProject(project: FullProject): boolean {
  return getProjectMetadata(project).deviceKind === 'desktop';
}
