"""Build the static site into _site/.

Every page exists in English and Spanish. A page body lives in pages/<lang>/<slug>.html and
extends templates/base.html (or templates/project.html); shared labels live in
strings/<lang>.json. English pages are served from the site root, Spanish ones under /es/.

    uv run python build.py            # build into _site/
    uv run python build.py --serve    # build, then serve http://localhost:8000
"""

import argparse
import json
import shutil
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_site"
SITE_URL = "https://alejandroperretg.github.io"
LANGS = ("en", "es")

# slug -> path below the language root
PAGES = {
    "index": "",
    "about": "about/",
    "cv": "cv/",
    "thesis": "projects/thesis/",
    "investor-toolkit": "projects/investor-toolkit/",
    "remora": "projects/remora/",
    "privacy": "privacy/",
    "404": "404.html",
}

# Old URLs that may be linked from elsewhere -> new slug
REDIRECTS = {
    "about.html": "about",
    "notes.html": "index",
    "work/l-bracket.html": "index",
    "work/investor-toolkit.html": "investor-toolkit",
}


def url(slug: str, lang: str) -> str:
    prefix = "/" if lang == "en" else f"/{lang}/"
    return prefix + PAGES[slug]


def build() -> None:
    # Empty _site/ rather than delete it, so a preview server running inside it survives.
    OUT.mkdir(exist_ok=True)
    for item in OUT.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()
    shutil.copytree(ROOT / "static", OUT / "static")
    (OUT / "cv").mkdir()
    for pdf in (ROOT / "cv").glob("*.pdf"):
        shutil.copy2(pdf, OUT / "cv" / pdf.name)
    (OUT / ".nojekyll").write_text("", encoding="utf-8")

    # cache-busting version: changes whenever any static file changes
    css_version = str(int(max(f.stat().st_mtime for f in (ROOT / "static").rglob("*") if f.is_file())))
    for lang in LANGS:
        strings = json.loads((ROOT / "strings" / f"{lang}.json").read_text(encoding="utf-8"))
        env = Environment(
            loader=FileSystemLoader([ROOT / "pages" / lang, ROOT / "templates"]),
            undefined=StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
        )
        other = "es" if lang == "en" else "en"
        for slug, path in PAGES.items():
            context = {
                "lang": lang,
                "other_lang": other,
                "slug": slug,
                "t": strings,
                "url": lambda s, lang=lang: url(s, lang),
                "self_url": url(slug, lang),
                "alt_url": url(slug, other),
                "canonical": SITE_URL + url(slug, lang),
                "alternates": {code: SITE_URL + url(slug, code) for code in LANGS},
                "year": date.today().year,
                "v": css_version,
                "portrait": (ROOT / "static" / "img" / "portrait.jpg").exists(),
            }
            html = env.get_template(f"{slug}.html").render(**context)
            target = OUT / url(slug, lang).lstrip("/")
            if not path.endswith(".html"):
                target = target / "index.html"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(html, encoding="utf-8", newline="\n")

    for old, slug in REDIRECTS.items():
        target = OUT / old
        target.parent.mkdir(parents=True, exist_ok=True)
        new = url(slug, "en")
        target.write_text(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            f'<meta http-equiv="refresh" content="0; url={new}">'
            f'<link rel="canonical" href="{SITE_URL}{new}"><title>Moved</title></head>'
            f'<body><p>This page has moved to <a href="{new}">{SITE_URL}{new}</a>.</p></body></html>\n',
            encoding="utf-8",
        )
    print(f"Built {len(PAGES) * len(LANGS)} pages and {len(REDIRECTS)} redirects into {OUT}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--serve", action="store_true", help="serve _site on localhost:8000")
    args = parser.parse_args()
    build()
    if args.serve:
        import functools
        import http.server

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=OUT)
        print("Serving http://localhost:8000 (Ctrl+C to stop)")
        http.server.ThreadingHTTPServer(("127.0.0.1", 8000), handler).serve_forever()


if __name__ == "__main__":
    main()
