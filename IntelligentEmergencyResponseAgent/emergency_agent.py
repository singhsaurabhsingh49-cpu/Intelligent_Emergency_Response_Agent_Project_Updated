import heapq
import time
from collections import deque

TRAFFIC_FACTOR = {"Low": 1.0, "Medium": 1.5, "High": 2.5}

def edge_cost(edge, mode):
    if edge.get("blocked"):
        return float("inf")
    if mode == "Minimum Distance":
        return edge["distance"]
    if mode == "Minimum Traffic":
        return TRAFFIC_FACTOR.get(edge.get("traffic", "Medium"), 1.5)
    if mode == "Safest Route":
        return edge.get("risk", 1) + (8 if edge.get("accident") else 0)
    # Minimum Travel Time and Avoid Blocked Roads
    return edge["base_time"] * TRAFFIC_FACTOR.get(edge.get("traffic", "Medium"), 1.5) + (5 if edge.get("accident") else 0)

def make_graph(city, mode):
    graph = {n["id"]: [] for n in city["nodes"]}
    for e in city["edges"]:
        cost = edge_cost(e, mode)
        if cost != float("inf"):
            graph[e["from"]].append((e["to"], cost))
            graph[e["to"]].append((e["from"], cost))
    return graph

def reconstruct(parent, goal):
    if goal not in parent and parent.get("_start") != goal:
        return None
    path, cur = [], goal
    while cur is not None:
        path.append(cur)
        cur = parent.get(cur)
    return list(reversed(path))

def bfs(graph, start, goal):
    q = deque([start]); parent = {start: None}; explored = []
    while q:
        u = q.popleft(); explored.append(u)
        if u == goal: break
        for v, _ in graph.get(u, []):
            if v not in parent:
                parent[v] = u; q.append(v)
    return reconstruct(parent, goal), explored

def dfs(graph, start, goal):
    stack = [start]; parent = {start: None}; explored = []
    while stack:
        u = stack.pop()
        if u in explored: continue
        explored.append(u)
        if u == goal: break
        for v, _ in reversed(graph.get(u, [])):
            if v not in parent:
                parent[v] = u; stack.append(v)
    return reconstruct(parent, goal), explored

def uniform_cost(graph, start, goal):
    pq = [(0, start)]; dist = {start: 0}; parent = {start: None}; explored = []
    while pq:
        cost, u = heapq.heappop(pq)
        if cost != dist.get(u): continue
        explored.append(u)
        if u == goal: break
        for v, w in graph.get(u, []):
            nd = cost + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd; parent[v] = u; heapq.heappush(pq, (nd, v))
    return reconstruct(parent, goal), explored, dist.get(goal)

def astar(graph, city, start, goal):
    coords = {n["id"]: (n["x"], n["y"]) for n in city["nodes"]}
    def h(node):
        x1,y1=coords[node]; x2,y2=coords[goal]
        return ((x1-x2)**2 + (y1-y2)**2)**0.5
    pq = [(h(start), 0, start)]; g = {start: 0}; parent = {start: None}; explored=[]
    while pq:
        _, cost, u = heapq.heappop(pq)
        if cost != g.get(u): continue
        explored.append(u)
        if u == goal: break
        for v,w in graph.get(u, []):
            nd=cost+w
            if nd < g.get(v,float("inf")):
                g[v]=nd; parent[v]=u; heapq.heappush(pq,(nd+h(v),nd,v))
    return reconstruct(parent,goal), explored, g.get(goal)

def plan_route(city, start, goal, algorithm, mode, vehicle, priority):
    ids = {n["id"] for n in city["nodes"]}
    if start not in ids or goal not in ids:
        return {"status":"error","message":"Please select valid start and destination nodes."}
    graph = make_graph(city, mode)
    started = time.perf_counter()
    if algorithm == "BFS":
        path, explored = bfs(graph,start,goal)
        cost = sum(next(w for v,w in graph[u] if v==n) for u,n in zip(path,path[1:])) if path else None
    elif algorithm == "DFS":
        path, explored = dfs(graph,start,goal)
        cost = sum(next(w for v,w in graph[u] if v==n) for u,n in zip(path,path[1:])) if path else None
    elif algorithm == "UCS":
        path, explored, cost = uniform_cost(graph,start,goal)
    else:
        path, explored, cost = astar(graph,city,start,goal)
        algorithm = "A*"
    elapsed_ms = round((time.perf_counter() - started) * 1000, 4)
    if not path:
        return {"status":"no_path","message":"No feasible route found. Check blocked roads.","path":None,"explored":explored,
                "found":False,"explored_count":len(explored),"algorithm":algorithm,"mode":mode,
                "vehicle":vehicle,"priority":priority,"execution_time_ms":elapsed_ms}
    return {
        "status":"success","path":path,"cost":round(cost,2),
        "explored":explored,"explored_count":len(explored),
        "algorithm":algorithm,"mode":mode,"vehicle":vehicle,"priority":priority,
        "message":"Route calculated successfully.",
        "found":True,"hops":len(path)-1,"execution_time_ms":elapsed_ms
    }

