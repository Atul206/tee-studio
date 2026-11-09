# Tee Studio

A CorelDRAW-style design studio for T-shirt artwork that runs entirely in the browser — **no install, no server, no internet**. Download the folder, double-click `index.html`, and design.

Exports print-ready **PNG (300 DPI, transparent)**, **layered PSD** (one Photoshop layer per object), **PDF**, **SVG**, **JPG** and **shirt mockups**.

> Status: early preview — looking for feedback. Behaviour is modelled on [TraceDraw](https://github.com/igtoth/tracedraw)'s documented CorelDRAW behaviour, rebuilt from scratch in JavaScript.

## Try it

**Online:** open **https://atul206.github.io/tee-studio/** — nothing to install. Works on desktop (Chrome/Edge best), tablets and phones: the layout adapts, pinch to zoom, double-tap for menus.

**Offline:**

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `index.html` in **Chrome** or **Edge**.
3. Click **Choose designs folder** and pick the included `my-designs` folder — your work saves there automatically as `.tee.json` files, exports go to `my-designs/exports/`.

Online, click **Choose designs folder** and pick any folder on your computer — your work is saved there, not on a server. Firefox and Safari work too, but can't write to folders: designs are kept in the browser and exports download instead.

Full instructions and shortcuts: [HOW-TO-USE.txt](HOW-TO-USE.txt).

## What's in it

| Area | Features |
|---|---|
| Devices | Desktop, tablet and phone layouts; pinch-zoom and two-finger pan, double-tap menus, larger touch handles |
| Help | Offline help panel: ask in your own words, then follow a guided tour on the real buttons, with practice shapes |
| Workspace | Menu bar, context property bar, toolbox, rulers in inches, colour palette (left-click fill, right-click outline), layers panel, a print area of any size on a T-shirt mockup: T-shirt and paper presets or custom, set for each design (7 shirt colours, front and back pages) |
| Toolbox | Every tool of CorelDRAW's basic toolbox, in flyouts and a Tools menu |
| Curves | Freehand, 2-Point Line, Bezier, Pen, B-Spline, Polyline, 3-Point Curve, Artistic Media (Preset, Brush, Sprayer, Calligraphic, Expression), Smart Drawing |
| Shapes | Rectangle, Ellipse and their 3-Point versions, Polygon, Star, Complex Star, Graph Paper, Spiral, 71 Basic, Arrow, Flowchart, Banner and Callout shapes |
| Editing tools | Smudge, Roughen, Free Transform, Crop, Knife, Eraser, Virtual Segment Delete, Smart Fill, Zoom, Pan |
| Text, tables, dimensions | Artistic and paragraph text with 12 embedded Google Fonts; tables with merged cells; Parallel, Horizontal/Vertical, Angular and Segment dimensions that follow their size; 3-Point Callout |
| Pick tool | Second-click rotate/skew with a movable centre, Shift/Ctrl/Alt handle modifiers, Space drops a copy, right-drag menu, Alt+click dig, smart duplicate, snapping and magenta alignment guides with equal spacing and sizes |
| Shape tool | Node editing: drag nodes, handles and segments, add/delete with refit, cusp/smooth/symmetrical, to line/curve, break/join/close, reverse, extract |
| Shaping | Weld, Trim, Intersect, Simplify, Front/Back minus, Combine, Break apart, Convert to curves — text included |
| Text | Arc text, fit text to any path (top/bottom centre, offset, flip side), text to curves |
| Live effects | Drop shadow (flat & perspective, feathering, merge modes), Contour, Envelope (arch, bulge, flag…), Distort (push/pull, zipper, twister), Blend, gradient Transparency |
| Groups | Ctrl+click inside groups, Focus mode, clip frames / PowerClip (text frames too), opacity masks |
| Pictures | Import PNG, JPEG, WebP, GIF, BMP, AVIF at the size their resolution gives; Resample by pixels, percent or dpi (Smooth, Sharp, Hard pixels, Enlarge with detail); Adjust brightness, contrast, saturation, hue, gamma, sharpen, greyscale, invert (non-destructive); Crop and Reset crop; Remove background (colours learnt from the edges or picked, tolerance, softness, specks, clean edges, gaps closed in by the picture such as between spokes or inside letters) with a drawn boundary to keep or remove, Erase and Keep brushes and Invert, all non-destructive; Heal: paint over people, objects or marks and they are filled in from their surroundings (content-aware fill, on this computer); save a picture's pixels as PNG |
| Export | PNG, JPG, layered PSD (with optional per-layer PNGs and a hidden shirt layer), PDF, SVG (fonts embedded, effects baked), mockup PNG — of the print area, the artwork or the selection, at any size (in, cm, mm or px) and resolution (1–2400 dpi); PNG and JPG files record their dpi |

## Design by chatting with Claude

The copy of Tee Studio hosted on claude.ai has an **Ask Claude** panel. People sign in with their own Claude account, and each request uses their own plan: there's no API key and no server. Claude can only change the open design, and designs save privately to that person's account. See [claude/README.md](claude/README.md).

## Logos from an image, with an AI agent

[`mcp/`](mcp/README.md) is an MCP server: give Claude or another agent an image file and it builds a vector logo template that appears under Assets > Logos. Optional, local, and no API key needed. The app itself stays free of any install. The `tee-studio` skill in `.claude/skills/` guides Claude Code through creating and editing logos and changing the app. Only make templates of logos you own or have permission to use.

## How it's built

Plain HTML, CSS and classic scripts — no build step, no modules, no `fetch`, so it works from `file://`. Libraries and fonts are bundled in `lib/` and `fonts/`.

```
index.html        the app
app/styles.css
app/js/           editor, tools, tables, dimensions, storage, export, bitmaps, background removal, shaping, text, nodes, pick tool, effects, clip frames, blend
lib/              Fabric.js, ag-psd, jsPDF, paper.js, opentype.js, Clipper
fonts/            embedded Google Fonts (display + outlines)
my-designs/       your designs folder (contents are git-ignored)
logos/            logo templates made with the MCP server (git-ignored)
mcp/              the logo MCP server (optional, needs Node)
```

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the bundled libraries' and fonts' licences.

## Feedback

Please open an [issue](../../issues) with what you tried, what you expected, and a screenshot or the `.tee.json` file if something looks wrong.
