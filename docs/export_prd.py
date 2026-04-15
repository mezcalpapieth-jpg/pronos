#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

import markdown
from bs4 import BeautifulSoup, NavigableString, Tag


CSS = """
@page {
  size: A4;
  margin: 20mm 18mm 22mm 18mm;
}

:root {
  --ink: #15202b;
  --muted: #5b6571;
  --line: #d6dde5;
  --line-dark: #aeb9c5;
  --panel: #f7f9fb;
  --accent: #0f4c81;
}

html, body {
  margin: 0;
  padding: 0;
  background: #eef3f7;
  color: var(--ink);
  font-family: "Aptos", "Helvetica Neue", Helvetica, Arial, sans-serif;
  line-height: 1.55;
}

body {
  padding: 24px 0;
}

main {
  width: min(920px, calc(100vw - 48px));
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 18px 45px rgba(20, 37, 53, 0.08);
  border-radius: 16px;
  padding: 56px 64px 72px;
}

h1, h2, h3, h4 {
  color: #102a43;
  line-height: 1.18;
  margin-top: 1.25em;
  margin-bottom: 0.55em;
}

h1 {
  font-size: 34px;
  margin-top: 0;
  padding-bottom: 14px;
  border-bottom: 3px solid var(--accent);
}

h2 {
  font-size: 24px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

h3 {
  font-size: 18px;
}

h4 {
  font-size: 16px;
}

p, li {
  font-size: 14px;
}

blockquote {
  margin: 18px 0;
  padding: 12px 18px;
  background: var(--panel);
  border-left: 4px solid var(--accent);
  color: var(--muted);
}

code, pre {
  font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
}

pre {
  background: #0f1720;
  color: #e8edf2;
  padding: 14px 16px;
  overflow: auto;
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 18px 0 24px;
  font-size: 13px;
}

th, td {
  border: 1px solid var(--line);
  padding: 8px 10px;
  vertical-align: top;
  text-align: left;
}

th {
  background: #f2f6fa;
  color: #102a43;
}

hr {
  border: none;
  border-top: 1px solid var(--line-dark);
  margin: 28px 0;
}

strong {
  color: #0b2b40;
}

ul, ol {
  margin-top: 10px;
  margin-bottom: 14px;
}

@media print {
  html, body {
    background: #fff;
  }

  body {
    padding: 0;
  }

  main {
    width: auto;
    margin: 0;
    border-radius: 0;
    box-shadow: none;
    padding: 0;
  }
}
"""


def load_markdown(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def markdown_to_html(md_text: str) -> str:
    body = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "sane_lists"],
        output_format="html5",
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PRONOS PRD - English Version</title>
  <style>{CSS}</style>
</head>
<body>
  <main>
    {body}
  </main>
