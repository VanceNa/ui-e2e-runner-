from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional

from .reporting import iter_run_reports, load_report_file, make_run_id
from .runtime import load_audit_script


IGNORED_DISCOVERY_DIRS = {
    ".git",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "env",
    "htmlcov",
    "reports",
    "tests",
    "ui_audit_runner",
    "venv",
}


def _utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _url_from_reports_root(path: Path, reports_root: Path) -> str:
    return "/reports/{0}".format(path.resolve().relative_to(reports_root.resolve()).as_posix())


def discover_audit_scripts(workspace: Path) -> List[Dict[str, object]]:
    scripts = []
    for path in workspace.rglob("*.py"):
        if any(part.startswith(".") and part != "." for part in path.parts):
            continue
        if any(part in IGNORED_DISCOVERY_DIRS for part in path.parts):
            continue
        try:
            spec = load_audit_script(str(path))
        except Exception:
            continue
        scripts.append(
            {
                "path": path.relative_to(workspace).as_posix(),
                "absolute_path": str(path.resolve()),
                "name": spec.name,
                "description": spec.description,
                "url": spec.url,
                "check_count": len(spec.checks),
                "viewports": [
                    {"name": item.name, "width": item.width, "height": item.height}
                    for item in spec.viewports
                ],
            }
        )
    return sorted(scripts, key=lambda item: str(item["path"]))


def list_runs(reports_root: Path) -> List[Dict[str, object]]:
    runs = []
    for report_path in iter_run_reports(reports_root):
        try:
            payload = load_report_file(report_path)
        except Exception:
            continue

        run_dir = report_path.parent
        html_path = run_dir / "report.html"
        artifacts = payload.get("artifacts", {})
        viewport_artifacts = artifacts.get("viewports", {})
        preview_image = ""
        for item in viewport_artifacts.values():
            if isinstance(item, dict) and item.get("final_screenshot"):
                preview_image = "/reports/{0}/{1}".format(
                    run_dir.relative_to(reports_root).as_posix(),
                    item["final_screenshot"],
                )
                break

        summary = payload.get("summary", {})
        run_status = "passed"
        if summary.get("error", 0):
            run_status = "error"
        elif summary.get("failed", 0):
            run_status = "failed"

        runs.append(
            {
                "run_id": payload.get("run_id", run_dir.name),
                "name": payload.get("name", run_dir.name),
                "description": payload.get("description", ""),
                "script_path": payload.get("script_path", ""),
                "started_at": payload.get("started_at", ""),
                "finished_at": payload.get("finished_at", ""),
                "summary": summary,
                "status": run_status,
                "report_json_url": _url_from_reports_root(report_path, reports_root),
                "report_html_url": _url_from_reports_root(html_path, reports_root) if html_path.exists() else "",
                "preview_image_url": preview_image,
            }
        )
    return runs


@dataclass
class RunState:
    running: bool = False
    run_id: str = ""
    script_path: str = ""
    script_name: str = ""
    headed: bool = False
    started_at: str = ""
    finished_at: str = ""
    exit_code: Optional[int] = None
    report_json_url: str = ""
    report_html_url: str = ""
    logs: List[str] = field(default_factory=list)
    error: str = ""


