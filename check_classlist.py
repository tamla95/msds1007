import re

html = open('index.html', encoding='utf-8').read()

# find document.getElementById('...').classList
for match in re.finditer(r"document\.getElementById\(['\"](.*?)['\"]\)\.classList", html):
    id_name = match.group(1)
    if not re.search(r"id=['\"]" + id_name + r"['\"]", html):
        print(f"MISSING ID IN HTML: {id_name}")

# find var.classList
for match in re.finditer(r"([a-zA-Z0-9_]+)\.classList", html):
    var_name = match.group(1)
    if var_name not in ['document', 'window', 'this', 'event', 'console', 'card']:
        assignment = re.search(r"(?:const|let|var)\s+" + var_name + r"\s*=\s*document\.getElementById\(['\"](.*?)['\"]\)", html)
        if assignment:
            id_name = assignment.group(1)
            if not re.search(r"id=['\"]" + id_name + r"['\"]", html):
                print(f"MISSING ID IN HTML (via {var_name}): {id_name}")
