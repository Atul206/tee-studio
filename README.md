# Tee Studio

A CorelDRAW-style design studio for T-shirt artwork that runs entirely in the browser — **no install, no server, no internet**. Download the folder, double-click `index.html`, and design.

Exports print-ready **PNG (300 DPI, transparent)**, **layered PSD** (one Photoshop layer per object), **PDF**, **SVG**, **JPG** and **shirt mockups**.

> Status: early preview — looking for feedback. Behaviour is modelled on [TraceDraw](https://github.com/igtoth/tracedraw)'s documented CorelDRAW behaviour, rebuilt from scratch in JavaScript.

## Try it

**Online:** open **https://atul206.github.io/tee-studio/** — nothing to install. Works on desktop (Chrome/Edge best), tablets and phones: the layout adapts, pinch to zoom, long-press for menus.

**Offline:**

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `index.html` in **Chrome** or **Edge**.
3. Click **Choose designs folder** and pick the included `my-designs` folder — your work saves there automatically as `.tee.json` files, exports go to `my-designs/exports/`.

Online, click **Choose designs folder** and pick any folder on your computer — your work is saved there, not on a server. Firefox and Safari work too, but can't write to folders: designs are kept in the browser and exports download instead.

Full instructions and shortcuts: [HOW-TO-USE.txt](HOW-TO-USE.txt).

## What's in it

| Area | Features |
|---|---|
| Devices | Desktop, tablet and phone layouts; pinch-zoom and two-finger pan, long-press menus, double-tap, larger touch handles |
| Workspace | Menu bar, context property bar, toolbox, rulers in inches, colour palette (left-click fill, right-click outline), layers panel, 12 × 16 in print area on a T-shirt mockup (7 shirt colours, front and back pages) |
| Drawing | Rectangle, ellipse, star, line, pen, freehand, brush, text with 12 embedded Google Fonts |
| Pick tool | Second-click rotate/skew with a movable centre, Shift/Ctrl/Alt handle modifiers, Space drops a copy, right-drag menu, Alt+click dig, smart duplicate, snapping and magenta alignment guides with equal spacing and sizes |
| Shape tool | Node editing: drag nodes, handles and segments, add/delete with refit, cusp/smooth/symmetrical, to line/curve, break/join/close, reverse, extract |
| Shaping | Weld, Trim, Intersect, Simplify, Front/Back minus, Combine, Break apart, Convert to curves — text included |
| Text | Arc text, fit text to any path (top/bottom centre, offset, flip side), text to curves |
| Live effects | Drop shadow (flat & perspective, feathering, merge modes), Contour, Envelope (arch, bulge, flag…), Distort (push/pull, zipper, twister), Blend, gradient Transparency |
| Groups | Ctrl+click inside groups, Focus mode, clip frames / PowerClip (text frames too), opacity masks |
| Export | PNG, JPG, layered PSD (with optional per-layer PNGs and a hidden shirt layer), PDF, SVG (fonts embedded, effects baked), mockup PNG |

## How it's built

Plain HTML, CSS and classic scripts — no build step, no modules, no `fetch`, so it works from `file://`. Libraries and fonts are bundled in `lib/` and `fonts/`.

```
index.html        the app
app/styles.css
app/js/           editor, storage, export, shaping, text, nodes, pick tool, effects, clip frames, blend
lib/              Fabric.js, ag-psd, jsPDF, paper.js, opentype.js, Clipper
fonts/            embedded Google Fonts (display + outlines)
my-designs/       your designs folder (contents are git-ignored)
```

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the bundled libraries' and fonts' licences.

## Feedback

Please open an [issue](../../issues) with what you tried, what you expected, and a screenshot or the `.tee.json` file if something looks wrong.
