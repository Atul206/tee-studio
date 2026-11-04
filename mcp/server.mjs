#!/usr/bin/env node
/* Tee Studio logo MCP server: give an agent an image file, get a logo template in the app.
   The agent is the eyes: this server shows it the image with coordinates, draws what it describes with the app's
   own code, lays that over the source to compare, and writes the result into logos/. It calls no AI service
   and needs no API key. Runs the app in headless Chrome, so Chrome, Edge or Chromium must be installed. */
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const LOGOS = process.env.TEE_LOGOS_DIR ? path.resolve(process.env.TEE_LOGOS_DIR) : path.join(APP, 'logos');
const MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif'};
const MAX_FILE = 40 * 1024 * 1024;

/* ---------- the headless app ---------- */
function findChrome(){
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const fixed = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  }[process.platform] || [];
  for (const p of fixed) if (existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']){
    try { return execFileSync('which', [name], {encoding: 'utf8'}).trim(); } catch (e){}
  }
  throw new Error('Chrome, Edge or Chromium was not found. Install one, or set CHROME_PATH to its executable.');
}
let browser = null, pagePromise = null;
function appPage(){
  if (pagePromise) return pagePromise;
  pagePromise = (async () => {
    browser = await puppeteer.launch({executablePath: findChrome(), headless: true, args: ['--no-first-run', '--disable-gpu'], defaultViewport: {width: 1280, height: 900}});
    browser.on('disconnected', () => { browser = null; pagePromise = null; });
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('[page]', e.message));
    await page.goto(pathToFileURL(path.join(APP, 'index.html')).href, {waitUntil: 'load'});
    await page.addScriptTag({path: path.join(HERE, 'node_modules/imagetracerjs/imagetracer_v1.2.6.js')});
    await page.addScriptTag({path: path.join(HERE, 'page.js')});
    return page;
  })().catch(e => { pagePromise = null; throw e; });
  return pagePromise;
}
// one thing at a time: exports use the page's canvas
let queue = Promise.resolve();
const inPage = (fn, ...args) => {
  const run = queue.then(async () => (await appPage()).evaluate(fn, ...args));
  queue = run.catch(() => {});
  return run;
};
const closeBrowser = async () => { try { if (browser) await browser.close(); } catch (e){} };

