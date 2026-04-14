import type { ProjectAdapter, ProjectId } from './adapters/types.js';

const ENV_PREFIX: Record<ProjectId, string> = {
  admin: 'ADMIN',
  marketing: 'MARKETING',
  member: 'MEMBER',
};

function resolveProjectId(adapterOrId: ProjectAdapter | ProjectId): ProjectId {
  return typeof adapterOrId === 'string' ? adapterOrId : adapterOrId.projectId;
}

export function getAdapterEnv(adapterOrId: ProjectAdapter | ProjectId, key: string): string | undefined {
  const projectId = resolveProjectId(adapterOrId);
  return process.env[`E2E_${ENV_PREFIX[projectId]}_${key}`] || process.env[`E2E_${key}`];
}

export function getAdapterBaseURL(adapter: ProjectAdapter): string {
  return getAdapterEnv(adapter, 'BASE_URL') || adapter.baseUrl;
}

export function getAdapterApiBaseURL(adapter: ProjectAdapter): string {
  return getAdapterEnv(adapter, 'API_BASE_URL') || adapter.apiBaseUrl;
}
