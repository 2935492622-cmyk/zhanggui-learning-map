"""Read-only, conservative source index for 掌柜智库. Standard library only."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULES = {
    'query_process': ('智能问答', '从问题确认、多路检索到答案生成。'),
    'import_process': ('知识导入', '从文档解析、切块到向量入库。'),
    'clients': ('存储客户端', 'Milvus、MongoDB、MinIO 与 Neo4j 的连接封装。'),
    'lm': ('模型能力', '语言模型、Embedding 和 Reranker 的访问入口。'),
    'utils': ('通用工具', '任务状态、SSE 事件、格式与路径工具。'),
    'conf': ('运行配置', '模型与外部服务的配置定义。'),
    'core': ('基础设施', '日志与提示词加载。'),
    'tool': ('模型准备', '模型下载辅助脚本。'),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scoped_walk(node):
    """Do not attribute a nested function's operations to its outer function."""
    yield node
    for child in ast.iter_child_nodes(node):
        if not isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            yield from scoped_walk(child)


def literal(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in ('END', 'START'):
        return node.id
    return None


def scan(root: Path):
    root = root.resolve()
    if not (root / 'app').is_dir() or not (root / 'pyproject.toml').is_file():
        raise ValueError('请选择包含 app/ 和 pyproject.toml 的掌柜智库仓库。')
    nodes, edges, files, trees, warnings = {}, [], {}, {}, []
    symbols, imports = {}, defaultdict(dict)
    state_locations = defaultdict(lambda: {'reads': {}, 'writes': {}})
    edge_keys = set()

    def evidence(rel, line=1, symbol='', end=None):
        return {'path': rel, 'line': line, 'endLine': end or line, 'symbol': symbol,
                'sha256': files[rel]['sha256']}

    def edge(src, dst, kind, status, ev, explanation):
        key = (src, dst, kind, ev['path'], ev['line'])
        if src not in nodes or dst not in nodes or key in edge_keys:
            return
        edge_keys.add(key)
        edges.append(dict(id=f'e{len(edges)}', source=src, target=dst, kind=kind,
                          status=status, evidence=[ev], explanation=explanation))

    nodes['project'] = dict(id='project', label='掌柜智库', type='project', module='',
                            description='围绕商品文档导入与智能问答的项目学习地图。', parent=None)
    paths = sorted((root / 'app').rglob('*'))
    for p in paths:
        if p.suffix not in ('.py', '.html') or not p.is_file() or p.is_symlink():
            continue
        if not p.resolve().is_relative_to(root) or any(x in p.parts for x in ('.venv', '__pycache__', '.git', 'node_modules')):
            continue
        rel = p.relative_to(root).as_posix()
        text = p.read_text(encoding='utf-8-sig')
        files[rel] = {'sha256': digest(p), 'lines': len(text.splitlines())}
        group = p.relative_to(root / 'app').parts[0]
        mid = 'module:' + group
        if mid not in nodes:
            title, desc = MODULES.get(group, (group, '项目源代码分组。'))
            nodes[mid] = dict(id=mid, label=title, type='module', module=group,
                              description=desc, parent='project', path='app/' + group)
            edge('project', mid, 'contains', 'confirmed', evidence(rel), '仓库目录结构中存在此模块。')
        fid = 'file:' + rel
        nodes[fid] = dict(id=fid, label=p.name, type='file', module=group, parent=mid,
                          path=rel, description='HTML 交互页面。' if p.suffix == '.html' else 'Python 源文件。',
                          evidence=[evidence(rel)], reads=[], writes=[])
        edge(mid, fid, 'contains', 'confirmed', evidence(rel), '文件位于此模块目录中。')
        if p.suffix != '.py':
            continue
        try:
            trees[rel] = ast.parse(text, filename=rel)
        except SyntaxError as exc:
            warnings.append(f'{rel}:{exc.lineno} 无法解析：{exc.msg}')
            continue
        module_name = rel[:-3].replace('/', '.')
        if module_name.endswith('.__init__'):
            module_name = module_name[:-9]
        symbols[module_name] = fid

        def add_defs(body, parent, prefix=''):
            for obj in body:
                if not isinstance(obj, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    continue
                qual = prefix + obj.name
                sid = f'symbol:{rel}:{qual}'
                kind = 'class' if isinstance(obj, ast.ClassDef) else 'function'
                fields = [a.target.id for a in obj.body if isinstance(a, ast.AnnAssign) and isinstance(a.target, ast.Name)]
                reads, writes = set(), set()
                for sub in scoped_walk(obj):
                    if isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Name) and sub.value.id == 'state':
                        k = literal(sub.slice)
                        if k:
                            (writes if isinstance(sub.ctx, ast.Store) else reads).add(k)
                            state_locations[rel]['writes' if isinstance(sub.ctx, ast.Store) else 'reads'][k] = (sub.lineno, qual)
                    if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) and isinstance(sub.func.value, ast.Name) and sub.func.value.id == 'state' and sub.func.attr == 'get' and sub.args:
                        k = literal(sub.args[0])
                        if k:
                            reads.add(k)
                            state_locations[rel]['reads'][k] = (sub.lineno, qual)
                    if isinstance(sub, ast.Return) and isinstance(sub.value, ast.Dict):
                        writes.update(k.value for k in sub.value.keys if isinstance(k, ast.Constant) and isinstance(k.value, str))
                        for k in sub.value.keys:
                            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                                state_locations[rel]['writes'][k.value] = (sub.lineno, qual)
                doc = ast.get_docstring(obj) or ''
                routes = []
                for dec in obj.decorator_list:
                    if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.args and literal(dec.args[0]):
                        routes.append(f'{dec.func.attr.upper()} {literal(dec.args[0])}')
                nodes[sid] = dict(id=sid, label=obj.name, type=kind, module=group, parent=parent,
                                  path=rel, symbol=qual, description=doc[:1500] or '由源码提取的符号；职责请结合实现确认。',
                                  evidence=[evidence(rel, obj.lineno, qual, obj.end_lineno)],
                                  reads=sorted(reads), writes=sorted(writes), fields=fields, routes=routes)
                symbols[module_name + '.' + qual] = sid
                edge(parent, sid, 'contains', 'confirmed', evidence(rel, obj.lineno, qual), '源码中直接声明的类或函数。')
                nodes[fid]['reads'] = sorted(set(nodes[fid]['reads']) | reads)
                nodes[fid]['writes'] = sorted(set(nodes[fid]['writes']) | writes)
                add_defs(obj.body, sid, qual + '.')
        add_defs(trees[rel].body, fid)

    # Literal import statements are facts. They are never labelled runtime calls.
    for rel, tree in trees.items():
        fid = 'file:' + rel
        for item in ast.walk(tree):
            if isinstance(item, ast.ImportFrom) and item.module and not item.level:
                for alias in item.names:
                    target_name = item.module + '.' + alias.name
                    if alias.name != '*':
                        imports[rel][alias.asname or alias.name] = target_name
                target = symbols.get(item.module)
                if target:
                    edge(fid, target, 'imports', 'confirmed', evidence(rel, item.lineno),
                         '源码显式 import 此文件；不证明被导入代码在某次请求中执行。')
            elif isinstance(item, ast.Import):
                for alias in item.names:
                    imports[rel][alias.asname or alias.name] = alias.name
                    target = symbols.get(alias.name)
                    if target:
                        edge(fid, target, 'imports', 'confirmed', evidence(rel, item.lineno), '源码显式 import 此文件。')

    # Calls: conservative candidates only; no wildcard, receiver or dynamic dispatch resolution.
    for sid, node in list(nodes.items()):
        if node['type'] != 'function':
            continue
        rel, qual = node['path'], node['symbol']
        obj = next((x for x in ast.walk(trees[rel]) if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef)) and x.lineno == node['evidence'][0]['line']), None)
        module_name = rel[:-3].replace('/', '.')
        for call in scoped_walk(obj):
            if not isinstance(call, ast.Call):
                continue
            name = ast.unparse(call.func)
            parts = name.split('.')
            resolved = imports[rel].get(parts[0], module_name + '.' + parts[0]) + ('.' + '.'.join(parts[1:]) if len(parts) > 1 else '')
            target = symbols.get(resolved)
            if target:
                edge(sid, target, 'calls', 'pending', evidence(rel, call.lineno, qual),
                     f'AST 发现表达式 {name}(…)；名称绑定、分支及运行时执行均待验证。')

    # Explicit LangGraph registrations and configured edges, distinct from runtime traces.
    for rel, tree in trees.items():
        if not rel.endswith('/agent/main_graph.py'):
            continue
        group = nodes['file:' + rel]['module']
        registry = {}
        for obj in ast.walk(tree):
            if not isinstance(obj, ast.Call) or not isinstance(obj.func, ast.Attribute):
                continue
            if obj.func.attr == 'add_node' and len(obj.args) >= 2 and literal(obj.args[0]):
                label = literal(obj.args[0])
                wid = f'workflow:{rel}:{label}'
                expression = ast.unparse(obj.args[1])
                target = symbols.get(imports[rel].get(expression, rel[:-3].replace('/', '.') + '.' + expression))
                registry[label] = wid
                nodes[wid] = dict(id=wid, label=label, type='workflow', module=group,
                                  parent='file:' + rel, path=rel, implementation=target,
                                  description='LangGraph 显式注册节点；执行路径由图配置和运行时 State 决定。',
                                  evidence=[evidence(rel, obj.lineno, label)], reads=[], writes=[])
                if target:
                    impl = nodes[target]
                    # Helpers in the same implementation file also read/write state.
                    nodes[wid]['reads'] = nodes['file:' + impl['path']]['reads']
                    nodes[wid]['writes'] = nodes['file:' + impl['path']]['writes']
                    edge(wid, target, 'implements', 'confirmed', evidence(rel, obj.lineno, label), 'add_node 显式绑定此导入符号；不代表运行验证。')
        for terminal in ('START', 'END'):
            wid = f'workflow:{rel}:{terminal}'
            registry[terminal] = wid
            nodes[wid] = dict(id=wid, label='开始' if terminal == 'START' else '结束', type='workflow', module=group,
                              parent='file:' + rel, path=rel, description='流程边界节点。', reads=[], writes=[])
        for obj in ast.walk(tree):
            if not isinstance(obj, ast.Call) or not isinstance(obj.func, ast.Attribute):
                continue
            method, args = obj.func.attr, obj.args
            if method == 'add_edge' and len(args) >= 2:
                src, dst = literal(args[0]), literal(args[1])
                if src in registry and dst in registry:
                    edge(registry[src], registry[dst], 'flow', 'confirmed', evidence(rel, obj.lineno),
                         f'源码 add_edge 显式配置 {src} → {dst}。这是流程定义，不是实际运行轨迹；State 由节点返回/修改。')
            elif method == 'set_entry_point' and args and literal(args[0]) in registry:
                edge(registry['START'], registry[literal(args[0])], 'flow', 'confirmed', evidence(rel, obj.lineno), 'set_entry_point 显式指定起点。')
            elif method == 'add_conditional_edges' and len(args) >= 2 and literal(args[0]) in registry:
                router = ast.unparse(args[1])
                fn = next((x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == router), None)
                if fn:
                    for ret in ast.walk(fn):
                        if isinstance(ret, ast.Return) and literal(ret.value) in registry:
                            edge(registry[literal(args[0])], registry[literal(ret.value)], 'conditional', 'pending',
                                 evidence(rel, ret.lineno, router), '根据路由函数 return 值推断的可能分支；条件是否满足、映射和执行结果待验证。')
        # Matching State keys imply a possible data link, never a proven transfer.
        for a in registry.values():
            for b in registry.values():
                if a == b:
                    continue
                shared = sorted(set(nodes[a].get('writes', [])) & set(nodes[b].get('reads', [])))
                if shared:
                    edge(a, b, 'data', 'pending', nodes[a]['evidence'][0],
                         '同名 State 字段候选：' + ', '.join(shared) + '。按实现文件静态汇总，可能包含辅助函数及非 State 返回字典；需确认可达性、时序和真实传值。')
                    candidate = edges[-1]
                    if candidate['source'] == a and candidate['target'] == b and candidate['kind'] == 'data':
                        for wid, mode in ((a, 'writes'), (b, 'reads')):
                            impl = nodes[wid].get('implementation')
                            if impl:
                                source_file = nodes[impl]['path']
                                for key in shared[:3]:
                                    location = state_locations[source_file][mode].get(key)
                                    if location:
                                        ev = evidence(source_file, location[0], location[1])
                                        if ev not in candidate['evidence']:
                                            candidate['evidence'].append(ev)

    # Overview dependencies are projections of imports, explicitly pending.
    for e in list(edges):
        if e['kind'] == 'imports':
            a, b = nodes[e['source']]['module'], nodes[e['target']]['module']
            if a != b:
                # One overview edge per module pair is enough.
                if not any(x['source'] == 'module:' + a and x['target'] == 'module:' + b and x['kind'] == 'dependency' for x in edges):
                    edge('module:' + a, 'module:' + b, 'dependency', 'pending', e['evidence'][0],
                         '由文件 import 汇总的模块依赖候选；不代表业务调用方向或运行时数据流。')

    try:
        if not (root / '.git').exists():
            raise OSError('Snapshot without Git metadata')
        revision = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(['git', '-C', str(root), 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        manifest = root / '.learning-source.json'
        snapshot = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
        revision = snapshot.get('revision', 'unknown')
        dirty = ({p: f['sha256'] for p, f in files.items()} != snapshot.get('files', {})) if snapshot else None
    return dict(schemaVersion=1, meta=dict(project='掌柜智库', sourceRoot=str(root), revision=revision, dirty=dirty,
                generatedAt=datetime.now(timezone.utc).isoformat(), scope='app/**/*.py + app/**/*.html',
                sourceNote='本地只读源码快照；提交号与文件哈希对应扫描版本。远端后续变更需重新扫描。', warnings=warnings,
                policy='源码已确认仅表示显式结构/导入/流程配置；自动推断调用、数据流和条件分支均待验证。'),
                files=files, nodes=list(nodes.values()), edges=edges)


def main():
    parser = argparse.ArgumentParser(description='只读扫描掌柜智库，不导入或执行业务代码')
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=HERE / 'data' / 'graph.json')
    args = parser.parse_args()
    result = scan(args.repo)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(args.output)
    print(f"Indexed {len(result['files'])} files, {len(result['nodes'])} nodes, {len(result['edges'])} relations -> {args.output}")


if __name__ == '__main__':
    main()