/* ---------- specs ---------- */
const COLOUR = /^(#[0-9a-f]{3,8}|none|transparent|[a-z]{3,30}|rgba?\([\d.,\s%]+\))$/i;
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
const num = z.number().finite();
const colour = z.string().regex(COLOUR, 'Use a colour such as #ffffff');
const point = z.array(num).min(2).max(3);
const common = {name: z.string().max(80).optional()};
const paintable = {...common, fill: colour.optional(), stroke: colour.optional(), strokeWidth: num.min(0).optional()};
const type = {...common, fontFamily: z.string().max(60).optional(), fontSize: num.positive().optional(), fontWeight: z.number().int().min(100).max(900).optional(), fill: colour.optional()};
const ELEMENT = z.discriminatedUnion('type', [
  z.object({type: z.literal('path'), d: z.string().max(4_000_000).regex(PATH_D, 'Only SVG path commands and numbers'), fillRule: z.enum(['nonzero', 'evenodd']).optional(), cap: z.enum(['butt', 'round', 'square']).optional(), join: z.enum(['miter', 'round', 'bevel']).optional(), ...paintable}),
  z.object({type: z.literal('polyline'), points: z.array(point).min(2).max(20000), smooth: z.boolean().optional(), closed: z.boolean().optional(), ...paintable}),
  z.object({type: z.literal('circle'), cx: num, cy: num, r: num.positive(), ...paintable}),
  z.object({type: z.literal('dots'), points: z.array(point).min(1).max(20000), r: num.positive().optional(), fill: colour.optional(), name: common.name}),
  z.object({type: z.literal('text'), text: z.string().min(1).max(500), x: num, y: num, align: z.enum(['left', 'center', 'right']).optional(), angle: num.optional(), charSpacing: num.optional(), ...type}),
  z.object({type: z.literal('arcText'), text: z.string().min(1).max(500), cx: num, cy: num, r: num.positive(), startDeg: num, endDeg: num, direction: z.enum(['cw', 'ccw']).optional(), ...type}),
  z.object({type: z.literal('trace'), trace_id: z.string().max(40), fill: colour.optional()}),
]);
const SPEC = z.object({
  name: z.string().min(1).max(60),
  viewBox: z.array(num).length(4).describe('[x, y, width, height] framing the logo, in the same units as the elements'),
  widthIn: num.positive().max(48).optional().describe('Width in inches when added to a design. Default 10'),
  elements: z.array(ELEMENT).min(1).max(5000),
}).describe('The logo, drawn bottom to top. See the server instructions for each element.');

const REGION = z.object({x: num, y: num, w: num.positive(), h: num.positive()}).describe('Part of the image, in image pixels');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'logo';

async function checkSpec(spec){
  const fonts = await inPage(() => window.__logo.fonts());
  for (const e of spec.elements) if ((e.type === 'text' || e.type === 'arcText') && e.fontFamily && !fonts.includes(e.fontFamily)) throw new Error(`Font "${e.fontFamily}" is not bundled with the app. Use one of: ${fonts.join(', ')}`);
  return inPage(s => window.__logo.expand(s), spec);
}
// the user may not see images returned to the agent, so previews are also files they can open
async function writePreview(name, images){
  const dir = path.join(LOGOS, 'previews'), out = [];
  await fs.mkdir(dir, {recursive: true});
  for (const [suffix, data] of images){ if (!data) continue; const f = path.join(dir, `${slug(name)}${suffix}.png`); await fs.writeFile(f, Buffer.from(data, 'base64')); out.push(f); }
  return out;
}
async function readLogos(){
  await fs.mkdir(LOGOS, {recursive: true});
  const files = (await fs.readdir(LOGOS)).filter(f => f.endsWith('.json')).sort(), out = [];
  for (const f of files){ try { out.push({file: f, spec: JSON.parse(await fs.readFile(path.join(LOGOS, f), 'utf8'))}); } catch (e){ console.error('[logos] unreadable', f, e.message); } }
  return out;
}
// the app opens from file://, where it cannot read JSON, so logos reach it as a script
async function writeIndex(){
  const list = await readLogos();
  const body = list.map(l => `window.TEE_LOGOS.push(${JSON.stringify(l.spec)});`).join('\n');
  await fs.writeFile(path.join(LOGOS, 'logos.js'), `// Written by the logo MCP server from the .json files in this folder. Do not edit.\nwindow.TEE_LOGOS = window.TEE_LOGOS || [];\n${body}\n`);
  return list;
}

/* ---------- replies ---------- */
const text = t => ({type: 'text', text: t});
const image = data => ({type: 'image', data, mimeType: 'image/png'});
const safely = fn => async args => {
  try { return await fn(args); }
  catch (e){ return {isError: true, content: [text(String(e.issues ? JSON.stringify(e.issues) : e.message || e))]}; }
};

const INSTRUCTIONS = `Turns an image file into a logo template in Tee Studio (a T-shirt design app).

Workflow:
1. logo_load_source with the file. Look at the picture. A selfie or mirror photo reads backwards: load it again with flip "horizontal". Read the wording exactly.
2. Choose how to draw it:
   - Clean, flat artwork (PNG, SVG, a scan): logo_autotrace, then use its trace_id. Add real text elements where you can match the font, so the words stay editable.
   - Photos, or fine line work that traces badly: draw it yourself. Use logo_view_source to zoom in with a coordinate grid, and read positions off the grid.
3. logo_preview with a spec. The overlay image draws your logo in red over the source. Fix what does not line up and preview again. Zoom in with "region" for detail. Two or three rounds is normal.
4. logo_save when it matches. It appears under Assets > Logos after the app is refreshed. logo_export writes PNG, SVG or PSD files if wanted.

Editing: logo_get shows a saved logo and numbers its elements. logo_edit changes them without redrawing, and undo restores the version before the last change.
Designing from a brief or reference: no source is needed. Preview with a plain spec. A reference is for inspiration unless the user asks for a copy, so make it original rather than tracing it.
Showing the user: logo_preview and logo_edit write PNG files and give their paths, because the user may not see images returned to you. Name the file so they can open it.

Rights: a saved logo can end up printed and sold. If a logo looks like it belongs to someone else and the user has not said they own it or have permission, ask before building it. Do not offer to publish logos.

Bundled fonts: Bebas Neue, Anton, Oswald, Montserrat, Inter, Pacifico, Lobster, Permanent Marker, Bungee, Playfair Display, Rubik Mono One, Caveat.

Tell the user about anything you interpreted rather than copied: unclear wording, the closest font, and damage in a photo you drew as clean (cracks in a print, folds).

Spec: {name, viewBox: [x, y, w, h], widthIn?, elements: [...]}, drawn bottom to top. Use source image pixels as units so the overlay lines up, and frame the logo with viewBox.
Elements:
- path: {type:"path", d, fill, stroke, strokeWidth, fillRule, cap, join}
- polyline: {type:"polyline", points:[[x,y],...], smooth, closed, fill, stroke, strokeWidth} (smooth runs a curve through the points)
- circle: {type:"circle", cx, cy, r, fill, stroke, strokeWidth}
- dots: {type:"dots", points:[[x,y] or [x,y,r],...], r, fill} (many small filled circles)
- text: {type:"text", text, x, y, align, angle, charSpacing, fontFamily, fontSize, fontWeight, fill} (x, y = anchor, vertically centred)
- arcText: {type:"arcText", text, cx, cy, r, startDeg, endDeg, direction, fontFamily, fontSize, fontWeight, fill}. Angles: 0 = right, 90 = down. direction "cw" runs clockwise over the top, letters outside the circle, r = baseline. "ccw" runs along the bottom, letters inside. Letters are spaced to fill the arc.
- trace: {type:"trace", trace_id, fill?} (everything logo_autotrace found; fill recolours it)
A photo's colours are not the artwork's: use clean values (#ffffff, not a grey-blue from the picture).`;

const server = new McpServer({name: 'tee-studio-logo', version: '0.1.0'}, {instructions: INSTRUCTIONS});

server.registerTool('logo_load_source', {
  title: 'Load an image',
  description: 'Load an image file (PNG, JPEG, WebP, GIF, BMP, SVG, AVIF) as the source for a logo. Returns a source_id and the picture with a coordinate grid. Flip or rotate here if the picture is mirrored or sideways: all coordinates afterwards refer to the corrected image.',
  inputSchema: {file: z.string().describe('Path to the image file'), flip: z.enum(['none', 'horizontal', 'vertical', 'both']).optional(), rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional()},
  annotations: {readOnlyHint: true},
}, safely(async ({file, flip, rotate}) => {
  const p = path.resolve(file), mime = MIME[path.extname(p).toLowerCase()];
  if (!mime) throw new Error(`Not a supported image type: ${path.extname(p) || file}. Use ${Object.keys(MIME).join(', ')}`);
  const stat = await fs.stat(p).catch(() => { throw new Error(`File not found: ${p}`); });
  if (stat.size > MAX_FILE) throw new Error('That image is over 40 MB');
  const url = `data:${mime};base64,${(await fs.readFile(p)).toString('base64')}`;
  const info = await inPage((u, o) => window.__logo.load(u, o), url, {flip, rotate});
  const v = await inPage((id) => window.__logo.view(id, {}), info.source_id);
  return {content: [text(`${JSON.stringify(info)}\nGrid labels are image pixels.`), image(v.image)]};
}));

server.registerTool('logo_view_source', {
  title: 'Zoom into the image',
  description: 'See part of a loaded image enlarged, with a grid labelled in image pixels. Use it to read exact positions before drawing.',
  inputSchema: {source_id: z.string(), region: REGION.optional(), grid: z.boolean().optional(), contrast: num.min(0.2).max(5).optional().describe('1 = unchanged')},
  annotations: {readOnlyHint: true},
}, safely(async ({source_id, region, grid, contrast}) => {
  const v = await inPage((id, o) => window.__logo.view(id, o), source_id, {region, grid, contrast});
  return {content: [text(JSON.stringify({region: v.region, scale: v.scale})), image(v.image)]};
}));

server.registerTool('logo_autotrace', {
  title: 'Trace flat artwork automatically',
  description: 'Vectorise flat artwork by colour. Returns a trace_id to use as {type:"trace", trace_id} in a spec, plus its viewBox. Best on clean art; on photos it follows every shadow, so draw those by hand instead. The background colour is left out unless keep_background is true.',
  inputSchema: {source_id: z.string(), region: REGION.optional(), colors: z.number().int().min(2).max(32).optional().describe('Colours in the artwork, counting the background. Default 2'), detail: num.min(0.1).max(10).optional().describe('Error allowed, in pixels: lower follows closer. Default 1'), keep_background: z.boolean().optional()},
}, safely(async ({source_id, region, colors, detail, keep_background}) => {
  const t = await inPage((id, o) => window.__logo.trace(id, o), source_id, {region, colors, detail, keepBackground: keep_background});
  if (!t.colours.length) throw new Error('Nothing was found apart from the background. Try more colors, or keep_background.');
  const spec = {name: 'Trace', viewBox: t.viewBox, elements: [{type: 'trace', trace_id: t.trace_id}]};
  const p = await inPage((s, o) => window.__logo.preview(s, o), spec, {source_id, background: '#808080'});
  return {content: [text(JSON.stringify(t)), image(p.clean), image(p.overlay)]};
}));

server.registerTool('logo_preview', {
  title: 'Draw a logo and compare it',
  description: 'Draw a spec with the app\'s own renderer. Returns the logo alone and, with source_id, laid in red over the source with a coordinate grid. Nothing is saved.',
  inputSchema: {spec: SPEC, source_id: z.string().optional(), region: REGION.optional().describe('Zoom in on part of the logo'), background: colour.optional().describe('Behind the clean render. Default #111111')},
  annotations: {readOnlyHint: true},
}, safely(async ({spec, source_id, region, background}) => {
  await checkSpec(spec);
  const p = await inPage((s, o) => window.__logo.preview(s, o), spec, {source_id, region, background});
  const files = await writePreview(spec.name, [['', p.clean], ['-overlay', p.overlay]]);
  const out = [text(`Logo alone (for the user: ${files[0]}):`), image(p.clean)];
  if (p.overlay) out.push(text('Red = your logo, over the source:'), image(p.overlay));
  return {content: out};
}));

server.registerTool('logo_save', {
  title: 'Save as a template',
  description: 'Save a spec as a logo template. It appears in the app under Assets > Logos once the page is refreshed. Stored as logos/<name>.json. Traces are written out in full.',
  inputSchema: {spec: SPEC, overwrite: z.boolean().optional()},
}, safely(async ({spec, overwrite}) => {
  const full = await checkSpec(spec), file = slug(spec.name) + '.json', target = path.join(LOGOS, file);
  await fs.mkdir(LOGOS, {recursive: true});
  if (existsSync(target) && !overwrite) throw new Error(`A logo called "${spec.name}" already exists (${file}). Pass overwrite: true to replace it.`);
  await fs.writeFile(target, JSON.stringify(full));
  const list = await writeIndex();
  return {content: [text(`Saved "${spec.name}" to ${target}. Refresh Tee Studio and find it under Assets > Logos. Templates now: ${list.map(l => l.spec.name).join(', ')}`)]};
}));

server.registerTool('logo_list', {
  title: 'List saved logos', description: 'The saved logo templates.', inputSchema: {}, annotations: {readOnlyHint: true},
}, safely(async () => {
  const list = await readLogos();
  return {content: [text(list.length ? JSON.stringify(list.map(l => ({name: l.spec.name, file: l.file, elements: l.spec.elements.length, widthIn: l.spec.widthIn || 10}))) : 'No logos saved yet.')]};
}));

// what an element is, short enough to read: traced paths run to thousands of characters
const describe = (e, i) => { const o = {index: i}; for (const [k, v] of Object.entries(e)){ if (k === 'd' && v.length > 200) o.d = `(${v.length} characters)`; else if (k === 'points' && v.length > 12) o.points = `(${v.length} points)`; else o[k] = v; } return o; };
const savedPath = name => path.join(LOGOS, slug(name) + '.json');
async function readSaved(name){
  const p = savedPath(name);
  if (!existsSync(p)) throw new Error(`No saved logo called "${name}". logo_list shows what is saved.`);
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

server.registerTool('logo_get', {
  title: 'Read a saved logo',
  description: 'See a saved logo: its picture, its settings, and its elements numbered for logo_edit.',
  inputSchema: {name: z.string(), background: colour.optional().describe('Behind the picture. Default #111111')},
  annotations: {readOnlyHint: true},
}, safely(async ({name, background}) => {
  const spec = await readSaved(name);
  const p = await inPage((s, o) => window.__logo.preview(s, o), spec, {background});
  const files = await writePreview(spec.name, [['', p.clean]]);
  return {content: [text(JSON.stringify({name: spec.name, viewBox: spec.viewBox, widthIn: spec.widthIn || 10, picture: files[0], elements: spec.elements.map(describe)}, null, 1)), image(p.clean)]};
}));

server.registerTool('logo_edit', {
  title: 'Change a saved logo',
  description: 'Change a saved logo without redrawing it. Everything given is applied in this order: update, remove, add, recolor, then rename and settings. Element numbers are those from logo_get. Set dry_run to look before saving. undo restores the version before the last saved change.',
  inputSchema: {
    name: z.string(),
    update: z.array(z.object({index: z.number().int().min(0), changes: z.record(z.string(), z.unknown())})).optional().describe('Fields to change on an element, e.g. {index: 3, changes: {text: "2027", fill: "#ff7a00"}}'),
    remove: z.array(z.number().int().min(0)).optional(),
    add: z.array(ELEMENT).optional().describe('New elements, drawn on top'),
    recolor: z.array(z.object({from: colour, to: colour})).optional().describe('Swap a colour everywhere in the logo'),
    rename: z.string().min(1).max(60).optional(),
    viewBox: z.array(num).length(4).optional(),
    widthIn: num.positive().max(48).optional(),
    dry_run: z.boolean().optional(),
    undo: z.boolean().optional(),
    background: colour.optional().describe('Behind the returned picture. Default #111111'),
  },
}, safely(async ({name, update, remove, add, recolor, rename, viewBox, widthIn, dry_run, undo, background}) => {
  const target = savedPath(name), prev = target + '.prev';
  let spec = await readSaved(name);
  if (undo){
    if (!existsSync(prev)) throw new Error(`"${name}" has no earlier version to go back to.`);
    const was = await fs.readFile(target, 'utf8'); spec = JSON.parse(await fs.readFile(prev, 'utf8'));
    await fs.writeFile(target, JSON.stringify(spec)); await fs.writeFile(prev, was); await writeIndex();
  } else {
    const before = JSON.stringify(spec), out = JSON.parse(before);
    for (const u of update || []){ if (!out.elements[u.index]) throw new Error(`There is no element ${u.index}. logo_get lists them.`); Object.assign(out.elements[u.index], u.changes); }
    if (remove) out.elements = out.elements.filter((_, i) => !remove.includes(i));
    if (add) out.elements.push(...add);
    const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
    for (const c of recolor || []) out.elements.forEach(e => { for (const k of ['fill', 'stroke']) if (same(e[k], c.from)) e[k] = c.to; });
    if (rename) out.name = rename;
    if (viewBox) out.viewBox = viewBox;
    if (widthIn) out.widthIn = widthIn;
    spec = SPEC.parse(out); await checkSpec(spec);
    if (!dry_run){
      const to = savedPath(spec.name);
      if (to !== target && existsSync(to)) throw new Error(`A logo called "${spec.name}" already exists.`);
      await fs.writeFile(to + '.prev', before); await fs.writeFile(to, JSON.stringify(spec));
      if (to !== target){ await fs.unlink(target); await fs.rm(prev, {force: true}); }
      await writeIndex();
    }
  }
  const p = await inPage((s, o) => window.__logo.preview(s, o), spec, {background});
  const files = await writePreview(spec.name, [[dry_run ? '-draft' : '', p.clean]]);
  const said = dry_run ? 'Not saved: this is how it would look.' : undo ? 'Went back to the earlier version.' : 'Saved. Refresh Tee Studio to get the new version; designs that already use the logo keep their copy.';
  return {content: [text(`${said} Picture: ${files[0]}`), image(p.clean)]};
}));

server.registerTool('logo_delete', {
  title: 'Delete a saved logo', description: 'Delete a saved logo template by name. Designs already using it keep their copy.',
  inputSchema: {name: z.string()}, annotations: {destructiveHint: true},
}, safely(async ({name}) => {
  const file = slug(name) + '.json', target = path.join(LOGOS, file);
  if (!existsSync(target)) throw new Error(`No saved logo called "${name}"`);
  await fs.unlink(target); await fs.rm(target + '.prev', {force: true}); await writeIndex();
  return {content: [text(`Deleted "${name}".`)]};
}));

server.registerTool('logo_export', {
  title: 'Export a saved logo',
  description: 'Write a saved logo to logos/exports/ as a transparent PNG, an SVG, or a layered PSD, on a page exactly its size.',
  inputSchema: {name: z.string(), format: z.enum(['png', 'svg', 'psd']), width_in: num.positive().max(48).optional().describe('Width in inches. Default: the logo\'s own width'), dpi: z.number().int().min(36).max(1200).optional().describe('Default 300')},
}, safely(async ({name, format, width_in, dpi}) => {
  const file = slug(name) + '.json', p = path.join(LOGOS, file);
  if (!existsSync(p)) throw new Error(`No saved logo called "${name}"`);
  const spec = JSON.parse(await fs.readFile(p, 'utf8'));
  const r = await inPage((s, o) => window.__logo.exportLogo(s, o), spec, {format, dpi: dpi || 300, widthIn: width_in || spec.widthIn || 10});
  const dir = path.join(LOGOS, 'exports'), out = path.join(dir, `${slug(name)}.${format}`);
  await fs.mkdir(dir, {recursive: true}); await fs.writeFile(out, Buffer.from(r.base64, 'base64'));
  return {content: [text(`Wrote ${out} (${(+r.width_in).toFixed(2)} × ${(+r.height_in).toFixed(2)} in).`)]};
}));

server.registerPrompt('create_logo', {
  title: 'Create a logo from an image',
  description: 'Turn an image file into a Tee Studio logo template',
  argsSchema: {file: z.string().describe('Path to the image file'), name: z.string().optional().describe('Name for the template')},
}, ({file, name}) => ({messages: [{role: 'user', content: {type: 'text', text: `Create a Tee Studio logo template from the image at ${file}${name ? `, named "${name}"` : ''}. Follow the tee-studio-logo workflow: load it, check whether it is mirrored, trace or draw it, compare the overlay until it lines up, then save it. Tell me what you interpreted rather than copied.`}}]}));

process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.stdin.on('close', async () => { await closeBrowser(); process.exit(0); });
await server.connect(new StdioServerTransport());
