"""Scan locally, then launch the viewer. No third-party dependencies."""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from graph_builder import scan

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description='启动掌柜智库学习知识图谱（Python 3.11+）')
parser.add_argument('--repo', type=Path, help='可选：改为读取你日常使用的业务仓库')
parser.add_argument('--port', type=int, default=8765)
args = parser.parse_args()
config = HERE / 'repo.local.json'
saved = json.loads(config.read_text(encoding='utf-8')) if config.exists() else {}
repo = args.repo or Path(saved.get('repo', HERE / 'reference-source'))
try:
    graph = scan(repo)
except (ValueError, OSError) as exc:
    print(f'无法读取源码：{exc}\n请使用 python start.py --repo "掌柜智库仓库完整路径"')
    raise SystemExit(1)
data = HERE / 'data/graph.json'
data.parent.mkdir(exist_ok=True)
temp = data.with_suffix('.tmp')
temp.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding='utf-8')
temp.replace(data)
config.write_text(json.dumps({'repo': str(repo.resolve())}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"已扫描 {len(graph['files'])} 个文件，提交 {graph['meta']['revision']}。", flush=True)
try:
    exit_code = subprocess.call([sys.executable, '-u', str(HERE / 'server.py'), '--port', str(args.port)])
except KeyboardInterrupt:
    exit_code = 0
raise SystemExit(exit_code)