</body>
</html>
"""


def rtf_escape(text: str) -> str:
    text = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    out = []
    for ch in text:
        code = ord(ch)
        if ch == "\n":
            out.append("\\line ")
        elif 32 <= code <= 126:
            out.append(ch)
        else:
            signed = code - 65536 if code > 32767 else code
            out.append(f"\\u{signed}?")
    return "".join(out)


def collapse_whitespace(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n\s*\n+", "\n", value)
    return value.strip()


def inline_text(node: Tag | NavigableString) -> str:
    if isinstance(node, NavigableString):
        return str(node)
    if not isinstance(node, Tag):
        return ""
    if node.name == "br":
        return "\n"
    if node.name in {"strong", "b"}:
        return node.get_text(" ", strip=False)
    if node.name in {"em", "i"}:
        return node.get_text(" ", strip=False)
    if node.name == "code":
        return f"`{node.get_text(' ', strip=False)}`"
    if node.name == "a":
        label = node.get_text(" ", strip=True)
        href = node.get("href", "")
        return f"{label} ({href})" if href else label
    parts = [inline_text(child) for child in node.children]
    return "".join(parts)


def paragraph(text: str, fs: int = 22, bold: bool = False, italic: bool = False, left_indent: int = 0) -> str:
    if not text:
        return ""
    prefix = "\\pard"
    if left_indent:
        prefix += f"\\li{left_indent}"
    prefix += "\\sa140\\sl300\\slmult1"
    styles = []
    if bold:
        styles.append("\\b")
    if italic:
        styles.append("\\i")
    style_prefix = "".join(styles)
    style_suffix = "".join("\\b0" if s == "\\b" else "\\i0" for s in styles)
    return f"{prefix}\\f0\\fs{fs}{style_prefix} {rtf_escape(text)}{style_suffix}\\par\n"


def code_block(text: str) -> str:
    escaped = rtf_escape(text.rstrip())
    return f"\\pard\\li360\\ri360\\sa140\\f2\\fs20 {escaped}\\par\n"


def render_table(table: Tag) -> str:
    rows = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if not cells:
            continue
        rows.append([collapse_whitespace("".join(inline_text(cell) for cell in cells)) for cell in cells])
    if not rows:
        return ""
    cols = max(len(row) for row in rows)
    total_width = 9360
    step = total_width // max(cols, 1)
    cellx = [(i + 1) * step for i in range(cols)]
    output = []
    for row_index, row in enumerate(rows):
        output.append("\\trowd\\trgaph108\\trleft0\n")
        for pos in cellx:
            output.append(
                "\\clbrdrt\\brdrs\\brdrw10"
                "\\clbrdrl\\brdrs\\brdrw10"
                "\\clbrdrb\\brdrs\\brdrw10"
                "\\clbrdrr\\brdrs\\brdrw10"
                f"\\cellx{pos}\n"
            )
        for idx in range(cols):
            text = row[idx] if idx < len(row) else ""
            style = "\\b" if row_index == 0 else ""
            style_end = "\\b0" if row_index == 0 else ""
            output.append(f"\\pard\\intbl\\f0\\fs20{style} {rtf_escape(text)}{style_end}\\cell\n")
        output.append("\\row\n")
    output.append("\\pard\\sa120\\par\n")
    return "".join(output)


def render_list(list_tag: Tag, ordered: bool = False) -> str:
    output = []
    for idx, item in enumerate(list_tag.find_all("li", recursive=False), start=1):
        marker = f"{idx}." if ordered else "-"
        own_parts = []
        nested_blocks = []
        for child in item.children:
            if isinstance(child, Tag) and child.name in {"ul", "ol"}:
                nested_blocks.append(render_node(child))
            else:
                own_parts.append(inline_text(child))
        text = collapse_whitespace("".join(own_parts))
        output.append(f"\\pard\\li720\\tx720\\sa80\\f0\\fs22 {rtf_escape(marker)}\\tab {rtf_escape(text)}\\par\n")
        output.extend(nested_blocks)
    return "".join(output)


def render_node(node: Tag | NavigableString) -> str:
    if isinstance(node, NavigableString):
        return ""
    if not isinstance(node, Tag):
        return ""
    name = node.name.lower()
    if name == "h1":
        return paragraph(collapse_whitespace(node.get_text(" ", strip=True)), fs=40, bold=True)
    if name == "h2":
        return "\\pagebb\n" + paragraph(collapse_whitespace(node.get_text(" ", strip=True)), fs=30, bold=True)
    if name == "h3":
        return paragraph(collapse_whitespace(node.get_text(" ", strip=True)), fs=26, bold=True)
    if name == "h4":
        return paragraph(collapse_whitespace(node.get_text(" ", strip=True)), fs=24, bold=True)
    if name == "p":
        return paragraph(collapse_whitespace("".join(inline_text(child) for child in node.children)))
    if name == "blockquote":
        text = collapse_whitespace(node.get_text("\n", strip=True))
        return paragraph(text, italic=True, left_indent=720)
    if name == "pre":
        return code_block(node.get_text())
    if name == "ul":
        return render_list(node, ordered=False)
    if name == "ol":
        return render_list(node, ordered=True)
    if name == "table":
        return render_table(node)
    if name == "hr":
        return "\\pard\\sa140\\brdrb\\brdrs\\brdrw10\\par\n"
    return "".join(render_node(child) for child in node.children if isinstance(child, Tag))


def html_to_rtf(html_text: str) -> str:
    soup = BeautifulSoup(html_text, "html.parser")
    main = soup.find("main") or soup.body or soup
    pieces = [
        "{\\rtf1\\ansi\\deff0",
        "{\\fonttbl{\\f0 Aptos;}{\\f1 Helvetica;}{\\f2 Courier New;}}",
        "\\paperw12240\\paperh15840\\margl900\\margr900\\margt900\\margb900\n",
    ]
    for child in main.children:
        if isinstance(child, Tag):
            pieces.append(render_node(child))
    pieces.append("}")
    return "".join(pieces)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a markdown PRD to HTML and RTF.")
    parser.add_argument("source", type=Path, help="Markdown source file")
    parser.add_argument("--html-out", type=Path, required=True, help="Output HTML path")
    parser.add_argument("--rtf-out", type=Path, required=True, help="Output RTF path")
    args = parser.parse_args()

    md_text = load_markdown(args.source)
    html_text = markdown_to_html(md_text)
    rtf_text = html_to_rtf(html_text)

    write(args.html_out, html_text)
    write(args.rtf_out, rtf_text)


if __name__ == "__main__":
    main()
