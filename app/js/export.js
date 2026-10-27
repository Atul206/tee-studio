/* ===================== export ===================== */
// Everything here renders from the live Fabric canvas. Scene units are PX_PER_IN per inch; the print area is
// PA_W × PA_H scene px at canvas offset (paL, paT) scaled by `zoom`.
// What is exported is an area R (the print area, the artwork's bounds or the selection, in scene units) at a
// scale s (output inches per inch on the shirt, 1 = actual size) and a resolution: pixels = R inches × s × dpi.
let exFmt = 'png';
const FMT_NOTES = {
  png:'Print-ready PNG. Transparent background by default — this is what DTG/DTF printers want. The file records its resolution, so it opens at the right size.',
  jpg:'Flat JPG on white. Good for sharing or quick proofs, not for printing on coloured shirts. The file records its resolution.',
  svg:'Vector SVG — opens in Illustrator, Inkscape or CorelDRAW and stays editable. Fonts are embedded in the file.',
  psd:'Layered Photoshop file: one layer per object, groups become layer folders, names/opacity/blend modes/hidden state kept. Text is rasterised (not editable type) at the chosen resolution.',
  pdf:'PDF with its page sized to the export size, the design at the chosen resolution. Accepted by most print shops.',
  mockup:'A photo-style preview of the design on the shirt colour you picked — for listings and client approval.',
};
const BLEND_PSD = {'source-over':'normal', multiply:'multiply', screen:'screen', overlay:'overlay', darken:'darken', lighten:'lighten', difference:'difference'};
const EX = {area: 'print', scale: 1, dpi: 300, unit: 'in', sel: []};
const PRINT_R = {x: 0, y: 0, w: PA_W, h: PA_H};
const UNITS = {in: 1, cm: 2.54, mm: 25.4};
const AREA_NAMES = {print: 'print area', artwork: 'artwork only', selection: 'selection only'};
const MAX_SIDE = 30000, MAX_PIXELS = 250e6;   // past these browsers give up on a canvas
const kOf = (dpi, s = 1) => s * dpi / PX_PER_IN;                       // output px per scene unit
const pxOf = (len, k) => Math.max(1, Math.floor(len * k * (1 + 1e-9)));  // so a typed 3000 px stays 3000

async function renderPage(p, fn){
  // groups being edited inside are folded back for the export, then opened again
  if (typeof Focus !== 'undefined' && Focus.stack.length) return Focus.collapsedAsync(() => renderPage(p, fn));
  // render a page that is not on screen by temporarily loading it
  if (p === page) return fn();
  const cur = docJSON(), sel = canvas.getActiveObject();
  canvas.discardActiveObject();
  await new Promise(res => { restoring = true; canvas.loadFromJSON(pages[p] || {objects:[]}, res); });
  try { return await fn(); }
  finally {
    await new Promise(res => canvas.loadFromJSON(cur, () => { canvas.getObjects().forEach(applyLock); restoring = false; res(); }));
    canvas.requestRenderAll(); refresh();
  }
}

