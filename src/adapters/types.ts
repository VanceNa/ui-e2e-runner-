import type { APIRequestContext, Page } from '@playwright/test';

export type ProjectId = 'marketing' | 'member' | 'admin';

export type LoginMode = 'password' | 'sms' | 'loginCode';

export interface BootstrapSecrets {
  systemTime?: number;
  salt?: string;
  iv?: string;
}

export interface ProjectAdapter {
  projectId: ProjectId;
  description: string;
  baseUrl: string;
  apiBaseUrl: string;
  loginMode: LoginMode;
  clientToc: string;
  defaultViewport: 'desktop' | 'mobile';
  buildAuthHeaders(token?: string): Record<string, string>;
  encryptPayload<T>(payload: T): Promise<T>;
  getBootstrapSecrets(apiContext: APIRequestContext): Promise<BootstrapSecrets>;
  injectSession(page: Page, token: string, salt?: string, iv?: string): Promise<void>;
  homeReadyCheck(page: Page): Promise<void>;
}

