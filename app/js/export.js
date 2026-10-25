/* ===================== export ===================== */
// Everything here renders from the live Fabric canvas. Scene units are PX_PER_IN per inch; the print area is
// PA_W × PA_H scene px at canvas offset (paL, paT) scaled by `zoom`. Output size = inches × DPI.
let exFmt = 'png';
const FMT_NOTES = {
  png:'Print-ready PNG of the print area. Transparent background by default — this is what DTG/DTF printers want.',
  jpg:'Flat JPG on white. Good for sharing or quick proofs, not for printing on coloured shirts.',
  svg:'Vector SVG — opens in Illustrator, Inkscape or CorelDRAW and stays editable. Fonts are embedded in the file.',
  psd:'Layered Photoshop file: one layer per object, groups become layer folders, names/opacity/blend modes/hidden state kept. Text is rasterised (not editable type) at the chosen DPI.',
  pdf:'PDF sized exactly 12 × 16 in with the design at the chosen DPI. Accepted by most print shops.',
  mockup:'A photo-style preview of the design on the shirt colour you picked — for listings and client approval.',
};
const BLEND_PSD = {'source-over':'normal', multiply:'multiply', screen:'screen', overlay:'overlay', darken:'darken', lighten:'lighten', difference:'difference'};

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
function cropArgs(dpi){ return {left: paL, top: paT, width: PA_W * zoom, height: PA_H * zoom, multiplier: (PA_IN.w * dpi) / (PA_W * zoom)}; }
const printClip = () => new fabric.Rect({left:0, top:0, width:PA_W, height:PA_H, absolutePositioned:true});

async function exportPNG(dpi, transparent, p, fmt = 'png'){
  return renderPage(p, () => {
    const sel = canvas.getActiveObject(), clip = canvas.clipPath, bg = canvas.backgroundColor;
    canvas.discardActiveObject();
    if (!transparent || fmt === 'jpeg') canvas.backgroundColor = '#ffffff';
    canvas.clipPath = printClip();
    const url = canvas.toDataURL(Object.assign({format: fmt, quality:.95}, cropArgs(dpi)));
    canvas.clipPath = clip; canvas.backgroundColor = bg; if (sel) canvas.setActiveObject(sel); canvas.requestRenderAll();
    return url;
  });
}

