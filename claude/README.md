# Tee Studio inside Claude

This is the same app, published as a private page on claude.ai. Anyone who opens it there is already signed in with their own Claude account, so the page can ask Claude directly. There's no API key and no server, and each request uses that person's own plan.

Claude can only act through the design actions in `app/js/claude.js`, on the design that is open.

## Publish or update

From Claude Code, run `python3 claude/build.py`, then ask Claude to publish `claude/dist/page.html` as an Artifact with `app/styles.css`, `app/js/*.js` and `fonts/*.js` alongside it, using the same URL. It needs these capabilities: `{"sample": {"images": true}, "db": {}, "user": {}, "downloads": true}`.

Saved logos in `logos/` are left out on purpose, because they're private to your computer.

## Letting other people use it

The page starts private to you. To let someone in, use **Share** on the page. They sign in with their own account and see a consent prompt the first time, their usage counts on their plan, and their designs stay private to them, even from you.

## Differences from the offline copy

| | Offline or public site | Inside Claude |
|---|---|---|
| Ask Claude panel | No | Yes |
| Designs saved to | A folder, or the browser | Your Claude account |
| Exports | Into the folder, or downloads | Claude's save prompt; PSD comes inside a .zip because the prompt doesn't take .psd |
| Needs internet | No | Yes |

## Test

`node claude/test.mjs` runs the real page in Chrome with a stand-in for Claude that enforces its documented limits. It spends no Claude usage. It needs `npm install` in `mcp/` first.
