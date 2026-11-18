"""Exercise cmd.exe itself; Python-only checks miss batch parsing problems."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'nt', 'Windows cmd.exe integration')
class WindowsLauncherTests(unittest.TestCase):
    def test_launchers_have_windows_line_endings_and_ascii_commands(self):
        for name in ('启动网站.cmd', 'start.cmd'):
            raw = (HERE / name).read_bytes()
            raw.decode('ascii')
            self.assertNotIn(b'\n', raw.replace(b'\r\n', b''))
            self.assertNotIn(b'chcp', raw)

    def test_real_launcher_from_another_working_directory(self):
        result = subprocess.run(['cmd.exe', '/d', '/c', str(HERE / '启动网站.cmd'), '--help'],
                                cwd=HERE.parent, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
        self.assertEqual(result.returncode, 0, repr(result.stdout))
        self.assertIn(b'--repo', result.stdout)
        self.assertIn(b'--port', result.stdout)
        self.assertNotIn(b'not recognized', result.stdout)

    def test_command_error_is_not_hidden_by_pause(self):
        result = subprocess.run(['cmd.exe', '/d', '/c', str(HERE / 'start.cmd'), '--port', 'invalid'],
                                cwd=HERE.parent, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
        self.assertEqual(result.returncode, 2, repr(result.stdout))

    def test_chinese_and_spaces_in_directory(self):
        with tempfile.TemporaryDirectory(prefix='掌柜 启动测试 ') as name:
            root = Path(name)
            (root / 'start.cmd').write_bytes((HERE / 'start.cmd').read_bytes())
            (root / 'start.py').write_text('import pathlib\nprint("LAUNCH_OK", pathlib.Path.cwd().name)\n', encoding='utf-8')
            # cmd /s /c uses an outer quote pair around the quoted script path.
            command = f'cmd.exe /d /s /c ""{root / "start.cmd"}""'
            result = subprocess.run(command,
                                    cwd=HERE, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
            self.assertEqual(result.returncode, 0, repr(result.stdout))
            self.assertIn(b'LAUNCH_OK', result.stdout)
            self.assertNotIn(b'not recognized', result.stdout)


if __name__ == '__main__':
    unittest.main()
