with open("Web/geojson_bundle.js", "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find('"kalurahan":"Hargobinangun"')
if idx != -1:
    end_idx = content.find("}", idx)
    print("Hargobinangun properties in bundle:")
    print(content[idx:end_idx+1])

