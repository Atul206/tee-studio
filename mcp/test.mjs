// End-to-end test through a real MCP client: node test.mjs [photo to view]
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'logo-mcp-'));
const logos = path.join(work, 'logos');
const svg = path.join(work, 'art.svg');
await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fff"/><circle cx="130" cy="150" r="90" fill="#e11d48"/><path d="M230 60h120v180h-120z M260 100v100h60v-100z" fill="#1d4ed8" fill-rule="evenodd"/></svg>');

const client = new Client({name: 'test', version: '1'});
await client.connect(new StdioClientTransport({command: process.execPath, args: [path.join(here, 'server.mjs')], env: {...process.env, TEE_LOGOS_DIR: logos}, stderr: 'inherit'}));
const call = async (name, args = {}) => client.callTool({name, arguments: args});
const say = (n, v) => console.log(`ok  ${n}${v === undefined ? '' : ': ' + v}`);
const firstText = r => r.content.find(c => c.type === 'text').text;
const saveImage = async (r, base) => { let i = 0; for (const c of r.content) if (c.type === 'image') await fs.writeFile(path.join(process.env.OUT || work, `${base}-${i++}.png`), Buffer.from(c.data, 'base64')); };

const tools = (await client.listTools()).tools.map(t => t.name);
assert.deepEqual(tools.sort(), ['logo_autotrace', 'logo_delete', 'logo_edit', 'logo_export', 'logo_get', 'logo_list', 'logo_load_source', 'logo_preview', 'logo_save', 'logo_view_source']);
say('tools', tools.length);
assert.ok((await client.getInstructions()).includes('Workflow'));
const prompt = await client.getPrompt({name: 'create_logo', arguments: {file: '/x/y.png'}});
assert.ok(prompt.messages[0].content.text.includes('/x/y.png')); say('prompt');

// bad input gives a clear error, not a crash
let r = await call('logo_load_source', {file: path.join(work, 'nope.png')}); assert.ok(r.isError && /not found/.test(firstText(r))); say('missing file');
r = await call('logo_load_source', {file: path.join(here, 'package.json')}); assert.ok(r.isError && /supported/.test(firstText(r))); say('non-image refused');

r = await call('logo_load_source', {file: svg});
const src = JSON.parse(firstText(r).split('\n')[0]); assert.equal(src.width, 400); assert.ok(r.content.some(c => c.type === 'image')); say('load', JSON.stringify(src));
const mirrored = JSON.parse(firstText(await call('logo_load_source', {file: svg, rotate: 90})).split('\n')[0]); assert.equal(mirrored.width, 300); say('rotate');
r = await call('logo_view_source', {source_id: src.source_id, region: {x: 200, y: 50, w: 100, h: 100}}); assert.ok(r.content.some(c => c.type === 'image')); say('view');
r = await call('logo_view_source', {source_id: 'src-999'}); assert.ok(r.isError); say('unknown source');

// autotrace
r = await call('logo_autotrace', {source_id: src.source_id, colors: 3}); assert.ok(!r.isError, firstText(r));
const tr = JSON.parse(firstText(r)); assert.equal(tr.colours.length, 2, 'background left out: ' + firstText(r));
const near = (hex, want) => [1, 3, 5].every(i => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16)) < 24);
for (const want of ['#e11d48', '#1d4ed8']) assert.ok(tr.colours.some(c => near(c.fill, want)), `${want} found in ${firstText(r)}`); say('autotrace', firstText(r)); await saveImage(r, 'trace');

// the whole picture came through: no colour covers it, and each sits where it should
const pixels = await call('logo_preview', {spec: {name: 'T', viewBox: [0, 0, 400, 300], elements: [{type: 'trace', trace_id: tr.trace_id}]}, background: '#ffffff'});
assert.ok(!pixels.isError); await saveImage(pixels, 'traceonly');

