#!/usr/bin/env python3
"""Single source of truth for the talk. script.json produces:
  - the per-slide speaker notes inside showcase/deck/index.html   (press N)
  - docs/SPEAKER-SCRIPT.md
  - showcase/deck/speaker-script.html                             (second-screen reader, no external deps)
Run: python3 showcase/deck/build.py   It exits with an error if the script and the deck's slides drift apart.
Timings are computed from word counts (script.json meta.wpm) plus fixed seconds (video, clicks) plus pauses, not guessed."""
import json, re, html, os, sys, math
D = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(D, "..", ".."))
S = json.load(open(os.path.join(D, "script.json"), encoding="utf-8"))
slides = S["slides"]; WPM = S["meta"].get("wpm", 145)

def mmss(t): t = int(round(t)); return f"{t//60}:{t%60:02d}"
def words(t): return len(re.findall(r"\S+", t))
def speak(t): return math.ceil(words(t) / WPM * 60)

def std_time(s):  return 0 if (s.get("skip_short") or s.get("appendix")) else speak(s["say"]) + s.get("fixed", 0)
def arc_text(s):  return s.get("a_say", s["say"])
def arc_time(s):  return 0 if (s.get("a_skip") or s.get("appendix")) else speak(arc_text(s)) + s.get("a_fixed", s.get("fixed", 0) if "a_say" not in s else 0) + s.get("pause_s", 0) * (1 if s.get("pause") else 0)

# ---- crop appendix: generated from packages/core/src/data/crop-params.json ----
CROPS = json.load(open(os.path.join(ROOT, "packages", "core", "src", "data", "crop-params.json"), encoding="utf-8"))
FAO56_JSON_PATH = os.path.join(ROOT, "showcase", "deck", "fao56-data.json")
CV_MAP = {}
if os.path.exists(FAO56_JSON_PATH):
    try:
        fao_data = json.load(open(FAO56_JSON_PATH, encoding="utf-8"))
        for cv in fao_data.get("cross_validation", []):
            CV_MAP[(cv["shipped_crop"], cv.get("shipped_variant"))] = cv
    except Exception:
        pass

GLYPH = {"MEASURED": "●", "ASSUMED": "○", "UNSOURCED": "✕"}
LBL = {"MEASURED": "checked against the book", "ASSUMED": "assumed", "UNSOURCED": "unsourced"}
def worst(sts):
    for k in ("UNSOURCED", "ASSUMED"):
        if k in sts: return k
    return "MEASURED"
def pages(clause):
    m = re.search(r"p\.\s*([\d][\d\-–, ]*\d|\d)", clause or ""); return m.group(1).replace("-", "–").replace(" ", "") if m else ""
def clauses(src):
    out = {}
    for seg in src.split("||"):
        m = re.match(r"\s*([A-Z_/]+):", seg)
        if m: out[m.group(1)] = seg
    return out
def g(st): return f'<span aria-label="{LBL[st]}">{GLYPH[st]}</span>'
rows = []; counts = {"MEASURED": 0, "ASSUMED": 0, "UNSOURCED": 0}
for c in CROPS:
    st = c["constant_status"]; cl = clauses(c["source"])
    for v in st.values(): counts[v] += 1
    name = c["crop"].capitalize() + (f" ({c['variant']})" if c.get("variant") else "")
    kc_st = worst([st["kc_ini"], st["kc_mid"], st["kc_end"]]); r = c["root_depth_m"]
    kc = f'{c["kc_ini"]:.2f} · {c["kc_mid"]:.2f} · {c["kc_end"]:.2f}'
    h = f'{c["max_height_m"]:g}'
    
    cv = CV_MAP.get((c["crop"], c.get("variant")))
    root_glyph = g(st["root_depth_m"])
    if cv and cv.get("root_verdict") == "DIFFERS":
        root_glyph += " ‡"
    root = f'{r["min"]:g}–{r["max"]:g} {root_glyph}'
    pv = f'{c["depletion_p"]:.2f}'

    if kc_st == "UNSOURCED" and st["depletion_p"] == "UNSOURCED":
        src = "unsourced: no valid FAO-56 source"
    else:
        pp = pages(cl.get("DEPLETION_P", ""))
        p_part = f" · 8.2 p.{pp}" if st["depletion_p"] == "MEASURED" and pp else " · p assumed"
        if cv and cv.get("book_table") and cv.get("book_page"):
            tbl_part = f"Tbl {cv['book_table']} p.{cv['book_page']}"
            if cv.get("citation_differs"):
                tbl_part += " †"
            src = tbl_part + p_part
        else:
            kp = pages(cl.get("KC", ""))
            src = (f"Tbl 6.2 p.{kp}" if kp else "Tbl 6.2") + p_part

    cls = ' class="unsrc"' if kc_st == "UNSOURCED" else ""
    rows.append(f'      <tr{cls}><td>{html.escape(name)}</td><td class="num">{kc} {g(kc_st)}</td><td class="num">{h} {g(st["max_height_m"])}</td><td class="num">{root}</td><td class="num">{pv} {g(st["depletion_p"])}</td><td>{html.escape(src)}</td></tr>')
