import unittest
from unittest.mock import patch

from ui_audit_runner.cli import main
from ui_audit_runner.models import AuditSpec


class CliRunCommandTest(unittest.TestCase):
    @patch("ui_audit_runner.cli.run_spec")
    @patch("ui_audit_runner.cli.load_audit_script")
    def test_run_command_passes_run_options(self, mock_load_audit_script, mock_run_spec):
        spec = AuditSpec(name="示例", url="https://example.com", checks=[])
        mock_load_audit_script.return_value = spec

        exit_code = main(
            [
                "run",
                "examples/sample_audit.py",
                "--output",
                "reports/sample-report.json",
                "--headed",
            ]
        )

        self.assertEqual(exit_code, 0)
        mock_load_audit_script.assert_called_once_with("examples/sample_audit.py")
        mock_run_spec.assert_called_once()

        args, kwargs = mock_run_spec.call_args
        self.assertEqual(kwargs, {})
        self.assertIs(args[0], spec)
        self.assertEqual(args[1].script_path, "examples/sample_audit.py")
        self.assertEqual(args[1].output_path, "reports/sample-report.json")
        self.assertFalse(args[1].headless)


if __name__ == "__main__":
    unittest.main()