/* ---------- the area ---------- */
// Scene-space bounds that also work for objects inside a group (getBoundingRect is group-relative there).
function absBounds(o){
  const m = o.calcTransformMatrix(), d = o._getNonTransformedDimensions();
  const pts = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => fabric.util.transformPoint(new fabric.Point(x * d.x, y * d.y), m));
  return fabric.util.makeBoundingBoxFromPoints(pts);
}
// what an object draws: effects reach past its box, text swashes past the text box
function drawnBounds(o){
  const b = Effects.hasAny(o) ? Effects.sceneBounds(o) : absBounds(o), sh = o.shadow;
  // a picture's box is exact: "Selection" of one gives its own pixel size
  const pad = (o.type === 'image' ? 0 : 1) + (o.text != null ? o.fontSize * (o.path ? 1.3 : 0.2) * Math.abs(o.scaleY || 1) : 0) + (sh ? sh.blur + Math.max(Math.abs(sh.offsetX), Math.abs(sh.offsetY)) : 0);
  return {l: b.left - pad, t: b.top - pad, r: b.left + b.width + pad, b: b.top + b.height + pad};
}
function exportRegion(area, sel){
  const objs = area === 'selection' ? (sel || []).filter(o => canvas.getObjects().includes(o) || o.group) : canvas.getObjects().filter(o => o.visible && !o.excludeFromExport);
  if (area === 'print' || !objs.length) return PRINT_R;
  const bs = objs.map(drawnBounds);
  let l = Math.min(...bs.map(b => b.l)), t = Math.min(...bs.map(b => b.t)), r = Math.max(...bs.map(b => b.r)), b = Math.max(...bs.map(b => b.b));
  // the print area crops artwork anyway; a selection goes out whole
  if (area === 'artwork'){ l = Math.max(0, l); t = Math.max(0, t); r = Math.min(PA_W, r); b = Math.min(PA_H, b); if (r <= l || b <= t) return PRINT_R; }
  return {x: l, y: t, w: r - l, h: b - t};
}
function cropArgs(dpi, R = PRINT_R, s = 1){
  return {left: paL + R.x * zoom, top: paT + R.y * zoom, width: R.w * zoom, height: R.h * zoom, multiplier: kOf(dpi, s) * (1 + 1e-9) / zoom};
}
const printClip = () => new fabric.Rect({left:0, top:0, width:PA_W, height:PA_H, absolutePositioned:true});
// for "Selection": everything else is hidden while fn draws
async function onlyThese(objs, fn){
  if (!objs) return fn();
  const hide = canvas.getObjects().filter(o => o.visible && !objs.includes(o));
  hide.forEach(o => o.visible = false);
  try { return await fn(); } finally { hide.forEach(o => o.visible = true); }
}
const selOf = opt => opt && opt.area === 'selection' ? opt.sel : null;

/* ---------- PNG / JPG ---------- */
async function rasterize(dpi, transparent, p, fmt = 'png', opt = {}){
  return renderPage(p, () => {
    const sel = canvas.getActiveObject(), clip = canvas.clipPath, bg = canvas.backgroundColor, only = selOf(opt), s = opt.scale || 1;
    canvas.discardActiveObject();
    const R = exportRegion(opt.area || 'print', only);
    if (!transparent || fmt === 'jpeg') canvas.backgroundColor = '#ffffff';
    canvas.clipPath = only ? null : printClip();
    return onlyThese(only, () => canvas.toDataURL(Object.assign({format: fmt, quality:.95}, cropArgs(dpi, R, s)))).then(url => {
      canvas.clipPath = clip; canvas.backgroundColor = bg; if (sel) canvas.setActiveObject(sel); canvas.requestRenderAll();
      const k = kOf(dpi, s);
      return {url, R, pw: pxOf(R.w, k), ph: pxOf(R.h, k), inW: R.w / PX_PER_IN * s, inH: R.h / PX_PER_IN * s};
    });
  });
}
async function exportPNG(dpi, transparent, p, fmt = 'png', opt){ return (await rasterize(dpi, transparent, p, fmt, opt)).url; }

