from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence


CheckExecutor = Callable[[Any], "AuditResult"]
LifecycleHook = Callable[[Any], None]


def default_viewports() -> List["Viewport"]:
    return [
        Viewport("desktop", 1440, 900),
        Viewport("tablet", 1024, 768),
        Viewport("mobile", 390, 844),
    ]


@dataclass
class Viewport:
    name: str
    width: int
    height: int


@dataclass
class KeyboardShortcut:
    keys: str
    expect_selector: Optional[str] = None
    expect_active_selector: Optional[str] = None
    expect_url_contains: Optional[str] = None
    description: str = ""


@dataclass
class NavigationStep:
    name: str
    action_selector: str
    expected_url_contains: Optional[str] = None
    expected_selector: Optional[str] = None
    go_back: bool = False
    back_expected_url_contains: Optional[str] = None
    back_expected_selector: Optional[str] = None


@dataclass
class AuditCheck:
    check_id: str
    title: str
    category: str
    executor: CheckExecutor

    def run(self, context: Any) -> "AuditResult":
        return self.executor(context)


@dataclass
class AuditSpec:
    name: str
    url: str
    checks: Sequence[AuditCheck]
    description: str = ""
    viewports: Sequence[Viewport] = field(default_factory=default_viewports)
    timeout_ms: int = 15000
    wait_until: str = "load"
    setup: Optional[LifecycleHook] = None
    teardown: Optional[LifecycleHook] = None


@dataclass
class AuditResult:
    check_id: str
    title: str
    category: str
    viewport: str
    status: str
    summary: str
    details: List[str] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)
    artifacts: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "check_id": self.check_id,
            "title": self.title,
            "category": self.category,
            "viewport": self.viewport,
            "status": self.status,
            "summary": self.summary,
            "details": list(self.details),
            "metrics": dict(self.metrics),
            "artifacts": dict(self.artifacts),
            "error": self.error,
        }


@dataclass
class AuditReport:
    name: str
    url: str
    started_at: str
    finished_at: str
    summary: Dict[str, int]
    results: List[AuditResult]
    run_id: str = ""
    description: str = ""
    script_path: str = ""
    artifacts: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "name": self.name,
            "description": self.description,
            "url": self.url,
            "script_path": self.script_path,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "summary": dict(self.summary),
            "results": [item.to_dict() for item in self.results],
            "artifacts": dict(self.artifacts),
        }


def summarize_results(results: Sequence[AuditResult]) -> Dict[str, int]:
    summary = {
        "total": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "error": 0,
    }
    for item in results:
        summary["total"] += 1
        if item.status in summary:
            summary[item.status] += 1
        else:
            summary["error"] += 1
    return summary
