"""Wrap the artifact-style HTML pages in a full document skeleton for static hosting (Cloudflare Pages)."""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / ".ref/site")
pages = {"index.html": "docs/architecture/architecture.html", "deck/index.html": "docs/presentation/jadal-deck.html"}
for dest, src in pages.items():
    s = root / src
    if not s.exists():
        print("skip (missing):", src); continue
    html = s.read_text()
    m = re.search(r"</style>", html)
    head, body = (html[: m.end()], html[m.end():]) if m else ("", html)
    doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + head + "\n</head>\n<body>\n" + body + "\n</body>\n</html>\n")
    d = out / dest; d.parent.mkdir(parents=True, exist_ok=True); d.write_text(doc)
    print("built", d, len(doc), "bytes")
