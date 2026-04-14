from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .models import AuditReport, AuditResult


def slugify_name(value: str) -> str:
    text = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", value.strip().lower())
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "audit-run"


def make_run_id(name: str, moment: Optional[datetime] = None) -> str:
    current = moment or datetime.now()
    return "{0}-{1}".format(current.strftime("%Y%m%d-%H%M%S"), slugify_name(name)[:48])


@dataclass
class RunPaths:
    run_id: str
    run_dir: Path
    json_report: Path
    html_report: Path
    screenshots_dir: Path
    traces_dir: Path
    videos_dir: Path


def resolve_run_paths(
    spec_name: str,
    reports_root: Optional[str] = None,
    artifacts_dir: Optional[str] = None,
    output_path: Optional[str] = None,
    html_report_path: Optional[str] = None,
) -> RunPaths:
    if artifacts_dir:
        run_dir = Path(artifacts_dir).expanduser().resolve()
    elif output_path:
        run_dir = Path(output_path).expanduser().resolve().parent
    elif html_report_path:
        run_dir = Path(html_report_path).expanduser().resolve().parent
    else:
        base_dir = Path(reports_root or "reports/runs").expanduser().resolve()
        run_dir = base_dir / make_run_id(spec_name)

    json_report = Path(output_path).expanduser().resolve() if output_path else run_dir / "report.json"
    html_report = Path(html_report_path).expanduser().resolve() if html_report_path else run_dir / "report.html"

    return RunPaths(
        run_id=run_dir.name,
        run_dir=run_dir,
        json_report=json_report,
        html_report=html_report,
        screenshots_dir=run_dir / "screenshots",
        traces_dir=run_dir / "traces",
        videos_dir=run_dir / "videos",
    )


def ensure_run_dirs(paths: RunPaths, capture_screenshots: bool, capture_trace: bool, capture_video: bool) -> None:
    paths.run_dir.mkdir(parents=True, exist_ok=True)
    if capture_screenshots:
        paths.screenshots_dir.mkdir(parents=True, exist_ok=True)
    if capture_trace:
        paths.traces_dir.mkdir(parents=True, exist_ok=True)
    if capture_video:
        paths.videos_dir.mkdir(parents=True, exist_ok=True)