n_rows = len(CROPS); n_crops = len({c["crop"] for c in CROPS})
if CV_MAP:
    legend = (f"{n_crops} crops in {n_rows} rows from crop-params.json. ● checked against book · ○ assumed · ✕ unsourced. "
              "Stages assumed (2025 ed. uses growing degrees); no percolation in FAO-56; redgram unsourced. "
              "† the file cites Table 6.2 but the row is in Table 6.1. ‡ differs from the book's maximum. "
              f"The book covers many more crops than we ship.")
else:
    legend = (f"{n_crops} crops in {n_rows} rows, read from crop-params.json. ● checked against the book (Kc, height, root depth: Table 6.2; p: Table 8.2) · ○ our assumption · ✕ unsourced. "
              "Every stage length is assumed: the 2025 edition replaced fixed day counts with growing degrees. FAO-56 has no paddy percolation rate. The whole redgram row is unsourced. "
              f"The book covers many more crops than we ship.")
CROP_STATS = {"rows": n_rows, "crops": n_crops, "tagged_fields": sum(counts.values()), **{k.lower(): v for k, v in counts.items()}}

# ---- drift guard + deck notes ----
idx_path = os.path.join(D, "index.html"); idx = open(idx_path, encoding="utf-8").read()
titles = re.findall(r'<section class="slide [^"]*" data-title="([^"]*)"', idx); want = [s["title"] for s in slides]
if titles != want: sys.exit(f"DRIFT: deck slides {titles} != script slides {want}")
it = iter(slides)
def repl(_m):
    s = next(it)
    parts = []
    if s.get("cue"): parts.append("Cue: " + s["cue"])
    parts.append(s["say"])
    if s.get("a_say") or s.get("a_skip"):
        parts.append("ARCHITECT CUT: " + ("(skipped in this cut)" if s.get("a_skip") else s["a_say"]))
    if s.get("pause"): parts.append(s["pause"])
    if s.get("closing"): parts.append(s["closing"])
    for x in s.get("extra", []): parts.append("IF ASKED — " + x["label"] + ": " + x["text"])
    return "<aside hidden>" + html.escape(" — ".join(parts), quote=False) + "</aside>"
new, n = re.subn(r"<aside hidden>.*?</aside>", repl, idx, flags=re.S)
if n != len(slides): sys.exit(f"DRIFT: {n} asides vs {len(slides)} slides")
new = re.sub(r"<!-- CROPS:START -->.*?<!-- CROPS:END -->", lambda m: "<!-- CROPS:START -->\n" + "\n".join(rows) + "\n<!-- CROPS:END -->", new, flags=re.S)
new = re.sub(r"<!-- LEGEND:START -->.*?<!-- LEGEND:END -->", lambda m: "<!-- LEGEND:START -->" + html.escape(legend, quote=False) + "<!-- LEGEND:END -->", new, flags=re.S)
open(idx_path, "w", encoding="utf-8").write(new)

std_total = sum(std_time(s) for s in slides); arc_total = sum(arc_time(s) for s in slides)
std_full = sum(speak(s["say"]) + s.get("fixed", 0) for s in slides if not s.get("appendix"))

# ---- markdown ----
L = ["# Jadal — speaker script", "",
     "Generated from `showcase/deck/script.json` by `showcase/deck/build.py`; the same text is the per-slide speaker notes in the deck (press **N**). Edit the JSON and re-run the build; do not edit this file by hand.", "",
     "Deck: http://127.0.0.1:5190/deck/ · Second-screen reader: http://127.0.0.1:5190/deck/speaker-script.html · keys: ← → move, N notes, F fullscreen.", "",
     "## Honesty rules for the talk", "", S["meta"]["rules"], "",
     "## Two cuts", "",
     f"Timings are computed at {WPM} words per minute, plus fixed seconds (the video, the toggle click) and the pauses for questions. They are estimates, not measurements of a rehearsal. Rehearse once and adjust.", "",
     f"- **Standard cut** (general judges): **{mmss(std_total)}** with the slides marked *skip when short* left out; {mmss(std_full)} if you speak every slide.",
     f"- **Architect cut** (an evaluator who will probe the architecture): **{mmss(arc_total)}**, including pauses for questions. Less story, more on trust boundaries and honest limits; the video is not played (offer it afterwards).", "",
     "| # | Slide | Standard | Architect | Note |", "|---|---|---|---|---|"]
