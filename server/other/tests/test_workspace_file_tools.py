import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from mcp_runtime.mcp.tools import workspace


class WorkspaceFileToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.root_patch = patch("mcp_runtime.mcp.tools.workspace.get_project_root", return_value=self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def test_edit_file_replaces_unique_block(self):
        path = os.path.join(self.root, "task.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("keep\nremove this\nkeep2\n")

        result = workspace._edit_file(1, {
            "path": "task.md",
            "edits": [{"op": "delete", "search": "remove this\n"}],
        }, 34)

        self.assertTrue(result["success"])
        self.assertTrue(result["changed"])
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "keep\nkeep2\n")

    def test_edit_file_rejects_ambiguous_match_without_replace_all(self):
        path = os.path.join(self.root, "task.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("same\nsame\n")

        with self.assertRaises(HTTPException) as cm:
            workspace._edit_file(1, {
                "path": "task.md",
                "edits": [{"op": "delete", "search": "same\n"}],
            }, 34)

        self.assertEqual(cm.exception.status_code, 409)
        self.assertIn("matched 2 times", str(cm.exception.detail))

    def test_run_command_returns_structured_stderr(self):
        result = workspace._run_command(1, {
            "command": "python -c \"import sys; sys.stderr.write('bad'); sys.exit(3)\"",
            "timeout": 10,
        }, 34)

        self.assertFalse(result["success"])
        self.assertEqual(result["exit_code"], 3)
        self.assertEqual(result["stderr"], "bad")
        self.assertIn("shell", result)
        self.assertIn("command_length", result)
        self.assertEqual(result["failure_type"], "nonzero_exit")

    def test_run_command_dry_run_returns_resolved_execution_context(self):
        result = workspace._run_command(1, {
            "command": "echo hello",
            "shell": "cmd" if os.name == "nt" else "auto",
            "dry_run": True,
        }, 34)

        self.assertTrue(result["success"])
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["stdout"], "")
        self.assertEqual(result["exit_code"], None)
        self.assertIn("cwd", result)

    def test_run_command_argv_bypasses_shell(self):
        result = workspace._run_command(1, {
            "argv": ["python", "-c", "print('argv-ok')"],
            "timeout": 10,
        }, 34)

        self.assertTrue(result["success"])
        self.assertEqual(result["shell"], "none")
        self.assertEqual(result["stdout"].strip(), "argv-ok")

    def test_run_command_uses_windows_codepage_for_cmd_shell(self):
        fake_proc = MagicMock(returncode=0, stdout="中文", stderr="")
        with patch.object(workspace.os, "name", "nt"), \
             patch("mcp_runtime.mcp.tools.workspace.locale.getpreferredencoding", return_value="cp936"), \
             patch("mcp_runtime.mcp.tools.workspace.subprocess.run", return_value=fake_proc) as mock_run:
            result = workspace._run_command(1, {
                "shell": "cmd",
                "command": "dir /a",
                "timeout": 10,
            }, 34)

        self.assertTrue(result["success"])
        self.assertEqual(result["stdout"], "中文")
        self.assertEqual(result["shell"], "cmd")
        self.assertEqual(mock_run.call_args.kwargs["encoding"], "cp936")
        self.assertEqual(mock_run.call_args.kwargs["errors"], "replace")

    def test_run_command_uses_utf8_for_powershell_shell(self):
        fake_proc = MagicMock(returncode=0, stdout="中文", stderr="")
        with patch.object(workspace.os, "name", "nt"), \
             patch("mcp_runtime.mcp.tools.workspace.locale.getpreferredencoding", return_value="cp936"), \
             patch("mcp_runtime.mcp.tools.workspace.subprocess.run", return_value=fake_proc) as mock_run:
            result = workspace._run_command(1, {
                "shell": "powershell",
                "command": "Write-Output 中文",
                "timeout": 10,
            }, 34)

        self.assertTrue(result["success"])
        self.assertEqual(result["stdout"], "中文")
        self.assertEqual(result["shell"], "powershell")
        self.assertEqual(mock_run.call_args.kwargs["encoding"], "utf-8")
        self.assertEqual(mock_run.call_args.kwargs["errors"], "replace")

    def test_run_command_reports_shell_launch_failure(self):
        result = workspace._run_command(1, {
            "shell": "pwsh",
            "command": "Write-Output ok",
            "timeout": 10,
        }, 34)

        if result["success"]:
            self.assertEqual(result["stdout"].strip(), "ok")
        else:
            self.assertEqual(result["failure_type"], "shell_launch_failed")
            self.assertIn("stderr", result)


if __name__ == "__main__":
    unittest.main()
