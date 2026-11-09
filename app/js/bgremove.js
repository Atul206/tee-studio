/* ===================== remove background =====================
   Makes a picture's background transparent on this computer, following TraceDraw's spec
   (docs/behavior/remove-background.md):
   1. background colours learnt from the picture's border (k-means in CIE Lab) or picked with the eyedropper (up to four)
   2. each pixel's CIE76 Delta E to its nearest background colour
   3. opacity 0 up to the tolerance, a smoothstep ramp over max(4, 0.6 × tolerance), 1 beyond
   4. Contiguous: only background reached from the border goes, walking on through a drifting backdrop in small steps
   5. specks under 1/2000 of the picture go  6. edge softness: two box blurs  7. edge colours lose the backdrop's tint
   On top: a boundary drawn around the part to keep (or to remove), and Invert, which keeps what would go.
   It is a Fabric filter (RemoveBg, first in o.filters), so the original pixels stay and the settings live in o.bg. */

const BgRemove = (() => {
  // holes is off here so designs saved before it existed look the same; a new removal turns it on (open)
  // brush: strokes painted on the picture, {m: 'erase' | 'keep', r: radius as a share of the picture's width, pts: [[u, v]…]}
  const BG0 = {colour: true, colors: [], tol: 14, soft: 1, contig: true, holes: false, specks: true, clean: true, poly: null, polyMode: 'keep', invert: false, brush: []};
  // a deep copy, so picking colours never changes the defaults or another picture's settings
  const fresh = b => JSON.parse(JSON.stringify(Object.assign({}, BG0, b || {})));

  /* ---------- colour maths ---------- */
  const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  function lab(r, g, b){
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  const dE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const smooth = t => t * t * (3 - 2 * t);

  // background colours from the opaque pixels of a two pixel border; none when the picture is already cut out
  function learn(D, w, h){
    const idx = [];
    for (let y = 0; y < h; y++){
      if (y < 2 || y >= h - 2) for (let x = 0; x < w; x++) idx.push(y * w + x);
      else idx.push(y * w, y * w + 1, y * w + w - 2, y * w + w - 1);
    }
    const opaque = idx.filter(i => D[i * 4 + 3] >= 128);
    if (opaque.length < idx.length / 3) return [];
    const step = Math.max(1, Math.floor(opaque.length / 4096));
    const S = []; for (let k = 0; k < opaque.length; k += step){ const i = opaque[k] * 4; S.push({rgb: [D[i], D[i + 1], D[i + 2]], lab: lab(D[i], D[i + 1], D[i + 2])}); }
    // farthest-point seeds, each at least 10 Delta E from the others, at most six
    const seeds = [S[0].lab.slice()];
    while (seeds.length < 6){
      let best = null, bd = 0;
      S.forEach(s => { const d = Math.min(...seeds.map(c => dE(s.lab, c))); if (d > bd){ bd = d; best = s; } });
      if (!best || bd < 10) break;
      seeds.push(best.lab.slice());
    }
    let groups = [];
    for (let round = 0; round < 10; round++){
      groups = seeds.map(() => ({n: 0, lab: [0, 0, 0], rgb: [0, 0, 0]}));
      S.forEach(s => {
        let j = 0, bd = Infinity; seeds.forEach((c, k) => { const d = dE(s.lab, c); if (d < bd){ bd = d; j = k; } });
        const g = groups[j]; g.n++; for (let t = 0; t < 3; t++){ g.lab[t] += s.lab[t]; g.rgb[t] += s.rgb[t]; }
      });
      groups.forEach((g, k) => { if (g.n) seeds[k] = g.lab.map(v => v / g.n); });
    }
    return groups.filter(g => g.n >= S.length / 15).map(g => ({lab: g.lab.map(v => v / g.n), rgb: g.rgb.map(v => Math.round(v / g.n))}));
  }

  /* ---------- the mask ---------- */
  function polyMask(poly, w, h){
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.beginPath(); poly.forEach(([u, v], i) => i ? x.lineTo(u * w, v * h) : x.moveTo(u * w, v * h)); x.closePath();
    x.fillStyle = '#000'; x.fill();
    const a = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3];
    return m;
  }
  // one painted stroke as coverage 0–255 (round ends, so a single dab is a dot)
  function strokeMask(s, w, h){
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.lineCap = x.lineJoin = 'round'; x.strokeStyle = x.fillStyle = '#000'; x.lineWidth = Math.max(1, s.r * 2 * w);
    const pts = s.pts.map(([u, v]) => [u * w, v * h]);
    if (pts.length === 1){ x.beginPath(); x.arc(pts[0][0], pts[0][1], x.lineWidth / 2, 0, Math.PI * 2); x.fill(); }
    else { x.beginPath(); pts.forEach(([u, v], i) => i ? x.lineTo(u, v) : x.moveTo(u, v)); x.stroke(); }
    const a = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3];
    return m;
  }
  // 4-connected kept parts smaller than `lim` pixels go
  function removeSpecks(op, w, h, lim){
    const N = w * h, seen = new Uint8Array(N), stack = new Int32Array(N), part = [];
    for (let s = 0; s < N; s++){
      if (seen[s] || op[s] < 128) continue;
      let top = 0, n = 0; stack[top++] = s; seen[s] = 1; part.length = 0;
      while (top){
        const i = stack[--top]; if (++n < lim) part.push(i);   // a big part is walked whole (so it is seen) but not listed
        const x = i % w;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1];
        for (const j of nb) if (j >= 0 && !seen[j] && op[j] >= 128){ seen[j] = 1; stack[top++] = j; }
      }
      if (n < lim) part.forEach(i => op[i] = 0);
    }
  }
  function blur(op, w, h, r){
    const t = new Uint8ClampedArray(op.length), b = new Uint8ClampedArray(op);
    for (let k = 0; k < 2; k++){ Bitmap.boxPass(b, t, w, h, r, true); Bitmap.boxPass(t, b, w, h, r, false); }
    op.set(b);
  }

  // D: RGBA pixels of the whole original picture, changed in place
  function apply(D, w, h, p){
    p = Object.assign({}, BG0, p);
    const N = w * h, op = new Uint8ClampedArray(N).fill(255);
    let cols = [], near = null;
    if (p.colour){
      cols = p.colors && p.colors.length ? p.colors.map(c => ({rgb: c, lab: lab(c[0], c[1], c[2])})) : learn(D, w, h);
      if (cols.length){
        const L = new Float32Array(N * 3), d = new Float32Array(N); near = new Uint8Array(N);
        for (let i = 0, k = 0; i < N; i++, k += 4){
          if (D[k + 3] < 8) continue;   // transparent already: background, distance 0
          const c = lab(D[k], D[k + 1], D[k + 2]); L[i * 3] = c[0]; L[i * 3 + 1] = c[1]; L[i * 3 + 2] = c[2];
          let bd = Infinity, bj = 0;
          for (let j = 0; j < cols.length; j++){ const q = cols[j].lab, v = Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]); if (v < bd){ bd = v; bj = j; } }
          d[i] = bd; near[i] = bj;
        }
        const tol = p.tol, band = Math.max(4, 0.6 * tol), lim = tol + band;
        const ramp = v => v <= tol ? 0 : v >= lim ? 255 : 255 * smooth((v - tol) / band);
        if (!p.contig) for (let i = 0; i < N; i++) op[i] = ramp(d[i]);
        else {
          // 1 = background, 2 = on the ramp (its depth into the ramp in dep), 0 = not reached: kept
          const st = new Uint8Array(N), dep = new Uint8Array(N), inQ = new Uint8Array(N), q = new Int32Array(N);
          const maxDep = 2 + Math.ceil(p.soft), stepE = Math.max(3, tol / 3), far = 3 * tol;
          let qh = 0, qn = 0;
          const push = i => { if (!inQ[i]){ inQ[i] = 1; q[(qh + qn++) % N] = i; } };
          const seed = i => { if (d[i] <= tol){ st[i] = 1; push(i); } else if (d[i] < lim){ st[i] = 2; dep[i] = 1; push(i); } };
          for (let x = 0; x < w; x++){ seed(x); seed((h - 1) * w + x); }
          for (let y = 1; y < h - 1; y++){ seed(y * w); seed(y * w + w - 1); }
          const diff = (a, b) => Math.hypot(L[a * 3] - L[b * 3], L[a * 3 + 1] - L[b * 3 + 1], L[a * 3 + 2] - L[b * 3 + 2]);
          const flood = () => { while (qn){
            const i = q[qh]; qh = (qh + 1) % N; qn--; inQ[i] = 0;
            const x = i % w, bg = st[i] === 1;
            const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1];
            for (const j of nb){
              if (j < 0 || st[j] === 1) continue;
              const dj = d[j];
              // within the tolerance, or a small step on from background through a drifting backdrop
              if (dj <= tol || (bg && dj <= far && diff(i, j) <= stepE)){ st[j] = 1; dep[j] = 0; push(j); continue; }
              // into the anti-aliased rim, but only a few pixels deep, so the subject stays
              if (st[j] === 0 && dj < lim){ const nd = (bg ? 0 : dep[i]) + 1; if (nd <= maxDep){ st[j] = 2; dep[j] = nd; push(j); } }
            }
          } };
          flood();
          // gaps closed in by the subject (between spokes, inside letters): background colour the edges can't reach.
          // A gap goes when enough of it is clearly background, so a stray pixel of that colour in the subject stays.
          if (p.holes){
            const seen = new Uint8Array(N), part = [], minPart = Math.max(4, Math.round(N / 400000));
            for (let s = 0; s < N; s++){
              if (seen[s] || st[s] || d[s] > tol * 0.8) continue;
              part.length = 0; part.push(s); seen[s] = 1;
              for (let k = 0; k < part.length; k++){
                const i = part[k], x = i % w;
                const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1];
                for (const j of nb) if (j >= 0 && !seen[j] && !st[j] && d[j] <= tol * 0.8){ seen[j] = 1; part.push(j); }
              }
              if (part.length >= minPart) part.forEach(i => { st[i] = 1; push(i); });
            }
            flood();
          }
          for (let i = 0; i < N; i++) op[i] = st[i] === 1 ? 0 : st[i] === 2 ? ramp(d[i]) : 255;
        }
      }
    }
    if (p.poly && p.poly.length >= 3){
      const m = polyMask(p.poly, w, h), cut = p.polyMode === 'cut';
      for (let i = 0; i < N; i++) op[i] = op[i] * (cut ? 255 - m[i] : m[i]) / 255;
    }
    if (p.invert) for (let i = 0; i < N; i++) op[i] = 255 - op[i];
    if (p.specks) removeSpecks(op, w, h, Math.max(12, N / 2000));
    // the brush has the last word: erase clears what it covers, keep brings it back
    if (p.brush && p.brush.length) p.brush.forEach(s => {
      const m = strokeMask(s, w, h), keep = s.m === 'keep';
      for (let i = 0; i < N; i++) if (m[i]) op[i] = keep ? Math.max(op[i], m[i]) : op[i] * (255 - m[i]) / 255;
    });
    const r = Math.round(p.soft); if (r > 0) blur(op, w, h, r);
    // half-transparent edge pixels: solve C = a·F + (1 − a)·B for the subject's own colour F
    if (near && p.clean && !p.invert) for (let i = 0, k = 0; i < N; i++, k += 4){
      const a = op[i] / 255; if (a <= 0.05 || a >= 1) continue;
      const B = cols[near[i]].rgb;
      for (let t = 0; t < 3; t++) D[k + t] = (D[k + t] - (1 - a) * B[t]) / a;
    }
    for (let i = 0, k = 3; i < N; i++, k += 4) D[k] = D[k] * op[i] / 255;
    return cols;
  }

  /* ---------- as a Fabric filter, with a small cache so other adjustments don't redo it ---------- */
  const cache = [];
  function fingerprint(D, w, h){
    let s = 0; const n = D.length, step = Math.max(4, Math.floor(n / 1024) & ~3);
    for (let i = 0; i < n; i += step) s = (s * 31 + D[i] + D[i + 1] * 7 + D[i + 2] * 13 + D[i + 3] * 17) >>> 0;
    return w + 'x' + h + ':' + s;
  }
  fabric.Image.filters.RemoveBg = fabric.util.createClass(fabric.Image.filters.BaseFilter, {
    type: 'RemoveBg', mainParameter: 'bg',
    isNeutralState(){ return !this.bg; },
    applyTo2d(options){
      const id = options.imageData, key = fingerprint(id.data, id.width, id.height) + JSON.stringify(this.bg);
      const hit = cache.find(c => c.key === key);
      if (hit){ id.data.set(hit.data); return; }
      apply(id.data, id.width, id.height, this.bg);
      cache.unshift({key, data: new Uint8ClampedArray(id.data)}); if (cache.length > 3) cache.pop();
    },
  });
  fabric.Image.filters.RemoveBg.fromObject = fabric.Image.filters.BaseFilter.fromObject;

  /* ---------- panel ---------- */
  let cur = null, keep = null, timer = 0, srcPx = null;
  const BG_IDS = {tol: 'bgTol', soft: 'bgSoft'}, CK = {colour: 'bgColour', contig: 'bgContig', holes: 'bgHoles', specks: 'bgSpecks', clean: 'bgClean', invert: 'bgInvert'};
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  function original(o){
    if (srcPx && srcPx.el === o._originalElement) return srcPx;
    const el = o._originalElement || o.getElement(), c = document.createElement('canvas'); c.width = el.naturalWidth || el.width; c.height = el.naturalHeight || el.height;
    const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(el, 0, 0);
    return srcPx = {el, c, x};
  }
  function showSwatches(){
    const o = cur.o, b = cur.bg, box = $('bgSw');
    let list = b.colors, auto = !list.length;
    if (auto){ const s = original(o); list = learn(s.x.getImageData(0, 0, s.c.width, s.c.height).data, s.c.width, s.c.height).map(c => c.rgb); }
    box.innerHTML = '';
    list.forEach((c, i) => {
      const sw = document.createElement('button'); sw.className = 'sw'; sw.style.background = hex(c);
      sw.title = auto ? 'Learnt from the edges of the picture' : 'Click to remove this colour'; if (!auto) sw.onclick = () => { b.colors.splice(i, 1); update(); };
      box.appendChild(sw);
    });
    // a picture that is already cut out has see-through edges, so there is nothing to learn from: the gaps' colour is picked
    const t = document.createElement('span'); t.className = 'hint'; t.textContent = auto ? (list.length ? 'auto' : 'edges already clear: Pick a gap') : ''; box.appendChild(t);
    $('bgAuto').disabled = auto;
  }
  function show(){
    const b = cur.bg;
    Object.entries(BG_IDS).forEach(([k, id]) => { $(id).value = b[k]; $(id).nextElementSibling.textContent = b[k]; });
    Object.entries(CK).forEach(([k, id]) => $(id).checked = !!b[k]);
    document.querySelectorAll('#bgPolyMode button').forEach(x => x.classList.toggle('on', x.dataset.v === b.polyMode));
    $('bgClear').disabled = !b.poly;
    $('bgColourOpts').classList.toggle('off', !b.colour);
    $('bgHolesRow').classList.toggle('off', !b.contig);
    document.querySelectorAll('#bgBrushMode button').forEach(x => x.classList.toggle('on', !!(mode && mode.kind === 'brush' && mode.m === x.dataset.v)));
    $('bgBrushUndo').disabled = !(b.brush && b.brush.length);
    $('rmbg').classList.toggle('painting', !!(mode && mode.kind === 'brush'));
    showSwatches();
  }
  function update(){
    if (!cur) return;
    show(); $('bgNote').textContent = 'Working…';
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!cur) return;
      const o = cur.o; o.bg = JSON.parse(JSON.stringify(cur.bg)); Bitmap.rebuild(o);
      const s = summary(o); $('bgNote').textContent = s;
    }, 120);
  }
  function summary(o){
    try {
      const el = o.getElement(), c = document.createElement('canvas'), W = Math.min(200, el.width), H = Math.max(1, Math.round(W * el.height / el.width));
      c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(el, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data; let gone = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 128) gone++;
      return `${Math.round(gone / (W * H) * 100)} % of the picture is now transparent.`;
    } catch(e){ return ''; }
  }
  function open(){
    const o = canvas.getActiveObject(); if (!Bitmap.isImg(o)) return toast('Select a picture first');
    Bitmap.closePanels();
    keep = o.bg ? JSON.parse(JSON.stringify(o.bg)) : null;
    cur = {o, bg: fresh(o.bg)};
    if (!o.bg) cur.bg.holes = true;
    $('rmbg').classList.add('on'); update();
  }
  function close(ok){
    if (!cur) return;
    stopMode();
    const o = cur.o; cur = null; $('rmbg').classList.remove('on'); clearTimeout(timer);
    if (!ok){ o.bg = keep; Bitmap.rebuild(o); return; }
    o.bg = isPlain(o.bg) ? null : o.bg; Bitmap.rebuild(o);
    if (JSON.stringify(o.bg) !== JSON.stringify(keep)) commit(o);
  }
  const isPlain = b => !b || (!b.colour && !b.poly && !b.invert && !(b.brush && b.brush.length));

  /* ---------- picking a colour and drawing a boundary on the picture ---------- */
  let mode = null;   // {kind: 'pick' | 'draw', pts, ov}
  const scenePt = e => canvas.getPointer(e);
  function toPicture(o, p){
    const l = fabric.util.transformPoint(p, fabric.util.invertTransform(o.calcTransformMatrix()));
    return {x: l.x + o.width / 2 + (o.cropX || 0), y: l.y + o.height / 2 + (o.cropY || 0)};
  }
  function fromPicture(o, x, y){ return fabric.util.transformPoint(new fabric.Point(x - (o.cropX || 0) - o.width / 2, y - (o.cropY || 0) - o.height / 2), o.calcTransformMatrix()); }
  function startMode(kind, m){
    if (!cur) return; stopMode();
    const ov = document.createElement('div'); ov.className = 'pickov'; $('stage').appendChild(ov);
    mode = {kind, m, pts: [], ov, down: false};
    if (kind === 'brush') return startBrush(ov);
    ov.addEventListener('pointerdown', e => {
      e.preventDefault(); ov.setPointerCapture(e.pointerId);
      const p = scenePt(e);
      if (kind === 'pick') return pickAt(p);
      const first = mode.pts[0], v = canvas.viewportTransform[0];
      if (mode.pts.length >= 3 && first && Math.hypot(p.x - first.x, p.y - first.y) * v < 10) return finishDraw();
      mode.down = true; mode.pts.push(p); canvas.requestRenderAll();
    });
    ov.addEventListener('pointermove', e => {
      if (!mode || kind !== 'draw') return;
      mode.hover = scenePt(e);
      if (mode.down){ const last = mode.pts[mode.pts.length - 1]; if (Math.hypot(mode.hover.x - last.x, mode.hover.y - last.y) * canvas.viewportTransform[0] > 4) mode.pts.push(mode.hover); }
      canvas.requestRenderAll();
    });
    ov.addEventListener('pointerup', () => { if (mode) mode.down = false; });
    ov.addEventListener('dblclick', e => { e.preventDefault(); finishDraw(); });
    $(kind === 'pick' ? 'bgPick' : 'bgDraw').classList.add('on');
    toast(kind === 'pick' ? 'Click the background colour on the picture' : 'Click around the part to keep, or drag to draw · double-click or Enter closes · Esc cancels');
  }
  function stopMode(){
    if (!mode) return;
    mode.ov.remove(); $('bgPick').classList.remove('on'); $('bgDraw').classList.remove('on');
    document.querySelectorAll('#bgBrushMode button').forEach(x => x.classList.remove('on')); $('rmbg').classList.remove('painting');
    mode = null; canvas.requestRenderAll();
  }
  /* the brush: paint on the picture to clear what was missed (Erase) or bring back what went (Keep).
     It stays on for stroke after stroke until its button is pressed again, Esc, or the panel closes. */
  const brushPx = () => +$('bgBrushSize').value;   // across, in screen pixels
  function startBrush(ov){
    ov.style.cursor = 'none';
    ov.addEventListener('pointerdown', e => {
      e.preventDefault(); ov.setPointerCapture(e.pointerId);
      mode.down = true; mode.pts = [scenePt(e)]; mode.hover = mode.pts[0]; canvas.requestRenderAll();
    });
    ov.addEventListener('pointermove', e => {
      if (!mode) return;
      const p = mode.hover = scenePt(e);
      if (mode.down){ const last = mode.pts[mode.pts.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) * canvas.viewportTransform[0] > 2) mode.pts.push(p); }
      canvas.requestRenderAll();
    });
    const end = () => { if (mode && mode.down){ mode.down = false; addStroke(mode.pts, mode.m); mode.pts = []; } };
    ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
    ov.addEventListener('pointerleave', () => { if (mode && !mode.down){ mode.hover = null; canvas.requestRenderAll(); } });
    show();
    toast(mode.m === 'erase' ? 'Paint over what should be see-through · press Erase again or Esc to stop' : 'Paint over what should stay · press Keep again or Esc to stop');
  }
  function addStroke(pts, m){
    if (!cur || !pts.length) return;
    const o = cur.o, full = o.getOriginalSize(), v = canvas.viewportTransform[0];
    const a = toPicture(o, pts[0]), b = toPicture(o, {x: pts[0].x + brushPx() / 2 / v, y: pts[0].y});
    const r = Math.hypot(b.x - a.x, b.y - a.y) / full.width;
    const uv = pts.map(p => { const q = toPicture(o, p); return [+(q.x / full.width).toFixed(5), +(q.y / full.height).toFixed(5)]; });
    cur.bg.brush = (cur.bg.brush || []).concat([{m, r: +r.toFixed(5), pts: uv}]);
    update();
  }
  function pickAt(p){
    const o = cur.o, q = toPicture(o, p), s = original(o);
    if (q.x < 0 || q.y < 0 || q.x >= s.c.width || q.y >= s.c.height){ toast('Click on the picture'); return; }
    const d = s.x.getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data;
    cur.bg.colour = true;
    if (cur.bg.colors.length >= 4) cur.bg.colors.shift();
    cur.bg.colors.push([d[0], d[1], d[2]]);
    stopMode(); update();
  }
  function finishDraw(){
    if (!mode || mode.kind !== 'draw') return;
    const pts = mode.pts; stopMode();
    if (pts.length < 3) return toast('A boundary needs at least three points');
    const o = cur.o, full = o.getOriginalSize();
    cur.bg.poly = pts.map(p => { const q = toPicture(o, p); return [+(q.x / full.width).toFixed(5), +(q.y / full.height).toFixed(5)]; });
    update();
  }
  document.addEventListener('keydown', e => {
    if (!mode) return;
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); stopMode(); }
    if (e.key === 'Enter' && mode.kind === 'draw'){ e.preventDefault(); e.stopPropagation(); finishDraw(); }
    if (e.key === 'Backspace' && mode.kind === 'draw'){ e.preventDefault(); e.stopPropagation(); mode.pts.pop(); canvas.requestRenderAll(); }
  }, true);
  // the boundary being drawn, and the one in use while the panel is open
  canvas.on('after:render', e => {
    if (!cur || !e || e.ctx !== canvas.contextContainer) return;
    const ctx = e.ctx, v = canvas.viewportTransform, S = p => fabric.util.transformPoint(p, v), rs = canvas.getRetinaScaling();
    if (mode && mode.kind === 'brush'){
      const col = mode.m === 'erase' ? '239,68,68' : '34,197,94', d = brushPx();
      ctx.save(); ctx.setTransform(rs, 0, 0, rs, 0, 0);
      if (mode.pts.length){
        ctx.beginPath(); mode.pts.map(S).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        if (mode.pts.length === 1){ const p = S(mode.pts[0]); ctx.lineTo(p.x + 0.1, p.y); }
        ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = d; ctx.strokeStyle = `rgba(${col},.45)`; ctx.stroke();
      }
      if (mode.hover){ const p = S(mode.hover); ctx.beginPath(); ctx.arc(p.x, p.y, d / 2, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4, 3]); ctx.strokeStyle = `rgb(${col})`; ctx.stroke(); }
      ctx.restore();
    }
    let pts = null, closed = true;
    if (mode && mode.kind === 'draw'){ pts = mode.pts.concat(mode.hover && mode.pts.length ? [mode.hover] : []); closed = false; }
    else if (cur.bg.poly){ const full = cur.o.getOriginalSize(); pts = cur.bg.poly.map(([u, w]) => fromPicture(cur.o, u * full.width, w * full.height)); }
    if (!pts || !pts.length) return;
    ctx.save(); ctx.setTransform(rs, 0, 0, rs, 0, 0);
    ctx.beginPath(); pts.map(S).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (closed) ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.setLineDash([6, 4]); ctx.stroke();
    ctx.lineDashOffset = 5; ctx.strokeStyle = '#d946ef'; ctx.stroke();
    if (!closed){ const p = S(pts[0]); ctx.setLineDash([]); ctx.fillStyle = '#d946ef'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  });

  /* ---------- wiring ---------- */
  Object.entries(BG_IDS).forEach(([k, id]) => $(id).addEventListener('input', () => { if (!cur) return; cur.bg[k] = +$(id).value; $(id).nextElementSibling.textContent = cur.bg[k]; update(); }));
  Object.entries(CK).forEach(([k, id]) => $(id).addEventListener('change', () => { if (!cur) return; cur.bg[k] = $(id).checked; update(); }));
  document.querySelectorAll('#bgPolyMode button').forEach(b => b.onclick = () => { if (!cur) return; cur.bg.polyMode = b.dataset.v; update(); });
  $('bgPick').onclick = () => mode && mode.kind === 'pick' ? stopMode() : startMode('pick');
  $('bgAuto').onclick = () => { if (!cur) return; cur.bg.colors = []; update(); };
  $('bgDraw').onclick = () => mode && mode.kind === 'draw' ? finishDraw() : startMode('draw');
  $('bgClear').onclick = () => { if (!cur) return; cur.bg.poly = null; update(); };
  document.querySelectorAll('#bgBrushMode button').forEach(b => b.onclick = () => {
    if (!cur) return;
    if (mode && mode.kind === 'brush' && mode.m === b.dataset.v) stopMode(); else startMode('brush', b.dataset.v);
    show();
  });
  $('bgBrushUndo').onclick = () => { if (!cur || !cur.bg.brush || !cur.bg.brush.length) return; cur.bg.brush = cur.bg.brush.slice(0, -1); update(); };
  $('bgBrushSize').addEventListener('input', () => { $('bgBrushSize').nextElementSibling.textContent = brushPx(); canvas.requestRenderAll(); });
  $('bgReset').onclick = () => { if (!cur) return; cur.bg = fresh(); update(); };
  $('bgCancel').onclick = () => close(false);
  $('bgOk').onclick = () => close(true);
  canvas.on('selection:cleared', () => { if (cur && !mode && !restoring) close(true); });
  canvas.on('selection:updated', () => { if (cur && canvas.getActiveObject() !== cur.o) close(true); });

  return {apply, learn, open, close, startBrush: m => startMode('brush', m), addStroke, get active(){ return !!cur; }, get bg(){ return cur && cur.bg; }};
})();
