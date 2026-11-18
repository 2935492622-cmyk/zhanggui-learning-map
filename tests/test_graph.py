import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from graph_builder import scan
from server import read_source


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'pyproject.toml').write_text('[project]\nname="fixture"', encoding='utf-8')
        (self.root / 'app/query_process/agent').mkdir(parents=True)
        (self.root / 'app/utils').mkdir()
        (self.root / 'app/utils/helper.py').write_text('def helper():\n    return 42\n', encoding='utf-8')
        (self.root / 'app/query_process/agent/main_graph.py').write_text(
            'from app.utils.helper import helper\n'
            'def a(state):\n    helper()\n    state["answer"] = "ok"\n    return state\n'
            'def b(state):\n    return state.get("answer")\n'
            'def route(state):\n    return "b"\n'
            'builder.add_node("a", a)\nbuilder.add_node("b", b)\n'
            'builder.set_entry_point("a")\nbuilder.add_edge("a", "b")\n'
            'builder.add_conditional_edges("a", route)\n', encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def test_auto_calls_are_pending_but_imports_are_syntax_facts(self):
        graph = scan(self.root)
        calls = [e for e in graph['edges'] if e['kind'] == 'calls']
        self.assertTrue(calls)
        self.assertTrue(all(e['status'] == 'pending' for e in calls))
        self.assertTrue(all(e['status'] == 'confirmed' for e in graph['edges'] if e['kind'] == 'imports'))
        self.assertTrue(all(e['status'] == 'pending' for e in graph['edges'] if e['kind'] == 'conditional'))

    def test_explicit_workflow_edges_have_correct_line_evidence(self):
        graph = scan(self.root)
        flow = next(e for e in graph['edges'] if e['kind'] == 'flow' and e['source'].endswith(':a'))
        ev = flow['evidence'][0]
        lines = (self.root / ev['path']).read_text(encoding='utf-8').splitlines()
        self.assertIn('add_edge("a", "b")', lines[ev['line'] - 1])
        self.assertEqual(flow['status'], 'confirmed')

    def test_state_intersections_stay_pending_with_field_locations(self):
        graph = scan(self.root)
        candidate = next(e for e in graph['edges'] if e['kind'] == 'data' and e['source'].endswith(':a') and e['target'].endswith(':b'))
        self.assertEqual(candidate['status'], 'pending')
        lines = (self.root / 'app/query_process/agent/main_graph.py').read_text(encoding='utf-8').splitlines()
        snippets = [lines[e['line'] - 1] for e in candidate['evidence']]
        self.assertTrue(any('state["answer"]' in s for s in snippets))
        self.assertTrue(any('state.get("answer")' in s for s in snippets))

    def test_every_edge_has_valid_endpoints_and_evidence(self):
        graph = scan(self.root)
        ids = {n['id'] for n in graph['nodes']}
        for edge in graph['edges']:
            self.assertIn(edge['source'], ids)
            self.assertIn(edge['target'], ids)
            for ev in edge['evidence']:
                self.assertIn(ev['path'], graph['files'])
                self.assertGreaterEqual(ev['line'], 1)
                self.assertEqual(len(ev['sha256']), 64)

    def test_scan_does_not_execute_business_code_or_read_env(self):
        (self.root / 'app/utils/danger.py').write_text('raise RuntimeError("NEVER EXECUTE")\n', encoding='utf-8')
        (self.root / '.env').write_text('SECRET=private', encoding='utf-8')
        before = (self.root / 'app/utils/danger.py').read_bytes()
        graph = scan(self.root)
        self.assertNotIn('.env', graph['files'])
        self.assertNotIn('SECRET', json.dumps(graph))
        self.assertEqual(before, (self.root / 'app/utils/danger.py').read_bytes())

    def test_stale_evidence_is_detected(self):
        graph = scan(self.root)
        path = 'app/utils/helper.py'
        self.assertFalse(read_source(graph, path, 1)['stale'])
        (self.root / path).write_text('# changed\ndef helper(): pass\n', encoding='utf-8')
        self.assertTrue(read_source(graph, path, 1)['stale'])

    def test_source_endpoint_rejects_traversal_and_unindexed_paths(self):
        graph = scan(self.root)
        for path in ('../pyproject.toml', '.env', 'pyproject.toml', 'C:/Windows/win.ini'):
            with self.assertRaises(ValueError):
                read_source(graph, path, 1)

    def test_syntax_error_is_reported_instead_of_fabricated(self):
        (self.root / 'app/utils/broken.py').write_text('def invalid(:', encoding='utf-8')
        graph = scan(self.root)
        self.assertEqual(len(graph['meta']['warnings']), 1)
        self.assertFalse(any(n.get('symbol') == 'invalid' for n in graph['nodes']))

    def test_learning_anchors_exist_in_delivered_snapshot(self):
        here = Path(__file__).resolve().parents[1]
        graph = json.loads((here / 'data/graph.json').read_text(encoding='utf-8'))
        learning = json.loads((here / 'content/learning.json').read_text(encoding='utf-8'))
        anchors = [s for p in learning['paths'] for s in p['steps']] + [t['anchor'] for t in learning['terms']]
        for a in anchors:
            self.assertTrue(any(n.get('path') == a['path'] and
                (n.get('symbol') == a['symbol'] if 'symbol' in a else n['type'] == 'file') for n in graph['nodes']), a)


if __name__ == '__main__':
    unittest.main()
