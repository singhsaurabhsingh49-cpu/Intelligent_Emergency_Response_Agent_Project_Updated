"""Automated checks for the Emergency Response Agent.
Run with:  py -m unittest -v test_app
Uses a temporary copy of the city file, so your real city_data.json is never changed."""
import json, os, shutil, tempfile, unittest

import app as appmod
from emergency_agent import plan_route, compare_algorithms, graph_snapshot, make_graph

HERE = os.path.dirname(os.path.abspath(__file__))
MODES = ["Minimum Travel Time", "Minimum Distance", "Minimum Traffic", "Safest Route", "Avoid Blocked Roads"]
ALGOS = ["BFS", "DFS", "UCS", "A*"]

def path_cost(graph, path):
    return sum(next(w for v, w in graph[a] if v == b) for a, b in zip(path, path[1:]))

class AppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.city_file = os.path.join(self.tmp, "city_data.json")
        shutil.copyfile(os.path.join(HERE, "city_data.default.json"), self.city_file)
        self._old = (appmod.CITY_FILE, appmod.DEFAULT_CITY_FILE)
        appmod.CITY_FILE = self.city_file
        appmod.DEFAULT_CITY_FILE = os.path.join(HERE, "city_data.default.json")
        self.c = appmod.app.test_client()

    def tearDown(self):
        appmod.CITY_FILE, appmod.DEFAULT_CITY_FILE = self._old
        shutil.rmtree(self.tmp, ignore_errors=True)

    def plan(self, **kw):
        body = dict(start="A", goal="H", algorithm="A*", mode="Minimum Travel Time", vehicle="Ambulance", priority="Critical")
        body.update(kw)
        return self.c.post("/api/plan", json=body).get_json()

    def event(self, a, b, event, value=None):
        return self.c.post("/api/event", json={"from": a, "to": b, "event": event, "value": value})

    def test_pages_and_old_endpoints(self):
        self.assertEqual(self.c.get("/").status_code, 200)
        self.assertEqual(len(self.c.get("/api/city").get_json()["nodes"]), 8)
        self.assertEqual(len(self.c.get("/api/agents").get_json()), 3)

    def test_graph_endpoint_matches_city_file(self):
        with open(self.city_file, encoding="utf-8") as fh:
            city = json.load(fh)
        g = self.c.get("/api/graph?mode=Minimum%20Distance").get_json()
        self.assertEqual([n["id"] for n in g["nodes"]], [n["id"] for n in city["nodes"]])
        self.assertEqual(len(g["edges"]), len(city["edges"]))
        for e in g["edges"]:
            if not e["blocked"]:
                self.assertEqual(e["cost"], e["distance"])

    def test_all_algorithms_all_modes_valid(self):
        with open(self.city_file, encoding="utf-8") as fh:
            city = json.load(fh)
        for mode in MODES:
            graph = make_graph(city, mode)
            for algo in ALGOS:
                r = self.plan(algorithm=algo, mode=mode)
                self.assertEqual(r["status"], "success", (algo, mode))
                self.assertEqual(r["algorithm"], algo)
                self.assertEqual(r["path"][0], "A"); self.assertEqual(r["path"][-1], "H")
                self.assertAlmostEqual(r["cost"], round(path_cost(graph, r["path"]), 2))
                self.assertTrue(set(r["path"]) <= set(r["explored"]))
                self.assertEqual(r["explored_count"], len(r["explored"]))
                self.assertIn("execution_time_ms", r)

    def test_blocked_road_never_used_and_matches_backend(self):
        self.assertEqual(self.event("B", "H", "block").status_code, 200)
        for algo in ALGOS:
            r = self.plan(algorithm=algo)
            hops = set(zip(r["path"], r["path"][1:]))
            self.assertNotIn(("B", "H"), hops); self.assertNotIn(("H", "B"), hops)
        g = self.c.get("/api/graph").get_json()
        blocked = [e for e in g["edges"] if e["blocked"]]
        self.assertEqual([(e["from"], e["to"]) for e in blocked], [("B", "H")])
        self.assertIsNone(blocked[0]["cost"])

    def test_fully_blocked_destination(self):
        self.event("G", "H", "block"); self.event("B", "H", "block")
        for algo in ALGOS:
            r = self.plan(algorithm=algo)
            self.assertEqual(r["status"], "no_path"); self.assertFalse(r["found"])
            self.assertNotIn("H", r["explored"])
        cmp = self.c.post("/api/compare", json={"start": "A", "goal": "H"}).get_json()
        self.assertTrue(all(not x["found"] for x in cmp["results"]))

    def test_traffic_changes_cost_and_clear(self):
        before = self.plan(algorithm="UCS")["cost"]
        self.event("A", "B", "traffic", "High")
        edge = next(e for e in self.c.get("/api/graph").get_json()["edges"] if {e["from"], e["to"]} == {"A", "B"})
        self.assertEqual(edge["traffic"], "High"); self.assertEqual(edge["cost"], 10.0)
        self.assertGreaterEqual(self.plan(algorithm="UCS")["cost"], before)
        self.event("B", "H", "block")
        self.assertTrue(self.event("B", "H", "clear").get_json()["ok"])
        self.assertFalse(next(e for e in self.c.get("/api/graph").get_json()["edges"] if {e["from"], e["to"]} == {"B", "H"})["blocked"])

    def test_accident_and_reset(self):
        self.event("C", "B", "accident", True)
        self.assertEqual(self.c.get("/api/graph").get_json()["summary"]["accidents"], 1)
        self.event("A", "B", "block")
        self.assertTrue(self.c.post("/api/reset").get_json()["ok"])
        s = self.c.get("/api/graph").get_json()["summary"]
        self.assertEqual((s["blocked"], s["accidents"]), (0, 0))

    def test_unknown_road_404(self):
        self.assertEqual(self.event("A", "H", "block").status_code, 404)

    def test_compare_matches_plan(self):
        for mode in MODES:
            cmp = self.c.post("/api/compare", json={"start": "A", "goal": "H", "mode": mode}).get_json()
            self.assertEqual([r["algorithm"] for r in cmp["results"]], ALGOS)
            for r in cmp["results"]:
                single = self.plan(algorithm=r["algorithm"], mode=mode)
                self.assertEqual(r["path"], single["path"]); self.assertEqual(r["cost"], single["cost"])
                self.assertEqual(r["explored"], single["explored"])
            self.assertTrue(cmp["insights"])

    def test_invalid_nodes(self):
        self.assertEqual(self.plan(start="Z")["status"], "error")
        self.assertEqual(self.c.post("/api/compare", json={"start": "Z", "goal": "H"}).get_json()["status"], "error")

if __name__ == "__main__":
    unittest.main()