for i, s in enumerate(slides, 1):
    note = ("skip when short (standard)" if s.get("skip_short") else "") + (" · " if s.get("skip_short") and s.get("a_skip") else "") + ("skipped in architect cut" if s.get("a_skip") else "")
    if s.get("appendix"): L.append(f"| {i} | {s['title']} | appendix | appendix | not timed |"); continue
    L.append(f"| {i} | {s['title']} | {mmss(speak(s['say']) + s.get('fixed', 0))} | {mmss(arc_time(s)) if not s.get('a_skip') else '—'} | {note} |")
L += ["", "## Standard cut — slide by slide", ""]
for i, s in enumerate(slides, 1):
    L += [f"### Slide {i} — {s['title']} ({mmss(speak(s['say']) + s.get('fixed', 0))})", "", f"**Stage cue:** {s['cue']}", "", f"> {s['say']}", ""]
    if s.get("closing"): L += [f"**{s['closing']}**", ""]
    for x in s.get("extra", []): L += [f"**Not on a slide. {x['label']}**", "", f"> {x['text']}", ""]
L += ["## Architect cut — slide by slide", "", "Same deck, same order. Slides marked *skipped* are not shown or are clicked past in a second.", ""]
for i, s in enumerate(slides, 1):
    if s.get("a_skip"): L += [f"### Slide {i} — {s['title']} (skipped)", ""]; continue
    L += [f"### Slide {i} — {s['title']} ({mmss(arc_time(s))})", "", f"**Stage cue:** {s['cue']}", "", f"> {arc_text(s)}", ""]
    if s.get("pause"): L += [f"**{s['pause']}**", ""]
    for x in s.get("extra", []): L += [f"**Not on a slide. {x['label']}**", "", f"> {x['text']}", ""]
L += ["## 30-second version", "", f"> {S['short30']}", "", "## 2-minute version", ""]
for k in S["short2min"]: L += [f"**{k['slide']}.** {k['say']}", ""]
L += ["## If asked", ""]
for k in S["ifasked"]: L += [f"**{k['q']}**", "", f"> {k['a']}", ""]
open(os.path.join(ROOT, "docs", "SPEAKER-SCRIPT.md"), "w", encoding="utf-8").write("\n".join(L))

# ---- talk-track table injected into docs/CASE-STUDY-PLAN.md between markers ----
plan_path = os.path.join(ROOT, "docs", "CASE-STUDY-PLAN.md")
if os.path.exists(plan_path):
    plan = open(plan_path, encoding="utf-8").read()
    m0, m1 = "<!-- TALK-TRACK:START -->", "<!-- TALK-TRACK:END -->"
    if m0 in plan and m1 in plan:
        rows = ["| Slide | Beat | Standard | Architect |", "|---|---|---|---|"]
        for i, s in enumerate(slides, 1):
            st = "appendix" if s.get("appendix") else ("skip when short" if s.get("skip_short") else mmss(speak(s["say"]) + s.get("fixed", 0)))
            ar = "appendix" if s.get("appendix") else ("skipped" if s.get("a_skip") else mmss(arc_time(s)))
            rows.append(f"| {i} {s['title']} | {s.get('beat','')} | {st} | {ar} |")
        rows.append(f"| **Total** | computed at {WPM} wpm, plus fixed seconds and pauses; not rehearsed | **{mmss(std_total)}** | **{mmss(arc_total)}** |")
        plan = plan[:plan.index(m0) + len(m0)] + "\n" + "\n".join(rows) + "\n" + plan[plan.index(m1):]
        open(plan_path, "w", encoding="utf-8").write(plan)

