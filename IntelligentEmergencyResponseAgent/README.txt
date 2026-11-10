INTELLIGENT EMERGENCY RESPONSE AND RESCUE AGENT
Runnable academic demonstration prototype (now with City Graph Visualization)

WINDOWS SETUP (PowerShell or VS Code terminal, inside this folder)
   py -m venv venv
   venv\Scripts\activate
   py -m pip install -r requirements.txt
   py app.py

Then open http://127.0.0.1:5000 in Chrome.
(If PowerShell blocks activation, run once:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass )

NEW FEATURES
- City Graph Visualization: the complete graph from city_data.json (all 8 cities, all 11 roads),
  drawn as SVG. Every road shows its distance, its travel cost for the selected optimization
  mode (computed by the backend), and its traffic level.
- Algorithm visualization: pick BFS / DFS / UCS / A* and click Find Best Route.
    Green = start, Red = destination, Purple = explored nodes, Orange = final route
    (route nodes and arrows), Blue = unexplored cities, Grey = normal roads,
    Red dashed = blocked roads. Small numbers on nodes show the exploration order.
  Changing the algorithm afterwards redraws the graph automatically.
  "Replay exploration" animates the search step by step.
- Road/traffic visualization: road thickness and label colour show Low / Medium / High traffic,
  blocked roads are red dashed with an X, accidents show a warning sign. Applying a road event
  updates the graph immediately (the changed road is highlighted briefly).
  Click any road on the graph (or a row in the Road Conditions table) to select it in the simulator.
- Algorithm Comparison: BFS, DFS, UCS and A* side by side - path, total cost, roads, explored
  nodes, execution time, valid route yes/no, a mini graph per algorithm, and a generated
  "Why the results differ" explanation.
- Extras: Report/Clear accident events and a "Reset all roads to original" button.

NEW / CHANGED API ENDPOINTS (all old endpoints still work unchanged)
  GET  /api/graph?mode=...   full graph + per-road cost for the optimization mode
  POST /api/compare          runs all four algorithms on the same request
  POST /api/reset            restores roads from city_data.default.json
  /api/plan now also returns execution_time_ms, found and hops (existing fields unchanged)

AUTOMATED TESTS (optional)
   py -m unittest -v test_app
They use a temporary copy of the city file and never change your real city_data.json.

HOW TO TAKE OUTPUT SCREENSHOTS
- Select Ambulance, start E, destination G, Minimum Travel Time. Run BFS, DFS, then UCS / A*:
  the three different routes show clearly on the graph. Screenshot the graph and the comparison.
- In Dynamic Environment Simulation, choose road B to D and Block road, Apply Road Event,
  and screenshot the dashed red road and the recalculated route.

IMPORTANT
- This is a demonstration using a small synthetic city graph, not live city traffic or GPS.
- BFS/DFS are included for comparison; UCS/A* use weighted edge costs. The algorithms are unchanged.
- Road events change city_data.json. Use "Reset all roads to original" (or restore city_data.json
  from city_data.default.json) to go back to the demo state.
- Keep the Flask terminal open while using the browser. Press Ctrl+C to stop the server.
