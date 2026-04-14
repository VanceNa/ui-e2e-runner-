import unittest

from ui_audit_runner.models import AuditResult, summarize_results


class SummarizeResultsTest(unittest.TestCase):
    def test_summarize_results(self):
        results = [
            AuditResult("a", "布局", "布局与排版", "desktop", "passed", "ok"),
            AuditResult("b", "视觉", "视觉一致性", "desktop", "failed", "bad"),
            AuditResult("c", "控件", "控件功能", "mobile", "skipped", "skip"),
            AuditResult("d", "导航", "导航与交互", "mobile", "error", "err"),
        ]

        summary = summarize_results(results)

        self.assertEqual(summary["total"], 4)
        self.assertEqual(summary["passed"], 1)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["skipped"], 1)
        self.assertEqual(summary["error"], 1)


if __name__ == "__main__":
    unittest.main()
