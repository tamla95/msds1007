import urllib.request
import urllib.parse
import json
import re

url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote("site:tds.noroopaint.com 내츄럴 듀프리코트")
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0'})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    links = re.findall(r'href="([^"]+)"', html)
    for l in links:
        if 'noroopaint.com/details' in urllib.parse.unquote(l):
            print("Found:", urllib.parse.unquote(l))
except Exception as e:
    print("Error:", e)
