---
name: tee-studio
description: Design, recreate and edit logos and T-shirt artwork for Tee Studio, and change the Tee Studio app itself. Use this whenever the user wants a logo or T-shirt graphic made from an image file, photo, sketch or reference, or designed from a description; wants to change a saved logo (wording, colours, size, parts); wants files exported for printing; or asks to fix, add to or change anything in Tee Studio, even if they don't name it, as in "make this into a logo", "same as this shirt", "change the year to 2027" or "add a tool".
---

# Tee Studio

Tee Studio is a CorelDRAW-style T-shirt design app that runs from `index.html` with no server. Logos are vector templates in `logos/`, added through the `tee-studio-logo` MCP server, and appear in the app under **Assets > Logos**.

Answer in the language the user writes in, including Hinglish. Many users aren't technical: talk about their logo, not specs and element numbers.

Work out which of these the request is, then follow that section:

| They want | Go to |
|---|---|
| Something that matches an image | [Recreate from a file](#recreate-from-a-file) |
| Something new, maybe with a reference for style | [Design from a brief](#design-from-a-brief) |
| A change to a saved logo | [Edit a saved logo](#edit-a-saved-logo) |
| A change to the app itself | Read [references/app-guide.md](references/app-guide.md) |

If the `logo_*` tools are missing, the server isn't connected. Check `mcp/node_modules` exists (if not, run `npm install` in `mcp/`), then ask the user to approve `tee-studio-logo` and restart Claude Code.

## Before you start

**Rights.** A template can end up printed and sold. If a logo looks like it belongs to a company or brand and the user hasn't said it's theirs, ask once whether they own it or have permission. If they do, carry on without further comment. A reference used for style is different: take the feel, but don't reproduce its marks.

**Ask only what changes the result.** If the name, wording and rough style are clear, start and show something, because a picture gets better feedback than questions. Otherwise ask for what's missing in one short message.

## Recreate from a file

1. `logo_load_source`. Look before doing anything else. Selfies and mirror photos read backwards, so load again with `flip: "horizontal"` if the text is reversed.
2. Read the wording with `logo_view_source`, zooming in on anything unclear. Digits and small letters are easy to misread on a curved or folded print. If you can't be sure, ask rather than guess.
3. Choose how to draw it:
   - **Flat artwork** (a clean PNG, SVG or scan): use `logo_autotrace`. Then replace text with real `text` or `arcText` elements if a bundled font is close, so it stays editable: pass a `region` to `logo_autotrace` so it traces only the artwork and not the letters. Traced edges have a faint wobble at high zoom, so draw plain circles and straight-edged shapes as real `circle` and `path` elements, and keep tracing for the organic parts.
   - **Photos, or fine lines**: draw by hand. Auto-trace follows shadows and folds, which aren't part of the logo. Read coordinates off the grid, zoom in on each part, and name the nodes for yourself as you go.
4. `logo_preview` with `source_id`. Red is yours, over the source. Work through the differences, zooming in with `region`, and preview again. Expect two or three rounds.
5. Draw the logo as designed, not as photographed: use clean colours, true circles, and straight lines where the print is folded. A photo of a shirt is distorted by the angle and the body, so small gaps from the overlay are expected. Line up the main shapes, and don't bend them to follow a fold.
6. `logo_save`, then tell the user how to find it, and what you interpreted.

Work in source image pixels so the overlay lines up, and use `viewBox` to frame the logo with a small margin. A spec too large to resend comfortably is a sign to save early and use `logo_edit`.

## Design from a brief

1. Decide on one clear idea, not several. A T-shirt logo is seen from across a room: a strong silhouette and a few words beat fine detail.
2. Use a 1000 × 1000 canvas: `viewBox: [0, 0, 1000, 1000]`.
3. `logo_preview` with no source, on the shirt colour they'll print on (`background`).
4. Give the user the picture's file path and ask what to change. If the direction is open, offer two or three clearly different versions by saving previews under different names, and let them pick.
5. Save it when they're happy.

Design for printing:
- **Lines** at least 1.5 pt at the final size. On a 10 in logo in a 1000-unit canvas, that's a `strokeWidth` of 2 or more. Thinner lines break up when screen printed.
- **Text** at least 8 pt at final size, and more for thin fonts.
- **Colours**: one to three solid colours, since each can add a screen and cost. Avoid gradients unless they ask.
- **The shirt**: white or light ink on dark shirts and dark ink on light ones. Check against the real shirt colour.
- **Curved text**: `arcText` with `cw` over the top and `ccw` along the bottom, with the same `cx`, `cy`. Letters on `ccw` sit inside the circle, so its `r` needs to be larger by about the letter height for the two lines to look level. Letters are spread to fill the arc, so a shorter arc gives tighter text: check the spacing in the preview and adjust `startDeg` and `endDeg` to suit.

Fonts bundled with the app: Bebas Neue, Anton, Oswald, Rubik Mono One, Bungee (bold, poster), Montserrat, Inter (clean), Playfair Display (elegant), Pacifico, Lobster, Caveat (script), Permanent Marker (hand-drawn).

## Edit a saved logo

1. `logo_list` if you aren't sure of the name, then `logo_get` to see it with its parts numbered.
2. `logo_edit` with only what changes. Use `dry_run: true` when the request is open to interpretation, so you can show them first. Otherwise just make the change.
3. Check the returned picture really shows what they asked for, then give them its path. `undo: true` goes back one step if they don't like it.

Typical requests:
- "Change 2023 to 2027": `update` the text element's `text`.
- "Make it orange": `recolor` from the current colour.
- "Add a tagline": `add` a `text` or `arcText` element. Adjust `viewBox` if it falls outside.
- "Remove the ring": `remove` its numbers.
- "Thicker lines": `update` the `strokeWidth`.
- "Make it smaller on the shirt": `widthIn`.
- A big redesign: start again from a spec and save with `overwrite: true`, after checking that's what they want.

Designs already using a logo keep their own copy, so a change appears only when the logo is added again. Say so if it matters.

## Finishing

Always tell the user:
- Where to see it: refresh Tee Studio, then **Assets > Logos**, and click to add it. They can move, scale and recolour it there.
- The path of the picture to open.
- Anything you interpreted rather than copied: unclear wording, the closest font, damage in a photo you drew clean.
- For printing, offer `logo_export` (transparent PNG, SVG or layered PSD, in `logos/exports/`). If the original artwork exists, it's better than a logo traced from a photo.

Logos in `logos/` are ignored by git so they stay private. Don't publish one or commit it unless the user asks and has the rights to it.