class RunManager:
    def __init__(self, workspace: Path, reports_root: Path) -> None:
        self.workspace = workspace
        self.reports_root = reports_root
        self._lock = threading.Lock()
        self._state = RunState()
        self._process: Optional[subprocess.Popen] = None

    def get_status(self) -> Dict[str, object]:
        with self._lock:
            return {
                "running": self._state.running,
                "run_id": self._state.run_id,
                "script_path": self._state.script_path,
                "script_name": self._state.script_name,
                "headed": self._state.headed,
                "started_at": self._state.started_at,
                "finished_at": self._state.finished_at,
                "exit_code": self._state.exit_code,
                "report_json_url": self._state.report_json_url,
                "report_html_url": self._state.report_html_url,
                "logs": list(self._state.logs),
                "error": self._state.error,
            }

    def _append_log(self, message: str) -> None:
        with self._lock:
            self._state.logs.append(message.rstrip())
            self._state.logs = self._state.logs[-500:]

    def start_run(self, script: str, headed: bool = False) -> Dict[str, object]:
        script_path = (self.workspace / script).resolve() if not Path(script).is_absolute() else Path(script).resolve()
        if not script_path.exists():
            raise FileNotFoundError("未找到审计脚本: {0}".format(script_path))

        try:
            spec = load_audit_script(str(script_path))
        except Exception as exc:
            raise RuntimeError("脚本不可执行: {0}".format(exc))

        with self._lock:
            if self._process is not None and self._process.poll() is None:
                raise RuntimeError("已有运行中的任务，请等待当前任务完成")

            run_id = make_run_id(spec.name)
            run_dir = self.reports_root / run_id
            report_json = run_dir / "report.json"
            report_html = run_dir / "report.html"
            command = [
                sys.executable,
                "-u",
                "-m",
                "ui_audit_runner",
                "run",
                str(script_path),
                "--artifacts-dir",
                str(run_dir),
                "--output",
                str(report_json),
                "--html-report",
                str(report_html),
            ]
            if headed:
                command.append("--headed")

            env = dict(os.environ)
            env["PYTHONUNBUFFERED"] = "1"
            process = subprocess.Popen(
                command,
                cwd=str(self.workspace),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )
            self._process = process
            self._state = RunState(
                running=True,
                run_id=run_id,
                script_path=script_path.relative_to(self.workspace).as_posix(),
                script_name=spec.name,
                headed=headed,
                started_at=_utc_now(),
                finished_at="",
                exit_code=None,
                report_json_url=_url_from_reports_root(report_json, self.reports_root),
                report_html_url=_url_from_reports_root(report_html, self.reports_root),
                logs=["$ {0}".format(" ".join(command))],
                error="",
            )

        thread = threading.Thread(
            target=self._watch_process,
            args=(process,),
            daemon=True,
        )
        thread.start()
        return self.get_status()

    def _watch_process(self, process: subprocess.Popen) -> None:
        if process.stdout is not None:
            for line in process.stdout:
                self._append_log(line)

        exit_code = process.wait()
        with self._lock:
            self._state.running = False
            self._state.exit_code = exit_code
            self._state.finished_at = _utc_now()
            if exit_code != 0 and not self._state.error:
                self._state.error = "运行失败，退出码 {0}".format(exit_code)
            self._process = None


