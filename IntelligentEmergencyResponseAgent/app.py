import json
import os
import shutil

from flask import Flask, render_template, request, jsonify
from emergency_agent import plan_route, classify_environment, graph_snapshot, compare_algorithms
from environment import update_road
from multi_agent import get_agents

app = Flask(__name__)

# Absolute paths so the app works no matter which folder it is started from.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CITY_FILE = os.path.join(BASE_DIR, "city_data.json")
DEFAULT_CITY_FILE = os.path.join(BASE_DIR, "city_data.default.json")

DEFAULT_MODE = "Minimum Travel Time"

def load_city():
    with open(CITY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/city")
def city():
    return jsonify(load_city())

@app.route("/api/graph")
def graph():
    """Complete city graph (nodes, roads, traffic, blocked state) plus the
    effective cost of each road for the selected optimisation mode."""
    mode = request.args.get("mode", DEFAULT_MODE)
    return jsonify(graph_snapshot(load_city(), mode))

@app.route("/api/plan", methods=["POST"])
def plan():
    data = request.get_json(force=True)
    city_data = load_city()
    result = plan_route(
        city_data,
        data.get("start", "A"),
        data.get("goal", "H"),
        data.get("algorithm", "A*"),
        data.get("mode", DEFAULT_MODE),
        data.get("vehicle", "Ambulance"),
        data.get("priority", "Critical")
    )
    result["environment"] = classify_environment(city_data)
    return jsonify(result)

@app.route("/api/compare", methods=["POST"])
def compare():
    """Run BFS, DFS, UCS and A* on the current city state for the same request."""
    data = request.get_json(force=True)
    city_data = load_city()
    result = compare_algorithms(
        city_data,
        data.get("start", "A"),
        data.get("goal", "H"),
        data.get("mode", DEFAULT_MODE),
        data.get("vehicle", "Ambulance"),
        data.get("priority", "Critical")
    )
    return jsonify(result)

@app.route("/api/event", methods=["POST"])
def event():
    data = request.get_json(force=True)
    city_data = load_city()
    changed = update_road(city_data, data.get("from"), data.get("to"),
                          data.get("event"), data.get("value"))
    if not changed:
        return jsonify({"ok": False, "message": "Road not found"}), 404
    with open(CITY_FILE, "w", encoding="utf-8") as f:
        json.dump(city_data, f, indent=2)
    return jsonify({"ok": True, "message": "Road condition updated. Recalculate the route."})

@app.route("/api/reset", methods=["POST"])
def reset():
    """Restore the original demo roads (copy of the shipped city_data.json)."""
    if not os.path.exists(DEFAULT_CITY_FILE):
        return jsonify({"ok": False, "message": "city_data.default.json is missing."}), 404
    shutil.copyfile(DEFAULT_CITY_FILE, CITY_FILE)
    return jsonify({"ok": True, "message": "All roads restored to the original demo state."})

@app.route("/api/agents")
def agents():
    return jsonify(get_agents())

if __name__ == "__main__":
    app.run(debug=True)
