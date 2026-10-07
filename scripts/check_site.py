"""Checks on the built site in _site/. Exits non-zero if anything fails.

* every internal link and asset resolves to a file
* every page has hreflang links for both languages, and they resolve
* no page loads anything from a third-party server (fonts, scripts, images)
* no phone number appears in any HTML page
* the name always appears in full (Perret-Gentil)
* the palette meets its contrast targets in both themes

    uv run python scripts/check_site.py
"""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "_site"
ORIGIN = "https://alejandroperretg.github.io"


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.alternates, self.ids, self.external = [], [], set(), []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        for key in ("href", "src"):
            if key in a and a[key]:
                self.links.append(a[key])
        loaded = a.get("src") if tag in ("script", "img", "iframe", "source") else None
        if tag == "link" and a.get("rel") in ("stylesheet", "preload", "preconnect", "icon"):
            loaded = a.get("href")
        if loaded and loaded.startswith(("http:", "https:", "//")):
            self.external.append(loaded)
        if tag == "link" and a.get("rel") == "alternate" and "hreflang" in a:
            self.alternates.append((a["hreflang"], a["href"]))


def resolve(link: str, page: Path) -> Path | None:
    if link.startswith(ORIGIN):
        link = link[len(ORIGIN):]
    if link.startswith(("http:", "https:", "mailto:", "#", "data:")):
        return None
    path = link.split("#")[0].split("?")[0]
    target = (SITE / path.lstrip("/")) if path.startswith("/") else (page.parent / path)
    return target / "index.html" if path.endswith("/") or target.is_dir() else target


def luminance(hex_colour: str) -> float:
    rgb = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main() -> int:
    errors = []
    pages = [p for p in SITE.rglob("*.html") if not p.name.startswith("__")]
    for page in pages:
        html = page.read_text(encoding="utf-8")
        parser = Links()
        parser.feed(html)
        rel = page.relative_to(SITE).as_posix()
        for link in parser.links:
            target = resolve(link, page)
            if target is not None and not target.exists():
                errors.append(f"{rel}: broken link {link}")
        for url in parser.external:
            errors.append(f"{rel}: loads a third-party resource {url}")
        refresh = 'http-equiv="refresh"' in html
        langs = {code for code, _ in parser.alternates}
        if not refresh and not {"en", "es"} <= langs:
            errors.append(f"{rel}: missing hreflang alternates ({sorted(langs)})")
        for _, href in parser.alternates:
            target = resolve(href, page)
            if target is not None and not target.exists():
                errors.append(f"{rel}: hreflang target missing {href}")
        text = re.sub(r"<svg.*?</svg>", "", html, flags=re.S)
        if re.search(r"\+?49[\s\d]{9,}|176\s?\d{6,}", text):
            errors.append(f"{rel}: looks like a phone number")
        if re.search(r"Perret(?!-Gentil)", text):
            errors.append(f"{rel}: name not written in full")

    css = (SITE / "static" / "site.css").read_text(encoding="utf-8")
    blocks = re.findall(r"(:root[^{]*)\{([^}]*)\}", css)
    themes = {}
    for selector, body in blocks:
        tokens = dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})", body))
        if tokens:
            name = "dark" if ("dark" in selector or ":not(" in selector) else "light"
            themes.setdefault(name, {}).update(tokens)
    themes["dark"] = {**themes["light"], **themes["dark"]}
    targets = [("ink", 4.5), ("ink-2", 4.5), ("muted", 4.5), ("accent", 3.0)]
    for name, tokens in themes.items():
        for token, minimum in targets:
            for surface in ("bg", "surface"):
                ratio = contrast(tokens[token], tokens[surface])
                status = "ok" if ratio >= minimum else "FAIL"
                print(f"  {name:5} {token:7} on {surface:7} {ratio:5.2f}:1 (min {minimum}) {status}")
                if ratio < minimum:
                    errors.append(f"contrast {name} {token} on {surface}: {ratio:.2f}")

    print(f"Checked {len(pages)} HTML files.")
    for e in errors:
        print("ERROR", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