# ---- second-screen HTML (no external dependencies) ----
E = lambda t: html.escape(t, quote=False)
def block(i, s, cut):
    if cut == "std":
        t, say, pause, skipped = std_time(s) or (speak(s["say"]) + s.get("fixed", 0)), s["say"], "", bool(s.get("skip_short"))
    else:
        t, say, pause, skipped = arc_time(s), arc_text(s), s.get("pause", ""), bool(s.get("a_skip"))
    cls = "slide skipped" if skipped else "slide"
    h = [f'<section class="{cls}" id="{cut}-s{i}" data-n="{i}">',
         f'<h2><span class="n">{i}</span>{E(s["title"])}<span class="t">{"appendix" if s.get("appendix") else ("skipped" if skipped and cut=="arc" else mmss(t))}</span></h2>']
    if s.get("cue") and not (skipped and cut == "arc" and not s.get("cue")): h.append(f'<p class="cue"><b>Cue</b> {E(s["cue"])}</p>')
    if not (skipped and cut == "arc"): h.append(f'<p class="say">{E(say)}</p>')
    if pause: h.append(f'<p class="pause">{E(pause)}</p>')
    if s.get("closing"): h.append(f'<p class="closing">{E(s["closing"])}</p>')
    for x in s.get("extra", []): h.append(f'<div class="extra"><p class="cue"><b>Not on a slide</b> {E(x["label"])}</p><p class="say">{E(x["text"])}</p></div>')
    h.append("</section>"); return "\n".join(h)
