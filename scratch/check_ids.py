import re

with open("Web/index.html", encoding="utf-8") as f:
    html = f.read()

with open("Web/app.js", encoding="utf-8") as f:
    js = f.read()

ids = set(re.findall(r"document\.getElementById\([\"']([^\"']+)[\"']\)", js))
missing = []
for i in sorted(ids):
    if f'id="{i}"' not in html and f"id='{i}'" not in html:
        missing.append(i)

print("Total IDs found in app.js:", len(ids))
print("Missing in HTML:", missing)

