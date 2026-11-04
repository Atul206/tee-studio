/* Runs inside the headless Tee Studio page. Works on images and renders logos with the app's own code,
   so what an agent sees here is what the app draws. */
window.__logo = {
  sources: new Map(), traces: new Map(), n: 0,

  /* ---------- source images ---------- */
  async load(dataUrl, {flip, rotate}){
    const im = new Image(); im.src = dataUrl; await im.decode();
    const lim = 4000, f = Math.min(1, lim / Math.max(im.naturalWidth || 1, im.naturalHeight || 1)), w = (im.naturalWidth || 1000) * f, h = (im.naturalHeight || 1000) * f;
    const q = ((rotate || 0) % 360 + 360) % 360, side = q === 90 || q === 270, c = document.createElement('canvas');
    c.width = Math.round(side ? h : w); c.height = Math.round(side ? w : h);
    const x = c.getContext('2d', {willReadFrequently: true});
    x.translate(c.width / 2, c.height / 2); x.rotate(q * Math.PI / 180);
    if (flip === 'horizontal' || flip === 'both') x.scale(-1, 1);
    if (flip === 'vertical' || flip === 'both') x.scale(1, -1);
    x.drawImage(im, -w / 2, -h / 2, w, h);
    const id = 'src-' + (++this.n); this.sources.set(id, c);
    return {source_id: id, width: c.width, height: c.height};
  },
  src(id){ const c = this.sources.get(id); if (!c) throw new Error(`Unknown source_id "${id}". Load the image first with logo_load_source.`); return c; },

  /* ---------- drawing helpers ---------- */
  fit(r, maxPx){ return Math.min(maxPx / r.w, maxPx / r.h); },
  clampRegion(region, W, H){
    const r = region ? {x: region.x, y: region.y, w: region.w, h: region.h} : {x: 0, y: 0, w: W, h: H};
    r.x = Math.max(0, Math.min(W - 1, r.x)); r.y = Math.max(0, Math.min(H - 1, r.y));
    r.w = Math.max(1, Math.min(W - r.x, r.w)); r.h = Math.max(1, Math.min(H - r.y, r.h));
    return r;
  },
  // a grid labelled in image coordinates, so positions can be read off the picture
  grid(x, r, k){
    const raw = Math.max(r.w, r.h) / 10, m = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(v => v * m).find(v => v >= raw);
    x.save(); x.font = 'bold 12px monospace'; x.lineWidth = 1;
    for (let v = Math.ceil(r.x / step) * step; v <= r.x + r.w; v += step){ const s = Math.round((v - r.x) * k) + .5; x.strokeStyle = 'rgba(255,225,0,.35)'; x.beginPath(); x.moveTo(s, 0); x.lineTo(s, r.h * k); x.stroke(); this.label(x, +v.toFixed(2), s + 2, 12); }
    for (let v = Math.ceil(r.y / step) * step; v <= r.y + r.h; v += step){ const s = Math.round((v - r.y) * k) + .5; x.strokeStyle = 'rgba(255,225,0,.35)'; x.beginPath(); x.moveTo(0, s); x.lineTo(r.w * k, s); x.stroke(); this.label(x, +v.toFixed(2), 2, s - 2); }
    x.restore();
  },
  label(x, t, a, b){ x.strokeStyle = '#000'; x.lineWidth = 3; x.strokeText(t, a, b); x.fillStyle = '#ffe100'; x.fillText(t, a, b); },
  output(c){ return c.toDataURL('image/png').split(',')[1]; },

  view(id, {region, grid = true, contrast = 1, maxPx = 1100}){
    const s = this.src(id), r = this.clampRegion(region, s.width, s.height), k = this.fit(r, maxPx), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k));
    const x = c.getContext('2d'); x.filter = contrast !== 1 ? `contrast(${contrast})` : 'none'; x.drawImage(s, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height); x.filter = 'none';
    if (grid) this.grid(x, r, k);
    return {image: this.output(c), region: r, scale: +k.toFixed(4)};
  },

  /* ---------- auto trace (flat artwork) ---------- */
  trace(id, {region, colors = 2, detail = 1, smooth = 1, keepBackground = false}){
    const s = this.src(id), r = this.clampRegion(region, s.width, s.height), k = Math.min(4, 1600 / Math.max(r.w, r.h)), c = document.createElement('canvas');   // small art is enlarged first: curves come out smooth, not faceted
    c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
    const x = c.getContext('2d', {willReadFrequently: true}); x.imageSmoothingQuality = 'high'; x.drawImage(s, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const data = x.getImageData(0, 0, c.width, c.height);
    const svg = ImageTracer.imagedataToSVG(data, {pal: this.palette(data, colors), colorquantcycles: 1, ltres: detail * 0.5, qtres: detail * 0.5, pathomit: 16, rightangleenhance: true, blurradius: 2, blurdelta: 64, strokewidth: 0, linefilter: false, roundcoords: 2, viewbox: false, desc: false});
    // the background is the colour round the edge of the picture
    let br = 0, bg = 0, bb = 0, ba = 0, n = 0;
    const px = data.data, W = c.width, H = c.height, edge = i => { br += px[i]; bg += px[i + 1]; bb += px[i + 2]; ba += px[i + 3]; n++; };
    for (let i = 0; i < W; i += 4){ edge(i * 4); edge(((H - 1) * W + i) * 4); }
    for (let i = 0; i < H; i += 4){ edge(i * W * 4); edge((i * W + W - 1) * 4); }
    const back = [br / n, bg / n, bb / n], clearEdge = ba / n < 40;
    const byColour = new Map(), doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    doc.querySelectorAll('path').forEach(p => {
      if (+p.getAttribute('opacity') === 0) return;
      const m = (p.getAttribute('fill') || '').match(/(\d+)\D+(\d+)\D+(\d+)/); if (!m) return;
      const rgb = [+m[1], +m[2], +m[3]];
      if (!keepBackground && !clearEdge && Math.hypot(rgb[0] - back[0], rgb[1] - back[1], rgb[2] - back[2]) < 45) return;
      const nums = {i: 0}, d = p.getAttribute('d').replace(/-?\d+(\.\d+)?/g, v => { const odd = nums.i++ % 2; return +((+v / k) + (odd ? r.y : r.x)).toFixed(2); });
      const hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
      byColour.set(hex, (byColour.get(hex) || '') + d);
    });
    const elements = [...byColour].map(([fill, d]) => ({type: 'path', d, fill, fillRule: 'evenodd', name: 'Traced ' + fill}));
    const id2 = 'trace-' + (++this.n); this.traces.set(id2, elements);
    return {trace_id: id2, viewBox: [r.x, r.y, r.w, r.h], colours: elements.map(e => ({fill: e.fill, subpaths: (e.d.match(/M/g) || []).length, bytes: e.d.length}))};
  },
  // the main colours: the commonest first, then whichever is furthest from those so far, refined by k-means.
  // A small area in a strong colour survives, and the blend along an edge never becomes a colour of its own.
  palette(data, count){
    const px = data.data, buckets = new Map(); let clear = 0;
    for (let i = 0; i < px.length; i += 4){
      if (px[i + 3] < 128){ clear++; continue; }
      const key = (px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | px[i + 2] >> 3, b = buckets.get(key) || {r: 0, g: 0, b: 0, n: 0};
      b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2]; b.n++; buckets.set(key, b);
    }
    const all = [...buckets.values()].map(b => ({r: b.r / b.n, g: b.g / b.n, b: b.b / b.n, n: b.n}));
    const dist = (p, q) => (p.r - q.r) ** 2 + (p.g - q.g) ** 2 + (p.b - q.b) ** 2;
    // a bucket too rare to be a real colour (edge blend, specks) cannot start a cluster
    const least = px.length / 4 * 0.0015, solid = all.filter(b => b.n >= least), seeds = solid.length ? solid : all;
    const want = Math.max(1, count - (clear ? 1 : 0));
    let centres = [seeds.reduce((m, b) => b.n > m.n ? b : m, seeds[0])];
    while (centres.length < want && centres.length < seeds.length){
      centres.push(seeds.reduce((m, b) => { const d = Math.min(...centres.map(c => dist(b, c))); return d > m.d ? {d, b} : m; }, {d: -1, b: seeds[0]}).b);
    }
    for (let it = 0; it < 8; it++){
      const sum = centres.map(() => ({r: 0, g: 0, b: 0, n: 0}));
      seeds.forEach(b => { let best = 0, bd = Infinity; centres.forEach((c, i) => { const d = dist(b, c); if (d < bd){ bd = d; best = i; } }); const t = sum[best]; t.r += b.r * b.n; t.g += b.g * b.n; t.b += b.b * b.n; t.n += b.n; });
      centres = centres.map((c, i) => sum[i].n ? {r: sum[i].r / sum[i].n, g: sum[i].g / sum[i].n, b: sum[i].b / sum[i].n, n: sum[i].n} : c);
    }
    const pal = centres.map(c => ({r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 255}));
    if (clear) pal.push({r: 0, g: 0, b: 0, a: 0});
    return pal;
  },
  // {type: 'trace', trace_id} stands for everything that trace found
  expand(spec){
    const elements = spec.elements.flatMap(e => {
      if (e.type !== 'trace') return [e];
      const t = this.traces.get(e.trace_id); if (!t) throw new Error(`Unknown trace_id "${e.trace_id}"`);
      return t.map(p => Object.assign({}, p, e.fill ? {fill: e.fill} : {}));
    });
    return Object.assign({}, spec, {elements});
  },

  /* ---------- logos ---------- */
  async canvasFor(spec, r, k, ink){
    const s = this.expand(spec); await LogoTemplates.fonts(s);
    const g = LogoTemplates.build(s, ink), el = document.createElement('canvas');
    const sc = new fabric.StaticCanvas(el, {width: Math.max(1, Math.round(r.w * k)), height: Math.max(1, Math.round(r.h * k)), enableRetinaScaling: false, renderOnAddRemove: false});
    sc.setViewportTransform([k, 0, 0, k, -r.x * k, -r.y * k]); sc.add(g); sc.renderAll();
    return {sc, el: sc.lowerCanvasEl};
  },
  // the logo on its own, and laid in red over the source
  async preview(spec, {source_id, region, background = '#111111', maxPx = 1100}){
    const v = spec.viewBox, r = region ? {x: region.x, y: region.y, w: region.w, h: region.h} : {x: v[0], y: v[1], w: v[2], h: v[3]}, k = this.fit(r, maxPx), out = {};
    const clean = await this.canvasFor(spec, r, k), a = document.createElement('canvas'); a.width = clean.el.width; a.height = clean.el.height;
    const xa = a.getContext('2d'); xa.fillStyle = background; xa.fillRect(0, 0, a.width, a.height); xa.drawImage(clean.el, 0, 0); clean.sc.dispose();
    out.clean = this.output(a);
    if (source_id){
      const s = this.src(source_id), red = await this.canvasFor(spec, r, k, '#ff2a2a'), b = document.createElement('canvas'); b.width = a.width; b.height = a.height;
      const xb = b.getContext('2d'); xb.fillStyle = '#000'; xb.fillRect(0, 0, b.width, b.height); xb.globalAlpha = .75;
      xb.drawImage(s, r.x, r.y, r.w, r.h, 0, 0, b.width, b.height); xb.globalAlpha = 1; xb.drawImage(red.el, 0, 0); red.sc.dispose();
      this.grid(xb, r, k);
      out.overlay = this.output(b);
    }
    return out;
  },
  fonts: () => FONTS,
  // a page exactly the logo's size at the chosen width, then the app's own exporters
  async exportLogo(spec, {format, dpi, widthIn}){
    const s = this.expand(spec); await LogoTemplates.fonts(s);
    restoring = true; canvas.discardActiveObject(); canvas.getObjects().slice().forEach(o => canvas.remove(o)); restoring = false;
    const g = LogoTemplates.build(s), k = widthIn * PX_PER_IN / g.width, wIn = widthIn, hIn = g.height * k / PX_PER_IN;
    setPageSize(wIn, hIn); g.scale(k); restoring = true; canvas.add(placeCenter(g)); restoring = false; canvas.renderAll();
    if (format === 'png'){ const u = await exportPNG(dpi, true, page); return {base64: u.split(',')[1], width_in: wIn, height_in: hIn}; }
    const blob = format === 'svg' ? await exportSVG(page, false) : (await exportPSD(page, dpi)).blob, bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return {base64: btoa(bin), width_in: wIn, height_in: hIn};
  },
};
