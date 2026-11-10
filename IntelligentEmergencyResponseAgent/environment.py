def update_road(city, source, target, event, value=None):
    for edge in city["edges"]:
        if {edge["from"], edge["to"]} == {source, target}:
            if event == "block":
                edge["blocked"] = True
            elif event == "clear":
                edge["blocked"] = False
            elif event == "traffic" and value in ("Low", "Medium", "High"):
                edge["traffic"] = value
            elif event == "accident":
                edge["accident"] = bool(value)
            else:
                return False
            return True
    return False