def _send_json(handler: BaseHTTPRequestHandler, data: Dict[str, object], status: int = 200) -> None:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _send_html(handler: BaseHTTPRequestHandler, content: str) -> None:
    body = content.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _serve_file(handler: BaseHTTPRequestHandler, file_path: Path) -> None:
    if not file_path.exists() or not file_path.is_file():
        handler.send_error(HTTPStatus.NOT_FOUND, "文件不存在")
        return
    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    body = file_path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _dashboard_html() -> str:
    return """
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UI Audit Dashboard</title>
    <style>
      :root {
        --bg: #0f1724;
        --panel: rgba(17, 27, 42, 0.84);
        --panel-soft: rgba(250, 245, 236, 0.08);
        --line: rgba(242, 220, 190, 0.16);
        --text: #f7efe2;
        --muted: #9db1c8;
        --accent: #df8c3f;
        --accent-ink: #2f1908;
        --pass: #43b37e;
        --fail: #f17366;
        --error: #f09cff;
        --skip: #d6b36b;
        --shadow: 0 28px 56px rgba(0, 0, 0, 0.32);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: "Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(223, 140, 63, 0.22), transparent 18%),
          radial-gradient(circle at bottom right, rgba(76, 103, 173, 0.24), transparent 24%),
          linear-gradient(180deg, #09101a 0%, #111b2a 48%, #151a22 100%);
        min-height: 100vh;
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        background-image:
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
        background-size: 44px 44px;
        pointer-events: none;
      }

      .shell {
        max-width: 1500px;
        margin: 0 auto;
        padding: 28px 22px 36px;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 18px;
        margin-bottom: 18px;
      }

      .hero h1, .panel h2, .script-card h3, .run-card h3 {
        font-family: "Baskerville", "Palatino Linotype", serif;
      }

      .hero h1 {
        margin: 0;
        font-size: 42px;
      }

      .hero p {
        margin: 8px 0 0;
        color: var(--muted);
        max-width: 720px;
      }

      .hero-badge {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(223, 140, 63, 0.16);
        color: #ffd5b0;
        border: 1px solid rgba(223, 140, 63, 0.24);
      }

      .board {
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 18px;
      }

      .stack {
        display: grid;
        gap: 18px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 26px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
        overflow: hidden;
      }

      .panel-inner {
        padding: 20px;
      }

      .panel h2 {
        margin: 0 0 14px;
        font-size: 28px;
      }

      .panel-note {
        color: var(--muted);
        margin: -4px 0 16px;
      }

      .script-list, .run-list {
        display: grid;
        gap: 12px;
      }

      .script-card, .run-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid rgba(242, 220, 190, 0.12);
        background: var(--panel-soft);
        cursor: pointer;
        transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
      }

      .script-card:hover, .run-card:hover, .script-card.active, .run-card.active {
        transform: translateY(-2px);
        border-color: rgba(223, 140, 63, 0.34);
        background: rgba(223, 140, 63, 0.10);
      }

      .script-card h3, .run-card h3 {
        margin: 0;
        font-size: 24px;
      }

      .meta-line, .tiny {
        color: var(--muted);
        font-size: 13px;
      }

      .pill-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }

      .pill, .status-pill {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 11px;
        border-radius: 999px;
        font-size: 12px;
        border: 1px solid rgba(242, 220, 190, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text);
      }

      .status-pill.pass { background: rgba(67, 179, 126, 0.16); color: #b0ffd2; }
      .status-pill.fail { background: rgba(241, 115, 102, 0.16); color: #ffd4cf; }
      .status-pill.error { background: rgba(240, 156, 255, 0.16); color: #ffd8ff; }
      .status-pill.skip { background: rgba(214, 179, 107, 0.16); color: #ffe7ad; }
      .status-pill.live { background: rgba(223, 140, 63, 0.16); color: #ffd8b2; }

      .control-row {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }

      .toggle {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        color: var(--muted);
      }

      button {
        border: 0;
        border-radius: 16px;
        height: 48px;
        padding: 0 18px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
      }

      .primary-btn {
        color: var(--accent-ink);
        background: linear-gradient(135deg, #f6c287, #df8c3f);
      }

      .secondary-btn {
        color: var(--text);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(242, 220, 190, 0.14);
      }

      .status-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-top: 14px;
      }

      .status-card {
        padding: 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(242, 220, 190, 0.10);
      }

      .status-card span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }

      .status-card strong {
        font-size: 28px;
      }

      .viewer-frame {
        width: 100%;
        min-height: 720px;
        border: 0;
        background: #fff;
      }

      .console {
        min-height: 220px;
        max-height: 320px;
        overflow: auto;
        border-radius: 18px;
        padding: 16px;
        background: rgba(6, 11, 18, 0.74);
        color: #dbe7f5;
        font-family: "SFMono-Regular", "Menlo", monospace;
        font-size: 12px;
        line-height: 1.6;
        border: 1px solid rgba(242, 220, 190, 0.10);
        white-space: pre-wrap;
      }

      .run-list {
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }

      .run-preview {
        width: 100%;
        height: 130px;
        border-radius: 14px;
        object-fit: cover;
        margin-top: 12px;
        background: rgba(255,255,255,0.04);
      }

      .empty {
        padding: 18px;
        border-radius: 18px;
        border: 1px dashed rgba(242, 220, 190, 0.16);
        color: var(--muted);
      }

      @media (max-width: 1180px) {
        .board {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
        .status-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .hero {
          display: grid;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <div>
          <div class="hero-badge">Python Playwright Visual Deck</div>
          <h1>UI Audit Dashboard</h1>
          <p>点选 Python 审计脚本、触发运行、查看实时日志，并直接预览截图、trace、video 和 HTML 报告。</p>
        </div>
      </header>

      <div class="board">
        <aside class="stack">
          <section class="panel">
            <div class="panel-inner">
              <h2>脚本库</h2>
              <p class="panel-note">只展示能成功加载为 `AuditSpec` 的 Python 脚本。</p>
              <div id="script-list" class="script-list"><div class="empty">正在扫描脚本…</div></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-inner">
              <h2>控制台</h2>
              <div class="control-row">
                <label class="toggle">
                  <input id="headed-toggle" type="checkbox" />
                  <span>有头运行</span>
                </label>
                <button id="run-btn" class="primary-btn">运行所选脚本</button>
              </div>
              <div class="pill-row" id="current-meta"></div>
              <div id="console-log" class="console">等待任务启动…</div>
            </div>
          </section>
        </aside>

        <main class="stack">
          <section class="panel">
            <div class="panel-inner">
              <h2>当前运行</h2>
              <div id="status-pills" class="pill-row"></div>
              <div id="status-grid" class="status-grid">
                <div class="status-card"><span>Run ID</span><strong id="stat-run">-</strong></div>
                <div class="status-card"><span>Script</span><strong id="stat-script">-</strong></div>
                <div class="status-card"><span>Started</span><strong id="stat-start">-</strong></div>
                <div class="status-card"><span>Finished</span><strong id="stat-finish">-</strong></div>
              </div>
              <div class="control-row" style="margin-top:14px;">
                <button id="open-report-btn" class="secondary-btn" disabled>打开 HTML 报告</button>
                <button id="refresh-runs-btn" class="secondary-btn">刷新最近运行</button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-inner">
              <h2>报告预览</h2>
              <iframe id="report-frame" class="viewer-frame" src="about:blank"></iframe>
            </div>
          </section>

          <section class="panel">
            <div class="panel-inner">
              <h2>最近运行</h2>
              <div id="run-list" class="run-list"><div class="empty">尚无运行记录。</div></div>
            </div>
          </section>
        </main>
      </div>
    </div>

    <script>
      const scriptListEl = document.getElementById("script-list");
      const runListEl = document.getElementById("run-list");
      const runBtn = document.getElementById("run-btn");
      const refreshRunsBtn = document.getElementById("refresh-runs-btn");
      const consoleLog = document.getElementById("console-log");
      const headedToggle = document.getElementById("headed-toggle");
      const reportFrame = document.getElementById("report-frame");
      const openReportBtn = document.getElementById("open-report-btn");
      const currentMeta = document.getElementById("current-meta");
      const statusPills = document.getElementById("status-pills");
      const statRun = document.getElementById("stat-run");
      const statScript = document.getElementById("stat-script");
      const statStart = document.getElementById("stat-start");
      const statFinish = document.getElementById("stat-finish");

      let selectedScript = null;
      let selectedRunHtml = "";

      function setPreview(url) {
        selectedRunHtml = url || "";
        reportFrame.src = selectedRunHtml || "about:blank";
        openReportBtn.disabled = !selectedRunHtml;
      }

      function renderScripts(items) {
        if (!items.length) {
          scriptListEl.innerHTML = '<div class="empty">没有找到可运行的审计脚本。</div>';
          return;
        }

        scriptListEl.innerHTML = items.map((item) => {
          const active = selectedScript && selectedScript.path === item.path ? "active" : "";
          const viewports = item.viewports.map((vp) => `<span class="pill">${vp.name} ${vp.width}×${vp.height}</span>`).join("");
          return `
            <article class="script-card ${active}" data-script="${item.path}">
              <h3>${item.name}</h3>
              <p class="meta-line">${item.path}</p>
              <p class="tiny">${item.description || "无描述"}</p>
              <div class="pill-row">
                <span class="pill">${item.check_count} checks</span>
                ${viewports}
              </div>
            </article>
          `;
        }).join("");

        scriptListEl.querySelectorAll(".script-card").forEach((node) => {
          node.addEventListener("click", () => {
            selectedScript = items.find((item) => item.path === node.dataset.script) || null;
            renderScripts(items);
            renderCurrentMeta();
          });
        });

        if (!selectedScript) {
          selectedScript = items[0];
          renderScripts(items);
          renderCurrentMeta();
        }
      }

      function renderCurrentMeta() {
        if (!selectedScript) {
          currentMeta.innerHTML = '<span class="pill">未选择脚本</span>';
          return;
        }
        currentMeta.innerHTML = `
          <span class="pill">${selectedScript.path}</span>
          <span class="pill">${selectedScript.check_count} 项检查</span>
          <span class="pill">${selectedScript.viewports.length} 个 viewport</span>
        `;
      }

      function statusClass(status) {
        if (status === "passed") return "pass";
        if (status === "failed") return "fail";
        if (status === "error") return "error";
        if (status === "skipped") return "skip";
        if (status === "running") return "live";
        return "live";
      }

      function renderRuns(items) {
        if (!items.length) {
          runListEl.innerHTML = '<div class="empty">尚无运行记录。</div>';
          return;
        }

        runListEl.innerHTML = items.map((item) => `
          <article class="run-card" data-html="${item.report_html_url || ""}">
            <div class="pill-row">
              <span class="status-pill ${statusClass(item.status)}">${item.status}</span>
              <span class="pill">${item.run_id}</span>
            </div>
            <h3>${item.name}</h3>
            <p class="meta-line">${item.script_path || "未记录脚本"}</p>
            <p class="tiny">passed ${item.summary.passed || 0} / failed ${item.summary.failed || 0} / error ${item.summary.error || 0}</p>
            ${item.preview_image_url ? `<img class="run-preview" src="${item.preview_image_url}" alt="${item.name}" />` : ""}
          </article>
        `).join("");

        runListEl.querySelectorAll(".run-card").forEach((node) => {
          node.addEventListener("click", () => {
            setPreview(node.dataset.html);
            runListEl.querySelectorAll(".run-card").forEach((card) => card.classList.remove("active"));
            node.classList.add("active");
          });
        });
      }

      async function fetchScripts() {
        const response = await fetch("/api/scripts");
        const data = await response.json();
        renderScripts(data.items || []);
      }

      async function fetchRuns() {
        const response = await fetch("/api/runs");
        const data = await response.json();
        renderRuns(data.items || []);
      }

      function renderStatus(data) {
        statRun.textContent = data.run_id || "-";
        statScript.textContent = data.script_name || data.script_path || "-";
        statStart.textContent = data.started_at || "-";
        statFinish.textContent = data.finished_at || "-";
        statusPills.innerHTML = `
          <span class="status-pill ${data.running ? "live" : (data.exit_code === 0 ? "pass" : (data.exit_code ? "fail" : "skip"))}">
            ${data.running ? "running" : (data.exit_code === 0 ? "finished" : (data.exit_code ? "failed" : "idle"))}
          </span>
          ${data.headed ? '<span class="pill">headed</span>' : '<span class="pill">headless</span>'}
          ${data.report_html_url ? '<span class="pill">html ready</span>' : ""}
        `;
        consoleLog.textContent = (data.logs || []).join("\\n") || "等待任务启动…";
        consoleLog.scrollTop = consoleLog.scrollHeight;
        if (data.report_html_url && !selectedRunHtml) {
          setPreview(data.report_html_url);
        }
        if (data.report_html_url && !data.running) {
          setPreview(data.report_html_url);
        }
      }

      async function fetchStatus() {
        const response = await fetch("/api/status");
        const data = await response.json();
        renderStatus(data);
      }

      async function startRun() {
        if (!selectedScript) {
          alert("请先选择一个审计脚本");
          return;
        }
        runBtn.disabled = true;
        try {
          const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              script: selectedScript.path,
              headed: headedToggle.checked,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.message || "启动失败");
          }
          renderStatus(data);
        } catch (error) {
          alert(error.message || "启动失败");
        } finally {
          runBtn.disabled = false;
          fetchRuns();
        }
      }

      openReportBtn.addEventListener("click", () => {
        if (selectedRunHtml) {
          window.open(selectedRunHtml, "_blank");
        }
      });
      runBtn.addEventListener("click", startRun);
      refreshRunsBtn.addEventListener("click", fetchRuns);

      Promise.all([fetchScripts(), fetchRuns(), fetchStatus()]);
      setInterval(() => {
        fetchStatus();
        fetchRuns();
      }, 3000);
    </script>
  </body>
</html>
    """


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "UIAuditDashboard/0.1"

    @property
    def dashboard_context(self) -> Dict[str, object]:
        return self.server.dashboard_context  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        workspace = self.dashboard_context["workspace"]
        reports_root = self.dashboard_context["reports_root"]
        manager = self.dashboard_context["manager"]

        if path == "/":
            _send_html(self, _dashboard_html())
            return
        if path == "/api/scripts":
            _send_json(self, {"items": discover_audit_scripts(workspace)})
            return
        if path == "/api/runs":
            _send_json(self, {"items": list_runs(reports_root)})
            return
        if path == "/api/status":
            _send_json(self, manager.get_status())
            return
        if path.startswith("/reports/"):
            requested = path[len("/reports/") :]
            file_path = (reports_root / requested).resolve()
            try:
                file_path.relative_to(reports_root.resolve())
            except ValueError:
                self.send_error(HTTPStatus.FORBIDDEN, "禁止访问")
                return
            _serve_file(self, file_path)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:
        if self.path != "/api/run":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            _send_json(self, {"message": "请求体不是合法 JSON"}, status=400)
            return

        manager = self.dashboard_context["manager"]
        try:
            data = manager.start_run(script=str(payload.get("script", "")), headed=bool(payload.get("headed")))
        except Exception as exc:
            _send_json(self, {"message": str(exc)}, status=400)
            return
        _send_json(self, data, status=200)

    def log_message(self, format: str, *args: object) -> None:
        return


def serve_dashboard(host: str = "127.0.0.1", port: int = 4328, workspace: Optional[str] = None) -> None:
    workspace_path = Path(workspace or ".").resolve()
    reports_root = (workspace_path / "reports" / "runs").resolve()
    reports_root.mkdir(parents=True, exist_ok=True)
    manager = RunManager(workspace=workspace_path, reports_root=reports_root)

    server = ThreadingHTTPServer((host, port), DashboardHandler)
    server.dashboard_context = {  # type: ignore[attr-defined]
        "workspace": workspace_path,
        "reports_root": reports_root,
        "manager": manager,
    }
    print("Dashboard running at http://{0}:{1}".format(host, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("")
        print("Dashboard stopped.")