// small art with a transparent background and a thin line
const png = path.join(work, 'clear.svg');
await fs.writeFile(png, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><path d="M10 110L60 10L110 110" fill="none" stroke="#059669" stroke-width="6"/></svg>');
const cs = JSON.parse(firstText(await call('logo_load_source', {file: png})).split('\n')[0]);
r = await call('logo_autotrace', {source_id: cs.source_id, colors: 2}); assert.ok(!r.isError, firstText(r));
assert.ok(JSON.parse(firstText(r)).colours.some(c => near(c.fill, '#059669')), 'transparent art: ' + firstText(r)); say('autotrace transparent', firstText(r)); await saveImage(r, 'tracethin');

// a hand-written spec using every element
const spec = {name: 'Test Logo!', viewBox: [0, 0, 400, 300], widthIn: 6, elements: [
  {type: 'trace', trace_id: tr.trace_id},
  {type: 'circle', cx: 130, cy: 150, r: 110, stroke: '#111111', strokeWidth: 2},
  {type: 'polyline', points: [[230, 270], [290, 285], [350, 270]], smooth: true, stroke: '#111111', strokeWidth: 3},
  {type: 'dots', points: [[230, 270], [350, 270, 5]], r: 3, fill: '#111111'},
  {type: 'text', text: 'FLAT', x: 290, y: 150, fontFamily: 'Anton', fontSize: 24, fill: '#111111'},
  {type: 'arcText', text: 'OVER THE TOP', cx: 130, cy: 150, r: 113, startDeg: 215, endDeg: 325, fontFamily: 'Montserrat', fontWeight: 700, fontSize: 14, fill: '#111111'},
  {type: 'arcText', text: 'ALONG THE BOTTOM', cx: 130, cy: 150, r: 125, startDeg: 145, endDeg: 35, direction: 'ccw', fontSize: 12, fill: '#111111'},
]};
r = await call('logo_preview', {spec, source_id: src.source_id, background: '#ffffff'}); assert.ok(!r.isError, firstText(r)); assert.equal(r.content.filter(c => c.type === 'image').length, 2); say('preview'); await saveImage(r, 'preview');
r = await call('logo_preview', {spec, region: {x: 200, y: 100, w: 150, h: 100}}); assert.ok(!r.isError, firstText(r)); say('preview zoom');

// refused specs
r = await call('logo_preview', {spec: {...spec, elements: [{type: 'path', d: 'M0 0"><script>'}]}}); assert.ok(r.isError); say('bad path refused');
r = await call('logo_preview', {spec: {...spec, elements: [{type: 'path', d: 'M0 0L1 1', fill: 'url(x)"'}]}}); assert.ok(r.isError); say('bad colour refused');
r = await call('logo_preview', {spec: {...spec, elements: [{type: 'text', text: 'x', x: 0, y: 0, fontFamily: 'Comic Sans'}]}}); assert.ok(r.isError && /bundled/.test(firstText(r))); say('unknown font refused');

// save, list, overwrite guard, export
r = await call('logo_save', {spec}); assert.ok(!r.isError, firstText(r)); say('save', firstText(r));
const saved = JSON.parse(await fs.readFile(path.join(logos, 'test-logo.json'), 'utf8'));
assert.ok(saved.elements.every(e => e.type !== 'trace'), 'traces written out');
const script = await fs.readFile(path.join(logos, 'logos.js'), 'utf8'); assert.ok(script.includes('TEE_LOGOS.push')); say('index written');
r = await call('logo_save', {spec}); assert.ok(r.isError && /exists/.test(firstText(r))); say('overwrite guard');
assert.ok(firstText(await call('logo_list')).includes('Test Logo!')); say('list');
for (const format of ['png', 'svg', 'psd']){
  r = await call('logo_export', {name: 'Test Logo!', format, dpi: 100}); assert.ok(!r.isError, firstText(r));
  const f = path.join(logos, 'exports', 'test-logo.' + format), s = await fs.stat(f); assert.ok(s.size > 500, format); say('export ' + format, s.size + ' bytes');
}
const head = (await fs.readFile(path.join(logos, 'exports', 'test-logo.png'))); assert.equal(head.toString('latin1', 1, 4), 'PNG');
const w = head.readUInt32BE(16); assert.ok(Math.abs(w - 600) <= 2, 'png width ' + w); say('png is 6 in at 100 dpi', w);
assert.equal((await fs.readFile(path.join(logos, 'exports', 'test-logo.psd'))).toString('latin1', 0, 4), '8BPS'); say('psd signature');
// reading and editing a saved logo
r = await call('logo_get', {name: 'Test Logo!'}); assert.ok(!r.isError, firstText(r));
const got = JSON.parse(firstText(r)); assert.ok(got.elements.some(e => e.text === 'FLAT')); assert.ok(r.content.some(c => c.type === 'image')); say('get', got.elements.length + ' elements');
await fs.stat(got.picture); say('preview file for the user');
const flat = got.elements.find(e => e.text === 'FLAT').index;
const textOf = async () => JSON.parse(await fs.readFile(path.join(logos, 'test-logo.json'), 'utf8')).elements[flat].text;
r = await call('logo_edit', {name: 'Test Logo!', update: [{index: flat, changes: {text: 'NEW'}}], dry_run: true}); assert.ok(!r.isError, firstText(r)); assert.equal(await textOf(), 'FLAT'); say('dry run changes nothing');
r = await call('logo_edit', {name: 'Test Logo!', update: [{index: flat, changes: {text: 'NEW', fill: '#ff7a00'}}], recolor: [{from: '#111111', to: '#222222'}]}); assert.ok(!r.isError, firstText(r)); assert.equal(await textOf(), 'NEW'); say('edit');
r = await call('logo_edit', {name: 'Test Logo!', undo: true}); assert.ok(!r.isError, firstText(r)); assert.equal(await textOf(), 'FLAT'); say('undo');
r = await call('logo_edit', {name: 'Test Logo!', update: [{index: 0, changes: {d: 'M0 0"><script>'}}]}); assert.ok(r.isError); assert.equal(await textOf(), 'FLAT'); say('unsafe edit refused');
r = await call('logo_edit', {name: 'Test Logo!', update: [{index: 999, changes: {}}]}); assert.ok(r.isError && /no element/.test(firstText(r))); say('bad index');
r = await call('logo_edit', {name: 'Test Logo!', add: [{type: 'circle', cx: 10, cy: 10, r: 5, fill: '#00ff00'}], remove: [flat], rename: 'Renamed'}); assert.ok(!r.isError, firstText(r));
assert.ok(firstText(await call('logo_list')).includes('Renamed')); assert.ok(!(await fs.readFile(path.join(logos, 'logos.js'), 'utf8')).includes('Test Logo!')); say('add, remove, rename');
r = await call('logo_edit', {name: 'Renamed', rename: 'Test Logo!'}); assert.ok(!r.isError, firstText(r));

r = await call('logo_delete', {name: 'Test Logo!'}); assert.ok(!r.isError); assert.ok(firstText(await call('logo_list')).includes('No logos')); say('delete');

await client.close();
await fs.rm(work, {recursive: true, force: true});
console.log('all passed');
process.exit(0);