/* ---------- SVG (fonts embedded so the file is self-contained) ---------- */
function usedFonts(objs){ return [...new Set(leafs(objs).filter(o => o.fontFamily).map(o => o.fontFamily))]; }
function fontFaceCss(families){
  const css = window.TEE_FONT_CSS || '';
  return css.split(/(?=\/\* latin \*\/)/).filter(b => families.some(f => b.includes(`font-family: '${f}'`))).join('\n');
}
// SVG has no text-on-path equivalent of Fabric's layout, so those texts (or all, when asked) go out as letter outlines
async function exportSVG(p, outlineAll){
  return renderPage(p, async () => {
    const swaps = [], texts = canvas.getObjects().filter(o => !Effects.hasAny(o) && o.text != null && (o.path || outlineAll));
    // live effects go out baked: contour steps and warped outlines as paths, flat shadows as SVG blur filters
    const fxObjs = canvas.getObjects().filter(o => Effects.hasAny(o));
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
    const svg = canvas.toSVG({width: PA_IN.w + 'in', height: PA_IN.h + 'in', viewBox: {x:0, y:0, width:PA_W, height:PA_H}});
    canvas.setViewportTransform(vpt);
    swaps.reverse().forEach(sw => {
      if (sw.pieces){ restoring = true; sw.pieces.forEach(p => { p.set('shadow', null); canvas.remove(p); }); canvas.insertAt(sw.o, sw.i); sw.o.fx = sw.restoreFx[1]; sw.o.__fx = null; restoring = false; return; }
      const [t, r, i] = sw; canvas.remove(r); canvas.insertAt(t, i);
    });
    if (texts.length) restoring = wasRestoring;
    const css = fontFaceCss(usedFonts(canvas.getObjects()));
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
// Scene-space bounds that also work for objects inside a group (getBoundingRect is group-relative there).
function absBounds(o){
  const m = o.calcTransformMatrix(), d = o._getNonTransformedDimensions();
  const pts = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => fabric.util.transformPoint(new fabric.Point(x * d.x, y * d.y), m));
  return fabric.util.makeBoundingBoxFromPoints(pts);
}
// Renders one object alone into a canvas cropped to its bounds, at output resolution.
function renderAlone(target, group, dpi){
  const scale = dpi / PX_PER_IN, all = canvas.getObjects();
  const saved = all.map(o => [o, o.visible, o.opacity, o.globalCompositeOperation]);
  const kids = group ? group.getObjects().map(o => [o, o.visible, o.opacity, o.globalCompositeOperation]) : [];
  all.forEach(o => o.visible = false);
  const host = group || target;
  host.set({visible: true, opacity: group ? 1 : host.opacity, globalCompositeOperation: 'source-over'});
  if (group){ group.getObjects().forEach(o => o.visible = o === target); target.set({opacity: 1, globalCompositeOperation:'source-over'}); group.set('dirty', true); }
  else target.set('opacity', 1);
  // bounds in scene units, padded for strokes and shadows, clipped to the print area
  // effects reach past the object's box: crop to what they draw
  const b = Effects.hasAny(target) ? (s => ({left: s.left, top: s.top, width: s.width, height: s.height}))(Effects.sceneBounds(target)) : absBounds(target), sh = target.shadow || (group && group.shadow);
  // text boxes don't cover swashes, and text on a path reaches about a letter height beyond its path
  const tpad = target.text != null ? target.fontSize * (target.path ? 1.3 : 0.4) * Math.max(Math.abs(target.scaleX), Math.abs(target.scaleY)) : 0;
  const pad = 2 + tpad + (sh ? sh.blur + Math.max(Math.abs(sh.offsetX), Math.abs(sh.offsetY)) : 0);
  const x0 = Math.max(0, Math.floor((b.left - pad) * scale)), y0 = Math.max(0, Math.floor((b.top - pad) * scale));
  const x1 = Math.min(PA_IN.w * dpi, Math.ceil((b.left + b.width + pad) * scale)), y1 = Math.min(PA_IN.h * dpi, Math.ceil((b.top + b.height + pad) * scale));
  let out = null;
  if (x1 > x0 && y1 > y0){
    const m = scale / zoom;
    out = canvas.toCanvasElement(m, {left: paL + x0 / m, top: paT + y0 / m, width: (x1 - x0) / m, height: (y1 - y0) / m});
  }
  saved.forEach(([o, v, op, g]) => o.set({visible: v, opacity: op, globalCompositeOperation: g}));
  kids.forEach(([o, v, op, g]) => o.set({visible: v, opacity: op, globalCompositeOperation: g}));
  if (group) group.set('dirty', true);
  return out && {canvas: out, left: x0, top: y0};
}
function psdLayer(o, group, dpi, layerPngs){
  const r = renderAlone(o, group, dpi);
  const layer = {name: nameOf(o).slice(0, 60), hidden: !o.visible, opacity: o.opacity ?? 1, blendMode: BLEND_PSD[o.globalCompositeOperation] || 'normal'};
  if (r){ Object.assign(layer, r); layerPngs.push({name: layer.name, canvas: r.canvas}); }
  else { const c = document.createElement('canvas'); c.width = c.height = 1; Object.assign(layer, {canvas: c, left: 0, top: 0}); }
  return layer;
}
async function exportPSD(p, dpi, opts = {}){
  return renderPage(p, async () => {
    const sel = canvas.getActiveObject(), clip = canvas.clipPath;
    canvas.discardActiveObject(); canvas.clipPath = null;
    const W = PA_IN.w * dpi, H = PA_IN.h * dpi, layerPngs = [];
    const children = [];
    if (opts.shirtLayer){
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = SHIRTS[shirt]; x.fillRect(0, 0, W, H);
      children.push({name: `Shirt colour · ${shirt} (preview only)`, hidden: true, canvas: c, left: 0, top: 0});
    }
    for (const o of canvas.getObjects().filter(o => !o.excludeFromExport)){
      if (o.type === 'group'){
        children.push({name: nameOf(o), opened: true, hidden: !o.visible, opacity: o.opacity ?? 1, blendMode: BLEND_PSD[o.globalCompositeOperation] || 'normal',
                       children: o.getObjects().map(c => psdLayer(c, o, dpi, layerPngs))});
      } else children.push(psdLayer(o, null, dpi, layerPngs));
      await new Promise(r => setTimeout(r));   // keep the page responsive between layers
    }
    canvas.clipPath = printClip();
    const composite = canvas.toCanvasElement(cropArgs(dpi).multiplier, {left: paL, top: paT, width: PA_W * zoom, height: PA_H * zoom});
    canvas.clipPath = clip; if (sel) canvas.setActiveObject(sel); canvas.requestRenderAll();
    const psd = {width: W, height: H, canvas: composite, children,
                 imageResources: {resolutionInfo: {horizontalResolution: dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches'}}};
    const buf = agPsd.writePsd(psd, {generateThumbnail: true});
    return {blob: new Blob([buf], {type: 'image/vnd.adobe.photoshop'}), layerPngs};
  });
}
function canvasBlob(c){ return new Promise(res => c.toBlob(res, 'image/png')); }

/* ---------- PDF (jsPDF) ---------- */
async function exportPDF(list, dpi){
  const doc = new window.jspdf.jsPDF({orientation: 'portrait', unit: 'in', format: [PA_IN.w, PA_IN.h], compress: true});
  for (let i = 0; i < list.length; i++){
    if (i) doc.addPage([PA_IN.w, PA_IN.h], 'portrait');
    doc.addImage(await exportPNG(dpi, true, list[i]), 'PNG', 0, 0, PA_IN.w, PA_IN.h, undefined, 'FAST');
  }
  doc.setProperties({title: Store.name, creator: 'Tee Studio'});
  return doc.output('blob');
}

/* ---------- dialog ---------- */
function updateExportUI(){
  document.querySelectorAll('#exFmts button').forEach(b => b.classList.toggle('on', b.dataset.f === exFmt));
  const dpi = +$('exDpi').value;
  $('exPx').value = exFmt === 'mockup' ? '2000 × 2100' : exFmt === 'svg' ? 'Vector · 12 × 16 in' : `${PA_IN.w * dpi} × ${PA_IN.h * dpi}`;
  $('exTransp').closest('.ck').style.display = exFmt === 'png' ? 'flex' : 'none';
  $('exLayers').closest('.ck').style.display = exFmt === 'psd' ? 'flex' : 'none';
  $('exShirt').closest('.ck').style.display = exFmt === 'psd' ? 'flex' : 'none';
  $('exOutline').closest('.ck').style.display = exFmt === 'svg' ? 'flex' : 'none';
  $('exDpi').disabled = ['svg','mockup'].includes(exFmt);
  $('exNote').textContent = FMT_NOTES[exFmt];
  $('exGo').textContent = `Export ${exFmt === 'mockup' ? 'mockup' : exFmt.toUpperCase()}`;
  $('exSub').textContent = `${$('exAll').checked ? 'Front & Back' : page[0].toUpperCase() + page.slice(1)} · ${exFmt === 'mockup' ? 'on ' + shirt.toLowerCase() + ' shirt' : 'print area only · shirt not included'}`;
  $('exDest').textContent = Store.canWrite() ? `Saves into ${Store.dirName()}/exports/${Store.slug()}/` : 'Downloads to your Downloads folder (connect a designs folder to save next to your projects)';
}
async function openExport(){
  $('export').classList.add('on'); updateExportUI();
  $('exPreview').src = await exportPNG(40, true, page);
}
document.querySelectorAll('#exFmts button').forEach(b => b.onclick = async () => {
  exFmt = b.dataset.f; updateExportUI();
  $('exPreview').src = exFmt === 'mockup' ? await exportMockup(page) : await exportPNG(40, exFmt === 'png' && $('exTransp').checked, page, exFmt === 'jpg' ? 'jpeg' : 'png');
});
['exDpi','exAll','exTransp'].forEach(id => $(id).onchange = updateExportUI);
$('exCancel').onclick = () => $('export').classList.remove('on');
$('export').onclick = e => { if (e.target === $('export')) $('export').classList.remove('on'); };
$('exGo').onclick = async () => {
  const dpi = +$('exDpi').value, list = $('exAll').checked ? ['front','back'] : [page];
  const go = $('exGo'), label = go.textContent; go.disabled = true; go.textContent = 'Exporting…';
  const saved = [];
  try {
    if (exFmt === 'pdf') saved.push(await Store.output(await exportPDF(list, dpi), `${list.length > 1 ? 'front-back' : page}-${dpi}dpi.pdf`, true));
    else for (const p of list){
      if (exFmt === 'png') saved.push(await Store.output(dataURLToBlob(await exportPNG(dpi, $('exTransp').checked, p)), `${p}-${dpi}dpi.png`, true));
      if (exFmt === 'jpg') saved.push(await Store.output(dataURLToBlob(await exportPNG(dpi, false, p, 'jpeg')), `${p}-${dpi}dpi.jpg`, true));
      if (exFmt === 'svg') saved.push(await Store.output(await exportSVG(p, $('exOutline').checked), `${p}.svg`, true));
      if (exFmt === 'mockup') saved.push(await Store.output(dataURLToBlob(await exportMockup(p)), `${p}-mockup-${shirt.toLowerCase()}.png`, true));
      if (exFmt === 'psd'){
        const {blob, layerPngs} = await exportPSD(p, dpi, {shirtLayer: $('exShirt').checked});
        saved.push(await Store.output(blob, `${p}-${dpi}dpi.psd`, true));
        if ($('exLayers').checked){
          for (let i = 0; i < layerPngs.length; i++){
            const n = String(i + 1).padStart(2, '0') + '-' + Store.slug(layerPngs[i].name) + '.png';
            await Store.output(await canvasBlob(layerPngs[i].canvas), `${p}-layers/${n}`, true);
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
