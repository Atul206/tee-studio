# Tee Studio logo MCP server

Give an AI agent an image file and it builds a logo template for Tee Studio: real vectors and editable text, in **Assets > Logos**.

The agent does the seeing. This server shows it the image with a coordinate grid, draws what it describes using the app's own code, lays that in red over the source so it can correct itself, and saves the result. It calls no AI service and needs no API key.

Needs Node 18 or newer and Chrome, Edge or Chromium installed. Set `CHROME_PATH` if the browser isn't found.

## Set up

```bash
cd mcp
npm install
```

**Claude Code:** open Claude Code in the Tee Studio folder. `.mcp.json` is already there, so approve the `tee-studio-logo` server when asked. To use it from any folder:

```bash
claude mcp add tee-studio-logo -- node /full/path/to/tee-studio/mcp/server.mjs
```

**Claude Desktop or another MCP client:** add this to its config, with your real path:

```json
{"mcpServers": {"tee-studio-logo": {"command": "node", "args": ["/full/path/to/tee-studio/mcp/server.mjs"]}}}
```

## Use it

Just ask:

> Make a logo template from ~/Downloads/shirt-photo.jpg

Or use the prompt: `/mcp__tee-studio-logo__create_logo` with the file path. In this repo the `/tee-studio` skill also guides Claude through designing from a brief and editing. When it's saved, refresh Tee Studio and find it under Assets > Logos.

## Tools

| Tool | What it does |
|---|---|
| `logo_load_source` | Loads an image, flipping or rotating it if it's mirrored or sideways |
| `logo_view_source` | Zooms in with a grid labelled in image pixels |
| `logo_autotrace` | Vectorises flat artwork by colour |
| `logo_preview` | Draws a spec, alone and in red over the source |
| `logo_save` | Saves it as a template |
| `logo_get` | Shows a saved logo with its parts numbered |
| `logo_edit` | Changes text, colours, size or parts of a saved logo without redrawing it, with a dry run and one step of undo |
| `logo_list`, `logo_delete` | Manage saved templates |
| `logo_export` | Writes a transparent PNG, SVG or layered PSD to `logos/exports/` |

The spec format is in the server's instructions, which clients pass to the agent, and at the top of `app/js/logos.js`.

## Good to know

- **Flat art vs photos.** Auto-trace suits clean artwork. On a photo it follows shadows and folds, so the agent should draw from the grid instead. Results from a photo are the agent's interpretation: check the wording, and use the original artwork for printing if you have it.
- **Fonts.** Text uses the 12 fonts bundled with the app. A logo in any other font gets the closest match, or can be traced as shapes, which stops it being editable.
- **Your responsibility.** Only make templates of logos you own or have permission to use. This tool will trace any image you give it, and it can't tell who owns a logo. Printing or selling someone else's logo may break trademark or copyright law.
- **Privacy.** Templates stay in `logos/`, which git ignores, so a company's logo is never published by accident. To put one on your public site, remove `logos/*` from `.gitignore` and commit it, if you have the right to use that logo.
- **Files.** The server reads only the image files it's given and writes only inside `logos/`. Set `TEE_LOGOS_DIR` to use another folder.

## Test

```bash
npm test
```

This runs the whole loop through a real MCP client, using a throwaway folder.
