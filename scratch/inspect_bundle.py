with open("Web/geojson_bundle.js", "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find('"kalurahan":"Hargobinangun"')
if idx != -1:
    print("Found in bundle:")
    print(content[idx:idx+450])
else:
    print("Not found")
