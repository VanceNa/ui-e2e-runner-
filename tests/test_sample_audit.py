import unittest
from pathlib import Path

from ui_audit_runner.runtime import load_audit_script


class SampleAuditScriptTest(unittest.TestCase):
    def test_load_sample_audit(self):
        script = Path(__file__).resolve().parents[1] / "examples" / "sample_audit.py"
        spec = load_audit_script(str(script))

        self.assertEqual(spec.name, "内置示例页面 UI 审计")
        self.assertTrue(spec.url.startswith("file://"))
        self.assertEqual(len(spec.viewports), 3)
        self.assertGreaterEqual(len(spec.checks), 20)


if __name__ == "__main__":
    unittest.main()
