/* ===================== heal =====================
   Paint over something in a photo (a person, a mark, a date stamp) and it is filled in from what is around it,
   on this computer. It is content-aware fill in the way of Wexler, Shechtman and Irani (2007) with PatchMatch
   (Barnes et al. 2009) to find the matches:
   1. the painted area and a margin around it are cut out and shrunk into a pyramid until the hole is small
   2. at the smallest size the hole is filled from its rim inwards, as a first guess
   3. at each size, every 7 × 7 patch touching the hole is matched to the most alike patch outside it,
      and each hole pixel becomes the weighted average of what the patches covering it say it should be
   4. the result is enlarged to the next size as its first guess, down to full size
   Unlike background removal, healing changes the picture's own pixels; Undo takes each stroke back. */

const Heal = (() => {
  const P = 3, C = 4;   // patch radius (7 × 7 patches), channels (RGBA)

  /* ---------- the pyramid ---------- */
  function down(L){
    const w = Math.ceil(L.w / 2), h = Math.ceil(L.h / 2), img = new Float32Array(w * h * C), hole = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      let n = 0; const s = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++){
        const X = 2 * x + dx, Y = 2 * y + dy; if (X >= L.w || Y >= L.h) continue;
        const i = Y * L.w + X; if (L.hole[i]) continue;
        n++; for (let c = 0; c < C; c++) s[c] += L.img[i * C + c];
      }
      const j = y * w + x;
      if (!n) hole[j] = 1; else for (let c = 0; c < C; c++) img[j * C + c] = s[c] / n;
    }
    return {w, h, img, hole};
  }
  // grow the known part into the hole a ring at a time, each pixel the average of its known neighbours
  function onion(L){
    const {w, h, img, hole} = L, known = new Uint8Array(w * h);
    let left = []; for (let i = 0; i < w * h; i++) if (hole[i]) left.push(i); else known[i] = 1;
    while (left.length){
      const ring = [], rest = [];
      for (const i of left){
        const x = i % w, y = (i / w) | 0; let n = 0; const s = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
          const X = x + dx, Y = y + dy; if ((!dx && !dy) || X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (!known[j]) continue;
          n++; for (let c = 0; c < C; c++) s[c] += img[j * C + c];
        }
        if (n){ for (let c = 0; c < C; c++) img[i * C + c] = s[c] / n; ring.push(i); } else rest.push(i);
      }
      if (!ring.length) break;   // nothing known at all
      ring.forEach(i => known[i] = 1); left = rest;
    }
  }
  // every pixel within r (square) of the hole
  function dilate(m, w, h, r){
    const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
    for (let y = 0; y < h; y++){ let last = -1e9; for (let x = 0; x < w; x++){ if (m[y * w + x]) last = x; if (x - last <= r) a[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--){ if (m[y * w + x]) last = x; if (last - x <= r) a[y * w + x] = 1; } }
    for (let x = 0; x < w; x++){ let last = -1e9; for (let y = 0; y < h; y++){ if (a[y * w + x]) last = y; if (y - last <= r) b[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--){ if (a[y * w + x]) last = y; if (last - y <= r) b[y * w + x] = 1; } }
    return b;
  }

  /* ---------- one size: match patches, then vote ---------- */
  function solve(L, prev, em, rand, sharp){
    const {w, h, img, hole} = L, near = dilate(hole, w, h, P);
    const tIdx = new Int32Array(w * h).fill(-1), tgt = [], ok = new Uint8Array(w * h), src = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x;
      if (near[i]){ tIdx[i] = tgt.length; tgt.push(i); }
      else if (x >= P && y >= P && x < w - P && y < h - P){ ok[i] = 1; src.push(i); }
    }
    if (!tgt.length) return null;
    if (!src.length) return null;   // no whole patch outside the hole at this size: the first guess stays
    const T = tgt.length, nx = new Int32Array(T), ny = new Int32Array(T), nd = new Float32Array(T);
    const clampX = v => v < 0 ? 0 : v >= w ? w - 1 : v, clampY = v => v < 0 ? 0 : v >= h ? h - 1 : v;
    function dist(tx, ty, sx, sy, cap){
      let s = 0;
      for (let dy = -P; dy <= P; dy++){
        const rt = clampY(ty + dy) * w, rs = (sy + dy) * w;
        for (let dx = -P; dx <= P; dx++){
          const a = (rt + clampX(tx + dx)) * C, b = (rs + sx + dx) * C;
          const d0 = img[a] - img[b], d1 = img[a + 1] - img[b + 1], d2 = img[a + 2] - img[b + 2], d3 = img[a + 3] - img[b + 3];
          s += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
        }
        if (s >= cap) return s;
      }
      return s;
    }
    const randSrc = () => src[(rand() * src.length) | 0];
    for (let k = 0; k < T; k++){
      const i = tgt[k], x = i % w, y = (i / w) | 0;
      let s = -1;
      if (prev){
        const ct = prev.tIdx[(y >> 1) * prev.w + (x >> 1)];
        if (ct >= 0){ const sx = Math.min(w - 1 - P, Math.max(P, prev.nx[ct] * 2 + (x & 1))), sy = Math.min(h - 1 - P, Math.max(P, prev.ny[ct] * 2 + (y & 1))); if (ok[sy * w + sx]) s = sy * w + sx; }
      }
      if (s < 0) s = randSrc();
      nx[k] = s % w; ny[k] = (s / w) | 0;
    }
    const r0 = prev ? Math.max(8, Math.round(Math.max(w, h) / 8)) : Math.max(w, h);
    const acc = new Float32Array(w * h * C), ws = new Float32Array(w * h);
    for (let e = 0; e < em; e++){
      for (let k = 0; k < T; k++){ const i = tgt[k]; nd[k] = dist(i % w, (i / w) | 0, nx[k], ny[k], Infinity); }
      for (let it = 0; it < 2; it++){
        const back = (it + e) & 1, step = back ? 1 : -1;
        for (let n = 0; n < T; n++){
          const k = back ? T - 1 - n : n, i = tgt[k], x = i % w, y = (i / w) | 0;
          let bx = nx[k], by = ny[k], bd = nd[k];
          const tryAt = (sx, sy) => { if (sx < P || sy < P || sx >= w - P || sy >= h - P || !ok[sy * w + sx]) return; const d = dist(x, y, sx, sy, bd); if (d < bd){ bd = d; bx = sx; by = sy; } };
          // a neighbour's match, shifted: good matches spread along the hole
          const X = x + step, Y = y + step;
          if (X >= 0 && X < w){ const j = tIdx[y * w + X]; if (j >= 0) tryAt(nx[j] - step, ny[j]); }
          if (Y >= 0 && Y < h){ const j = tIdx[Y * w + x]; if (j >= 0) tryAt(nx[j], ny[j] - step); }
          for (let r = r0; r >= 1; r >>= 1) tryAt(bx + Math.round((rand() * 2 - 1) * r), by + Math.round((rand() * 2 - 1) * r));
          nx[k] = bx; ny[k] = by; nd[k] = bd;
        }
      }
      // vote: patches that match well count for more
      let mean = 0; for (let k = 0; k < T; k++) mean += nd[k]; mean = mean / T + 1;
      acc.fill(0); ws.fill(0);
      for (let k = 0; k < T; k++){
        const i = tgt[k], x = i % w, y = (i / w) | 0, wt = Math.exp(-nd[k] / (2 * mean)) + 1e-6;
        for (let dy = -P; dy <= P; dy++){
          const Y = y + dy; if (Y < 0 || Y >= h) continue;
          for (let dx = -P; dx <= P; dx++){
            const X = x + dx; if (X < 0 || X >= w) continue;
            const p = Y * w + X; if (!hole[p]) continue;
            const q = ((ny[k] + dy) * w + nx[k] + dx) * C;
            for (let c = 0; c < C; c++) acc[p * C + c] += wt * img[q + c];
            ws[p] += wt;
          }
        }
      }
      for (let p = 0; p < w * h; p++) if (hole[p] && ws[p] > 0) for (let c = 0; c < C; c++) img[p * C + c] = acc[p * C + c] / ws[p];
    }
    // at full size, averaging blurs grain such as grass, sand or skin, so each pixel takes the middle of its own best match:
    // real pixels from the picture. Matches only ever point outside the hole, so nothing copies what it is replacing.
    if (sharp){
      for (let k = 0; k < T; k++){ const i = tgt[k]; nd[k] = dist(i % w, (i / w) | 0, nx[k], ny[k], Infinity); }
      for (let k = 0; k < T; k++){ const p = tgt[k]; if (!hole[p]) continue; const q = (ny[k] * w + nx[k]) * C; for (let c = 0; c < C; c++) img[p * C + c] = img[q + c]; }
    }
    return {w, h, tIdx, nx, ny};
  }
  // the coarser result as the first guess for the hole at this size
  function up(F, Cl){
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++){
      const p = y * F.w + x; if (!F.hole[p]) continue;
      const u = Math.min(Cl.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), v = Math.min(Cl.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(Cl.w - 1, x0 + 1), y1 = Math.min(Cl.h - 1, y0 + 1), fx = u - x0, fy = v - y0;
      for (let c = 0; c < C; c++){
        const g = (X, Y) => Cl.img[(Y * Cl.w + X) * C + c];
        F.img[p * C + c] = (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
      }
    }
  }

  /* D: RGBA pixels (changed in place), mask: coverage per pixel, anything above 0 is filled */
  function inpaint(D, W, H, mask, seed = 1){
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return false;
    // enough of the surroundings to borrow from
    const m = Math.max(24, Math.round(0.75 * Math.max(x1 - x0, y1 - y0)));
    const X0 = Math.max(0, x0 - m), Y0 = Math.max(0, y0 - m), X1 = Math.min(W - 1, x1 + m), Y1 = Math.min(H - 1, y1 + m);
    const w = X1 - X0 + 1, h = Y1 - Y0 + 1, img = new Float32Array(w * h * C), hole = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x, j = (Y0 + y) * W + X0 + x;
      hole[i] = mask[j] ? 1 : 0;
      if (!hole[i]) for (let c = 0; c < C; c++) img[i * C + c] = D[j * 4 + c];
    }
    const levels = [{w, h, img, hole}];
    for (;;){
      const L = levels[levels.length - 1];
      let bx0 = L.w, bx1 = -1, by0 = L.h, by1 = -1;
      for (let i = 0; i < L.w * L.h; i++) if (L.hole[i]){ const x = i % L.w, y = (i / L.w) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      if (bx1 < 0 || Math.max(bx1 - bx0, by1 - by0) <= 8 || L.w < 6 * P || L.h < 6 * P || levels.length >= 10) break;
      levels.push(down(L));
    }
    let s = seed >>> 0 || 1; const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    let prev = null;
    for (let k = levels.length - 1; k >= 0; k--){
      const L = levels[k];
      if (k === levels.length - 1) onion(L); else up(L, levels[k + 1]);
      // a big hole at full size gets one round: the sizes below already settled what goes where
      let holeN = 0; for (let i = 0; i < L.w * L.h; i++) holeN += L.hole[i];
      const em = k === levels.length - 1 ? 6 : k === 0 ? (holeN > 60000 ? 1 : 2) : holeN > 60000 ? 2 : 4;
      prev = solve(L, prev, em, rand, k === 0);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = y * w + x; if (!hole[i]) continue;
      const j = ((Y0 + y) * W + X0 + x) * 4;
      for (let c = 0; c < C; c++) D[j + c] = Math.round(img[i * C + c]);
    }
    return true;
  }

  /* ---------- on a picture in the design ---------- */
  // the picture's own pixels (before background removal and adjustments), at full size
  function pixels(o){
    const el = o._originalElement || o.getElement(), c = document.createElement('canvas');
    c.width = el.naturalWidth || el.width; c.height = el.naturalHeight || el.height;
    const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(el, 0, 0);
    return {c, x, data: x.getImageData(0, 0, c.width, c.height)};
  }
  const toPicture = (o, p) => { const l = fabric.util.transformPoint(p, fabric.util.invertTransform(o.calcTransformMatrix())); return {x: l.x + o.width / 2 + (o.cropX || 0), y: l.y + o.height / 2 + (o.cropY || 0)}; };
  // draw(ctx) paints the area to fill in the picture's own pixels; one Undo step per call
  function healWith(o, draw){
    return new Promise(res => {
      const {c, x, data} = pixels(o), W = c.width, H = c.height;
      const mc = document.createElement('canvas'); mc.width = W; mc.height = H; const mx = mc.getContext('2d');
      mx.fillStyle = mx.strokeStyle = '#000'; mx.lineCap = mx.lineJoin = 'round'; draw(mx);
      const a = mx.getImageData(0, 0, W, H).data, mask = new Uint8Array(W * H);
      for (let i = 0; i < mask.length; i++) mask[i] = a[i * 4 + 3] > 20 ? 255 : 0;
      if (!inpaint(data.data, W, H, mask)) return res(false);
      x.putImageData(data, 0, 0);
      const src = o.getSrc ? o.getSrc() : '', jpeg = /^data:image\/jpe?g/.test(src) || /\.jpe?g($|\?)/i.test(src);
      let opaque = true; if (jpeg) for (let i = 3; i < data.data.length; i += 4) if (data.data[i] < 255){ opaque = false; break; }
      const url = c.toDataURL(jpeg && opaque ? 'image/jpeg' : 'image/png', 0.95);
      const keep = {cropX: o.cropX || 0, cropY: o.cropY || 0, width: o.width, height: o.height, scaleX: o.scaleX, scaleY: o.scaleY}, ctr = o.getCenterPoint();
      o.setSrc(url, () => {
        o.set(keep); o.setPositionByOrigin(ctr, 'center', 'center');
        // the Undo step is taken now, not after the usual short wait, so Undo straight after takes back this stroke
        Bitmap.rebuild(o); o.set('dirty', true); commit(o); clearTimeout(snapT); snapshot(); res(true);
      });
    });
  }
  // areas on the page, in scene units: [{x, y, w, h}] ellipses inside those boxes
  function healAreas(o, areas){
    return healWith(o, ctx => areas.forEach(r => {
      const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([u, v]) => toPicture(o, new fabric.Point(u, v)));
      const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
      const rx = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) / 2, ry = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y) / 2;
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), ang, 0, Math.PI * 2); ctx.fill();
    }));
  }

  /* ---------- the panel: a brush that heals on letting go ---------- */
  let cur = null, ov = null, stroke = null, hover = null, busy = false;
  const size = () => +$('healSize').value;
  function open(){
    const o = canvas.getActiveObject(); if (!Bitmap.isImg(o)) return toast('Select a picture first');
    Bitmap.closePanels(); if (typeof BgRemove !== 'undefined') BgRemove.close(true);
    cur = {o, at: canvas.getObjects().indexOf(o)};
    $('heal').classList.add('on'); $('healNote').textContent = '';
    ov = document.createElement('div'); ov.className = 'pickov'; ov.style.cursor = 'none'; $('stage').appendChild(ov);
    ov.addEventListener('pointerdown', e => {
      if (busy) return;
      e.preventDefault(); ov.setPointerCapture(e.pointerId);
      stroke = [canvas.getPointer(e)]; hover = stroke[0]; canvas.requestRenderAll();
    });
    ov.addEventListener('pointermove', e => {
      const p = hover = canvas.getPointer(e);
      if (stroke){ const l = stroke[stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * canvas.viewportTransform[0] > 2) stroke.push(p); }
      canvas.requestRenderAll();
    });
    const end = () => { if (stroke){ const s = stroke; stroke = null; run(s); } };
    ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
    ov.addEventListener('pointerleave', () => { if (!stroke){ hover = null; canvas.requestRenderAll(); } });
    toast('Paint over what to remove; it is filled in when you let go');
  }
  function close(){
    if (!cur) return;
    cur = null; stroke = null; hover = null;
    if (ov){ ov.remove(); ov = null; }
    $('heal').classList.remove('on'); canvas.requestRenderAll();
  }
  // after Undo the design is rebuilt, so the picture is found again by its place in the list
  function picture(){
    if (!cur) return null;
    if (canvas.getObjects().includes(cur.o)) return cur.o;
    const o = canvas.item(cur.at);
    if (o && Bitmap.isImg(o)){ cur.o = o; return o; }
    return null;
  }
  async function run(pts){
    const o = picture(); if (!o){ close(); return toast('The picture is no longer there'); }
    if (busy) return;
    busy = true; $('healNote').textContent = 'Filling in…'; canvas.requestRenderAll();
    await new Promise(r => setTimeout(r, 30));
    const t0 = performance.now();
    try {
      const v = canvas.viewportTransform[0];
      const a = toPicture(o, pts[0]), b = toPicture(o, {x: pts[0].x + size() / 2 / v, y: pts[0].y});
      const r = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) + 1;   // a pixel more, so the edge of what was painted goes too
      const q = pts.map(p => toPicture(o, p));
      const done = await healWith(o, ctx => {
        ctx.lineWidth = 2 * r; ctx.beginPath();
        if (q.length === 1){ ctx.arc(q[0].x, q[0].y, r, 0, Math.PI * 2); ctx.fill(); return; }
        q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
      });
      $('healNote').textContent = done ? `Filled in (${((performance.now() - t0) / 1000).toFixed(1)} s). Paint again to improve it, or Undo.` : 'That was outside the picture.';
    } catch (e){ console.error(e); $('healNote').textContent = 'Could not fill that in: ' + (e && e.message || e); }
    finally { busy = false; canvas.requestRenderAll(); }
  }
  canvas.on('after:render', e => {
    if (!cur || !e || e.ctx !== canvas.contextContainer) return;
    const ctx = e.ctx, v = canvas.viewportTransform, S = p => fabric.util.transformPoint(p, v), rs = canvas.getRetinaScaling(), d = size();
    ctx.save(); ctx.setTransform(rs, 0, 0, rs, 0, 0);
    if (stroke && stroke.length){
      ctx.beginPath(); stroke.map(S).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (stroke.length === 1){ const p = S(stroke[0]); ctx.lineTo(p.x + 0.1, p.y); }
      ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = d; ctx.strokeStyle = 'rgba(217,70,239,.45)'; ctx.stroke();
    }
    if (hover && !busy){ const p = S(hover); ctx.beginPath(); ctx.arc(p.x, p.y, d / 2, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#d946ef'; ctx.stroke(); }
    ctx.restore();
  });
  $('healSize').addEventListener('input', () => { $('healSize').nextElementSibling.textContent = size(); canvas.requestRenderAll(); });
  $('healDone').onclick = close;
  $('healUndo').onclick = () => { if (!busy) undo(); };
  document.addEventListener('keydown', e => { if (cur && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } }, true);

  return {inpaint, healAreas, open, close, get active(){ return !!cur; }, get busy(){ return busy; }};
})();
