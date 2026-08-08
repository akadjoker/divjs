#!/usr/bin/env python3
"""
Generate a new DivJS tutorial/demo HTML page under examples/, with all the
canvas/JS boilerplate already wired up (matches examples/tutor0a.html) and
just an empty PROGRAM skeleton left for you to fill in.

Usage:
    python3 tools/new_tutorial.py tutor0b
    python3 tools/new_tutorial.py tutor0b --title "Tutorial 0b"
    python3 tools/new_tutorial.py tutor0b --force   # overwrite if it exists

Writes examples/<name>.html.
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXAMPLES_DIR = REPO_ROOT / "examples"

NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]*$")

TEMPLATE = """<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DivJS - {title}</title>
  <style>
    * {{
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }}

    body {{
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }}

    .container {{
      text-align: center;
    }}

    h1 {{
      color: #fff;
      margin-bottom: 20px;
      font-size: 2em;
    }}

    canvas {{
      border: 4px solid #4a9eff;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(74, 158, 255, 0.3);
    }}

    .info {{
      color: #aaa;
      margin-top: 15px;
    }}
  </style>
</head>

<body>
  <div class="container">
    <h1>🎮 DivJS {title}</h1>
    <canvas id="gameCanvas" width="{width}" height="{height}"></canvas>
    <div id="log">booting...</div>
  </div>

  <script type="module">
    import {{ runDivDemo }} from '../divjs.js';

    const source = `
PROGRAM {program_name};
BEGIN
    // TODO: add DIV script code here.
    // e.g. load_fpg('../assets/div-support/{fpg_name}.fpg');

END

`;

    const canvas = document.getElementById('gameCanvas');
    const log = document.getElementById('log');

    let statusLine = '';
    function logLine(line) {{
      console.log(line);
      log.textContent = statusLine ? `${{line}}  ||  ${{statusLine}}` : line;
    }}

    try {{
      runDivDemo({{
        canvas,
        source: source,
        clearColor: '#000',
        // Set to true to draw collision shapes, pivots and control
        // points over every process (with a colour legend bottom-left).
        debugDrawProcessBounds: false,
        onLog: (line) => {{ logLine(line); }},
        onFrame: ({{ runtime }}) => {{
          const fps = Math.round(runtime.fpsValue || 0);
          const procs = runtime.vm?.processManager?.getAll?.() || [];
          const active = procs.filter(p => p.active && !p.suspended && !p.dead);

        }},
        onError: (err) => {{
          logLine('error: ' + (err?.message || String(err)));
          console.error(err);
        }}
      }});
    }} catch (err) {{
      logLine('error: ' + (err?.message || String(err)));
      console.error(err);
    }}
  </script>
</body>

</html>
"""


def slug_to_title(name: str) -> str:
    """tutor0b -> Tutor0B is ugly; prefer splitting on _/- and title-casing words."""
    words = re.split(r"[_-]+", name)
    return " ".join(w[:1].upper() + w[1:] for w in words if w)


def slug_to_program_name(name: str) -> str:
    """DIV program names are plain identifiers; underscores are safe, hyphens aren't."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", help="Output file base name, e.g. 'tutor0b' -> examples/tutor0b.html")
    parser.add_argument("--title", help="Page/H1 title (default: derived from name, e.g. 'Tutor0B')")
    parser.add_argument("--fpg", help="FPG asset base name used in the placeholder comment (default: same as name)")
    parser.add_argument("--width", type=int, default=800, help="Canvas width (default: 800)")
    parser.add_argument("--height", type=int, default=600, help="Canvas height (default: 600)")
    parser.add_argument("--force", action="store_true", help="Overwrite the file if it already exists")
    args = parser.parse_args()

    if not NAME_RE.match(args.name):
        print(f"error: '{args.name}' isn't a safe file base name - use letters/digits/_/- only, starting with a letter.", file=sys.stderr)
        return 1

    out_path = EXAMPLES_DIR / f"{args.name}.html"
    if out_path.exists() and not args.force:
        print(f"error: {out_path} already exists (pass --force to overwrite).", file=sys.stderr)
        return 1

    title = args.title or slug_to_title(args.name)
    fpg_name = args.fpg or args.name
    program_name = slug_to_program_name(args.name)

    html = TEMPLATE.format(
        title=title,
        width=args.width,
        height=args.height,
        program_name=program_name,
        fpg_name=fpg_name,
    )

    EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(f"wrote {out_path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
