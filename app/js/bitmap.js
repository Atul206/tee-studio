/* ===================== bitmaps =====================
   CorelDRAW's picture commands, following TraceDraw's spec (docs/behavior/bitmap-import.md and resample.md):
   • Import places a picture at the resolution its file records (PNG pHYs, JPEG JFIF or EXIF, TIFF, BMP header),
     96 dpi when it records none, shrunk to fit the print area when it is bigger.
   • Resample gives a picture a new pixel size (pixels, percent or dpi); its place and size on the shirt stay.
   • Adjust: brightness, contrast, saturation, hue, gamma, sharpen, greyscale, invert as live Fabric filters (o.adj),
     so the original pixels are kept and the settings can be changed again later.
   • Crop: an area dragged over the picture, applied as cropX/cropY; Reset crop gives the hidden pixels back.
   • Exported PNG and JPEG files carry their resolution (pHYs chunk, JFIF density) so print software reads the right size. */

// filters on big pictures: the WebGL backend stops at 2048 px textures, the 2D one has no limit
fabric.filterBackend = new fabric.Canvas2dFilterBackend();

const Bitmap = (() => {
  /* ---------- resolution recorded in the file ---------- */
  const str = (b, s, n) => String.fromCharCode(...b.subarray(s, s + n));
  // PNG keeps pixels per metre, so 300 dpi reads back as 299.9994: snap what is that close to a whole number
  const okDpi = v => v >= 1 && v <= 100000 ? (Math.abs(v - Math.round(v)) < 0.01 ? Math.round(v) : v) : null;
  function tiffDpi(dv, base){
    try {
      const le = dv.getUint16(base) === 0x4949, u16 = o => dv.getUint16(base + o, le), u32 = o => dv.getUint32(base + o, le);
      const rat = o => { const d = u32(o + 4); return d ? u32(o) / d : null; };
      const ifd = u32(4), n = u16(ifd); let xr = null, yr = null, unit = 2;
      for (let k = 0; k < n; k++){
        const e = ifd + 2 + k * 12, tag = u16(e);
        if (tag === 0x011A) xr = rat(u32(e + 8));
        if (tag === 0x011B) yr = rat(u32(e + 8));
        if (tag === 0x0128) unit = u16(e + 8);
      }
      if (unit !== 2 && unit !== 3) return null;
      const k = unit === 3 ? 2.54 : 1, x = okDpi(xr * k), y = okDpi(yr * k);
      return x && y ? {x, y} : null;
    } catch(e){ return null; }
  }
  function readDpi(buf){
    const b = new Uint8Array(buf), dv = new DataView(buf);
    try {
      if (b[0] === 0x89 && str(b, 1, 3) === 'PNG'){
        for (let i = 8; i + 12 <= b.length; ){
          const len = dv.getUint32(i), type = str(b, i + 4, 4);
          if (type === 'pHYs' && len >= 9){
            if (b[i + 16] !== 1) return null;   // unit not the metre: only an aspect ratio
            const x = okDpi(dv.getUint32(i + 8) * 0.0254), y = okDpi(dv.getUint32(i + 12) * 0.0254);
            return x && y ? {x, y} : null;
          }
          if (type === 'IDAT' || type === 'IEND') return null;
          i += 12 + len;
        }
        return null;
      }
      if (b[0] === 0xFF && b[1] === 0xD8){
        let exif = null;
        for (let i = 2; i + 4 <= b.length; ){
          if (b[i] !== 0xFF){ i++; continue; }
          const m = b[i + 1];
          if (m === 0xFF){ i++; continue; }
          if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)){ i += 2; continue; }
          if (m === 0xDA || m === 0xD9) break;
          const len = dv.getUint16(i + 2), s = i + 4;
          if (m === 0xE0 && len >= 14 && str(b, s, 5) === 'JFIF\0'){
            const u = b[s + 7], k = u === 2 ? 2.54 : 1;
            if (u === 1 || u === 2){ const x = okDpi(dv.getUint16(s + 8) * k), y = okDpi(dv.getUint16(s + 10) * k); if (x && y) return {x, y}; }
          }
          if (m === 0xE1 && !exif && str(b, s, 6) === 'Exif\0\0') exif = tiffDpi(dv, s + 6);
          i += 2 + len;
        }
        return exif;
      }
      if (str(b, 0, 2) === 'II' || str(b, 0, 2) === 'MM') return tiffDpi(dv, 0);
      if (str(b, 0, 2) === 'BM' && b.length >= 46){
        const x = okDpi(dv.getInt32(38, true) * 0.0254), y = okDpi(dv.getInt32(42, true) * 0.0254);
        return x && y ? {x, y} : null;
      }
    } catch(e){}
    return null;
  }

  /* ---------- resolution written into exports ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b, s, e){ let c = 0xFFFFFFFF; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function withDpi(blob, dpi){
    const b = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(b.buffer);
    if (b[0] === 0x89 && str(b, 1, 3) === 'PNG'){
      // pHYs right after IHDR (any older one dropped): pixels per metre, unit 1 = the metre
      const ppm = Math.round(dpi / 0.0254), ch = new Uint8Array(21), cv = new DataView(ch.buffer);
      cv.setUint32(0, 9); ch.set([0x70, 0x48, 0x59, 0x73], 4); cv.setUint32(8, ppm); cv.setUint32(12, ppm); ch[16] = 1; cv.setUint32(17, crc32(ch, 4, 17));
      const parts = [b.subarray(0, 8)];
      for (let i = 8; i + 12 <= b.length; ){
        const len = dv.getUint32(i), type = str(b, i + 4, 4), end = i + 12 + len;
        if (type !== 'pHYs') parts.push(b.subarray(i, end));
        if (type === 'IHDR') parts.push(ch);
        i = end;
      }
      return new Blob(parts, {type: 'image/png'});
    }
    if (b[0] === 0xFF && b[1] === 0xD8){
      const d = Math.max(1, Math.min(65535, Math.round(dpi)));
      if (b[2] === 0xFF && b[3] === 0xE0 && str(b, 6, 5) === 'JFIF\0'){
        const c = b.slice(), cv = new DataView(c.buffer);
        c[13] = 1; cv.setUint16(14, d); cv.setUint16(16, d);
        return new Blob([c], {type: 'image/jpeg'});
      }
      const app0 = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
      return new Blob([b.subarray(0, 2), app0, b.subarray(2)], {type: 'image/jpeg'});
    }
    return blob;
  }

  /* ---------- import ---------- */
  function importImage(file, place){
    const r = new FileReader();
    r.onload = () => {
      const buf = r.result, dpi = readDpi(buf), fr = new FileReader();
      fr.onload = () => fabric.Image.fromURL(fr.result, (img, err) => {
        if (err || !img.width) return toast(/\.tiff?$/i.test(file.name) ? 'This browser can’t open TIFF files: save it as PNG or JPEG first' : 'Could not read that picture');
        const d = dpi || {x: 96, y: 96}, sx = PX_PER_IN / d.x, sy = PX_PER_IN / d.y;
        const fit = Math.min(1, PA_W / (img.width * sx), PA_H / (img.height * sy));
        img.set({scaleX: sx * fit, scaleY: sy * fit});
        place(img);
        const eff = Math.round(d.x / fit), size = `${inch(img.getScaledWidth())} × ${inch(img.getScaledHeight())} in`;
        toast(fit < 1 ? `Scaled down to fit the print area: ${size} at ${eff} dpi`
                      : `${dpi ? 'Placed at its own size' : 'No resolution in the file: placed at 96 dpi'} · ${size} · ${img.width} × ${img.height} px`);
      });
      fr.readAsDataURL(file);
    };
    r.readAsArrayBuffer(file);
  }

  /* ---------- picture facts ---------- */
  const isImg = o => !!o && o.type === 'image';
  function dpiOf(o){ return {x: o.width / (o.getScaledWidth() / PX_PER_IN), y: o.height / (o.getScaledHeight() / PX_PER_IN)}; }
  function info(o){
    const d = dpiOf(o), dx = Math.round(d.x), dy = Math.round(d.y);
    return `${Math.round(o.width)} × ${Math.round(o.height)} px · ${dx === dy ? dx : dx + ' × ' + dy} dpi`;
  }
  const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  /* ---------- resampling ---------- */
  const lanczos3 = x => { x = Math.abs(x); if (x < 1e-7) return 1; if (x >= 3) return 0; const p = Math.PI * x; return 3 * Math.sin(p) * Math.sin(p / 3) / (p * p); };
  const catmull = x => { x = Math.abs(x); return x < 1 ? 1.5 * x * x * x - 2.5 * x * x + 1 : x < 2 ? -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2 : 0; };
  // which source pixels feed each output pixel, and how much (the filter widens when shrinking, so every pixel counts)
  function weights(sn, dn, kernel, support){
    const scale = dn / sn, fs = scale < 1 ? 1 / scale : 1, r = support * fs, out = new Array(dn);
    for (let i = 0; i < dn; i++){
      const c = (i + 0.5) / scale - 0.5;
      let lo = Math.max(0, Math.ceil(c - r)), hi = Math.min(sn - 1, Math.floor(c + r));
      if (hi < lo) lo = hi = Math.max(0, Math.min(sn - 1, Math.round(c)));
      const w = new Float32Array(hi - lo + 1); let sum = 0;
      for (let j = lo; j <= hi; j++){ const v = kernel((j - c) / fs); w[j - lo] = v; sum += v; }
      if (sum) for (let k = 0; k < w.length; k++) w[k] /= sum;
      out[i] = {lo, w};
    }
    return out;
  }
  const tick = () => new Promise(r => setTimeout(r));
  // separable filter on premultiplied colour, so transparent edges don't turn dark
  async function convolve(S, sw, sh, dw, dh, kernel, support){
    const WX = weights(sw, dw, kernel, support), WY = weights(sh, dh, kernel, support);
    const tmp = new Float32Array(dw * sh * 4), D = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < sh; y++){
      const row = y * sw * 4, orow = y * dw * 4;
      for (let x = 0; x < dw; x++){
        const {lo, w} = WX[x]; let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0, i = row + lo * 4; k < w.length; k++, i += 4){ const wa = w[k] * S[i + 3]; r += S[i] * wa; g += S[i + 1] * wa; b += S[i + 2] * wa; a += wa; }
        const o = orow + x * 4; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
      }
      if ((y & 127) === 127) await tick();
    }
    const stride = dw * 4;
    for (let y = 0; y < dh; y++){
      const {lo, w} = WY[y], orow = y * stride;
      for (let x = 0; x < dw; x++){
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0, i = lo * stride + x * 4; k < w.length; k++, i += stride){ const wk = w[k]; r += tmp[i] * wk; g += tmp[i + 1] * wk; b += tmp[i + 2] * wk; a += tmp[i + 3] * wk; }
        if (a > 0){ const o = orow + x * 4; D[o] = r / a; D[o + 1] = g / a; D[o + 2] = b / a; D[o + 3] = a; }
      }
      if ((y & 127) === 127) await tick();
    }
    return D;
  }
  // three box blurs make a Gaussian of this sigma (box radii from the usual formula)
  function boxRadii(sigma){
    const n = 3, ideal = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    return [0, 1, 2].map(i => ((i < m ? wl : wl + 2) - 1) / 2);
  }
  function boxPass(a, b, w, h, r, horiz){
    const n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, inv = 1 / (r + r + 1);
    for (let l = 0; l < lines; l++){
      const o = horiz ? l * w : l, at = k => a[o + Math.max(0, Math.min(n - 1, k)) * step];
      let acc = at(0) * (r + 1); for (let j = 0; j < r; j++) acc += at(j);
      for (let x = 0; x < n; x++){ acc += at(x + r) - at(x - r - 1); b[o + x * step] = acc * inv; }
    }
  }
  // Enlarge with detail: unsharp mask on lightness only, radius 0.6·g (0.6 to 4 px), amount 0.35 + 0.25·ln g (up to 1.2)
  function detail(D, w, h, g){
    const radius = Math.max(0.6, Math.min(4, 0.6 * g)), amount = Math.min(1.2, 0.35 + 0.25 * Math.log(g));
    const L = new Uint8ClampedArray(w * h), B = new Uint8ClampedArray(w * h), T = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < L.length; i++, p += 4) L[i] = 0.299 * D[p] + 0.587 * D[p + 1] + 0.114 * D[p + 2];
    B.set(L);
    boxRadii(radius).forEach(r => { if (r > 0){ boxPass(B, T, w, h, r, true); boxPass(T, B, w, h, r, false); } });
    for (let i = 0, p = 0; i < L.length; i++, p += 4){ const d = amount * (L[i] - B[i]); D[p] += d; D[p + 1] += d; D[p + 2] += d; }
  }
  async function resamplePixels(src, sx, sy, sw, sh, dw, dh, method){
    const out = document.createElement('canvas'); out.width = dw; out.height = dh;
    const xo = out.getContext('2d');
    if (method === 'hard'){ xo.imageSmoothingEnabled = false; xo.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh); return out; }
    const c0 = document.createElement('canvas'); c0.width = sw; c0.height = sh;
    const x0 = c0.getContext('2d'); x0.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    const S = x0.getImageData(0, 0, sw, sh).data;
    const D = await convolve(S, sw, sh, dw, dh, method === 'sharp' ? catmull : lanczos3, method === 'sharp' ? 2 : 3);
    const g = Math.max(dw / sw, dh / sh);
    if (method === 'detail' && g > 1.05) detail(D, dw, dh, g);
    xo.putImageData(new ImageData(D, dw, dh), 0, 0);
    return out;
  }
  const hasAlpha = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false; };
  // swap a picture's pixels; its place, size on the page, flips, angle and adjustments stay
  function setPixels(o, cnv, done){
    const src = o.getSrc ? o.getSrc() : '', jpeg = /^data:image\/jpe?g/.test(src) && !hasAlpha(cnv);
    const url = cnv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.95);
    const W = o.getScaledWidth(), H = o.getScaledHeight(), c = o.getCenterPoint();
    o.setSrc(url, () => {
      o.set({cropX: 0, cropY: 0, width: cnv.width, height: cnv.height, scaleX: W / cnv.width, scaleY: H / cnv.height});
      if (o.filters && o.filters.length) o.applyFilters();
      o.setPositionByOrigin(c, 'center', 'center'); o.set('dirty', true);
      commit(o); done && done();
    });
  }

  /* ---------- Resample dialog ---------- */
  const RS = {};
  function openResample(){
    const o = canvas.getActiveObject(); if (!isImg(o)) return toast('Select a picture to resample');
    Object.assign(RS, {o, W0: Math.round(o.width), H0: Math.round(o.height), inW: o.getScaledWidth() / PX_PER_IN, inH: o.getScaledHeight() / PX_PER_IN, w: Math.round(o.width), h: Math.round(o.height)});
    $('rsKeep').checked = true;
    rsShow(); $('resample').classList.add('on'); $('rsW').focus(); $('rsW').select();
  }
  // skip: the field being typed into keeps what was typed
  function rsShow(skip){
    const set = (id, v) => { if (id !== skip) $(id).value = v; };
    const {w, h, W0, H0} = RS, r2 = v => Math.round(v * 100) / 100;
    set('rsW', w); set('rsH', h); set('rsWp', r2(w / W0 * 100)); set('rsHp', r2(h / H0 * 100));
    set('rsDx', r2(w / RS.inW)); set('rsDy', r2(h / RS.inH));
    const big = w * h > 100e6, up = w > W0 || h > H0;
    $('rsInfo').innerHTML = `Now <b>${W0} × ${H0} px</b> (${mb(W0 * H0 * 4)}) → <b>${w} × ${h} px</b> (${mb(w * h * 4)}) at ${inch(RS.inW * PX_PER_IN)} × ${inch(RS.inH * PX_PER_IN)} in on the shirt.`
      + (up ? '<br>Enlarging smooths the pixels for print but can’t add detail the picture never had.' : '')
      + (big ? '<br><b style="color:var(--warn)">Very large: the browser may run out of memory.</b>' : '');
    $('rsGo').disabled = !(w >= 1 && h >= 1 && w <= 20000 && h <= 20000);
  }
  function rsSet(w, h, skip){
    const keep = $('rsKeep').checked, clamp = v => Math.max(1, Math.min(20000, Math.round(v) || 1));
    if (w != null){ RS.w = clamp(w); if (keep) RS.h = clamp(RS.w * RS.H0 / RS.W0); }
    if (h != null){ RS.h = clamp(h); if (keep) RS.w = clamp(RS.h * RS.W0 / RS.H0); }
    rsShow(skip);
  }
  [['rsW', (v, id) => rsSet(v, null, id)], ['rsH', (v, id) => rsSet(null, v, id)], ['rsWp', (v, id) => rsSet(RS.W0 * v / 100, null, id)], ['rsHp', (v, id) => rsSet(null, RS.H0 * v / 100, id)],
   ['rsDx', (v, id) => rsSet(v * RS.inW, null, id)], ['rsDy', (v, id) => rsSet(null, v * RS.inH, id)]].forEach(([id, fn]) => {
    $(id).addEventListener('input', () => { const v = parseFloat($(id).value); if (v > 0) fn(v, id); });
    $(id).addEventListener('change', () => rsShow());
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('rsGo').click(); });
  });
  $('rsKeep').onchange = () => { if ($('rsKeep').checked) rsSet(RS.w, null); };
  $('rs300').onclick = () => rsSet(300 * RS.inW, null);
  $('rsCancel').onclick = () => $('resample').classList.remove('on');
  $('resample').onclick = e => { if (e.target === $('resample')) $('resample').classList.remove('on'); };
  $('rsGo').onclick = async () => {
    const {o, w, h} = RS; if (!o) return;
    const go = $('rsGo'); go.disabled = true; go.textContent = 'Working…';
    await tick();
    try {
      // the crop goes into the new pixels: only what shows is resampled
      const el = o._originalElement || o.getElement();
      const cnv = await resamplePixels(el, o.cropX || 0, o.cropY || 0, o.width, o.height, w, h, $('rsMethod').value);
      await new Promise(res => setPixels(o, cnv, res));
      $('resample').classList.remove('on'); toast(`Resampled to ${w} × ${h} px · ${info(o).split('· ')[1]}`);
    } catch(err){ console.error(err); toast('Resample failed: ' + (err && err.message || err)); }
    finally { go.disabled = false; go.textContent = 'Resample'; }
  };

  /* ---------- Adjust panel (live filters) ---------- */
  const ADJ0 = {b: 0, c: 0, s: 0, h: 0, g: 100, sh: 0, gray: false, inv: false};
  const ADJ_IDS = {b: 'adjB', c: 'adjC', s: 'adjS', h: 'adjH', g: 'adjG', sh: 'adjSh'};
  function filtersFor(a){
    const F = fabric.Image.filters, f = [];
    if (a.b) f.push(new F.Brightness({brightness: a.b / 200}));
    if (a.c) f.push(new F.Contrast({contrast: a.c / 100}));
    if (a.s) f.push(new F.Saturation({saturation: a.s / 100}));
    if (a.h) f.push(new F.HueRotation({rotation: a.h / 180}));
    if (a.g !== 100){ const g = a.g / 100; f.push(new F.Gamma({gamma: [g, g, g]})); }
    if (a.sh){ const k = a.sh / 100; f.push(new F.Convolute({matrix: [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0]})); }
    if (a.gray) f.push(new F.Grayscale());
    if (a.inv) f.push(new F.Invert());
    return f;
  }
  let adjO = null, adjKeep = null, adjRaf = 0;
  function applyAdj(o, a){ o.adj = Object.assign({}, a); o.filters = filtersFor(a); o.applyFilters(); o.set('dirty', true); canvas.requestRenderAll(); }
  function readAdj(){ const a = {}; Object.entries(ADJ_IDS).forEach(([k, id]) => a[k] = +$(id).value); a.gray = $('adjGray').checked; a.inv = $('adjInv').checked; return a; }
  function showAdj(a){
    Object.entries(ADJ_IDS).forEach(([k, id]) => { $(id).value = a[k]; $(id).nextElementSibling.textContent = k === 'g' ? (a[k] / 100).toFixed(2) : a[k]; });
    $('adjGray').checked = a.gray; $('adjInv').checked = a.inv;
  }
  function openAdjust(){
    const o = canvas.getActiveObject(); if (!isImg(o)) return toast('Select a picture to adjust');
    adjO = o; adjKeep = Object.assign({}, ADJ0, o.adj || {});
    showAdj(adjKeep); $('adjust').classList.add('on');
  }
  function closeAdjust(ok){
    if (!adjO) return;
    const o = adjO; adjO = null; $('adjust').classList.remove('on');
    if (!ok) applyAdj(o, adjKeep);
    if (JSON.stringify(Object.assign({}, ADJ0, o.adj || {})) !== JSON.stringify(adjKeep)) commit(o);
  }
  const live = () => {
    if (!adjO) return;
    const a = readAdj(); showAdj(a);
    cancelAnimationFrame(adjRaf); adjRaf = requestAnimationFrame(() => adjO && applyAdj(adjO, a));
  };
  Object.values(ADJ_IDS).concat(['adjGray', 'adjInv']).forEach(id => $(id).addEventListener('input', live));
  $('adjReset').onclick = () => { showAdj(ADJ0); live(); };
  $('adjCancel').onclick = () => closeAdjust(false);
  $('adjOk').onclick = () => closeAdjust(true);

  /* ---------- Crop ---------- */
  let crop = null;
  function startCrop(){
    const o = canvas.getActiveObject(); if (!isImg(o)) return toast('Select a picture to crop');
    closeAdjust(true);
    const r = new fabric.Rect({width: o.width, height: o.height, scaleX: o.scaleX, scaleY: o.scaleY, angle: o.angle, flipX: o.flipX, flipY: o.flipY, skewX: o.skewX, skewY: o.skewY,
      fill: 'rgba(0,0,0,0)', strokeWidth: 0, excludeFromExport: true, lockRotation: true, lockSkewingX: true, lockSkewingY: true, objectCaching: false, name: 'Crop area'});
    r.setPositionByOrigin(o.getCenterPoint(), 'center', 'center');
    crop = {o, r, keep: {selectable: o.selectable, evented: o.evented}};
    o.set({selectable: false, evented: false});
    restoring = true; canvas.add(r); restoring = false;
    r.setCoords(); canvas.setActiveObject(r); canvas.requestRenderAll(); refresh();
  }
  function endCrop(){
    const {o, r, keep} = crop; crop = null;
    restoring = true; canvas.remove(r); restoring = false;
    o.set(keep); canvas.setActiveObject(o); canvas.requestRenderAll(); refresh();
    return o;
  }
  function applyCrop(){
    if (!crop) return;
    const {o, r} = crop, m = o.calcTransformMatrix(), inv = fabric.util.invertTransform(m);
    // the crop area's corners in the picture's own pixels (centre at 0, 0)
    const pts = r.getCoords(true, true).map(p => fabric.util.transformPoint(p, inv));
    const hw = o.width / 2, hh = o.height / 2, cl = (v, a) => Math.max(-a, Math.min(a, v));
    const x0 = Math.round(cl(Math.min(...pts.map(p => p.x)), hw) + hw), x1 = Math.round(cl(Math.max(...pts.map(p => p.x)), hw) + hw);
    const y0 = Math.round(cl(Math.min(...pts.map(p => p.y)), hh) + hh), y1 = Math.round(cl(Math.max(...pts.map(p => p.y)), hh) + hh);
    endCrop();
    if (x1 - x0 < 1 || y1 - y0 < 1) return toast('The crop area is outside the picture');
    if (x0 === 0 && y0 === 0 && x1 === Math.round(o.width) && y1 === Math.round(o.height)) return;
    const c = fabric.util.transformPoint(new fabric.Point((x0 + x1) / 2 - hw, (y0 + y1) / 2 - hh), m);
    o.set({cropX: (o.cropX || 0) + x0, cropY: (o.cropY || 0) + y0, width: x1 - x0, height: y1 - y0});
    o.setPositionByOrigin(c, 'center', 'center'); o.set('dirty', true);
    commit(o); toast(`Cropped to ${x1 - x0} × ${y1 - y0} px · Reset crop brings the rest back`);
  }
  function cancelCrop(){ if (crop) endCrop(); }
  function uncrop(){
    const o = canvas.getActiveObject(); if (!isImg(o)) return;
    const full = o.getOriginalSize(); if (!o.cropX && !o.cropY && o.width === full.width && o.height === full.height) return toast('This picture is not cropped');
    const m = o.calcTransformMatrix();
    const c = fabric.util.transformPoint(new fabric.Point(full.width / 2 - (o.cropX + o.width / 2), full.height / 2 - (o.cropY + o.height / 2)), m);
    o.set({cropX: 0, cropY: 0, width: full.width, height: full.height});
    o.setPositionByOrigin(c, 'center', 'center'); o.set('dirty', true); commit(o);
  }
  // shade what the crop cuts away, outline what it keeps
  canvas.on('after:render', e => {
    if (!crop || !e || e.ctx !== canvas.contextContainer) return;
    const ctx = e.ctx, v = canvas.viewportTransform, S = p => fabric.util.transformPoint(p, v);
    const quad = obj => { const m = obj.calcTransformMatrix(), w = obj.width / 2, h = obj.height / 2; return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => S(fabric.util.transformPoint(new fabric.Point(x, y), m))); };
    const path = q => { ctx.moveTo(q[0].x, q[0].y); q.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); };
    const rs = canvas.getRetinaScaling(), qo = quad(crop.o), qr = quad(crop.r);
    ctx.save(); ctx.setTransform(rs, 0, 0, rs, 0, 0);
    ctx.beginPath(); path(qo); path(qr); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill('evenodd');
    ctx.beginPath(); path(qr); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.lineDashOffset = 4.5; ctx.strokeStyle = '#2563eb'; ctx.stroke();
    ctx.restore();
  });
  document.addEventListener('keydown', e => {
    if (!crop || isTyping(e)) return;
    if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); applyCrop(); }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); cancelCrop(); }
  }, true);
  canvas.on('selection:cleared', () => { if (crop && !restoring) setTimeout(() => crop && canvas.setActiveObject(crop.r) && canvas.requestRenderAll()); });

  /* ---------- Save the picture's pixels ---------- */
  async function savePixels(){
    const o = canvas.getActiveObject(); if (!isImg(o)) return toast('Select a picture to save');
    const c = document.createElement('canvas'); c.width = Math.round(o.width); c.height = Math.round(o.height);
    c.getContext('2d').drawImage(o.getElement(), o.cropX || 0, o.cropY || 0, o.width, o.height, 0, 0, c.width, c.height);
    const blob = await withDpi(await new Promise(res => c.toBlob(res, 'image/png')), dpiOf(o).x);
    const where = await Store.output(blob, `${Store.slug(nameOf(o))}-${c.width}x${c.height}.png`, true);
    toast(Store.canWrite() ? `Saved ${where}` : 'Downloaded the picture');
  }

  function run(cmd){
    if (cmd === 'resample') return openResample();
    if (cmd === 'adjust') return openAdjust();
    if (cmd === 'crop') return startCrop();
    if (cmd === 'cropok') return applyCrop();
    if (cmd === 'cropcancel') return cancelCrop();
    if (cmd === 'uncrop') return uncrop();
    if (cmd === 'save') return savePixels();
  }
  function syncBar(o){
    $('bmInfo').textContent = info(o);
    const full = o.getOriginalSize();
    $('bmUncrop').style.display = o.cropX || o.cropY || o.width !== full.width || o.height !== full.height ? '' : 'none';
  }
  // a picture that stops being selected takes its adjustments as they are
  canvas.on('selection:cleared', () => { if (adjO && !crop) closeAdjust(true); });
  canvas.on('selection:updated', () => { if (adjO && canvas.getActiveObject() !== adjO) closeAdjust(true); });

  return {readDpi, withDpi, importImage, run, syncBar, isImg, info, dpiOf, get cropping(){ return !!crop; }, cancelCrop};
})();
