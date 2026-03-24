import { createServer } from 'node:http';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');
const testsDir = join(rootDir, 'tests');
const dashboardDir = join(rootDir, 'dashboard');
const previewDir = join(rootDir, '.live-preview');
const reportDir = join(rootDir, 'playwright-report');
const testResultsDir = join(rootDir, 'test-results');

loadEnv({ path: join(rootDir, '.env.e2e.local'), quiet: true });
loadEnv({ path: join(rootDir, '.env.e2e'), quiet: true });

let currentRun = null;
let runState = {
  running: false,
  command: '',
  logs: [],
  current: null,
  exitCode: null,
  startedAt: null,
  finishedAt: null,
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferProject(file) {
  if (file.includes('/admin.')) return 'admin';
  if (file.includes('/member.')) return 'member';
  if (file.includes('/marketing.')) return 'marketing';
  return 'shared';
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return fullPath;
  }));
  return files.flat();
}

function contentTypeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

async function listTests() {
  const files = (await walk(testsDir)).filter((file) => file.endsWith('.spec.ts')).sort();
  const filesWithCases = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const suiteMatches = [...content.matchAll(/test\.describe\(\s*['"`](.+?)['"`]/g)].map((m) => m[1]);
    const caseMatches = [...content.matchAll(/test(?:\.skip)?\(\s*['"`](.+?)['"`]/g)].map((m) => m[1]);
    const rel = relative(rootDir, file);
    const scope = rel.includes('/integration/') ? 'integration' : 'smoke';

    filesWithCases.push({
      id: rel,
      file: rel,
      project: inferProject(rel),
      scope,
      suite: suiteMatches[0] || rel,
      title: caseMatches[0] || rel,
      cases: caseMatches.map((title) => ({
        id: `${rel}::${title}`,
        title,
      })),
    });
  }

  return filesWithCases;
}

async function getOnboardingEntry() {
  const tests = await listTests();
  return tests.find((item) => item.file === 'tests/integration/admin.user-role-onboarding.spec.ts') || null;
}

async function getMarketingHsdEntry() {
  const tests = await listTests();
  return tests.find((item) => item.file === 'tests/integration/marketing.hsd-product.forms.spec.ts') || null;
}

async function listArtifactFiles() {
  if (!existsSync(testResultsDir)) return [];
  const files = (await walk(testResultsDir))
    .filter((file) => /\.(png|webm|md|zip)$/i.test(file))
    .map((file) => ({
      path: relative(rootDir, file),
      name: file.split('/').pop() || file,
      mtimeMs: 0,
    }));

  for (const entry of files) {
    const info = await stat(join(rootDir, entry.path)).catch(() => null);
    entry.mtimeMs = info?.mtimeMs || 0;
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function getArtifacts() {
  const artifacts = await listArtifactFiles();
  return {
    htmlReport: existsSync(join(reportDir, 'index.html')) ? '/artifacts/playwright-report/index.html' : '',
    latestVideo: artifacts.find((item) => item.path.endsWith('.webm'))?.path
      ? `/artifacts/${artifacts.find((item) => item.path.endsWith('.webm')).path}`
      : '',
    latestScreenshot: artifacts.find((item) => item.path.endsWith('.png'))?.path
      ? `/artifacts/${artifacts.find((item) => item.path.endsWith('.png')).path}`
      : '',
    latestErrorContext: artifacts.find((item) => item.path.endsWith('.md'))?.path
      ? `/artifacts/${artifacts.find((item) => item.path.endsWith('.md')).path}`
      : '',
    files: artifacts.slice(0, 20).map((item) => ({
      name: item.name,
      url: `/artifacts/${item.path}`,
    })),
  };
}

function appendLog(chunk) {
  const text = chunk.toString();
  runState.logs.push(text);
  if (runState.logs.length > 400) {
    runState.logs = runState.logs.slice(-400);
  }
}

async function startRun(payload) {
  if (currentRun) {
    throw new Error('已有任务正在执行');
  }

  await rm(previewDir, { recursive: true, force: true });

  const file = payload.file;
  const title = payload.title || '';
  const playwrightProject = payload.playwrightProject || 'chromium-desktop';
  const args = ['playwright', 'test', file, '--project', playwrightProject, '--workers=1'];
  if (title) {
    args.push('-g', escapeRegex(title));
  }

  const env = {
    ...process.env,
    E2E_PROJECT: payload.e2eProject || 'admin',
    E2E_ENABLE_MOBILE: payload.enableMobile ? '1' : process.env.E2E_ENABLE_MOBILE,
    E2E_FORCE_MOBILE: payload.forceMobile ? '1' : process.env.E2E_FORCE_MOBILE,
    E2E_BASE_URL: payload.baseURL || process.env.E2E_BASE_URL || 'https://xydb-release.local.hzzxf.com',
    E2E_API_BASE_URL: payload.apiBaseURL || process.env.E2E_API_BASE_URL || 'https://xydb-release.local.hzzxf.com/api',
    E2E_LOGIN_PHONE: payload.loginPhone || process.env.E2E_LOGIN_PHONE,
    E2E_LIVE_PREVIEW_DIR: previewDir,
  };

  runState = {
    running: true,
    command: `npx ${args.join(' ')}`,
    logs: [],
    current: payload,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  currentRun = spawn('npx', args, {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  currentRun.stdout.on('data', appendLog);
  currentRun.stderr.on('data', appendLog);

  currentRun.on('close', (code) => {
    runState.running = false;
    runState.exitCode = code;
    runState.finishedAt = new Date().toISOString();
    currentRun = null;
  });
}

function serveFile(res, filePath, contentType) {
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/api/tests') {
    return sendJson(res, await listTests());
  }

  if (req.method === 'GET' && url.pathname === '/api/onboarding') {
    return sendJson(res, await getOnboardingEntry());
  }

  if (req.method === 'GET' && url.pathname === '/api/marketing-hsd') {
    return sendJson(res, await getMarketingHsdEntry());
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, runState);
  }

  if (req.method === 'GET' && url.pathname === '/api/artifacts') {
    return sendJson(res, await getArtifacts());
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        await startRun(payload);
        sendJson(res, { ok: true });
      } catch (error) {
        sendJson(res, { ok: false, message: error instanceof Error ? error.message : String(error) }, 400);
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (currentRun) {
      currentRun.kill('SIGTERM');
    }
    return sendJson(res, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/preview') {
    const imagePath = join(previewDir, 'live.png');
    if (!existsSync(imagePath)) {
      res.writeHead(204);
      res.end();
      return;
    }
    return serveFile(res, imagePath, 'image/png');
  }

  if (req.method === 'GET' && url.pathname === '/api/preview-meta') {
    const metaPath = join(previewDir, 'meta.json');
    if (!existsSync(metaPath)) {
      return sendJson(res, {});
    }
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      return sendJson(res, meta);
    } catch {
      return sendJson(res, {});
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/artifacts/')) {
    const relativePath = url.pathname.replace('/artifacts/', '');
    const filePath = join(rootDir, relativePath);
    const allowed = filePath.startsWith(reportDir) || filePath.startsWith(testResultsDir);
    if (!allowed || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    return serveFile(res, filePath, contentTypeFor(filePath));
  }

  const filePath = url.pathname === '/' ? join(dashboardDir, 'index.html') : join(dashboardDir, url.pathname);
  if (!filePath.startsWith(dashboardDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (existsSync(filePath) && (await stat(filePath)).isFile()) {
    return serveFile(res, filePath, contentTypeFor(filePath));
  }

  res.writeHead(404);
  res.end('Not found');
}

const port = Number(process.env.E2E_DASHBOARD_PORT || 4318);
const host = process.env.E2E_DASHBOARD_HOST || '127.0.0.1';
createServer((req, res) => {
  void handle(req, res);
}).listen(port, host, () => {
  console.log(`dashboard: http://${host}:${port}`);
});