/* ---------- SVG (fonts embedded so the file is self-contained) ---------- */
function usedFonts(objs){ return [...new Set(leafs(objs).filter(o => o.fontFamily).map(o => o.fontFamily))]; }
function fontFaceCss(families){
  const css = window.TEE_FONT_CSS || '';
  return css.split(/(?=\/\* latin \*\/)/).filter(b => families.some(f => b.includes(`font-family: '${f}'`))).join('\n');
}
// SVG has no text-on-path equivalent of Fabric's layout, so those texts (or all, when asked) go out as letter outlines
async function exportSVG(p, outlineAll, opt = {}){
  return renderPage(p, async () => {
    const only = selOf(opt), s = opt.scale || 1;
    if (only) canvas.discardActiveObject();
    const R = exportRegion(opt.area || 'print', only);
    // "Selection": the rest is left out of the file for the time of the export
    const left = only ? canvas.getObjects().filter(o => !o.excludeFromExport && !only.includes(o)) : [];
    left.forEach(o => o.excludeFromExport = true);
    const swaps = [], texts = canvas.getObjects().filter(o => !o.excludeFromExport && !Effects.hasAny(o) && o.text != null && (o.path || outlineAll));
    // live effects go out baked: contour steps and warped outlines as paths, flat shadows as SVG blur filters
    const fxObjs = canvas.getObjects().filter(o => !o.excludeFromExport && Effects.hasAny(o));
    if (fxObjs.length){
      if (fxObjs.some(o => o.text != null)) await TextCurves.ready();
      var fxRestoring = restoring; restoring = true;
      fxObjs.forEach(o => {
        const {main, steps} = Effects.bake(o), i = canvas.getObjects().indexOf(o), body = main || o;
        const s = o.fx.shadow;
        const pieces = steps.filter(x => x.order < 0).map(x => x.obj).concat([body], steps.filter(x => x.order > 0).map(x => x.obj));
        if (o.fx.blend){ const S = Blend.steps(o), st = Blend.bake(o); if (S && S.below) pieces.unshift(...st); else pieces.push(...st); }
        const keepFx = o.fx; if (body === o) o.fx = null;
        if (s && (!s.kind || s.kind === 'flat')){ const c = new fabric.Color(s.color || '#000'); c.setAlpha((s.opacity != null ? s.opacity : 50) / 100); pieces.forEach(p => p.set('shadow', new fabric.Shadow({color: c.toRgba(), blur: (s.feather || 0) * 2, offsetX: s.dx, offsetY: s.dy}))); }
        canvas.remove(o); pieces.forEach((p, k) => canvas.insertAt(p, i + k));
        swaps.push({restoreFx: [o, keepFx], pieces, o, i});
      });
      restoring = fxRestoring;
    }
    if (texts.length){
      await TextCurves.ready(); Shaping.init(); var wasRestoring = restoring; restoring = true;
      texts.forEach(t => {
        const r = Shaping.toFabric(TextCurves.item(t), t, nameOf(t));
        if (r){ r.set({fillRule: 'nonzero', visible: t.visible}); const i = canvas.getObjects().indexOf(t); canvas.remove(t); canvas.insertAt(r, i); swaps.push([t, r, i]); }
      });
      paper.project.clear();
    }
    const vpt = canvas.viewportTransform.slice();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const inW = +(R.w / PX_PER_IN * s).toFixed(4), inH = +(R.h / PX_PER_IN * s).toFixed(4);
    const svg = canvas.toSVG({width: inW + 'in', height: inH + 'in', viewBox: {x: R.x, y: R.y, width: R.w, height: R.h}});
    canvas.setViewportTransform(vpt);
    swaps.reverse().forEach(sw => {
      if (sw.pieces){ restoring = true; sw.pieces.forEach(p => { p.set('shadow', null); canvas.remove(p); }); canvas.insertAt(sw.o, sw.i); sw.o.fx = sw.restoreFx[1]; sw.o.__fx = null; restoring = false; return; }
      const [t, r, i] = sw; canvas.remove(r); canvas.insertAt(t, i);
    });
    if (texts.length) restoring = wasRestoring;
    left.forEach(o => o.excludeFromExport = false);
    const css = fontFaceCss(usedFonts(canvas.getObjects().filter(o => !only || only.includes(o))));
    return new Blob([svg.replace(/<defs>/, `<defs><style>${css}</style>`)], {type:'image/svg+xml'});
  });
}

