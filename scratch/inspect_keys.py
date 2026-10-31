with open("Web/geojson_bundle.js", "r", encoding="utf-8") as f:
    first_lines = "".join([f.readline() for _ in range(20)])
print("Header of geojson_bundle.js:")
print(first_lines[:800])

