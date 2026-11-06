// Touch menus, the colour strip and the help guides, in Chrome with real touch input. Run: node tools/test-ui.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || fs.mkdtempSync('/tmp/teeui-');
const puppeteer = createRequire(path.join(ROOT, 'mcp/package.json'))('puppeteer-core');
const say = (n, v) => console.log(`ok  ${n}${v === undefined ? '' : ': ' + JSON.stringify(v)}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run']});
const errors = [];
const open = async (w, h, touch) => {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.setViewport({width: w, height: h, hasTouch: touch, isMobile: touch});
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, {waitUntil: 'load'});
  await page.waitForSelector('.modal.home.on');
  await page.evaluate(() => { document.querySelector('.modal.home').classList.remove('on'); Pick.snapOn = false; });
  return page;
};
const clientOf = (page, x, y) => page.evaluate((x, y) => { const r = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform; return [x * v[0] + v[4] + r.left, y * v[3] + v[5] + r.top]; }, x, y);
const tap = async (page, x, y) => { const t = await page.touchscreen.touchStart(x, y); await sleep(30); await t.end(); };
const dbl = async (page, x, y) => { await tap(page, x, y); await sleep(70); await tap(page, x, y); await sleep(80); };
// a spot on the stage that really is outside the open menu
const away = page => page.evaluate(() => { const s = $('stage').getBoundingClientRect(), m = document.querySelector('.ctxmenu'), r = m && m.getBoundingClientRect(); const spots = [[s.left + 20, s.bottom - 20], [s.right - 20, s.bottom - 20], [s.left + 20, s.top + 60], [s.right - 20, s.top + 60]]; return spots.find(([x, y]) => !r || x < r.left - 4 || x > r.right + 4 || y < r.top - 4 || y > r.bottom + 4); });
const tapAway = async page => { const [x, y] = await away(page); await tap(page, x, y); };
const menu = page => page.evaluate(() => { const m = document.querySelector('.ctxmenu'); if (!m) return null; const r = m.getBoundingClientRect(); return {items: [...m.querySelectorAll('button')].map(b => b.childNodes[0].textContent.trim()), onScreen: r.top >= 0 && r.bottom <= innerHeight + 1}; });
const add = (page, kind) => page.evaluate(k => {
  restoring = true; canvas.discardActiveObject(); canvas.getObjects().slice().forEach(o => canvas.remove(o));
  const o = k === 'text' ? makeText('HELLO', {fontSize: 60}) : k === 'path' ? new fabric.Path('M0 0L80 0L80 80Z', {fill: '#f00'}) : new fabric.Rect({width: 100, height: 100, fill: '#f00', strokeWidth: 0});
  canvas.add(placeCenter(o, 120, 120)); restoring = false; canvas.renderAll(); snapshot();
}, kind);

try {
  /* ---------- touch menus, on a tablet and a phone ---------- */
  for (const [w, h, label] of [[820, 1180, 'tablet'], [390, 844, 'phone']]){
    const page = await open(w, h, true);
    await add(page, 'rect');
    const [x, y] = await clientOf(page, 120, 120);

    await page.touchscreen.touchStart(x, y).then(async t => { await sleep(900); await t.end(); }); await sleep(100);
    assert.equal(await menu(page), null, 'a long press opens nothing'); say(`${label}: long press opens nothing`);
    await page.evaluate(() => { canvas.discardActiveObject(); canvas.renderAll(); });

    await dbl(page, x, y);
    let m = await menu(page); assert.ok(m && m.items.includes('Duplicate') && m.onScreen, JSON.stringify(m));
    assert.equal(await page.evaluate(() => { const a = canvas.getActiveObject(); return !!(a && a.rotateMode); }), false, 'no rotate handles from the second tap');
    say(`${label}: double-tap opens the menu, on screen, without side effects`);

    await tapAway(page); await sleep(60); assert.equal(await menu(page), null, 'closed by tapping the canvas'); say(`${label}: tapping the page closes the menu`);
    await dbl(page, x, y); assert.ok(await menu(page));
    const tb = await page.evaluate(() => { const r = document.querySelector('.std').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(page, tb[0], tb[1]); await sleep(60); assert.equal(await menu(page), null, 'closed by tapping a bar'); say(`${label}: tapping a bar closes the menu`);

    // a menu item still works by touch
    await dbl(page, x, y);
    const it = await page.evaluate(() => { const b = [...document.querySelectorAll('.ctxmenu button')].find(b => b.textContent.startsWith('Duplicate')), r = b.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; });
    const n0 = await page.evaluate(() => canvas.getObjects().length);
    await tap(page, it[0], it[1]); await sleep(150);
    assert.equal(await page.evaluate(() => canvas.getObjects().length), n0 + 1); assert.equal(await menu(page), null); say(`${label}: a menu item works by touch`);

    await add(page, 'text'); await dbl(page, x, y);
    m = await menu(page); assert.ok(m && m.items.includes('Edit text'), JSON.stringify(m));
    assert.equal(await page.evaluate(() => canvas.getActiveObject().isEditing), false);
    const et = await page.evaluate(() => { const b = [...document.querySelectorAll('.ctxmenu button')].find(b => b.textContent === 'Edit text'), r = b.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; });
    await tap(page, et[0], et[1]); await sleep(120); assert.equal(await page.evaluate(() => canvas.getActiveObject().isEditing), true);
    await page.evaluate(() => { canvas.getActiveObject().exitEditing(); canvas.discardActiveObject(); canvas.renderAll(); }); say(`${label}: text offers Edit text`);

    await add(page, 'path'); await dbl(page, x, y);
    m = await menu(page); assert.ok(m && m.items.includes('Edit points (Shape tool)'), JSON.stringify(m)); assert.equal(await page.evaluate(() => tool), 'pick'); await tapAway(page); await sleep(60); assert.equal(await page.evaluate(() => canvas.getObjects().length), 1); say(`${label}: curves offer Edit points`);

    // shape tool: its own menu; drawing tools: double-tap finishes
    await page.evaluate(() => { canvas.setActiveObject(canvas.getObjects()[0]); setTool('shape'); });
    const [nx, ny] = await clientOf(page, 160, 80);   // a corner of the curve
    await dbl(page, nx, ny); m = await menu(page); assert.ok(m && m.items.includes('Add node'), JSON.stringify(m)); await tapAway(page); await sleep(60); assert.equal(await menu(page), null); say(`${label}: Shape tool menu opens by double-tap, closes by tapping outside`);
    await page.evaluate(() => { setTool('bezier'); });
    const [bx, by] = await clientOf(page, 40, 40), [bx2, by2] = await clientOf(page, 180, 60);
    await tap(page, bx, by); await sleep(420); await tap(page, bx2, by2); await sleep(420); await dbl(page, bx2, by2); await sleep(50);
    assert.equal(await page.evaluate(() => tool), 'pick'); assert.equal(await menu(page), null); say(`${label}: drawing tools still finish on double-tap`);

    // flyout without holding
    await page.evaluate(() => { $('tools').classList.add('all'); });
    const fly = await page.evaluate(() => { const g = Toolbox.groups.findIndex(g => g.tools.includes('rect')), b = document.querySelector(`.tool[data-group="${g}"]`); b.scrollIntoView({block: 'nearest', inline: 'center'}); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.touchscreen.touchStart(fly[0], fly[1]).then(async t => { await sleep(700); await t.end(); }); await sleep(100);
    const flyHeld = await page.evaluate(() => !!Toolbox.flyEl); await page.evaluate(() => { Toolbox.close(); setTool('rect'); });
    assert.equal(flyHeld, false); await tap(page, fly[0], fly[1]); await sleep(100); assert.equal(await page.evaluate(() => !!Toolbox.flyEl), true); await page.evaluate(() => { Toolbox.close(); setTool('pick'); }); say(`${label}: toolbox needs no holding; tapping the current tool opens its group`);

    /* ---------- colour strip ---------- */
    await add(page, 'rect');
    const swatch = (c) => page.evaluate(c => { const s = document.querySelector(`#pal [data-c="${c}"]`); s.scrollIntoView({inline: 'center', block: 'nearest'}); const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, c);
    await page.evaluate(() => { canvas.setActiveObject(canvas.getObjects()[0]); canvas.renderAll(); });
    let at = await swatch('#22c55e'); await tap(page, at[0], at[1]); await sleep(100);
    assert.equal(await page.evaluate(() => canvas.getObjects()[0].fill), '#22c55e'); assert.ok((await page.$eval('#toast', e => e.textContent)).includes('Fill changed'));
    const modeAt = await page.evaluate(() => { const r = document.querySelector('#palMode [data-m="outline"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(page, modeAt[0], modeAt[1]); await sleep(60);
    at = await swatch('#3b82f6'); await tap(page, at[0], at[1]); await sleep(100);
    let o = await page.evaluate(() => { const r = canvas.getObjects()[0]; return [r.fill, r.stroke, r.strokeWidth > 0]; }); assert.deepEqual(o, ['#22c55e', '#3b82f6', true]);
    const none = await page.evaluate(() => { $('palNone').scrollIntoView({inline: 'center', block: 'nearest'}); const r = $('palNone').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(page, none[0], none[1]); await sleep(100); assert.equal(await page.evaluate(() => canvas.getObjects()[0].strokeWidth), 0);
    await page.evaluate(() => { setPalMode(false); canvas.discardActiveObject(); canvas.renderAll(); });
    at = await swatch('#ec4899'); await tap(page, at[0], at[1]); await sleep(100);
    assert.ok((await page.$eval('#toast', e => e.textContent)).includes('Nothing is selected')); assert.equal(await page.evaluate(() => defFill), '#ec4899');
    say(`${label}: colours change the fill and outline, remove them, and set the next shape's colour`);
    await page.screenshot({path: path.join(OUT, `strip-${label}.png`)});

    /* ---------- help at this size ---------- */
    await page.evaluate(() => { Help.open(); }); await sleep(300);
    await page.$eval('#helpQ', e => { e.value = 'blend kaise kare'; }); await page.click('#helpGo'); await sleep(60);
    await page.screenshot({path: path.join(OUT, `help-${label}.png`)});
    await page.click('#helpTour'); await sleep(150);
    await page.click('#tourDo'); await sleep(80); await page.click('#tourNext'); await sleep(350);
    const ring = await page.evaluate(() => { const r = document.querySelector('.tourring').getBoundingClientRect(), c = document.querySelector('.tourcard').getBoundingClientRect(); return {ring: r.width > 0 && getComputedStyle(document.querySelector('.tourring')).display !== 'none', cardIn: c.left >= 0 && c.right <= innerWidth + 1 && c.top >= 0 && c.bottom <= innerHeight + 1, overlap: !(r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom)}; });
    assert.ok(ring.ring && ring.cardIn && !ring.overlap, JSON.stringify(ring));
    await page.screenshot({path: path.join(OUT, `tour-${label}.png`)});
    await page.click('#tourDo'); await sleep(60); await page.click('#tourNext'); await sleep(150); await page.click('#tourDo');
    await page.waitForFunction(() => document.querySelector('#tourDo') && document.querySelector('#tourDo').textContent.includes('Done'), {timeout: 6000});
    assert.equal(await page.evaluate(() => canvas.getObjects().some(o => o.fx && o.fx.blend)), true);
    await page.screenshot({path: path.join(OUT, `tour-blend-${label}.png`)});
    await page.click('.tourx'); say(`${label}: the blend tour points at the real button and does the real blend`, ring);
    await page.close();
  }

  /* ---------- computer: right-click as it was ---------- */
  const desk = await open(1440, 900, false);
  await add(desk, 'rect');
  const [dx, dy] = await clientOf(desk, 120, 120);
  await desk.mouse.click(dx, dy, {button: 'right'}); await sleep(80);
  assert.ok((await menu(desk)).items.includes('Duplicate')); const [ex, ey] = await away(desk); await desk.mouse.click(ex, ey); await sleep(60); assert.equal(await menu(desk), null);
  await desk.mouse.click(dx, dy, {button: 'right'}); await sleep(80); await desk.keyboard.press('Escape'); await sleep(40); assert.equal(await menu(desk), null); say('computer: right-click opens the menu; click outside or Esc closes it');
  await desk.mouse.click(dx, dy); await desk.mouse.click(dx, dy, {clickCount: 2}); await sleep(100); assert.equal(await menu(desk), null); say('computer: double-click opens no menu');
  await desk.evaluate(() => { canvas.setActiveObject(canvas.getObjects()[0]); });
  const sw = await desk.evaluate(() => { const r = document.querySelector('#pal [data-c="#22c55e"]').getBoundingClientRect(); return [r.left + 5, r.top + 5]; });
  await desk.mouse.click(sw[0], sw[1], {button: 'right'}); await sleep(60); assert.equal(await desk.evaluate(() => canvas.getObjects()[0].stroke), '#22c55e');
  await desk.mouse.click(sw[0], sw[1]); await sleep(60); assert.equal(await desk.evaluate(() => canvas.getObjects()[0].fill), '#22c55e'); say('computer: left-click fills and right-click outlines, as before');
  const labelBox = await desk.evaluate(() => { const l = document.querySelector('#pal .lbl'); return {w: l.getBoundingClientRect().width, clipped: l.scrollWidth > l.clientWidth + 1, text: l.textContent}; });
  assert.ok(!labelBox.clipped && labelBox.w > 30, JSON.stringify(labelBox)); say('the strip has a readable label', labelBox);

  /* ---------- help: finding the right answer ---------- */
  const ask = q => desk.evaluate(q => Help.search(q).map(g => g.id), q);
  const cases = {'how to blend': 'blend', 'where is blend option': 'blend', 'blend kaise kare': 'blend', 'blending': 'blend', 'blnd': 'blend', 'how do i blend two shapes': 'blend',
    'what is purpose of colour plalets down below': 'palette', 'how to apply colour from palette': 'palette', 'color palette': 'palette',
    'merge two shapes': 'weld', 'how to join shapes': 'weld', 'cut one shape with another': 'trim', 'text ko gol kaise kare': 'curvetext', 'curved text': 'curvetext', 'text on a circle': 'curvetext',
    'remove background from photo': 'background', 'image background hatana': 'background', 'how to export psd': 'export', 'save as png': 'export', 'drop shadow': 'shadow', 'shadow kaise lagaye': 'shadow',
    'long press popup': 'menu', 'right click on tablet': 'menu', 'where is my file saved': 'save', 'change shirt colour': 'shirt', 'undo': 'undo', 'how to add text': 'text', 'how to rotate': 'select', 'change page size': 'pagesize', 'photo inside text': 'powerclip', 'add table': 'table', 'erase': 'eraser', 'knife': 'knife', 'how to crop picture': 'crop', 'align center': 'align', 'lock layer': 'layers', 'see on shirt mockup': 'preview', 'contour': 'contour', 'b spline': 'tool-bspline', '3 point rectangle': 'tool-rect3', 'complex star': 'tool-cstar', 'angular dimension': 'tool-dimang'};
  const wrong = [];
  for (const [q, want] of Object.entries(cases)){ const got = await ask(q); if (got[0] !== want) wrong.push(`${q} -> ${got.join(',') || 'nothing'} (wanted ${want})`); }
  assert.deepEqual(wrong, []); say(`${Object.keys(cases).length} questions find the right guide`);
  for (const q of ['what is the meaning of life', 'xyzzy plugh', 'weather in pune today', 'how', 'kaise kare']) assert.deepEqual(await ask(q), [], q);
  say('questions it has no guide for get no made-up answer');
  await desk.evaluate(() => { Help.open(); Help.ask('weather in pune today'); }); assert.ok((await desk.$eval('#helpOut', e => e.textContent)).includes("don't have a guide"));

  /* ---------- help: every step of every guide is real ---------- */
  const bad = await desk.evaluate(() => {
    const out = [], cmds = new Set([...document.querySelectorAll('[data-cmd]')].map(e => e.dataset.cmd));
    const ok = c => cmds.has(c) || /^(tool|shape|bmp|clip):/.test(c);
    HELP_GUIDES.forEach(g => g.steps.forEach((s, i) => {
      if (s.target && !s.target.startsWith('tool:') && !s.target.startsWith('cmd:') && !s.target.startsWith('dock:') && s.target !== 'canvas' && !document.querySelector(s.target)) out.push(`${g.id}#${i} target ${s.target}`);
      if (s.target && s.target.startsWith('tool:') && !Toolbox.groups.some(x => x.tools.includes(s.target.slice(5)))) out.push(`${g.id}#${i} ${s.target}`);
      if (s.target && s.target.startsWith('cmd:') && !document.querySelector(`.dd [data-cmd="${s.target.slice(4)}"]`)) out.push(`${g.id}#${i} ${s.target}`);
      if (s.target && s.target.startsWith('dock:') && !document.querySelector(`.dtabs [data-d="${s.target.slice(5)}"]`)) out.push(`${g.id}#${i} ${s.target}`);
      if (s.do && s.do.cmd && !ok(s.do.cmd)) out.push(`${g.id}#${i} cmd ${s.do.cmd}`);
      if (s.do && s.do.tool && !Toolbox.groups.some(x => x.tools.includes(s.do.tool))) out.push(`${g.id}#${i} tool ${s.do.tool}`);
    }));
    return {out, n: HELP_GUIDES.length, steps: HELP_GUIDES.reduce((n, g) => n + g.steps.length, 0), covered: Toolbox.groups.flatMap(g => g.tools).filter(t => !t.startsWith('cmd:')).filter(t => !HELP_GUIDES.some(g => g.steps.some(s => s.target === 'tool:' + t || (s.do && s.do.tool === t)) || g.keys.includes(Toolbox.name(t).toLowerCase().split(' ')[0]))).map(t => t)};
  });
  assert.deepEqual(bad.out, []); assert.deepEqual(bad.covered, [], 'a tool has no guide'); say(`${bad.n} guides, ${bad.steps} steps: every button and command exists; every tool is covered`);

  // run each guide's automatic steps against a fresh design
  const skip = new Set(['import', 'export', 'pagesize']);   // these open a file picker or a dialog
  const ran = await desk.evaluate(async skip => {
    const fails = []; let done = 0;
    const tests = {blend: () => canvas.getObjects().some(o => o.fx && o.fx.blend), shadow: () => canvas.getObjects().some(o => o.fx && o.fx.shadow), contour: () => canvas.getObjects().some(o => o.fx && o.fx.contour), distort: () => canvas.getObjects().some(o => o.fx && o.fx.distort), transp: () => canvas.getObjects().some(o => o.fx && o.fx.transp), one: () => canvas.getObjects().length === 1};
    for (const g of HELP_GUIDES){
      if (skip.includes(g.id)) continue;
      restoring = true; canvas.discardActiveObject(); canvas.getObjects().slice().forEach(o => canvas.remove(o)); restoring = false; setTool('pick');
      Tour.start(g);
      for (let i = 0; i < g.steps.length; i++){
        Tour.go(i);
        const s = g.steps[i];
        try {
          if (s.do){ await Tour.perform(s.do); await new Promise(r => setTimeout(r, s.do.cmd && s.do.cmd.startsWith('shape:') ? 250 : 40)); done++; }
          if (s.do && s.do.check && !tests[s.do.check]()) fails.push(`${g.id}#${i}: ${s.do.check} did not happen`);
          if (s.target && s.target !== 'canvas' && !Tour.find(s.target)) fails.push(`${g.id}#${i}: nothing to point at for ${s.target}`);
        } catch (e){ fails.push(`${g.id}#${i}: ${e.message}`); }
      }
      Tour.stop();
    }
    return {fails, done};
  }, [...skip]);
  assert.deepEqual(ran.fails, []); say(`${ran.done} automatic steps ran, and each effect really happened`);

  // practice shapes come off with one undo
  const undoOk = await desk.evaluate(async () => {
    restoring = true; canvas.getObjects().slice().forEach(o => canvas.remove(o)); restoring = false; setTool('pick'); snapshot();
    Tour.start(HELP_GUIDES.find(g => g.id === 'blend')); await Tour.perform({sample: 'two'}); const n = canvas.getObjects().length; undo(); await new Promise(r => setTimeout(r, 150)); Tour.stop(); return [n, canvas.getObjects().length];
  });
  assert.deepEqual(undoOk, [2, 0]); say('Undo removes practice shapes in one step');

  await desk.evaluate(() => { Help.open(); Help.home(); }); await sleep(100);
  await desk.screenshot({path: path.join(OUT, 'help-desktop.png')});
  assert.deepEqual(errors, []); say('no page errors');
  console.log('all passed; pictures in', OUT);
} finally { await browser.close(); }
