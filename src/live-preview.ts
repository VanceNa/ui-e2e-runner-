import type { Page } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LIVE_PREVIEW_DIR = process.env.E2E_LIVE_PREVIEW_DIR || '';
const SCREENSHOT_PATH = LIVE_PREVIEW_DIR ? join(LIVE_PREVIEW_DIR, 'live.png') : '';
const META_PATH = LIVE_PREVIEW_DIR ? join(LIVE_PREVIEW_DIR, 'meta.json') : '';
const STATUS_PATH = LIVE_PREVIEW_DIR ? join(LIVE_PREVIEW_DIR, 'status.json') : '';

function isEnabled() {
  return Boolean(LIVE_PREVIEW_DIR);
}

async function ensureDir() {
  if (!isEnabled()) return;
  await mkdir(LIVE_PREVIEW_DIR, { recursive: true });
}

async function writeJson(path: string, data: unknown) {
  if (!isEnabled()) return;
  await ensureDir();
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await rename(tempPath, path);
}

export async function writeLiveStatus(data: Record<string, unknown>) {
  await writeJson(STATUS_PATH, {
    updatedAt: new Date().toISOString(),
    ...data,
  });
}

export function bindLivePreview(page: Page, label = 'page') {
  if (!isEnabled()) {
    return () => {};
  }

  let stopped = false;
  let capturing = false;

  const capture = async () => {
    if (stopped || capturing || page.isClosed()) {
      return;
    }
    capturing = true;
    try {
      await ensureDir();
      await page.screenshot({ path: SCREENSHOT_PATH });
      await writeJson(META_PATH, {
        label,
        updatedAt: new Date().toISOString(),
        url: page.url(),
      });
    } catch {
      // Ignore transient screenshot failures during navigation/close.
    } finally {
      capturing = false;
    }
  };

  const interval = setInterval(() => {
    void capture();
  }, 700);

  page.on('load', () => {
    void capture();
  });
  page.on('domcontentloaded', () => {
    void capture();
  });
  void capture();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
