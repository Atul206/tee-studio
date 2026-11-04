// Tests the copy of Tee Studio that runs inside Claude: the real page and panel in Chrome, with a stand-in for Claude's
// viewer that enforces its documented limits. It spends no Claude usage. Run: node claude/test.mjs (needs mcp/ installed).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const puppeteer = createRequire(path.join(ROOT, 'mcp/package.json'))('puppeteer-core');
const OUT = process.env.OUT || fs.mkdtempSync('/tmp/teeclaude-');
execFileSync('python3', [path.join(ROOT, 'claude/build.py')]);
// the page as Claude's publish step wraps it
const harness = path.join(ROOT, '_claude_test.html');
fs.writeFileSync(harness, '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(path.join(ROOT, 'claude/dist/page.html'), 'utf8') + '</body></html>');

const fake = () => {
  const store = JSON.parse(window.name || '{}');   // survives a reload, like the real thing
  const persist = () => { window.name = JSON.stringify(store); };
  const log = window.__fake = {calls: [], saves: [], script: null, largest: 0};
  const snap = (id, v) => ({id, exists: v !== undefined, data: () => v === undefined ? undefined : JSON.parse(JSON.stringify(v))});
  const docRef = p => ({
    get: async () => snap(p.split('/').pop(), store[p]),
    set: async d => { const n = new Blob([JSON.stringify(d)]).size; log.largest = Math.max(log.largest, n); if (n > 262144) throw {code: 'invalid_argument', message: 'over 256 KiB'}; store[p] = d; persist(); },
    delete: async () => { delete store[p]; persist(); },
  });
  const db = {
    collection: c => {
      if (c.split('/').length % 2 === 0) throw new TypeError('collection paths have odd segments');
      return {
        doc: id => { if (!/^[\w\-.~:@+]+$/.test(id)) throw new TypeError('bad segment ' + id); return docRef(c + '/' + id); },
        where: (f, op, v) => ({get: async () => ({docs: Object.keys(store).filter(k => k.startsWith(c + '/') && store[k][f] === v).map(k => snap(k.split('/').pop(), store[k]))})}),
      };
    },
  };
  const sample = async (input, opts = {}) => {
    if (opts.signal && !(opts.signal instanceof AbortSignal)) throw {code: 'invalid_request', message: 'signal'};
    if (!Array.isArray(input) || input[0].role !== 'user' || input[input.length - 1].role !== 'user') throw {code: 'invalid_request', message: 'turns must start and end on user'};
    if (input.some(t => !t.content)) throw {code: 'invalid_request', message: 'empty turn'};
    const bytes = new Blob(input.map(t => t.content)).size; if (bytes > 262144) throw {code: 'prompt_too_large', message: 'too big'};
    if (opts.cache && opts.tools) throw {code: 'invalid_request', message: 'cache with tools'};
    if (opts.images && opts.images.length > 5) throw {code: 'image_rejected', message: 'too many'};
    for (const t of opts.tools || []){
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(t.name) || t.description.length > 1024 || JSON.stringify(t.inputSchema).length > 4096) throw {code: 'invalid_request', message: 'tool too large'};
    }
    log.calls.push({bytes, turns: input.length, last: input[input.length - 1].content, tier: opts.modelTier, images: (opts.images || []).map(b => b.type), first: input[0].content.slice(0, 60)});
    const s = log.script; if (!s) throw {code: 'upstream_error', message: 'no script'};
    if (s.fail) throw s.fail;
    if (s.hang){ await new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej({code: 'cancelled', message: 'stop', text: 'Partly'}))); }
    for (const ops of s.rounds || []){
      const r = await opts.tools[0].execute({ops}, {signal: new AbortController().signal});
      if (new Blob([r]).size > 32768) throw {code: 'invalid_request', message: 'tool result over 32 KB'};
      log.lastResult = JSON.parse(r);
    }
    opts.onText && opts.onText({text: s.text, delta: s.text});
    return {text: s.text, truncated: false, modelTierApplied: 'default'};
  };
  sample.limits = async () => ({maxPromptBytes: 262144, images: {maxCount: 5, maxInputBytes: 2e7, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']}, tools: {maxCount: 16}});
  const OK = new Set('gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig'.split(' '));
  const downloads = {save: async ({filename, data}) => {
    if (!OK.has(filename.split('.').pop())) throw {code: 'rejected_extension', message: filename};
    const buf = await new Blob([data]).arrayBuffer(); let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    log.saves.push({filename, size: u.length, b64: btoa(bin)}); return {status: 'saved'};
  }};
  window.claude = {use: async n => ({sample, db, downloads, user: {id: async () => 'viewer1'}})[n] || null};
};

const say = (n, v) => console.log(`ok  ${n}${v === undefined ? '' : ': ' + JSON.stringify(v)}`);
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--allow-file-access-from-files']});
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1180, height: 820, hasTouch: false});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());   // the leave-page warning while a save is pending
  await page.evaluateOnNewDocument(fake);
  const open = async () => { await page.goto(pathToFileURL(harness).href, {waitUntil: 'load'}); await page.waitForFunction(() => document.querySelector('#d-ai textarea') && document.querySelector('.modal.home.on')); };
  await open();

  assert.ok(await page.$eval('#homeFolder', e => e.textContent.includes('Claude account'))); say('home says designs go to the Claude account');
  assert.equal(await page.$eval('#homeFolder', e => !!e.querySelector('#hfPick')), false); say('no folder picker inside Claude');

  await page.evaluate(() => { $('homeName').value = 'Club Tee'; $('homeNew').click(); });
  await page.waitForFunction(() => Store.open && !Store.pending);
  let st = await page.evaluate(async () => { await Store.writing; return {list: await Store.list(), status: $('docname').textContent}; });
  assert.equal(st.list[0].name, 'Club Tee'); assert.equal(st.list[0].where, 'cloud'); assert.ok(st.status.includes('Claude account'), st.status); say('new design saved to the account', st.status);

  await page.evaluate(() => run('askclaude')); await page.waitForFunction(() => $('d-ai').classList.contains('on'));
  await page.screenshot({path: path.join(OUT, 'panel-empty.png')});

  const ask = async (text, script) => {
    await page.evaluate(s => { __fake.script = s; }, script);
    await page.$eval('#aiText', (e, t) => { e.value = t; }, text);
    await page.click('#aiSend');
    await page.waitForFunction(() => !AskClaude.busy);
    return page.evaluate(() => ({log: [...document.querySelectorAll('.aimsg')].map(m => m.className.replace('aimsg ', '') + ': ' + m.textContent), act: [...document.querySelectorAll('.aiact')].map(a => a.textContent), n: canvas.getObjects().length, undo: !$('aiUndoRow').hidden, lastCall: __fake.calls[__fake.calls.length - 1], result: __fake.lastResult}));
  };

  // everything Claude can do, in one go
  const art = {op: 'add_artwork', name: 'Badge', x: 1, y: 6, width: 8, viewBox: [0, 0, 1000, 1000], elements: [
    {type: 'circle', cx: 500, cy: 500, r: 480, fill: 'none', stroke: '#ffffff', strokeWidth: 12},
    {type: 'arcText', text: 'PUNE RIDERS', cx: 500, cy: 500, r: 380, startDeg: 205, endDeg: 335, fontFamily: 'Anton', fontSize: 92, fill: '#ffffff'},
    {type: 'polyline', points: [[310, 590], [430, 430], [610, 430]], smooth: true, fill: 'none', stroke: '#ffffff', strokeWidth: 18},
    {type: 'dots', points: [[310, 590], [610, 430, 12]], r: 8, fill: '#ffffff'},
    {type: 'path', d: 'M100 800L900 800', fill: 'none', stroke: '#ffffff', strokeWidth: 10},
  ]};
  let r = await ask('Add a heading and a badge', {text: 'Added a heading and a badge.', rounds: [[
    {op: 'add_text', text: 'STAY WILD', x: 2, y: 1, font: 'Bebas Neue', size_pt: 72, bold: true, fill: '#ffffff'},
    {op: 'add_shape', shape: 'rect', x: 1, y: 4, w: 10, h: 1, fill: '#f97316', radius: 0.1},
    {op: 'add_shape', shape: 'star', x: 9, y: 0.5, w: 2, h: 2, points: 5, sharpness: 50, fill: '#facc15'},
    {op: 'add_shape', shape: 'line', x: 1, y: 5.5, w: 10, h: 0, stroke: '#ffffff', stroke_width: 2},
    art,
    {op: 'set_shirt', color: 'Navy'},
    {op: 'add_text', text: 'bad', font: 'Comic Sans'},
    {op: 'launch_rocket'},
    {op: 'add_artwork', viewBox: [0, 0, 1, 1], elements: [{type: 'path', d: 'M0 0"><script>'}]},
  ]]});
  assert.equal(r.n, 5); assert.ok(r.undo); assert.ok(r.act[0].includes('6 changes') && r.act[0].includes('3 failed'), r.act[0]);
  assert.deepEqual(r.result.results.filter(x => !x.ok).map(x => x.op), ['add_text', 'launch_rocket', 'add_artwork']);
  assert.ok(r.lastCall.first.includes('Tee Studio')); assert.equal(r.lastCall.tier, 'default');
  assert.equal(r.lastCall.images.length, 0, 'an empty design sends no picture');
  say('six actions applied, three bad ones reported, none crashed', r.act);
  let d = await page.evaluate(() => DesignActions.state());
  const heading = d.objects.find(o => o.text === 'STAY WILD'), badge = d.objects.find(o => o.name === 'Badge');
  assert.equal(heading.font, 'Bebas Neue'); assert.equal(heading.size_pt, 72); assert.equal(heading.x, 2); assert.equal(d.shirt, 'Navy');
  assert.ok(Math.abs(badge.x - 1) < 0.02 && Math.abs(badge.y - 6) < 0.02 && Math.abs(badge.w - 8) < 0.02, JSON.stringify(badge));
  const arc = badge.parts.find(p => p.text === 'PUNE RIDERS'); assert.ok(arc); say('positions and sizes are in inches', badge);
  await page.screenshot({path: path.join(OUT, 'panel-after.png')});

  // the next message sees the design, keeps the words of earlier turns, and can edit parts of a group
  r = await ask('Make the badge orange, change the name, center the heading', {text: 'Done.', rounds: [[
    {op: 'update', id: badge.id, color: '#ff7a00'},
    {op: 'update', id: arc.id, text: 'PUNE RIDERS 27'},
    {op: 'update', id: heading.id, center: 'x', opacity: 0.9, size_pt: 60},
    {op: 'order', id: heading.id, to: 'front'},
    {op: 'update', id: arc.id, x: 5},
  ]]});
  assert.equal(r.lastCall.images.length, 1, 'a picture of the design goes along'); assert.equal(r.lastCall.images[0], 'image/jpeg');
  assert.ok(r.lastCall.last.includes('STAY WILD')); assert.equal(r.lastCall.turns, 4);
  d = await page.evaluate(() => { const b = canvas.getObjects().find(o => o.name === 'Badge'); return {state: DesignActions.state(), fills: leafs([b]).map(k => [k.fill, k.strokeWidth ? k.stroke : null]), top: canvas.getObjects().slice(-1)[0].text}; });
  assert.ok(d.fills.every(([f, s]) => (!f || f === '#ff7a00' || f === '#000000') && (!s || s === '#ff7a00')), JSON.stringify(d.fills));
  assert.ok(d.state.objects.find(o => o.name === 'Badge').parts.some(p => p.text === 'PUNE RIDERS 27'));
  const h2 = d.state.objects.find(o => o.text === 'STAY WILD'); assert.ok(Math.abs(h2.x + h2.w / 2 - 6) < 0.1, JSON.stringify(h2)); assert.equal(h2.size_pt, 60); assert.equal(d.top, 'STAY WILD');
  assert.equal(r.result.results[4].ok, false); say('a follow-up edits the group, its parts and the order');

  // one Undo reverses the whole reply
  await page.click('#aiUndo'); await page.waitForFunction(() => $('aiUndoRow').hidden); await new Promise(res => setTimeout(res, 150));
  d = await page.evaluate(() => DesignActions.state());
  assert.ok(d.objects.find(o => o.name === 'Badge').parts.some(p => p.text === 'PUNE RIDERS')); assert.equal(d.objects.find(o => o.text === 'STAY WILD').size_pt, 72); say('Undo reverses one whole reply');

  // deleting, grouping, and page changes
  r = await ask('tidy up', {text: 'Tidied.', rounds: [[{op: 'delete', id: d.objects.find(o => o.type === 'path' && o.fill === '#facc15').id}]]});
  assert.equal(r.n, 4);
  d = await page.evaluate(() => DesignActions.state());
  const two = d.objects.filter(o => o.type === 'rect' || o.text).map(o => o.id);
  r = await ask('group', {text: 'Grouped.', rounds: [[{op: 'group', ids: two, name: 'Pair'}]]}); assert.equal(r.n, 3);
  d = await page.evaluate(() => DesignActions.state()); const pair = d.objects.find(o => o.name === 'Pair');
  r = await ask('ungroup and resize', {text: 'OK.', rounds: [[{op: 'ungroup', id: pair.id}, {op: 'set_page_size', width: 14, height: 18}]]}); assert.equal(r.n, 4);
  assert.deepEqual(await page.evaluate(() => [PA_IN.w, PA_IN.h, $('paHint').textContent]), [14, 18, '14 × 18 in']); say('delete, group, ungroup, page size');
  await page.evaluate(() => setPageSize(12, 16));

  // pictures attached by the person
  const png = path.join(OUT, 'tiny.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M/AQAxgYvhPDAAAf+kDAYk3ZiIAAAAASUVORK5CYII=', 'base64'));
  await (await page.$('#aiFile')).uploadFile(png);
  await page.waitForFunction(() => AskClaude.pics.length === 1);
  r = await ask('Put my picture at the bottom', {text: 'Placed.', rounds: [[{op: 'place_image', index: 0, x: 1, y: 14, width: 2}, {op: 'place_image', index: 3}]]});
  assert.equal(r.lastCall.images.length, 2); assert.ok(r.lastCall.last.includes('1 picture is attached')); assert.equal(r.result.results[1].ok, false);
  assert.ok(await page.evaluate(() => canvas.getObjects().some(o => o.type === 'image' && Math.abs(o.getBoundingRect(true, true).width - 40) < 1))); say('attached picture is sent, and placed at the asked size');

  // tier, stop and failures
  await page.click('#aiTier [data-t="quick"]');
  await page.evaluate(() => { __fake.script = {hang: true}; }); await page.$eval('#aiText', e => { e.value = 'long job'; }); await page.click('#aiSend');
  await page.waitForFunction(() => AskClaude.busy && $('aiSend').textContent === 'Stop'); await new Promise(res => setTimeout(res, 50));
  await page.click('#aiSend'); await page.waitForFunction(() => !AskClaude.busy);
  r = await page.evaluate(() => ({last: [...document.querySelectorAll('.aimsg')].slice(-1)[0].textContent, tier: __fake.calls.slice(-1)[0].tier, label: $('aiSend').textContent}));
  assert.equal(r.last, 'Partly'); assert.equal(r.tier, 'quick'); assert.equal(r.label, 'Send'); say('Stop works and keeps the partial reply; Fast mode is passed on');
  await page.click('#aiTier [data-t="default"]');
  for (const [code, words] of [['rate_limited', 'usage limit'], ['session_expired', 'sign in'], ['refused', 'declined'], ['not_granted', 'not allowed'], ['upstream_error', 'dropped'], ['something_new', 'went wrong']]){
    r = await ask('x', {fail: {code, message: 'm'}});
    assert.ok(r.log.slice(-1)[0].startsWith('error') && r.log.slice(-1)[0].includes(words), r.log.slice(-1)[0]);
  }
  say('every failure gives a plain message');
  r = await ask('after a failure', {text: 'Back.', rounds: []}); assert.equal(r.log.slice(-1)[0], 'claude: Back.'); say('the chat carries on after failures, and turn order stays valid');

  // what Claude sends stays within the page limits, even with many objects and a long chat
  await page.evaluate(() => { restoring = true; for (let i = 0; i < 400; i++) canvas.add(new fabric.Rect({left: i % 200, top: i % 300, width: 5, height: 5, fill: '#fff', name: 'Dot ' + i})); restoring = false; canvas.renderAll(); });
  r = await ask('big', {text: 'Fine.', rounds: [[{op: 'add_text', text: 'x'}]]}); assert.ok(r.lastCall.bytes < 262144, String(r.lastCall.bytes)); assert.ok(r.lastCall.turns <= 21); say('large design stays within the limits', {promptBytes: r.lastCall.bytes, turns: r.lastCall.turns});
  await page.evaluate(() => { restoring = true; canvas.getObjects().filter(o => /^Dot /.test(o.name || '')).forEach(o => canvas.remove(o)); restoring = false; canvas.renderAll(); snapshot(); });

  // a design over the 256 KB document limit is split, and comes back whole on another device
  const big = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 900; const x = c.getContext('2d'), img = x.createImageData(900, 900);
    for (let i = 0; i < img.data.length; i++) img.data[i] = Math.random() * 255 | 0; for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255; x.putImageData(img, 0, 0);
    const o = await new Promise(r => fabric.Image.fromURL(c.toDataURL('image/png'), r)); o.scale(0.05); o.name = 'Big picture'; canvas.add(o); canvas.renderAll(); snapshot();
    await Store.saveNow(true); await Store.writing;
    return {size: JSON.stringify(projectData()).length, largest: __fake.largest, status: $('docname').textContent, file: Store.fileName};
  });
  assert.ok(big.size > 500000, String(big.size)); assert.ok(big.largest <= 262144); assert.ok(!big.status.includes('Not saved'), big.status); say('large design saved in pieces', big);
  await open();
  const back = await page.evaluate(async file => { const items = await Store.list(), it = items.find(i => i.file === file); await Store.openItem(it); await new Promise(r => setTimeout(r, 400)); return {pic: canvas.getObjects().some(o => o.name === 'Big picture'), shirt, n: canvas.getObjects().length, name: Store.name}; }, big.file);
  assert.ok(back.pic); assert.equal(back.name, 'Club Tee'); say('reopens whole after a reload', back);
  // only the parts that changed are written again
  await page.waitForFunction(() => !Store.pending).catch(() => {});

  // files go through the save prompt
  const saved = await page.evaluate(async () => {
    __fake.saves = [];
    await Store.output(new Blob(['png-bytes']), 'front.png'); await Store.output(new Blob(['8BPS-layers']), 'front.psd');
    run('savecopy'); await new Promise(r => setTimeout(r, 100));
    return __fake.saves.map(s => ({filename: s.filename, size: s.size, b64: s.b64}));
  });
  assert.deepEqual(saved.map(s => s.filename.split('.').pop()), ['png', 'zip', 'json']);
  const zipFile = path.join(OUT, 'test.zip'); fs.writeFileSync(zipFile, Buffer.from(saved[1].b64, 'base64'));
  const inside = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;n=z.namelist()[0];print(n,z.read(n).decode())', zipFile], {encoding: 'utf8'}).trim();
  assert.ok(inside.endsWith('.psd 8BPS-layers'), inside); say('PNG and project files save directly; a PSD arrives intact inside a zip', inside);

  // dialogs that replace the blocked browser ones
  await page.evaluate(() => { window.confirm = () => { throw new Error('confirm used'); }; window.prompt = () => { throw new Error('prompt used'); }; Store.renamePrompt(); });
  await page.waitForSelector('.askdlg input');
  await page.$eval('.askdlg input', e => { e.value = 'Club Tee Two'; }); await page.click('.askdlg .btn.primary');
  await page.waitForFunction(() => Store.name === 'Club Tee Two'); await page.evaluate(() => Store.writing);
  let names = await page.evaluate(async () => (await Store.list()).map(i => i.name)); assert.deepEqual(names, ['Club Tee Two']); say('rename uses an in-page dialog and moves the saved design');
  await page.evaluate(() => run('clear')); await page.waitForSelector('.askdlg'); await page.click('.askdlg .btn.ghost'); assert.ok(await page.evaluate(() => canvas.getObjects().length > 0));
  await page.evaluate(() => run('clear')); await page.waitForSelector('.askdlg'); await page.click('.askdlg .btn.primary'); await page.waitForFunction(() => canvas.getObjects().length === 0); say('clear asks first, in the page');
  await page.evaluate(() => run('home')); await page.waitForSelector('.pcard .pdel'); await page.evaluate(() => document.querySelector('.pcard .pdel').click()); await page.waitForSelector('.askdlg'); await page.click('.askdlg .btn.primary');
  await page.waitForFunction(async () => (await Store.list()).length === 0);
  const leftover = await page.evaluate(() => Object.keys(JSON.parse(window.name))); assert.deepEqual(leftover, []); say('delete removes the design and all its pieces');

  // tablet layout
  await page.evaluate(() => $('homeClose').click());
  await page.setViewport({width: 820, height: 1180, hasTouch: true, isMobile: true});
  await open();
  await page.evaluate(() => { $('homeNew').click(); }); await page.waitForFunction(() => Store.open);
  await page.evaluate(() => run('askclaude')); await new Promise(res => setTimeout(res, 300));
  const box = await page.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(), t = $('aiText').getBoundingClientRect(); return {dockVisible: d.left < innerWidth && d.right <= innerWidth + 1, textIn: t.bottom <= innerHeight && t.top > 0, sendable: !$('aiSend').disabled, font: getComputedStyle($('aiText')).fontSize, scrollsSideways: document.documentElement.scrollWidth > innerWidth}; });
  assert.ok(box.dockVisible && box.textIn && !box.scrollsSideways, JSON.stringify(box)); say('Ask Claude opens as a side drawer on a tablet', box);
  await page.screenshot({path: path.join(OUT, 'panel-tablet.png')});

  // outside Claude: no chat, just a way to open the copy that has it, and the app stays as it was
  await page.setViewport({width: 1180, height: 820});
  const plain = await browser.newPage(); const plainErrors = []; plain.on('pageerror', e => plainErrors.push(e.message));
  await plain.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, {waitUntil: 'load'}); await plain.waitForSelector('.modal.home.on');
  await plain.waitForSelector('#d-ai a');
  const p = await plain.evaluate(() => ({chat: !!$('aiText'), link: document.querySelector('#d-ai a').href, picker: Store.supported, cloud: Cloud.on}));
  assert.equal(p.chat, false); assert.ok(p.link.startsWith('https://claude.ai/')); assert.equal(p.cloud, false); assert.equal(plainErrors.length, 0, plainErrors.join()); say('the offline copy has no chat, only a link to the copy in Claude', p);

  assert.deepEqual(errors, []); say('no page errors');
  console.log('all passed; pictures in', OUT);
} finally {
  await browser.close();
  fs.rmSync(harness, {force: true});
}
