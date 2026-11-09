// Background removal (gaps inside, the brush) and Heal, in Chrome. Run: node tools/test-picture.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || fs.mkdtempSync('/tmp/teepic-');
const puppeteer = createRequire(path.join(ROOT, 'mcp/package.json'))('puppeteer-core');
const say = (n, v) => console.log(`ok  ${n}${v === undefined ? '' : ': ' + JSON.stringify(v)}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run']});
const errors = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.setViewport({width: 1400, height: 900});
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, {waitUntil: 'load'});
await page.waitForSelector('.modal.home.on');
await page.evaluate(() => { document.querySelector('.modal.home').classList.remove('on'); });

// test pictures, drawn in the page
await page.evaluate(() => {
  // a wheel: black rim and spokes on white, so the white between the spokes is closed in
  window.wheel = (clearOutside) => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
    if (!clearOutside){ x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300); }
    else { x.fillStyle = '#fff'; x.beginPath(); x.arc(200, 150, 120, 0, Math.PI * 2); x.fill(); }   // white only inside the wheel
    x.strokeStyle = '#111'; x.lineWidth = 14; x.beginPath(); x.arc(200, 150, 120, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 5; for (let k = 0; k < 12; k++){ const a = k * Math.PI / 6; x.beginPath(); x.moveTo(200, 150); x.lineTo(200 + 118 * Math.cos(a), 150 + 118 * Math.sin(a)); x.stroke(); }
    x.fillStyle = '#c00'; x.beginPath(); x.arc(200, 150, 18, 0, Math.PI * 2); x.fill();
    return c;
  };
  window.alphaAt = (D, w, px, py) => D[(py * w + px) * 4 + 3];
  window.run = (c, p) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); BgRemove.apply(d.data, c.width, c.height, p); return d.data; };
});

try {
  /* ---------- gaps closed in by the picture ---------- */
  const gaps = await page.evaluate(() => {
    const c = wheel(false), w = c.width, gap = [200 + 70 * Math.cos(Math.PI / 12), 150 + 70 * Math.sin(Math.PI / 12)].map(Math.round);
    const off = run(c, {holes: false}), on = run(c, {holes: true});
    return {outsideOff: alphaAt(off, w, 10, 10), gapOff: alphaAt(off, w, ...gap), gapOn: alphaAt(on, w, ...gap), rimOn: alphaAt(on, w, 200, 30), hubOn: alphaAt(on, w, 200, 150), spokeOn: alphaAt(on, w, 260, 150)};
  });
  assert.equal(gaps.outsideOff, 0); assert.equal(gaps.gapOff, 255, 'without the option the gap stays');
  assert.equal(gaps.gapOn, 0, 'gap between spokes is cleared'); assert.equal(gaps.rimOn, 255); assert.equal(gaps.hubOn, 255); assert.equal(gaps.spokeOn, 255);
  say('white between spokes cleared, wheel kept', gaps);

  // a picture already cut out: edges see-through, nothing to learn, the gap colour is picked
  const cut = await page.evaluate(() => {
    const c = wheel(true), w = c.width, gap = [200 + 70 * Math.cos(Math.PI / 12), 150 + 70 * Math.sin(Math.PI / 12)].map(Math.round);
    const d = c.getContext('2d').getImageData(0, 0, w, c.height).data;
    const learnt = BgRemove.learn(d, w, c.height).length;
    const auto = run(c, {holes: true}), picked = run(c, {holes: true, colors: [[255, 255, 255]]});
    return {learnt, gapAuto: alphaAt(auto, w, ...gap), gapPicked: alphaAt(picked, w, ...gap), spoke: alphaAt(picked, w, 260, 150), rim: alphaAt(picked, w, 200, 30)};
  });
  assert.equal(cut.learnt, 0); assert.equal(cut.gapPicked, 0); assert.equal(cut.spoke, 255); assert.equal(cut.rim, 255);
  say('cut-out PNG: picking the gap colour clears the gaps', cut);

  // the brush: erase clears, keep brings back, keep wins when painted after
  const br = await page.evaluate(() => {
    const c = wheel(false), w = c.width;
    const er = run(c, {holes: true, brush: [{m: 'erase', r: 0.03, pts: [[0.5, 0.5]]}]});
    const kp = run(c, {holes: true, brush: [{m: 'keep', r: 0.03, pts: [[0.05, 0.05], [0.1, 0.05]]}]});
    const both = run(c, {holes: true, brush: [{m: 'erase', r: 0.05, pts: [[0.5, 0.5]]}, {m: 'keep', r: 0.02, pts: [[0.5, 0.5]]}]});
    return {hubErased: alphaAt(er, w, 200, 150), bgKept: alphaAt(kp, w, 30, 15), hubKeptAfterErase: alphaAt(both, w, 200, 150), ringAfter: alphaAt(both, w, 216, 155)};
  });
  assert.equal(br.hubErased, 0); assert.equal(br.bgKept, 255); assert.equal(br.hubKeptAfterErase, 255); assert.ok(br.ringAfter < 30);
  say('brush erase and keep', br);

  /* ---------- the panel ---------- */
  await page.evaluate(async () => {
    const c = wheel(false), url = c.toDataURL();
    const img = await new Promise(r => fabric.Image.fromURL(url, r));
    img.scale(10 * PX_PER_IN / img.width); canvas.add(placeCenter(img)); canvas.setActiveObject(img); canvas.renderAll(); snapshot();
    window.pic = img; Bitmap.run('rmbg');
  });
  await sleep(400);
  const panel = await page.evaluate(() => ({holes: $('bgHoles').checked, open: $('rmbg').classList.contains('on')}));
  assert.ok(panel.open && panel.holes, 'a new removal clears gaps by default');
  // paint an erase stroke on the hub with the mouse
  await page.click('#bgBrushMode [data-v="erase"]');
  const hub = await page.evaluate(() => { const p = fabric.util.transformPoint(pic.getCenterPoint(), canvas.viewportTransform), r = canvas.upperCanvasEl.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; });
  await page.mouse.move(hub[0] - 3, hub[1]); await page.mouse.down(); await page.mouse.move(hub[0] + 3, hub[1], {steps: 3}); await page.mouse.up();
  await sleep(500);
  const painted = await page.evaluate(() => ({strokes: BgRemove.bg.brush.length, undo: !$('bgBrushUndo').disabled, on: document.querySelector('#bgBrushMode [data-v="erase"]').classList.contains('on')}));
  assert.equal(painted.strokes, 1);
  await page.evaluate(() => $('bgOk').click());
  const kept = await page.evaluate(() => { const e = pic.getElement(), c = document.createElement('canvas'); c.width = e.width; c.height = e.height; const x = c.getContext('2d'); x.drawImage(e, 0, 0); return {hub: x.getImageData(200, 150, 1, 1).data[3], gap: x.getImageData(268, 168, 1, 1).data[3], saved: !!(pic.bg && pic.bg.brush.length && pic.bg.holes)}; });
  assert.equal(kept.hub, 0); assert.equal(kept.gap, 0); assert.ok(kept.saved);
  say('panel: gaps on by default, brush stroke painted with the mouse', {painted, kept});
  await page.screenshot({path: path.join(OUT, 'rmbg.png')});

  /* ---------- heal ---------- */
  // stripes and a gradient, with a red "person" over them; filled in, the red should be gone and the stripes carry on
  const heal = await page.evaluate(() => {
    const W = 600, H = 400, truth = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const i = (y * W + x) * 4, s = Math.floor(x / 24) % 2 ? 200 : 90; truth[i] = s; truth[i + 1] = 120 + y / 4; truth[i + 2] = 255 - s; truth[i + 3] = 255; }
    const D = new Uint8ClampedArray(truth), mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - 300) / 50) ** 2 + ((y - 200) / 110) ** 2 <= 1){ const i = (y * W + x) * 4; D[i] = 230; D[i + 1] = 20; D[i + 2] = 20; mask[y * W + x] = 255; }
    const t0 = performance.now(); Heal.inpaint(D, W, H, mask); const ms = performance.now() - t0;
    let err = 0, n = 0, red = 0;
    for (let i = 0; i < W * H; i++) if (mask[i]){ const k = i * 4; err += Math.abs(D[k] - truth[k]) + Math.abs(D[k + 1] - truth[k + 1]) + Math.abs(D[k + 2] - truth[k + 2]); n++; if (D[k] > 200 && D[k + 1] < 60) red++; }
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(D), W, H), 0, 0);
    return {ms: Math.round(ms), meanErr: +(err / n / 3).toFixed(1), redLeft: red, png: c.toDataURL()};
  });
  fs.writeFileSync(path.join(OUT, 'heal-stripes.png'), Buffer.from(heal.png.split(',')[1], 'base64'));
  assert.equal(heal.redLeft, 0); assert.ok(heal.meanErr < 25, 'filled in close to what was behind');
  say('heal fills a hole from the stripes around it', {ms: heal.ms, meanErr: heal.meanErr});

  // a big photo, to see how long a person-sized hole takes
  const big = await page.evaluate(() => {
    const W = 2000, H = 1500, D = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H);
    let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < W * H; i++){ const y = (i / W) | 0, v = 100 + 60 * Math.sin(i % W / 30) + 30 * rnd(); D[i * 4] = v; D[i * 4 + 1] = v * 0.8 + y / 20; D[i * 4 + 2] = 160; D[i * 4 + 3] = 255; }
    for (let y = 500; y < 1300; y++) for (let x = 900; x < 1150; x++) mask[y * W + x] = 255;
    const t0 = performance.now(); Heal.inpaint(D, W, H, mask); return Math.round(performance.now() - t0);
  });
  say('2000 × 1500 photo, 250 × 800 px area', {ms: big});

  // in the app: paint with the brush, the picture's pixels change, Undo brings them back
  await page.evaluate(async () => {
    restoring = true; canvas.getObjects().slice().forEach(o => canvas.remove(o)); restoring = false;
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d');
    for (let i = 0; i < 300; i += 20){ x.fillStyle = i % 40 ? '#3a7' : '#2b5'; x.fillRect(i, 0, 20, 200); }
    x.fillStyle = '#e11'; x.fillRect(140, 80, 20, 40);
    const img = await new Promise(r => fabric.Image.fromURL(c.toDataURL(), r));
    img.scale(9 * PX_PER_IN / img.width); canvas.add(placeCenter(img)); canvas.setActiveObject(img); canvas.renderAll(); snapshot();
    window.pic = img; Bitmap.run('heal');
    $('healSize').value = 80; $('healSize').dispatchEvent(new Event('input'));
  });
  const ctr = await page.evaluate(() => { const p = fabric.util.transformPoint(pic.getCenterPoint(), canvas.viewportTransform), r = canvas.upperCanvasEl.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; });
  await page.mouse.move(ctr[0], ctr[1] - 10); await page.mouse.down(); await page.mouse.move(ctr[0], ctr[1] + 10, {steps: 4}); await page.mouse.up();
  await page.waitForFunction(() => /Filled in/.test($('healNote').textContent), {timeout: 20000});
  const redAt = () => page.evaluate(() => { const o = canvas.getObjects().find(Bitmap.isImg), e = o._originalElement, c = document.createElement('canvas'); c.width = e.naturalWidth || e.width; c.height = e.naturalHeight || e.height; const x = c.getContext('2d'); x.drawImage(e, 0, 0); const d = x.getImageData(150, 100, 1, 1).data; return [d[0], d[1], d[2]]; });
  const after = await redAt();
  assert.ok(after[0] < 120 && after[1] > 120, 'red mark painted over is gone: ' + after);
  await page.screenshot({path: path.join(OUT, 'heal-panel.png')});
  await page.click('#healUndo'); await sleep(600);
  const undone = await redAt();
  assert.ok(undone[0] > 200 && undone[1] < 60, 'Undo brings the mark back: ' + undone);
  // and it heals again on the picture as rebuilt by Undo
  await page.mouse.move(ctr[0], ctr[1] - 10); await page.mouse.down(); await page.mouse.move(ctr[0], ctr[1] + 10, {steps: 4}); await page.mouse.up();
  await page.waitForFunction(() => /Filled in/.test($('healNote').textContent) && !Heal.busy, {timeout: 20000}); await sleep(300);
  const again = await redAt();
  assert.ok(again[0] < 120, 'heals again after Undo: ' + again);
  await page.click('#healDone');
  assert.equal(await page.evaluate(() => Heal.active || !!document.querySelector('.pickov')), false);
  say('heal panel: brush, Undo, heal again, Done', {after, undone, again});

  /* ---------- Ask Claude's actions ---------- */
  const ai = await page.evaluate(async () => {
    restoring = true; canvas.getObjects().slice().forEach(o => canvas.remove(o)); restoring = false;
    const img = await new Promise(r => fabric.Image.fromURL(wheel(true).toDataURL(), r));
    img.scale(8 * PX_PER_IN / img.width); canvas.add(placeCenter(img)); canvas.renderAll(); uidOf(img);
    const id = uidOf(img), st = DesignActions.state().objects[0];
    const b = img.getBoundingRect(true, true), cx = (b.left + b.width / 2) / PX_PER_IN, cy = (b.top + b.height / 2) / PX_PER_IN;
    const r1 = await DesignActions.apply([{op: 'remove_background', id, colors: ['#ffffff'], erase: [[cx, cy, 0.3]]}]);
    const o = canvas.getObjects().find(Bitmap.isImg), e = o.getElement(), c = document.createElement('canvas'); c.width = e.width; c.height = e.height; const x = c.getContext('2d'); x.drawImage(e, 0, 0);
    const gap = x.getImageData(268, 168, 1, 1).data[3], hub = x.getImageData(200, 150, 1, 1).data[3], rim = x.getImageData(200, 30, 1, 1).data[3];
    const r2 = await DesignActions.apply([{op: 'heal', id, areas: [{x: cx - 0.5, y: cy - 0.5, w: 1, h: 1}]}, {op: 'heal', id: 'nope', areas: []}]);
    const o2 = canvas.getObjects().find(Bitmap.isImg), e2 = o2._originalElement, c2 = document.createElement('canvas'); c2.width = e2.naturalWidth || e2.width; c2.height = e2.naturalHeight || e2.height; const x2 = c2.getContext('2d'); x2.drawImage(e2, 0, 0);
    const red = x2.getImageData(200, 150, 1, 1).data;
    return {type: st.type, ok1: r1.results[0].ok, gap, hub, rim, healOk: r2.results[0].ok, badErr: r2.results[1].error, red: [red[0], red[1], red[2]], seen: r2.design.objects[0].background_removed};
  });
  assert.equal(ai.type, 'picture'); assert.ok(ai.ok1); assert.equal(ai.gap, 0); assert.equal(ai.hub, 0); assert.equal(ai.rim, 255);
  assert.ok(ai.healOk); assert.ok(ai.red[0] < 150, 'red hub healed: ' + ai.red); assert.ok(ai.badErr);
  say('Ask Claude: remove_background with gaps and erase, heal', ai);

  const hits = await page.evaluate(() => ['bike ke andar ka background clear nahi hua', 'holes between spokes not transparent', 'photo se logon ko hatao', 'remove people from photo', 'heal', 'remove background'].map(q => [q, (Help.search(q)[0] || {}).id]));
  const want = {bggaps: [0, 1], heal: [2, 3, 4], background: [5]};
  Object.entries(want).forEach(([id, is]) => is.forEach(i => assert.equal(hits[i][1], id, hits[i][0])));
  say('help finds the new guides', hits);

  /* ---------- by touch, on a tablet and a phone ---------- */
  for (const [w, h, label] of [[820, 1180, 'tablet'], [390, 844, 'phone']]){
    const t = await browser.newPage();
    t.on('pageerror', e => errors.push(label + ': ' + e.message));
    await t.setViewport({width: w, height: h, hasTouch: true, isMobile: true});
    await t.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, {waitUntil: 'load'});
    await t.waitForSelector('.modal.home.on');
    await t.evaluate(async () => {
      document.querySelector('.modal.home').classList.remove('on');
      const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#123'; x.fillRect(60, 40, 180, 120); x.fillStyle = '#fff'; x.fillRect(140, 90, 20, 20);
      const img = await new Promise(r => fabric.Image.fromURL(c.toDataURL(), r));
      img.scale(8 * PX_PER_IN / img.width); canvas.add(placeCenter(img)); canvas.setActiveObject(img); canvas.renderAll(); snapshot(); window.pic = img;
    });
    const finger = async (x0, y0, x1, y1) => { const s = await t.touchscreen.touchStart(x0, y0); for (let k = 1; k <= 5; k++){ await t.touchscreen.touchMove(x0 + (x1 - x0) * k / 5, y0 + (y1 - y0) * k / 5); await sleep(16); } await s.end(); };
    const centre = () => t.evaluate(() => { const p = fabric.util.transformPoint(pic.getCenterPoint(), canvas.viewportTransform), r = canvas.upperCanvasEl.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; });
    const onScreen = id => t.evaluate(id => { const r = $(id).getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1; }, id);
    await t.evaluate(() => Bitmap.run('rmbg')); await sleep(400);
    const rm = {panel: await onScreen('rmbg'), holes: await t.evaluate(() => $('bgHoles').checked)};
    await t.evaluate(() => $('bgBrushMode').scrollIntoView({block: 'nearest'}));
    await t.evaluate(() => document.querySelector('#bgBrushMode [data-v="erase"]').click());
    // paint where the picture shows: on a phone the panel sits over the bottom of the screen
    const [cx, cy0] = await centre(), top = await t.evaluate(() => { const r = $('rmbg').getBoundingClientRect(); return r.top > innerHeight / 3 ? r.top : 1e9; });
    const cy = Math.min(cy0, top - 20);
    rm.compact = await t.evaluate(() => $('rmbg').getBoundingClientRect().height);
    await finger(cx - 40, cy, cx + 40, cy); await sleep(500);
    rm.strokes = await t.evaluate(() => BgRemove.bg.brush.length);
    rm.gapInside = await t.evaluate(() => { const e = pic.getElement(), c = document.createElement('canvas'); c.width = e.width; c.height = e.height; const x = c.getContext('2d'); x.drawImage(e, 0, 0); return x.getImageData(150, 100, 1, 1).data[3]; });
    rm.panelBack = await t.evaluate(() => { $('bgBrushMode').querySelector('.on').click(); return $('rmbg').getBoundingClientRect().height; });
    await t.evaluate(() => $('bgOk').click());
    await t.evaluate(() => { canvas.setActiveObject(pic); Bitmap.run('heal'); });
    const hl = {panel: await onScreen('heal')};
    const htop = await t.evaluate(() => { const r = $('heal').getBoundingClientRect(); return r.top > innerHeight / 3 ? r.top : 1e9; });
    await finger(cx - 20, Math.min(cy0 + 20, htop - 20), cx + 20, Math.min(cy0 + 20, htop - 20));
    await t.waitForFunction(() => /Filled in/.test($('healNote').textContent) && !Heal.busy, {timeout: 20000});
    hl.note = await t.evaluate(() => $('healNote').textContent);
    await t.evaluate(() => $('healDone').click());
    assert.ok(rm.panel && rm.holes && rm.strokes === 1 && rm.gapInside === 0, label + ' remove background: ' + JSON.stringify(rm));
    assert.ok(hl.panel, label + ' heal panel on screen');
    await t.screenshot({path: path.join(OUT, `touch-${label}.png`)});
    say(`${label}: brush and heal by finger, panels on screen`, {rm, hl});
    await t.close();
  }

  assert.deepEqual(errors, []);
  say('no page errors');
  console.log('pictures in', OUT);
} finally { await browser.close(); }