/* ---------- Mockup ---------- */
function loadImg(src){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function exportMockup(p){
  const W = 2000, H = 2100, k = W / (PA_W / 0.36);
  const svg = $('shirt').cloneNode(true); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const shirtImg = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)));
  const design = await loadImg(await exportPNG(Math.round(PA_W * k / PA_IN.w), true, p));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#f4f4f5'); g.addColorStop(1, '#d4d4d8'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.drawImage(shirtImg, 0, 0, W, H);
  x.drawImage(design, (W - PA_W * k) / 2, 0.22 * H, PA_W * k, PA_H * k);
  return c.toDataURL('image/png');
}

/* ---------- PSD (ag-psd) ---------- */
// Renders one object alone into a canvas cropped to its bounds, at output resolution.
// F: the export frame {R, k, W, H} — area in scene units, px per scene unit, document size in px.
function renderAlone(target, group, F){
  const {R, k: scale, W, H} = F, all = canvas.getObjects();
  const saved = all.map(o => [o, o.visible, o.opacity, o.globalCompositeOperation]);
  const kids = group ? group.getObjects().map(o => [o, o.visible, o.opacity, o.globalCompositeOperation]) : [];
  all.forEach(o => o.visible = false);
  const host = group || target;
  host.set({visible: true, opacity: group ? 1 : host.opacity, globalCompositeOperation: 'source-over'});
  if (group){ group.getObjects().forEach(o => o.visible = o === target); target.set({opacity: 1, globalCompositeOperation:'source-over'}); group.set('dirty', true); }
  else target.set('opacity', 1);
  // bounds in scene units, padded for strokes, shadows, effects and text swashes, clipped to the document
  const b = drawnBounds(target);
  const x0 = Math.max(0, Math.floor((b.l - R.x) * scale)), y0 = Math.max(0, Math.floor((b.t - R.y) * scale));
  const x1 = Math.min(W, Math.ceil((b.r - R.x) * scale)), y1 = Math.min(H, Math.ceil((b.b - R.y) * scale));
  let out = null;
  if (x1 > x0 && y1 > y0){
    const m = scale / zoom;
    out = canvas.toCanvasElement(m, {left: paL + R.x * zoom + x0 / m, top: paT + R.y * zoom + y0 / m, width: (x1 - x0) / m, height: (y1 - y0) / m});
  }
  saved.forEach(([o, v, op, g]) => o.set({visible: v, opacity: op, globalCompositeOperation: g}));
  kids.forEach(([o, v, op, g]) => o.set({visible: v, opacity: op, globalCompositeOperation: g}));
  if (group) group.set('dirty', true);
  return out && {canvas: out, left: x0, top: y0};
}
function psdLayer(o, group, F, layerPngs){
  const r = renderAlone(o, group, F);
  const layer = {name: nameOf(o).slice(0, 60), hidden: !o.visible, opacity: o.opacity ?? 1, blendMode: BLEND_PSD[o.globalCompositeOperation] || 'normal'};
  if (r){ Object.assign(layer, r); layerPngs.push({name: layer.name, canvas: r.canvas}); }
  else { const c = document.createElement('canvas'); c.width = c.height = 1; Object.assign(layer, {canvas: c, left: 0, top: 0}); }
  return layer;
}
async function exportPSD(p, dpi, opts = {}){
  return renderPage(p, async () => {
    const sel = canvas.getActiveObject(), clip = canvas.clipPath, only = selOf(opts), s = opts.scale || 1;
    canvas.discardActiveObject(); canvas.clipPath = null;
    const R = exportRegion(opts.area || 'print', only), k = kOf(dpi, s), W = pxOf(R.w, k), H = pxOf(R.h, k), F = {R, k, W, H}, layerPngs = [];
    const children = [];
    if (opts.shirtLayer){
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = SHIRTS[shirt]; x.fillRect(0, 0, W, H);
      children.push({name: `Shirt colour · ${shirt} (preview only)`, hidden: true, canvas: c, left: 0, top: 0});
    }
    for (const o of canvas.getObjects().filter(o => !o.excludeFromExport && (!only || only.includes(o)))){
      if (o.type === 'group'){
        children.push({name: nameOf(o), opened: true, hidden: !o.visible, opacity: o.opacity ?? 1, blendMode: BLEND_PSD[o.globalCompositeOperation] || 'normal',
                       children: o.getObjects().map(c => psdLayer(c, o, F, layerPngs))});
      } else children.push(psdLayer(o, null, F, layerPngs));
      await new Promise(r => setTimeout(r));   // keep the page responsive between layers
    }
    canvas.clipPath = only ? null : printClip();
    const a = cropArgs(dpi, R, s);
    const composite = await onlyThese(only, () => canvas.toCanvasElement(a.multiplier, a));
    canvas.clipPath = clip; if (sel) canvas.setActiveObject(sel); canvas.requestRenderAll();
    const psd = {width: W, height: H, canvas: composite, children,
                 imageResources: {resolutionInfo: {horizontalResolution: dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches'}}};
    const buf = agPsd.writePsd(psd, {generateThumbnail: true});
    return {blob: new Blob([buf], {type: 'image/vnd.adobe.photoshop'}), layerPngs, W, H};
  });
}
function canvasBlob(c){ return new Promise(res => c.toBlob(res, 'image/png')); }

/* ---------- PDF (jsPDF) ---------- */
async function exportPDF(list, dpi, opt){
  let doc = null;
  for (const p of list){
    const r = await rasterize(dpi, true, p, 'png', opt), w = +r.inW.toFixed(4), h = +r.inH.toFixed(4), orient = w > h ? 'landscape' : 'portrait';
    if (!doc) doc = new window.jspdf.jsPDF({orientation: orient, unit: 'in', format: [w, h], compress: true});
    else doc.addPage([w, h], orient);
    doc.addImage(r.url, 'PNG', 0, 0, w, h, undefined, 'FAST');
  }
  doc.setProperties({title: Store.name, creator: 'Tee Studio'});
  return doc.output('blob');
}

/* ---------- dialog ---------- */
const fmtLen = (v, u) => u === 'px' ? String(v) : String(+v.toFixed(u === 'mm' ? 1 : 2));
function exState(){
  const R = exportRegion(EX.area, EX.sel), k = kOf(EX.dpi, EX.scale);
  return {R, pw: pxOf(R.w, k), ph: pxOf(R.h, k), inW: R.w / PX_PER_IN * EX.scale, inH: R.h / PX_PER_IN * EX.scale};
}
function updateExportUI(skip){
  document.querySelectorAll('#exFmts button').forEach(b => b.classList.toggle('on', b.dataset.f === exFmt));
  const raster = !['svg', 'mockup'].includes(exFmt), hasSel = EX.sel.length > 0;
  if (!raster && EX.unit === 'px') EX.unit = 'in';
  if (EX.area === 'selection' && !hasSel) EX.area = 'print';
  document.querySelectorAll('#exArea button').forEach(b => { b.classList.toggle('on', b.dataset.a === EX.area); b.disabled = b.dataset.a === 'selection' && !hasSel; });
  document.querySelectorAll('.exsz').forEach(r => r.style.display = exFmt === 'mockup' ? 'none' : '');
  $('exDpi').closest('.row').style.display = raster ? '' : 'none';
  $('exUnit').querySelector('[value=px]').disabled = !raster;
  const {pw, ph, inW, inH} = exState(), u = EX.unit, set = (id, v) => { if (id !== skip) $(id).value = v; };
  set('exW', u === 'px' ? pw : fmtLen(inW * UNITS[u], u)); set('exH', u === 'px' ? ph : fmtLen(inH * UNITS[u], u));
  set('exDpi', +EX.dpi.toFixed(2)); $('exUnit').value = u;
  const tooBig = raster && exFmt !== 'mockup' && (pw > MAX_SIDE || ph > MAX_SIDE || pw * ph > MAX_PIXELS);
  $('exPx').value = exFmt === 'mockup' ? '2000 × 2100' : exFmt === 'svg' ? `Vector · ${fmtLen(inW, 'in')} × ${fmtLen(inH, 'in')} in` : `${pw} × ${ph} px`;
  const actual = Math.abs(EX.scale - 1) < 1e-6;
  $('exActual').style.visibility = actual ? 'hidden' : 'visible';
  const note = $('exSizeNote');
  note.classList.toggle('warn', tooBig);
  note.textContent = exFmt === 'mockup' ? '' : tooBig ? `${pw} × ${ph} px is more than a browser can draw. Lower the size or the resolution.`
    : `${fmtLen(inW, 'in')} × ${fmtLen(inH, 'in')} in (${fmtLen(inW * 2.54, 'cm')} × ${fmtLen(inH * 2.54, 'cm')} cm)` + (actual ? ' · actual size on the shirt' : ` · artwork scaled to ${+(EX.scale * 100).toFixed(1)}%`)
      + (raster ? ` · ${+EX.dpi.toFixed(2)} dpi` : '');
  $('exTransp').closest('.ck').style.display = exFmt === 'png' ? 'flex' : 'none';
  $('exLayers').closest('.ck').style.display = exFmt === 'psd' ? 'flex' : 'none';
  $('exShirt').closest('.ck').style.display = exFmt === 'psd' ? 'flex' : 'none';
  $('exOutline').closest('.ck').style.display = exFmt === 'svg' ? 'flex' : 'none';
  $('exAll').disabled = EX.area === 'selection';
  $('exNote').textContent = FMT_NOTES[exFmt];
  $('exGo').textContent = `Export ${exFmt === 'mockup' ? 'mockup' : exFmt.toUpperCase()}`;
  $('exGo').disabled = tooBig;
  const pages2 = $('exAll').checked && EX.area !== 'selection';
  $('exSub').textContent = `${pages2 ? 'Front & Back' : page[0].toUpperCase() + page.slice(1)} · ${exFmt === 'mockup' ? 'on ' + shirt.toLowerCase() + ' shirt' : AREA_NAMES[EX.area] + ' · shirt not included'}`;
  $('exDest').textContent = Store.canWrite() ? `Saves into ${Store.dirName()}/exports/${Store.slug()}/` : 'Downloads to your Downloads folder (connect a designs folder to save next to your projects)';
}
let exPrevN = 0;
async function updatePreview(){
  const n = ++exPrevN;
  let src;
  if (exFmt === 'mockup') src = await exportMockup(page);
  else {
    const R = exportRegion(EX.area, EX.sel), d = Math.min(300, 600 * PX_PER_IN / Math.max(R.w, R.h));
    src = await exportPNG(d, exFmt === 'png' ? $('exTransp').checked : exFmt !== 'jpg', page, exFmt === 'jpg' ? 'jpeg' : 'png', {area: EX.area, sel: EX.sel});
  }
  if (n === exPrevN) $('exPreview').src = src;
}
async function openExport(){
  EX.sel = actives().slice();
  $('export').classList.add('on'); updateExportUI(); updatePreview();
}
document.querySelectorAll('#exFmts button').forEach(b => b.onclick = () => { exFmt = b.dataset.f; updateExportUI(); updatePreview(); });
document.querySelectorAll('#exArea button').forEach(b => b.onclick = () => { EX.area = b.dataset.a; EX.scale = 1; updateExportUI(); updatePreview(); });
// typed px set the resolution (the size on the shirt stays, as CorelDRAW does); typed lengths scale the artwork
function exTyped(side){
  const v = parseFloat($(side === 'w' ? 'exW' : 'exH').value); if (!(v > 0)) return;
  const R = exportRegion(EX.area, EX.sel), len = side === 'w' ? R.w : R.h;
  if (EX.unit === 'px') EX.dpi = Math.min(2400, Math.max(1, v * PX_PER_IN / (len * EX.scale)));
  else EX.scale = Math.max(0.001, (v / UNITS[EX.unit]) / (len / PX_PER_IN));
  updateExportUI(side === 'w' ? 'exW' : 'exH');
}
['w', 'h'].forEach(s => { const el = $(s === 'w' ? 'exW' : 'exH'); el.oninput = () => exTyped(s); el.onchange = () => updateExportUI(); });
$('exDpi').oninput = () => { const v = parseFloat($('exDpi').value); if (v > 0){ EX.dpi = Math.min(2400, Math.max(1, v)); updateExportUI('exDpi'); } };
$('exDpi').onchange = () => updateExportUI();
$('exUnit').onchange = () => { EX.unit = $('exUnit').value; updateExportUI(); };
$('exActual').onclick = () => { EX.scale = 1; updateExportUI(); };
$('exAll').onchange = () => updateExportUI();
$('exTransp').onchange = () => { updateExportUI(); updatePreview(); };
$('exCancel').onclick = () => $('export').classList.remove('on');
$('export').onclick = e => { if (e.target === $('export')) $('export').classList.remove('on'); };
$('exGo').onclick = async () => {
  const dpi = EX.dpi, dpiTag = +dpi.toFixed(2), opt = {area: EX.area, scale: EX.scale, sel: EX.sel};
  const list = $('exAll').checked && EX.area !== 'selection' ? ['front','back'] : [page];
  const tag = EX.area === 'print' ? '' : '-' + EX.area;
  const go = $('exGo'), label = go.textContent; go.disabled = true; go.textContent = 'Exporting…';
  const saved = [];
  try {
    if (exFmt === 'pdf') saved.push(await Store.output(await exportPDF(list, dpi, opt), `${list.length > 1 ? 'front-back' : page}${tag}-${dpiTag}dpi.pdf`, true));
    else for (const p of list){
      if (exFmt === 'png' || exFmt === 'jpg'){
        const jpg = exFmt === 'jpg', r = await rasterize(dpi, !jpg && $('exTransp').checked, p, jpg ? 'jpeg' : 'png', opt);
        saved.push(await Store.output(await Bitmap.withDpi(dataURLToBlob(r.url), dpi), `${p}${tag}-${r.pw}x${r.ph}-${dpiTag}dpi.${exFmt}`, true));
      }
      if (exFmt === 'svg') saved.push(await Store.output(await exportSVG(p, $('exOutline').checked, opt), `${p}${tag}.svg`, true));
      if (exFmt === 'mockup') saved.push(await Store.output(dataURLToBlob(await exportMockup(p)), `${p}-mockup-${shirt.toLowerCase()}.png`, true));
      if (exFmt === 'psd'){
        const {blob, layerPngs, W, H} = await exportPSD(p, dpi, Object.assign({shirtLayer: $('exShirt').checked}, opt));
        saved.push(await Store.output(blob, `${p}${tag}-${W}x${H}-${dpiTag}dpi.psd`, true));
        if ($('exLayers').checked){
          for (let i = 0; i < layerPngs.length; i++){
            const n = String(i + 1).padStart(2, '0') + '-' + Store.slug(layerPngs[i].name) + '.png';
            await Store.output(await Bitmap.withDpi(await canvasBlob(layerPngs[i].canvas), dpi), `${p}-layers/${n}`, true);
          }
          saved.push(`${layerPngs.length} layer PNGs in ${p}-layers/`);
        }
      }
    }
    $('export').classList.remove('on');
    toast(Store.canWrite() ? `Saved ${saved.length} item(s) to ${Store.dirName()}/exports/${Store.slug()}/` : `Downloaded ${saved.length} file(s)`);
  } catch (err){
    console.error(err); toast('Export failed: ' + (err && err.message || err));
  } finally { go.disabled = false; go.textContent = label; }
};