def relativize(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def write_json_report(report: AuditReport, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")


def _status_class(status: str) -> str:
    return {
        "passed": "status-pass",
        "failed": "status-fail",
        "skipped": "status-skip",
        "error": "status-error",
    }.get(status, "status-info")


def _render_result_card(result: AuditResult) -> str:
    details = "".join("<li>{0}</li>".format(html.escape(item)) for item in result.details) or "<li>无额外说明</li>"
    artifact_links = []
    for key, value in sorted(result.artifacts.items()):
        if isinstance(value, str) and value:
            artifact_links.append(
                '<a class="artifact-link" href="{href}" target="_blank" rel="noreferrer">{label}</a>'.format(
                    href=html.escape(value),
                    label=html.escape(key),
                )
            )
    artifact_html = "".join(artifact_links) or '<span class="artifact-muted">无附加产物</span>'
    metrics_html = html.escape(json.dumps(result.metrics, ensure_ascii=False, indent=2)) if result.metrics else "无"
    error_html = (
        '<div class="error-box"><strong>执行异常</strong><pre>{0}</pre></div>'.format(html.escape(result.error))
        if result.error
        else ""
    )

    return """
    <article class="result-card">
      <div class="result-head">
        <div>
          <p class="result-category">{category}</p>
          <h3>{title}</h3>
        </div>
        <div class="result-meta">
          <span class="badge {status_class}">{status}</span>
          <span class="viewport-pill">{viewport}</span>
        </div>
      </div>
      <p class="result-summary">{summary}</p>
      <div class="artifact-row">{artifact_html}</div>
      <div class="result-grid">
        <section>
          <h4>细节</h4>
          <ul>{details}</ul>
        </section>
        <section>
          <h4>指标</h4>
          <pre>{metrics}</pre>
        </section>
      </div>
      {error_html}
    </article>
    """.format(
        category=html.escape(result.category),
        title=html.escape(result.title),
        status_class=_status_class(result.status),
        status=html.escape(result.status.upper()),
        viewport=html.escape(result.viewport),
        summary=html.escape(result.summary),
        artifact_html=artifact_html,
        details=details,
        metrics=metrics_html,
        error_html=error_html,
    )


def _render_viewport_cards(viewports: Dict[str, Dict[str, str]]) -> str:
    cards = []
    for viewport, payload in sorted(viewports.items()):
        screenshot = payload.get("final_screenshot")
        trace = payload.get("trace")
        video = payload.get("video")
        screenshot_html = (
            '<a class="shot-link" href="{0}" target="_blank" rel="noreferrer"><img src="{0}" alt="{1} screenshot" /></a>'.format(
                html.escape(screenshot),
                html.escape(viewport),
            )
            if screenshot
            else '<div class="shot-placeholder">无截图</div>'
        )
        links = []
        if trace:
            links.append(
                '<a class="artifact-link" href="{0}" target="_blank" rel="noreferrer">trace</a>'.format(
                    html.escape(trace)
                )
            )
        if video:
            links.append(
                '<a class="artifact-link" href="{0}" target="_blank" rel="noreferrer">video</a>'.format(
                    html.escape(video)
                )
            )
        cards.append(
            """
            <article class="viewport-card">
              <div class="viewport-head">
                <h3>{viewport}</h3>
                <span class="viewport-pill">{viewport}</span>
              </div>
              {screenshot_html}
              <div class="artifact-row">{links}</div>
            </article>
            """.format(
                viewport=html.escape(viewport),
                screenshot_html=screenshot_html,
                links="".join(links) or '<span class="artifact-muted">无 trace / video</span>',
            )
        )
    return "".join(cards) or '<div class="empty-panel">当前运行未生成 viewport 级产物。</div>'


def _render_summary_cards(summary: Dict[str, int]) -> str:
    order = [
        ("total", "总检查"),
        ("passed", "通过"),
        ("failed", "失败"),
        ("skipped", "跳过"),
        ("error", "异常"),
    ]
    return "".join(
        """
        <article class="summary-card">
          <p>{label}</p>
          <strong>{value}</strong>
        </article>
        """.format(label=html.escape(label), value=summary.get(key, 0))
        for key, label in order
    )


def write_html_report(report: AuditReport, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    viewport_cards = _render_viewport_cards(report.artifacts.get("viewports", {}))
    result_cards = "".join(_render_result_card(item) for item in report.results) or '<div class="empty-panel">没有检查结果。</div>'
    html_content = """
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <style>
      :root {{
        --paper: #f3eee4;
        --card: rgba(255, 251, 244, 0.88);
        --ink: #132235;
        --muted: #607089;
        --accent: #b86a2b;
        --accent-soft: rgba(184, 106, 43, 0.14);
        --line: rgba(19, 34, 53, 0.12);
        --pass: #186a3b;
        --fail: #9a2b24;
        --skip: #7b6640;
        --error: #6d2573;
        --shadow: 0 18px 42px rgba(19, 34, 53, 0.10);
      }}

      * {{ box-sizing: border-box; }}

      body {{
        margin: 0;
        font-family: "Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(184, 106, 43, 0.18), transparent 22%),
          linear-gradient(180deg, #f8f4ec 0%, #f1eadf 100%);
      }}

      .page {{
        max-width: 1360px;
        margin: 0 auto;
        padding: 28px 22px 52px;
      }}

      .hero {{
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 18px;
      }}

      .hero-card, .panel {{
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }}

      .hero-card {{
        padding: 28px;
      }}

      .eyebrow {{
        margin: 0 0 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-size: 12px;
        color: var(--accent);
      }}

      h1, h2, h3, h4 {{
        font-family: "Baskerville", "Palatino Linotype", serif;
      }}

      h1 {{
        margin: 0;
        font-size: 38px;
        line-height: 1.05;
      }}

      .meta-grid {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 18px;
      }}

      .meta-item {{
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.68);
        border: 1px solid rgba(19, 34, 53, 0.08);
      }}

      .meta-item span {{
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 6px;
      }}

      .summary-grid, .viewport-grid, .result-list {{
        margin-top: 22px;
      }}

      .summary-grid {{
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 14px;
      }}

      .summary-card {{
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(19, 34, 53, 0.08);
      }}

      .summary-card p {{
        margin: 0;
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }}

      .summary-card strong {{
        display: block;
        margin-top: 10px;
        font-size: 34px;
      }}

      .panel {{
        padding: 22px;
        margin-top: 18px;
      }}

      .viewport-grid {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
      }}

      .viewport-card {{
        border-radius: 18px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.74);
        border: 1px solid rgba(19, 34, 53, 0.08);
      }}

      .viewport-head {{
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 16px 10px;
      }}

      .shot-link, .shot-placeholder {{
        display: block;
        margin: 0 16px 16px;
        border-radius: 16px;
        overflow: hidden;
        background: linear-gradient(135deg, #d9dfeb, #f4ede2);
        min-height: 160px;
      }}

      .shot-link img {{
        display: block;
        width: 100%;
        height: 180px;
        object-fit: cover;
      }}

      .shot-placeholder {{
        display: grid;
        place-items: center;
        color: var(--muted);
      }}

      .artifact-row {{
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        padding: 0 16px 16px;
      }}

      .artifact-link, .artifact-muted, .viewport-pill, .badge {{
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        font-size: 12px;
        text-decoration: none;
      }}

      .artifact-link {{
        color: var(--ink);
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid rgba(19, 34, 53, 0.10);
      }}

      .artifact-muted, .viewport-pill {{
        color: var(--muted);
        background: rgba(19, 34, 53, 0.05);
      }}

      .result-list {{
        display: grid;
        gap: 16px;
      }}

      .result-card {{
        padding: 20px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.76);
        border: 1px solid rgba(19, 34, 53, 0.08);
      }}

      .result-head {{
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }}

      .result-head h3 {{
        margin: 4px 0 0;
        font-size: 24px;
      }}

      .result-category {{
        margin: 0;
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }}

      .result-meta {{
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: flex-start;
      }}

      .badge {{
        color: #fff;
      }}

      .status-pass {{ background: var(--pass); }}
      .status-fail {{ background: var(--fail); }}
      .status-skip {{ background: var(--skip); }}
      .status-error {{ background: var(--error); }}
      .status-info {{ background: #445268; }}

      .result-summary {{
        color: var(--ink);
        font-size: 16px;
      }}

      .result-grid {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }}

      section h4 {{
        margin: 0 0 10px;
        font-size: 18px;
      }}

      ul {{
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
      }}

      pre {{
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--muted);
        background: rgba(19, 34, 53, 0.04);
        border-radius: 14px;
        padding: 12px;
      }}

      .error-box {{
        margin-top: 14px;
        padding: 14px;
        border-radius: 16px;
        background: rgba(154, 43, 36, 0.08);
        border: 1px solid rgba(154, 43, 36, 0.12);
      }}

      .empty-panel {{
        padding: 18px;
        border-radius: 18px;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.72);
        border: 1px dashed rgba(19, 34, 53, 0.16);
      }}

      @media (max-width: 980px) {{
        .hero, .summary-grid, .result-grid {{
          grid-template-columns: 1fr;
        }}
      }}
    </style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <article class="hero-card">
          <p class="eyebrow">UI Audit Report</p>
          <h1>{name}</h1>
          <p>{description}</p>
          <div class="meta-grid">
            <div class="meta-item"><span>Run ID</span><strong>{run_id}</strong></div>
            <div class="meta-item"><span>Target URL</span><strong>{url}</strong></div>
            <div class="meta-item"><span>Started</span><strong>{started_at}</strong></div>
            <div class="meta-item"><span>Finished</span><strong>{finished_at}</strong></div>
          </div>
        </article>
        <article class="hero-card">
          <p class="eyebrow">Outputs</p>
          <div class="artifact-row">
            <a class="artifact-link" href="{json_href}" target="_blank" rel="noreferrer">JSON report</a>
            <a class="artifact-link" href="{html_href}" target="_blank" rel="noreferrer">HTML report</a>
          </div>
          <div class="summary-grid">{summary_cards}</div>
        </article>
      </section>

      <section class="panel">
        <p class="eyebrow">Viewport Gallery</p>
        <div class="viewport-grid">{viewport_cards}</div>
      </section>

      <section class="panel">
        <p class="eyebrow">Checks</p>
        <div class="result-list">{result_cards}</div>
      </section>
    </div>
  </body>
</html>
    """.format(
        title=html.escape(report.name),
        name=html.escape(report.name),
        description=html.escape(report.description or "本次运行包含截图、trace、video 与详细检查清单。"),
        run_id=html.escape(report.run_id),
        url=html.escape(report.url),
        started_at=html.escape(report.started_at),
        finished_at=html.escape(report.finished_at),
        json_href=html.escape(report.artifacts.get("json_report_relative", "report.json")),
        html_href=html.escape(report.artifacts.get("html_report_relative", "report.html")),
        summary_cards=_render_summary_cards(report.summary),
        viewport_cards=viewport_cards,
        result_cards=result_cards,
    )
    output_path.write_text(html_content, encoding="utf-8")


def load_report_file(report_json_path: Path) -> Dict[str, object]:
    return json.loads(report_json_path.read_text(encoding="utf-8"))


def iter_run_reports(reports_root: Path) -> Iterable[Path]:
    if not reports_root.exists():
        return []
    report_files: List[Path] = []
    for directory in sorted(reports_root.iterdir(), reverse=True):
        candidate = directory / "report.json"
        if candidate.exists():
            report_files.append(candidate)
    return report_files