std_blocks = "\n".join(block(i, s, "std") for i, s in enumerate(slides, 1))
arc_blocks = "\n".join(block(i, s, "arc") for i, s in enumerate(slides, 1))
nav = " ".join(f'<a href="#" data-go="{i}" title="{E(s["title"])}">{i}</a>' for i, s in enumerate(slides, 1))
extra = ['<section id="short30"><h2>30-second version</h2><p class="say">' + E(S["short30"]) + "</p></section>", '<section id="short2"><h2>2-minute version</h2>']
extra += [f'<p class="say"><b>{E(k["slide"])}.</b> {E(k["say"])}</p>' for k in S["short2min"]] + ["</section>", '<section id="ifasked"><h2>If asked</h2>']
extra += [f'<div class="qa"><p class="q">{E(k["q"])}</p><p class="say">{E(k["a"])}</p></div>' for k in S["ifasked"]] + ["</section>"]
page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jadal — speaker script</title>
<style>
:root{{--bg:#F6F4EE;--ink:#10202B;--mute:#4B5C66;--accent:#0E5C73;--warn:#9A3A1E;--rule:#D9D4C7}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0E1B23;--ink:#EAF2EF;--mute:#A9C2CC;--accent:#5FD0DB;--warn:#E2805F;--rule:#26404E}}}}
*{{box-sizing:border-box}} html{{scroll-behavior:smooth;scroll-padding-top:150px}}
body{{margin:0;background:var(--bg);color:var(--ink);font:400 32px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}}
header{{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:3px solid var(--rule);padding:14px 36px}}
header h1{{font-size:28px;margin:0 0 8px;font-weight:600}} header h1 small{{font-weight:400;color:var(--mute);font-size:22px;margin-left:12px}}
.bar{{display:flex;flex-wrap:wrap;gap:8px;align-items:center}}
.bar button,.bar a{{font-weight:600;font-size:24px;line-height:1;font-family:inherit;color:var(--ink);background:transparent;border:2px solid var(--rule);border-radius:10px;padding:10px 16px;text-decoration:none;cursor:pointer}}
.bar button[aria-pressed=true]{{background:var(--ink);color:var(--bg);border-color:var(--ink)}}
.bar a.cur{{background:var(--accent);color:var(--bg);border-color:var(--accent)}}
.bar .sep{{width:18px}}
main{{max-width:1500px;margin:0 auto;padding:10px 36px 160px}}
.cut{{display:none}} .cut.on{{display:block}}
.slide{{padding:26px 0 30px;border-bottom:2px solid var(--rule)}}
.slide h2,section h2{{font-size:46px;line-height:1.1;margin:0 0 12px;display:flex;align-items:baseline;gap:20px}}
.n{{display:inline-block;min-width:2.1ch;color:var(--accent);font-variant-numeric:tabular-nums}}
.t{{margin-left:auto;font-size:28px;font-weight:500;color:var(--mute);font-variant-numeric:tabular-nums}}
.cue{{font-size:28px;line-height:1.4;color:var(--mute);border-left:6px solid var(--accent);padding:4px 0 4px 16px;margin:0 0 14px}}
.cue b{{color:var(--accent)}}
.say{{margin:0 0 14px;max-width:34em}}
.pause{{font-size:30px;font-weight:600;color:var(--warn);border:3px solid var(--warn);border-radius:12px;padding:10px 18px;max-width:34em}}
.closing{{font-size:32px;font-weight:600;border-left:6px solid var(--accent);padding:6px 0 6px 16px;max-width:34em}}
.extra{{margin-top:18px;padding-top:12px;border-top:2px dashed var(--rule)}}
.slide.skipped{{opacity:.55}} .slide.skipped .say{{display:none}}
section[id^=short],section#ifasked{{padding:30px 0;border-bottom:2px solid var(--rule)}}
.qa{{margin:0 0 22px}} .q{{font-weight:600;margin:0 0 4px;font-size:34px}}
.hint{{color:var(--mute);font-size:24px;margin:10px 0 0}}
:focus-visible{{outline:4px solid var(--accent);outline-offset:3px}}
@media (max-width:900px){{body{{font-size:26px}}.slide h2,section h2{{font-size:36px}}header{{padding:10px 16px}}main{{padding:8px 16px 120px}}}}
</style></head><body>
<header>
 <h1>Jadal — speaker script <small>standard {mmss(std_total)} · architect {mmss(arc_total)} (computed, not rehearsed)</small></h1>
 <div class="bar" role="group" aria-label="Choose cut">
  <button type="button" data-cut="std" aria-pressed="true">Standard cut</button>
  <button type="button" data-cut="arc" aria-pressed="false">Architect cut</button>
  <span class="sep"></span>{nav}
  <span class="sep"></span><a href="#short30">30 s</a><a href="#short2">2 min</a><a href="#ifasked">If asked</a>
  <a href="/deck/" target="_blank" rel="noopener">Open deck</a>
 </div>
 <p class="hint">Keys: ← → previous or next slide · 1–9 jump · S standard · A architect. The deck is at /deck/#N.</p>
</header>
<main>
 <div class="cut on" id="cut-std">
{std_blocks}
 </div>
 <div class="cut" id="cut-arc">
{arc_blocks}
 </div>
{chr(10).join(extra)}
</main>
<script>
(function(){{
  var cut="std", cur=1, N={len(slides)};
  function setCut(c,keep){{cut=c;
    document.getElementById("cut-std").classList.toggle("on",c==="std");
    document.getElementById("cut-arc").classList.toggle("on",c==="arc");
    [].forEach.call(document.querySelectorAll("[data-cut]"),function(b){{b.setAttribute("aria-pressed",String(b.dataset.cut===c))}});
    try{{history.replaceState(null,"","?cut="+c+(location.hash||""))}}catch(e){{}}
    if(!keep)go(cur,true)}}
  function go(n,instant){{n=Math.max(1,Math.min(N,n));cur=n;
    var el=document.getElementById(cut+"-s"+n); if(el)el.scrollIntoView({{behavior:instant?"instant":"smooth",block:"start"}});
    [].forEach.call(document.querySelectorAll("[data-go]"),function(a){{a.classList.toggle("cur",+a.dataset.go===n)}});
    try{{history.replaceState(null,"","?cut="+cut+"#s"+n)}}catch(e){{}}}}
  [].forEach.call(document.querySelectorAll("[data-cut]"),function(b){{b.addEventListener("click",function(){{setCut(b.dataset.cut)}})}});
  [].forEach.call(document.querySelectorAll("[data-go]"),function(a){{a.addEventListener("click",function(e){{e.preventDefault();go(+a.dataset.go)}})}});
  addEventListener("keydown",function(e){{
    if(e.target.tagName==="INPUT")return;
    if(e.key==="ArrowRight"||e.key==="PageDown"){{e.preventDefault();go(cur+1)}}
    else if(e.key==="ArrowLeft"||e.key==="PageUp"){{e.preventDefault();go(cur-1)}}
    else if(e.key==="s"||e.key==="S")setCut("std"); else if(e.key==="a"||e.key==="A")setCut("arc");
    else if(/^[1-9]$/.test(e.key))go(+e.key)}});
  var q=new URLSearchParams(location.search).get("cut"); if(q==="arc"||q==="std")setCut(q,true);
  var h=/^#s(\\d+)$/.exec(location.hash); go(h?+h[1]:1,true);
}})();
</script></body></html>
"""
open(os.path.join(D, "speaker-script.html"), "w", encoding="utf-8").write(page)
print("crop table:", CROP_STATS)
print(f"ok: {len(slides)} slides | standard {mmss(std_total)} (all slides {mmss(std_full)}) | architect {mmss(arc_total)} | words std {sum(words(s['say']) for s in slides)} arc {sum(words(arc_text(s)) for s in slides if not s.get('a_skip'))}")
for i, s in enumerate(slides, 1): print(f"  {i:2} {s['title'][:28]:28} std {mmss(speak(s['say'])+s.get('fixed',0)):>5}  arc {('skip' if s.get('a_skip') else mmss(arc_time(s))):>5}")
