# Changing the Tee Studio app

The promise of the app: open `index.html` by double-clicking it and everything works, offline. Every rule below protects that.

## Rules

- **No server, no build, no CDN.** Use classic `<script>` tags only: no ES modules, no `fetch` of local files, since both fail from `file://`. Libraries are vendored in `lib/`, fonts in `fonts/`. The optional `mcp/` folder may use Node and npm because the app never loads it.
- **Script order matters.** All scripts share one global scope, so a top-level `const` in one file is visible in later files, but a clash breaks the page. See the bottom of `index.html` for the order.
- **The copy on claude.ai has its own limits.** `confirm()`, `prompt()`, `window.print()` and browser downloads do nothing there: use `askDialog` and `saveFile`. Run `node claude/test.mjs` after touching saving, export or dialogs, and republish with `claude/build.py`.
- **Tablets and phones count.** `COARSE` means a touch device. Give fingers bigger targets, keep lists scrollable, and let bars swipe. Double-tap opens the app's own menu with the Pick and Shape tools, and nothing needs a long press. The browser's menu stays blocked except in real text fields. The canvas library ignores mouse events for 400 ms after a touch.
- **Before committing app changes, run `python3 tools/stamp.py`.** It versions script links, so browsers can't mix an updated page with old cached scripts.
- **Don't push without being asked.** `main` deploys straight to the public site at https://atul206.github.io/tee-studio/.

## Where things are

| File in `app/js/` | Holds |
|---|---|
| `editor.js` | Constants, page size, zoom and view, history (`snapshot`), `setTool`, `run(cmd)` for menu commands, keyboard |
| `tools.js` | `Tools` (the framework), `Toolbox` (flyouts), drawing tools, Perfect Shapes |
| `tools-edit.js` | `Edit` helpers, Smudge, Roughen, Free Transform, Crop, Knife, Eraser, Segment Delete, Smart Fill, Text |
| `table.js`, `dimension.js` | Tables and dimensions as custom object classes |
| `logos.js` | Draws logo specs, Assets > Logos |
| `pick.js`, `nodes.js` | Pick tool, guides, snapping; Shape tool nodes |
| `shaping.js`, `textcurves.js` | Weld and Trim with paper.js; text on curves and text outlines |
| `effects.js`, `effects-ui.js`, `blend.js`, `clip.js` | Live effects, blends, transparency, clip frames, Focus |
| `bitmap.js`, `bgremove.js` | Pictures: resample, adjust, crop, background removal |
| `help.js`, `help-data.js` | Offline Help panel and guided tours. Add a guide to `help-data.js` when a feature changes where something is |
| `claude.js` | The copy inside Claude: Ask Claude panel, the actions Claude may take, saving to the Claude account, save prompt (see `claude/README.md`) |
| `export.js`, `storage.js`, `pagesize.js`, `touch.js` | Exports, saving and the home screen, page size dialog, touch |

Scene units: `PX_PER_IN = 20`. The print area is `PA_W × PA_H`. Page size can change, so don't hard-code 12 × 16.

## Traps that have already caused bugs

- **Don't give a custom object a `text` property.** The app treats `o.text != null` as "this is a text object". Dimensions use `caption` for this reason.
- **Custom classes** need `type`, `toObject` and a static `fromObject` on `fabric.<Capitalised type>`, or they vanish on reload.
- **Custom properties** must be in `PROPS` (top of `editor.js`), or undo and saving lose them.
- **Group boxes** ignore letters that stand outside their text path, and a group's cache then cuts them off after a reload. `LogoTemplates.build` adds a "Logo box" for this.
- **Undo**: `snapshot()` once per action. Wrap multi-step changes in `restoring = true ... false`, as `Edit.commit` does, so one action is one undo.
- **Closed strokes** start and end on the same point, which breaks simple geometry. `Tools.rdp` handles it.
- **New tool**: `Tools.def(id, {...})`, add it to `Toolbox.groups` and give it an icon in `TOOL_ICONS`. Add a shortcut in `editor.js` if it needs one.

## Check your work in a real browser

Syntax checks aren't enough here: most bugs show up only when drawing, reloading or exporting. Open `index.html` in Chrome, or drive it headless, and:

1. Use the feature with real mouse or touch events, and look at a screenshot.
2. Save and reload (`loadJSON(JSON.stringify(docJSON()))`), and undo.
3. Export PNG and PSD if the feature draws anything. Exports have caught what the screen didn't.
4. Try a tablet size (820 × 1180 and 1180 × 820) with touch on.
5. Run `node tools/test-ui.mjs` if you touched menus, touch, the palette or Help. It also checks that every help step points at something real.
6. Run `npm test` in `mcp/` if you touched logos, export or page code.

Say plainly what you couldn't test. Emulation can't show a real tablet's own browser menus, for example.

## Docs

Update `HOW-TO-USE.txt` and `README.md` when behaviour changes. Add any new library to `THIRD-PARTY-NOTICES.md`.
