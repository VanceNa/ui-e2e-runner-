from __future__ import annotations

import importlib.util
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .models import AuditReport, AuditResult, AuditSpec, summarize_results
from .reporting import ensure_run_dirs, relativize, resolve_run_paths, write_html_report, write_json_report


def _utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def ensure_playwright() -> Any:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "未安装 Playwright Python 依赖。请先执行 `pip install -e .[browser]` "
            "并运行 `python -m playwright install chromium`。"
        ) from exc
    return sync_playwright


def resolve_target_url(url: str) -> str:
    if url.startswith(("http://", "https://", "file://", "data:")):
        return url
    path = Path(url)
    if path.exists():
        return path.resolve().as_uri()
    return url


def load_audit_script(script_path: str) -> AuditSpec:
    path = Path(script_path).resolve()
    if not path.exists():
        raise FileNotFoundError("未找到审计脚本: {0}".format(path))

    module_name = "ui_audit_script_{0}".format(path.stem.replace("-", "_"))
    spec = importlib.util.spec_from_file_location(module_name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载审计脚本: {0}".format(path))

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    loaded = getattr(module, "SPEC", None)
    if loaded is None and hasattr(module, "build_spec"):
        loaded = module.build_spec()

    if not isinstance(loaded, AuditSpec):
        raise TypeError("审计脚本必须暴露 `SPEC` 或 `build_spec()`，且返回 AuditSpec")
    return loaded


@dataclass
class PageAuditContext:
    spec: AuditSpec
    page: Any
    viewport: Any
    run_dir: Optional[Path] = None

    def result(
        self,
        check_id: str,
        title: str,
        category: str,
        status: str,
        summary: str,
        details: Optional[list] = None,
        metrics: Optional[dict] = None,
        artifacts: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> AuditResult:
        return AuditResult(
            check_id=check_id,
            title=title,
            category=category,
            viewport=self.viewport.name,
            status=status,
            summary=summary,
            details=details or [],
            metrics=metrics or {},
            artifacts=artifacts or {},
            error=error,
        )

    def wait_for_visible(self, selector: str, timeout_ms: Optional[int] = None) -> None:
        self.page.locator(selector).first.wait_for(
            state="visible",
            timeout=timeout_ms or self.spec.timeout_ms,
        )

    def current_url(self) -> str:
        return str(self.page.url)


def print_console_report(report: AuditReport) -> None:
    for item in report.results:
        marker = {
            "passed": "PASS",
            "failed": "FAIL",
            "skipped": "SKIP",
            "error": "ERR ",
        }.get(item.status, "INFO")
        print("[{0}] [{1}] [{2}] {3}".format(marker, item.viewport, item.category, item.title))
        print("  {0}".format(item.summary))
        if item.error:
            print("  error: {0}".format(item.error))
    print("")
    print(
        "Summary: total={total} passed={passed} failed={failed} skipped={skipped} error={error}".format(
            **report.summary
        )
    )
    if report.artifacts.get("json_report"):
        print("JSON report: {0}".format(report.artifacts["json_report"]))
    if report.artifacts.get("html_report"):
        print("HTML report: {0}".format(report.artifacts["html_report"]))
    if report.artifacts.get("root_dir"):
        print("Artifacts: {0}".format(report.artifacts["root_dir"]))


@dataclass
class RunOptions:
    script_path: str = ""
    reports_root: Optional[str] = None
    artifacts_dir: Optional[str] = None
    output_path: Optional[str] = None
    html_report_path: Optional[str] = None
    headless: bool = True
    capture_screenshots: bool = True
    capture_trace: bool = True
    capture_video: bool = True


def _capture_check_screenshot(context: PageAuditContext, screenshot_path: Path) -> None:
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    context.page.screenshot(path=str(screenshot_path), full_page=True)


def _normalize_result_artifact(result: AuditResult, key: str, absolute_path: Path, run_dir: Path) -> None:
    result.artifacts[key] = relativize(absolute_path, run_dir)


def run_spec(spec: AuditSpec, options: Optional[RunOptions] = None) -> AuditReport:
    run_options = options or RunOptions()
    sync_playwright = ensure_playwright()
    started_at = _utc_now()
    results = []
    target_url = resolve_target_url(spec.url)
    run_paths = resolve_run_paths(
        spec_name=spec.name,
        reports_root=run_options.reports_root,
        artifacts_dir=run_options.artifacts_dir,
        output_path=run_options.output_path,
        html_report_path=run_options.html_report_path,
    )
    ensure_run_dirs(
        run_paths,
        capture_screenshots=run_options.capture_screenshots,
        capture_trace=run_options.capture_trace,
        capture_video=run_options.capture_video,
    )
    viewport_artifacts = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=run_options.headless)
        try:
            for viewport in spec.viewports:
                context_browser = browser.new_context(
                    viewport={"width": viewport.width, "height": viewport.height},
                    record_video_dir=str(run_paths.videos_dir) if run_options.capture_video else None,
                    record_video_size={"width": viewport.width, "height": viewport.height} if run_options.capture_video else None,
                )
                if run_options.capture_trace:
                    context_browser.tracing.start(screenshots=True, snapshots=True, sources=True)

                page = context_browser.new_page()
                page_video = page.video
                context = PageAuditContext(spec=spec, page=page, viewport=viewport, run_dir=run_paths.run_dir)
                trace_stopped = not run_options.capture_trace
                context_closed = False

                try:
                    page.goto(target_url, wait_until=spec.wait_until, timeout=spec.timeout_ms)

                    if spec.setup is not None:
                        spec.setup(context)

                    for check in spec.checks:
                        try:
                            result = check.run(context)
                        except Exception as exc:
                            result = context.result(
                                check_id=check.check_id,
                                title=check.title,
                                category=check.category,
                                status="error",
                                summary="检查执行异常",
                                error=str(exc),
                            )

                        if run_options.capture_screenshots and result.status in ("failed", "error"):
                            screenshot_path = run_paths.screenshots_dir / "{0}-{1}.png".format(
                                viewport.name,
                                check.check_id,
                            )
                            try:
                                _capture_check_screenshot(context, screenshot_path)
                                _normalize_result_artifact(result, "screenshot", screenshot_path, run_paths.run_dir)
                            except Exception as screenshot_exc:
                                result.details.append("失败截图采集失败: {0}".format(screenshot_exc))

                        results.append(result)

                    if spec.teardown is not None:
                        spec.teardown(context)

                    viewport_artifact = {}
                    if run_options.capture_screenshots:
                        final_screenshot_path = run_paths.screenshots_dir / "{0}-final.png".format(viewport.name)
                        try:
                            _capture_check_screenshot(context, final_screenshot_path)
                            viewport_artifact["final_screenshot"] = relativize(final_screenshot_path, run_paths.run_dir)
                        except Exception:
                            pass

                    if run_options.capture_trace:
                        trace_path = run_paths.traces_dir / "{0}-trace.zip".format(viewport.name)
                        try:
                            context_browser.tracing.stop(path=str(trace_path))
                            trace_stopped = True
                            viewport_artifact["trace"] = relativize(trace_path, run_paths.run_dir)
                        except Exception:
                            pass

                    page.close()
                    context_browser.close()
                    context_closed = True

                    if run_options.capture_video and page_video is not None:
                        try:
                            raw_video_path = Path(page_video.path())
                            final_video_path = run_paths.videos_dir / "{0}.webm".format(viewport.name)
                            final_video_path.parent.mkdir(parents=True, exist_ok=True)
                            if raw_video_path.exists():
                                shutil.move(str(raw_video_path), str(final_video_path))
                                viewport_artifact["video"] = relativize(final_video_path, run_paths.run_dir)
                        except Exception:
                            pass

                    viewport_artifacts[viewport.name] = viewport_artifact
                finally:
                    if run_options.capture_trace and not trace_stopped:
                        try:
                            context_browser.tracing.stop()
                        except Exception:
                            pass
                    if page and not page.is_closed():
                        page.close()
                    if not context_closed:
                        try:
                            context_browser.close()
                        except Exception:
                            pass
        finally:
            browser.close()

    report = AuditReport(
        name=spec.name,
        description=spec.description,
        url=target_url,
        script_path=run_options.script_path,
        started_at=started_at,
        finished_at=_utc_now(),
        summary=summarize_results(results),
        results=results,
        run_id=run_paths.run_id,
        artifacts={
            "root_dir": str(run_paths.run_dir),
            "json_report": str(run_paths.json_report),
            "html_report": str(run_paths.html_report),
            "json_report_relative": relativize(run_paths.json_report, run_paths.run_dir),
            "html_report_relative": relativize(run_paths.html_report, run_paths.run_dir),
            "viewports": viewport_artifacts,
        },
    )
    write_json_report(report, run_paths.json_report)
    write_html_report(report, run_paths.html_report)
    print_console_report(report)
    return report