def classify_environment(city):
    edges=city["edges"]
    blocked=sum(1 for e in edges if e.get("blocked"))
    high=sum(1 for e in edges if e.get("traffic")=="High")
    if blocked >= 2 or high >= 3: return "High-risk / congested"
    if blocked or high: return "Moderate-risk"
    return "Normal"


# ---------------------------------------------------------------------------
# Additions for graph visualisation and algorithm comparison.
# These helpers only READ the city data and call the existing algorithms.
# ---------------------------------------------------------------------------
ALGORITHMS = ["BFS", "DFS", "UCS", "A*"]

def graph_snapshot(city, mode):
    """Full city graph (all nodes and edges) with the effective cost of every
    road for the chosen optimisation mode, computed by the same edge_cost()
    function the search algorithms use. Blocked roads have cost None."""
    edges = []
    for e in city["edges"]:
        item = dict(e)
        cost = edge_cost(e, mode)
        item["cost"] = None if cost == float("inf") else round(cost, 2)
        item["traffic_factor"] = TRAFFIC_FACTOR.get(e.get("traffic", "Medium"), 1.5)
        edges.append(item)
    return {
        "nodes": city["nodes"],
        "edges": edges,
        "mode": mode,
        "environment": classify_environment(city),
        "summary": {
            "roads": len(edges),
            "blocked": sum(1 for e in edges if e.get("blocked")),
            "accidents": sum(1 for e in edges if e.get("accident")),
            "traffic": {lvl: sum(1 for e in edges if e.get("traffic") == lvl) for lvl in ("Low", "Medium", "High")},
        },
    }

_REASONS = {
    "BFS": "BFS expands the map level by level and stops at the route with the fewest roads. It ignores road costs, so fewer roads can still mean a more expensive trip.",
    "DFS": "DFS follows one branch as deep as it can before backtracking, so its route depends on the order of neighbouring roads and is not guaranteed to be short or cheap.",
    "UCS": "UCS always expands the cheapest frontier node first, so it returns the lowest-cost route for the selected optimisation mode.",
    "A*": "A* uses the straight-line distance between map coordinates as a heuristic. That heuristic is not guaranteed to be a true lower bound for every optimisation mode, so A* can return a non-optimal route.",
}

def _build_insights(results):
    found = [r for r in results if r["found"]]
    if not found:
        return ["No algorithm found a route: every path to the destination is blocked."]
    insights = []
    best = min(r["cost"] for r in found)
    best_names = [r["algorithm"] for r in found if abs(r["cost"] - best) < 1e-9]
    insights.append(f"Lowest total cost ({best}) was found by: {', '.join(best_names)}.")
    if len({tuple(r["path"]) for r in found}) == 1:
        insights.append("All algorithms that found a route returned the same path, so they agree on this request.")
    for r in found:
        if r["cost"] > best + 1e-9:
            pct = round((r["cost"] - best) / best * 100) if best else 0
            extra = f" ({pct}% more than the best)" if best else ""
            insights.append(f"{r['algorithm']} returned a route costing {r['cost']}{extra}. {_REASONS[r['algorithm']]}")
    for r in results:
        if not r["found"]:
            insights.append(f"{r['algorithm']} found no route.")
    fewest = min(r["explored_count"] for r in found)
    fewest_names = [r["algorithm"] for r in found if r["explored_count"] == fewest]
    insights.append(f"Fewest explored nodes ({fewest}): {', '.join(fewest_names)}.")
    ucs = next((r for r in found if r["algorithm"] == "UCS"), None)
    ast = next((r for r in found if r["algorithm"] == "A*"), None)
    if ucs and ast:
        if ast["explored_count"] < ucs["explored_count"]:
            insights.append("A* explored fewer nodes than UCS because its heuristic steers the search toward the destination.")
        elif ast["explored_count"] == ucs["explored_count"]:
            insights.append("A* and UCS explored the same number of nodes on this request; the heuristic did not prune anything here.")
        else:
            insights.append("A* explored more nodes than UCS on this request; the heuristic can mislead the search when it does not match the selected cost mode.")
    return insights

def compare_algorithms(city, start, goal, mode, vehicle, priority):
    """Run BFS, DFS, UCS and A* on the same graph state with the same inputs."""
    results = []
    for name in ALGORITHMS:
        r = plan_route(city, start, goal, name, mode, vehicle, priority)
        if r.get("status") == "error":
            return r
        results.append({
            "algorithm": name,
            "found": r["found"],
            "status": r["status"],
            "path": r.get("path"),
            "cost": r.get("cost"),
            "hops": r.get("hops"),
            "explored": r["explored"],
            "explored_count": r["explored_count"],
            "execution_time_ms": r["execution_time_ms"],
        })
    return {"status": "success", "start": start, "goal": goal, "mode": mode,
            "results": results, "insights": _build_insights(results),
            "environment": classify_environment(city)}
