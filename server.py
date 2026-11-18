"""Loopback-only viewer; no business imports, shell execution or write APIs."""
import argparse
import hashlib
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent


def read_source(graph, path, line):
    if path not in graph['files']:
        raise ValueError('此文件不在扫描清单中。')
    root = Path(graph['meta']['sourceRoot']).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise ValueError('源码路径不可用。')
    raw = target.read_bytes()
    current = hashlib.sha256(raw).hexdigest()
    lines = raw.decode('utf-8-sig').splitlines()
    start, end = max(1, line - 6), min(len(lines), line + 30)
    return dict(path=path, absolutePath=str(target), line=line, start=start, lines=lines[start-1:end],
                stale=current != graph['files'][path]['sha256'],
                editorUrl='vscode://file/' + target.as_posix() + ':' + str(line))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        port = self.server.server_address[1]
        allowed = (f'127.0.0.1:{port}', f'localhost:{port}')
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        if host not in allowed or (origin and origin not in tuple('http://' + h for h in allowed)):
            return self.send_error(403)
        parsed = urlparse(self.path)
        try:
            if parsed.path in ('/api/graph', '/api/source'):
                graph = json.loads((HERE / 'data/graph.json').read_text(encoding='utf-8'))
                if parsed.path == '/api/graph':
                    payload = graph
                else:
                    query = parse_qs(parsed.query)
                    payload = read_source(graph, query.get('path', [''])[0], max(1, int(query.get('line', ['1'])[0])))
                return self.respond(json.dumps(payload, ensure_ascii=False).encode(), 'application/json; charset=utf-8')
            mapping = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'}
            if parsed.path == '/api/learning':
                return self.respond((HERE / 'content/learning.json').read_bytes(), 'application/json; charset=utf-8')
            if parsed.path not in mapping:
                return self.send_error(404)
            file = HERE / 'static' / mapping[parsed.path]
            return self.respond(file.read_bytes(), (mimetypes.guess_type(str(file))[0] or 'text/plain') + '; charset=utf-8')
        except FileNotFoundError:
            self.send_error(404, 'Run graph_builder.py first; check source repository path.')
        except (ValueError, UnicodeError) as exc:
            self.send_error(400, str(exc).encode('ascii', errors='replace').decode())

    def respond(self, data, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'掌柜智库学习知识图谱 http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
