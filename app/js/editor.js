/* ===================== constants & state ===================== */
// fingers need bigger handles and pick distances than a mouse
const COARSE = matchMedia('(pointer: coarse)').matches;
const PX_PER_IN = 20;               // scene units: 20 px = 1 inch
const PA_IN = {w:12, h:16};
const PA_W = PA_IN.w * PX_PER_IN, PA_H = PA_IN.h * PX_PER_IN;
const DEF_STROKE = 3 * PX_PER_IN / 72;   // 3 pt
const PROPS = ['name','lockedObj','selectable','evented','curve','fitD','pathPlace','fitAnchor','pathUserOffset','nodeTypes','fx','uid'];
const FONTS = ['Bebas Neue','Anton','Oswald','Montserrat','Inter','Pacifico','Lobster','Permanent Marker','Bungee','Playfair Display','Rubik Mono One','Caveat'];
const SHIRTS = {Black:'#1f2937', White:'#f3f4f6', Heather:'#9ca3af', Navy:'#1e3a8a', Red:'#b91c1c', Forest:'#14532d', Sand:'#d6c7a1'};
const PALETTE = ['#000000','#ffffff','#1f2937','#4b5563','#9ca3af','#e5e7eb','#7f1d1d','#ef4444','#f97316','#f59e0b','#fde68a','#facc15','#84cc16','#22c55e','#14532d','#10b981','#06b6d4','#0ea5e9','#3b82f6','#1e3a8a','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#78350f','#a16207','#c2b280','#d6c7a1','#c0c0c0','#d4af37','#b87333'];

const $ = id => document.getElementById(id);
let zoom = 1, tool = 'pick', page = 'front', shirt = 'Black', snapOn = true, preview = false;
let paL = 0, paT = 0;
let defFill = '#f97316', defStroke = null;
let pages = {front:null, back:null};
let hist = [], hi = -1, restoring = false;
let clipboard = null;

// Fabric 5's IText.fromObject drops text-on-path (fabric.Text revives it); without this, curved text is lost on
// reload, undo and duplicate
(function(){
  const base = fabric.IText.fromObject;
  fabric.IText.fromObject = function(object, callback){
    if (!object.path) return base.call(this, object, callback);
    const copy = Object.assign({}, object), path = copy.path; delete copy.path;
    return base.call(this, copy, t => fabric.Path.fromObject(path, p => { t.set('path', p); t.initDimensions(); t.setCoords(); callback && callback(t); }));
  };
})();
fabric.Object.prototype.set({transparentCorners:false, cornerColor:'#ffffff', cornerStrokeColor:'#3b82f6', borderColor:'#3b82f6', cornerSize:8, padding:2});
fabric.devicePixelRatio = Math.min(window.devicePixelRatio || 1, COARSE ? 2 : 2.5);
const canvas = new fabric.Canvas('c', {preserveObjectStacking:true, selectionColor:'rgba(59,130,246,.12)', selectionBorderColor:'#3b82f6', selectionLineWidth:1, stopContextMenu:true, fireRightClick:true});

/* ===================== helpers ===================== */
const inch = px => (px / PX_PER_IN).toFixed(2);
const fromIn = v => parseFloat(String(v).replace(/[^\d.\-]/g,'')) * PX_PER_IN;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200); }
function soon(what){ toast(`${what} — coming in the build phase`); }
function hex(c){ try { return c ? '#' + new fabric.Color(c).toHex().toLowerCase() : null; } catch(e){ return null; } }
function shade(c, amt){ const col = new fabric.Color(c).getSource(); return '#' + new fabric.Color(`rgb(${col.slice(0,3).map(v => Math.max(0, Math.min(255, v + amt))).join(',')})`).toHex(); }
function fillHex(o){ const f = o.fill; if (!f) return null; if (typeof f === 'string') return hex(f); return f.colorStops ? hex(f.colorStops[0].color) : null; }
function dataURLToBlob(url){
  const [head, b64] = url.split(','), bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type: head.match(/data:([^;]+)/)[1]});
}
function download(url, name){ const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function isTyping(e){ const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return true; const a = canvas.getActiveObject(); return !!(a && a.isEditing); }
function kindOf(o){
  return ({'i-text':'Text', textbox:'Text', text:'Text', rect:'Rectangle', ellipse:'Ellipse', circle:'Ellipse', polygon: o.starPoints ? 'Star' : 'Polygon', polyline:'Polyline', path:'Curve', line:'Line', image:'Image', group:'Group', clipframe:'Clip frame', triangle:'Triangle'})[o.type] || o.type;
}
function nameOf(o){ if (o.name) return o.name; if (o.text != null) return o.text.split('\n')[0] || 'Text'; return kindOf(o); }
function applyLock(o){ const l = !!o.lockedObj; o.selectable = !l; o.evented = !l; o.hoverCursor = l ? 'default' : null; }
function actives(){ return canvas.getActiveObjects(); }
// a clip frame's fill and outline are its frame's (its contents keep their own)
function leafs(objs){ return objs.flatMap(o => o.type === 'group' ? leafs(o.getObjects()) : o.type === 'clipframe' ? [o._objects[0]] : [o]); }

/* ===================== layout, zoom & rulers ===================== */
// The canvas is always the size of the stage (a canvas the size of the zoomed shirt ran to 30+ megapixels on
// phones). The view is (zoom, paL, paT): the print area's top-left in canvas pixels. The shirt picture and the
// print-area frame are moved to match by CSS transform, which the browser composites cheaply.
const SHIRT_W = PA_W / 0.36, SHIRT_H = SHIRT_W * 1.05;
function layout(){
  const s = $('stage'), sw = s.clientWidth, sh = s.clientHeight;
  if (canvas.getWidth() !== sw || canvas.getHeight() !== sh){ canvas.setDimensions({width: sw, height: sh}); canvas.calcOffset(); }
  const wrap = $('wrap');
  if (!wrap.style.width){ wrap.style.width = SHIRT_W + 'px'; wrap.style.height = SHIRT_H + 'px'; }
  const wx = paL - (SHIRT_W - PA_W) / 2 * zoom, wy = paT - 0.22 * SHIRT_H * zoom;
  wrap.style.transform = `translate(${wx}px,${wy}px) scale(${zoom})`;
  Object.assign($('pa').style, {left: paL + 'px', top: paT + 'px', width: PA_W * zoom + 'px', height: PA_H * zoom + 'px'});
  canvas.setViewportTransform([zoom, 0, 0, zoom, paL, paT]);
  $('zoomlbl').textContent = Math.round(zoom * 100) + '%';
  drawRulers();
}
// moves the view; keeps some of the print area on screen
function panBy(dx, dy){
  const s = $('stage'), m = 40;
  paL = Math.min(s.clientWidth - m, Math.max(m - PA_W * zoom, paL + dx));
  paT = Math.min(s.clientHeight - m, Math.max(m - PA_H * zoom, paT + dy));
  layout();
}
function fitZoom(){
  const s = $('stage'), sw = s.clientWidth, sh = s.clientHeight;
  if (matchMedia('(max-width: 767px)').matches){
    // phones: the print area fills the screen (the shirt runs off the sides), centred
    zoom = Math.max(0.3, Math.min((sw - 24) / PA_W, (sh - 96) / PA_H));
    paL = (sw - PA_W * zoom) / 2; paT = (sh - PA_H * zoom) / 2 + 10;
  } else {
    zoom = Math.max(0.3, Math.min((sw - 40) / SHIRT_W, (sh - 30) / SHIRT_H));
    const wx = (sw - SHIRT_W * zoom) / 2, wy = (sh - SHIRT_H * zoom) / 2;
    paL = wx + (SHIRT_W - PA_W) / 2 * zoom; paT = wy + 0.22 * SHIRT_H * zoom;
  }
  layout();
}
// zoom about a point of the canvas (the stage centre by default): the scene point there stays put
function setZoom(z, ax, ay){
  autoFit = false;
  const s = $('stage'); if (ax == null){ ax = s.clientWidth / 2; ay = s.clientHeight / 2; }
  const qx = (ax - paL) / zoom, qy = (ay - paT) / zoom;
  zoom = Math.max(0.3, Math.min(6, z));
  paL = ax - qx * zoom; paT = ay - qy * zoom;
  layout();
}
let autoFit = true;
function drawRulers(){
  const dpr = window.devicePixelRatio || 1, paRect = $('pa').getBoundingClientRect();
  [['rulerH', true], ['rulerV', false]].forEach(([id, horiz]) => {
    const c = $(id), r = c.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, r.width, r.height);
    x.fillStyle = '#2a2b2f'; x.fillRect(0, 0, r.width, r.height);
    const origin = horiz ? paRect.left - r.left : paRect.top - r.top;
    const len = horiz ? r.width : r.height, ppi = PX_PER_IN * zoom, step = ppi >= 40 ? 0.25 : ppi >= 16 ? 0.5 : 1;
    const ext = horiz ? PA_IN.w : PA_IN.h;
    x.fillStyle = 'rgba(59,130,246,.22)';
    horiz ? x.fillRect(origin, 0, ext * ppi, r.height) : x.fillRect(0, origin, r.width, ext * ppi);
    x.strokeStyle = '#6b6e75'; x.fillStyle = '#9a9ca3'; x.font = '9px Inter'; x.lineWidth = 1;
    const first = Math.floor(-origin / ppi), last = Math.ceil((len - origin) / ppi), labelEvery = Math.max(1, Math.ceil(22 / ppi));
    for (let i = first; i <= last; i += step){
      const p = Math.round(origin + i * ppi) + .5, major = Math.abs(i - Math.round(i)) < 1e-6, t = major ? 10 : 5;
      x.beginPath();
      if (horiz){ x.moveTo(p, r.height); x.lineTo(p, r.height - t); } else { x.moveTo(r.width, p); x.lineTo(r.width - t, p); }
      x.stroke();
      if (major && Math.round(i) % labelEvery === 0){
        if (horiz) x.fillText(String(Math.round(i)), p + 2, 9);
        else { x.save(); x.translate(9, p + 2); x.rotate(-Math.PI / 2); x.fillText(String(Math.round(i)), -10, 0); x.restore(); }
      }
    }
  });
}
$('stage').addEventListener('scroll', () => { drawRulers(); canvas.calcOffset(); });
// Fabric caches where the canvas sits on the page; refresh it before each press so pointers stay exact
// even after the layout shifted (panels, scrollbars, the start screen closing)
canvas.upperCanvasEl.addEventListener('mousedown', () => canvas.calcOffset(), true);
window.addEventListener('resize', () => { if (autoFit) fitZoom(); else layout(); canvas.calcOffset(); });
// wheel / trackpad: scroll pans, Ctrl/⌘ (or a trackpad pinch) zooms about the pointer
$('stage').addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.upperCanvasEl.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) setZoom(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  else { autoFit = false; panBy(-(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), -(e.shiftKey && !e.deltaX ? 0 : e.deltaY)); }
}, {passive:false});
// Space + drag (or the middle button) pans on desktop
(function(){
  let space = false, drag = null;
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e) && !canvas._currentTransform){ space = true; canvas.defaultCursor = canvas.hoverCursor = 'grab'; e.preventDefault(); } });
  document.addEventListener('keyup', e => { if (e.code === 'Space'){ space = false; canvas.defaultCursor = tool === 'pick' ? 'default' : 'crosshair'; canvas.hoverCursor = 'move'; } });
  $('stage').addEventListener('mousedown', e => {
    if (!(space || e.button === 1)) return;
    e.preventDefault(); e.stopPropagation(); drag = {x: e.clientX, y: e.clientY};
  }, true);
  document.addEventListener('mousemove', e => { if (!drag) return; autoFit = false; panBy(e.clientX - drag.x, e.clientY - drag.y); drag = {x: e.clientX, y: e.clientY}; });
  document.addEventListener('mouseup', () => { drag = null; });
})();

/* ===================== shirt colour & pages ===================== */
Object.entries(SHIRTS).forEach(([n, c]) => {
  const b = document.createElement('button'); b.innerHTML = `<i style="background:${c}"></i>${n}`; b.dataset.s = n;
  b.onclick = () => setShirt(n); $('shirtTabs').appendChild(b);
});
function setShirt(n){
  shirt = n; $('teeBody').setAttribute('fill', SHIRTS[n]);
  document.querySelectorAll('#shirtTabs button').forEach(b => b.classList.toggle('on', b.dataset.s === n));
  autosave();
}
function setPageVisual(){
  $('neck').setAttribute('d', page === 'front' ? 'M140 20c10 18 32 28 60 28s50-10 60-28' : 'M140 20c14 8 34 12 60 12s46-4 60-12');
  document.querySelectorAll('#pageTabs button').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  const label = page[0].toUpperCase() + page.slice(1);
  $('layersTitle').textContent = label + ' · Objects'; $('stPage').textContent = label;
}
function switchPage(p){
  if (p === page) return;
  pages[page] = docJSON(); if (typeof Focus !== 'undefined') Focus.drop();
  page = p; setPageVisual();
  loadJSON(pages[p], () => { hist = []; hi = -1; snapshot(); });
}
document.querySelectorAll('#pageTabs button').forEach(b => b.onclick = () => switchPage(b.dataset.page));

/* ===================== history & persistence ===================== */
function loadJSON(json, cb){
  if (typeof Focus !== 'undefined') Focus.drop();
  restoring = true; canvas.discardActiveObject();
  const done = () => { canvas.getObjects().forEach(applyLock); canvas.requestRenderAll(); restoring = false; if (typeof Nodes !== 'undefined') Nodes.reattach(); if (typeof FxTool !== 'undefined') FxTool.reattach(); refresh(); cb && cb(); };
  if (!json){ canvas.clear(); done(); return; }
  canvas.loadFromJSON(json, done);
}
let snapT;
function queueSnapshot(){ if (restoring) return;
  // typing inside a group: wait until the editing ends (folding the group would end it)
  if (typeof Focus !== 'undefined' && Focus.stack.length && canvas.getActiveObject() && canvas.getActiveObject().isEditing) return; clearTimeout(snapT); snapT = setTimeout(snapshot, 120); }
function snapshot(){
  if (restoring) return;
  const s = JSON.stringify(docJSON());
  if (hist[hi] === s) return;
  hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1;
  updateUndo(); autosave();
}
function undo(){ if (hi > 0){ hi--; loadJSON(hist[hi], updateUndo); } }
function redo(){ if (hi < hist.length - 1){ hi++; loadJSON(hist[hi], updateUndo); } }
function updateUndo(){ $('bUndo').disabled = hi <= 0; $('bRedo').disabled = hi >= hist.length - 1; }
// every change lands here: Store keeps a browser backup and writes the project file into the designs folder
function autosave(){ if (typeof Store !== 'undefined') Store.changed(); }
function projectData(){ return {app:'tee-studio', version:1, name: typeof Store !== 'undefined' ? Store.name : 'Untitled tee', shirt, page, pages: Object.assign({}, pages, {[page]: docJSON()})}; }
// the drawing as saved: groups and clip frames being edited inside are folded back first
function docJSON(){ return typeof Focus !== 'undefined' ? Focus.collapsed(() => canvas.toJSON(PROPS)) : canvas.toJSON(PROPS); }
function openProject(data, cb){
  pages = Object.assign({front:null, back:null}, data.pages || {});
  setShirt(data.shirt && SHIRTS[data.shirt] ? data.shirt : 'Black');
  page = 'front'; setPageVisual();
  loadJSON(pages.front, () => { hist = []; hi = -1; snapshot(); cb && cb(); });
}

/* ===================== object factories ===================== */
function styleNew(o, extra){
  o.set(Object.assign({fill: defFill, stroke: defStroke, strokeWidth: defStroke ? DEF_STROKE : 0, strokeUniform:true}, extra || {}));
  return o;
}
function starPoints(n = 5, outer = 50, inner = 21){
  const pts = [];
  for (let i = 0; i < n * 2; i++){ const r = i % 2 ? inner : outer, a = Math.PI / n * i - Math.PI / 2; pts.push({x: r * Math.cos(a), y: r * Math.sin(a)}); }
  return pts;
}
function makeStar(n, inner){ const s = new fabric.Polygon(starPoints(n, 50, inner), {objectCaching:false}); s.starPoints = n; return s; }
function makeText(str, opts){
  return new fabric.IText(str, Object.assign({fontFamily:'Bebas Neue', fontSize:40, fill:defFill, textAlign:'center', charSpacing:40, lineHeight:1.05}, opts));
}
function placeCenter(o, x = PA_W / 2, y = PA_H / 2){ o.setPositionByOrigin(new fabric.Point(x, y), 'center', 'center'); o.setCoords(); return o; }
function addAndSelect(o){ canvas.add(o); canvas.setActiveObject(o); canvas.requestRenderAll(); }

const SHAPES = {
  'Circle': () => new fabric.Circle({radius:50}),
  'Rounded box': () => new fabric.Rect({width:140, height:80, rx:16, ry:16}),
  'Star': () => makeStar(5, 21),
  'Burst': () => makeStar(16, 40),
  'Triangle': () => new fabric.Triangle({width:110, height:96}),
  'Heart': () => new fabric.Path('M50 88 C10 60 0 40 0 25 A25 25 0 0 1 50 15 A25 25 0 0 1 100 25 C100 40 90 60 50 88 Z'),
  'Badge ring': () => new fabric.Circle({radius:60, fill:'', stroke: defStroke || defFill, strokeWidth:6}),
  'Banner': () => new fabric.Path('M0 10 L20 0 L180 0 L200 10 L190 25 L200 40 L180 30 L20 30 L0 40 L10 25 Z'),
};
Object.keys(SHAPES).forEach(n => {
  const b = document.createElement('button'); b.className = 'card'; b.style.justifyContent = 'center';
  b.textContent = n; b.onclick = () => {
    const o = styleNew(SHAPES[n]());
    if (n === 'Badge ring') o.set({fill:'', stroke: defStroke || defFill, strokeWidth:6});
    o.name = n; addAndSelect(placeCenter(o));
  };
  $('shapeLib').appendChild(b);
});
const TEMPLATES = {
  vintage: () => makeText('VINTAGE', {fontFamily:'Bebas Neue', fontSize:70, fill:'#f97316', charSpacing:120}),
  script:  () => makeText('Retro Script', {fontFamily:'Pacifico', fontSize:34, fill:'#fde68a', charSpacing:0}),
  college: () => makeText('COLLEGE', {fontFamily:'Rubik Mono One', fontSize:34, fill:'#ffffff', stroke:'#ef4444', strokeWidth:3, paintFirst:'stroke', charSpacing:20}),
  marker:  () => makeText('Street tag', {fontFamily:'Permanent Marker', fontSize:38, fill:'#22c55e', charSpacing:0, angle:-8}),
};
document.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => addAndSelect(placeCenter(TEMPLATES[b.dataset.tpl]())));

function buildSample(){
  restoring = true; canvas.clear();
  const title = makeText('STAY WILD', {fontSize:58, fill:'#f97316', charSpacing:80, name:'STAY WILD'});
  placeCenter(title, PA_W / 2, 42);
  const ring = new fabric.Circle({radius:62, fill:'', stroke:'#fde68a', strokeWidth:5, name:'Ring'}); placeCenter(ring, PA_W / 2, 150);
  const sun = new fabric.Circle({radius:13, fill:'#fde68a', name:'Sun'}); placeCenter(sun, PA_W / 2, 118);
  const back = new fabric.Polygon([{x:0,y:62},{x:30,y:20},{x:44,y:36},{x:62,y:6},{x:96,y:62}], {fill:'#fb923c', opacity:.75, name:'Mountain back'}); placeCenter(back, PA_W / 2 + 8, 172);
  const front = new fabric.Polygon([{x:0,y:58},{x:36,y:0},{x:54,y:24},{x:72,y:4},{x:110,y:58}], {fill:'#f97316', name:'Mountain front'}); placeCenter(front, PA_W / 2 - 6, 178);
  const badge = new fabric.Group([ring, sun, back, front], {name:'Badge'});
  const club = makeText('Mountain Club', {fontFamily:'Pacifico', fontSize:28, fill:'#fde68a', charSpacing:0, name:'Mountain Club'}); placeCenter(club, PA_W / 2, 250);
  const est = makeText('EST. 2026', {fontFamily:'Inter', fontSize:11, fill:'#9ca3af', charSpacing:400, name:'EST. 2026'}); placeCenter(est, PA_W / 2, 282);
  [badge, title, club, est].forEach(o => canvas.add(o));
  canvas.requestRenderAll(); restoring = false; snapshot(); refresh();
}

/* ===================== tools ===================== */
const TOOL_INFO = {
  pick:['Pick', 'Click an object to select it. Shift-click to add. Drag on empty space to marquee-select.'],
  shape:['Shape', 'Click a curve, then drag nodes, handles or segments. Double-click a segment to add a node.'],
  fxshadow:['Drop shadow', 'Drag from the middle of an object for a flat shadow, from near an edge for one standing on it.'],
  fxcontour:['Contour', 'Drag from an object outward for an outside contour, inward for inside.'],
  fxenvelope:['Envelope', 'Click an object, then drag the frame nodes. Double-click the frame to add a node.'],
  fxdistort:['Distort', 'Drag on an object: the distortion centres where you start.'],
  fxblend:['Blend', 'Drag from the start object to the end object.'],
  fxtransp:['Transparency', 'Click an object; drag across it for a gradient.'],
  zoom:['Zoom', 'Click to zoom in, ⌥/Alt-click to zoom out. ⌘/Ctrl + scroll also zooms.'],
  free:['Freehand', 'Drag to draw a freehand curve.'],
  brush:['Artistic media', 'Drag to paint a thick brush stroke.'],
  pen:['Pen', 'Click to place points. Click the first point to close, double-click or Enter to finish.'],
  rect:['Rectangle', 'Drag to draw. Hold Shift for a square.'],
  ellipse:['Ellipse', 'Drag to draw. Hold Shift for a circle.'],
  star:['Star', 'Drag to draw a star.'],
  line:['Line', 'Drag to draw a straight line. Hold Shift to snap to 45°.'],
  text:['Text', 'Click where the text should go, then type.'],
  eyedrop:['Eyedropper', 'Click an object to copy its fill & outline onto the current selection.'],
};
let eyeTargets = [];
function setTool(t){
  if (t.startsWith('soon:')) return soon(t.slice(5));
  if (t.startsWith('cmd:')) return run(t.slice(4));
  if (tool === 'pen' && t !== 'pen') finishPen(false);
  if (t === 'eyedrop') eyeTargets = actives().slice();
  const wasActive = canvas.getActiveObject();
  if (tool === 'shape' && t !== 'shape') Nodes.stop(true);
  const wasFx = FxTool.active();
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const draw = !['pick', 'eyedrop'].includes(t);
  canvas.isDrawingMode = t === 'free' || t === 'brush';
  if (canvas.isDrawingMode){
    const br = new fabric.PencilBrush(canvas);
    br.color = (t === 'brush' ? defFill : (defStroke || defFill)) || '#111';
    br.width = t === 'brush' ? 14 : 3; br.decimate = 2;
    canvas.freeDrawingBrush = br;
  }
  canvas.selection = t === 'pick';
  canvas.skipTargetFind = draw;
  canvas.defaultCursor = t === 'zoom' ? 'zoom-in' : t === 'text' ? 'text' : draw ? 'crosshair' : 'default';
  canvas.hoverCursor = t === 'eyedrop' ? 'copy' : 'move';
  if (draw) canvas.discardActiveObject();
  $('penHint').classList.toggle('on', t === 'pen');
  if (FxTool.active()){ canvas.defaultCursor = 'crosshair'; if (!wasFx) { if (wasActive) canvas.setActiveObject(wasActive); FxTool.start(); } else FxTool.bar(); } else if (wasFx) { FxTool.stop(); }
  $('pbFxCommon').classList.toggle('on', FxTool.active());
  if (t === 'shape'){
    canvas.defaultCursor = 'default';
    if (wasActive && wasActive.type === 'path') Nodes.edit(wasActive);
    else if (wasActive && Nodes.convertible(wasActive)){ Nodes.pending = wasActive; toast('Double-click the shape to turn it into a curve and edit its nodes'); }
  }
  Nodes.bar();
  canvas.requestRenderAll(); refresh();
}
document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));

let drawing = null, start = null;
function pointer(o){ return canvas.getPointer(o.e); }
canvas.on('mouse:down', o => {
  if (preview) return;
  if (tool === 'shape') return Nodes.down(o);
  if (FxTool.active()) return FxTool.down(o);
  const p = pointer(o);
  if (tool === 'zoom'){ const c = canvas.getPointer(o.e, true); setZoom(zoom * (o.e.altKey ? 0.8 : 1.25), c.x, c.y); return; }
  if (tool === 'eyedrop'){
    if (!o.target) return;
    const src = o.target.type === 'group' ? o.target.getObjects()[0] : o.target;
    const props = {fill: src.fill, stroke: src.stroke, strokeWidth: src.strokeWidth};
    if (eyeTargets.length){ leafs(eyeTargets).forEach(t => t.set(props)); canvas.requestRenderAll(); queueSnapshot(); toast('Colours copied'); }
    else { defFill = typeof src.fill === 'string' ? src.fill : fillHex(src); defStroke = src.stroke || null; toast('Default colours picked'); }
    const back = eyeTargets; setTool('pick');
    if (back.length) canvas.setActiveObject(back.length > 1 ? new fabric.ActiveSelection(back, {canvas}) : back[0]);
    refresh(); return;
  }
  if (tool === 'text'){
    const t = makeText('Your text', {fontSize:40}); t.set({left: p.x, top: p.y - 20});
    canvas.add(t); setTool('pick'); canvas.setActiveObject(t); t.enterEditing(); t.selectAll(); canvas.requestRenderAll(); return;
  }
  if (tool === 'pen'){ penClick(p); return; }
  if (['rect','ellipse','star','line'].includes(tool)){
    start = Pick.snapPoint(p);
    if (tool === 'rect') drawing = styleNew(new fabric.Rect({left:p.x, top:p.y, width:1, height:1}));
    if (tool === 'ellipse') drawing = styleNew(new fabric.Ellipse({left:p.x, top:p.y, rx:1, ry:1}));
    if (tool === 'star'){ drawing = styleNew(makeStar(5, 21)); drawing.set({left:p.x, top:p.y, scaleX:.01, scaleY:.01}); }
    if (tool === 'line') drawing = new fabric.Line([p.x, p.y, p.x, p.y], {stroke: defStroke || defFill || '#111', strokeWidth:3, strokeLineCap:'round', fill:null});
    canvas.add(drawing);
  }
});
canvas.on('mouse:move', o => {
  const p = pointer(o);
  $('stCur').textContent = `${inch(p.x)}, ${inch(p.y)} in`;
  if (tool === 'shape') return Nodes.move(o);
  if (FxTool.active()) return FxTool.move(o);
  if (tool === 'pen'){ penMove(p); return; }
  if (!drawing) return;
  const sp = Pick.snapPoint(p);
  let w = sp.x - start.x, h = sp.y - start.y;
  if (o.e.shiftKey && tool !== 'line'){ const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
  const left = Math.min(start.x, start.x + w), top = Math.min(start.y, start.y + h), aw = Math.abs(w), ah = Math.abs(h);
  if (tool === 'rect') drawing.set({left, top, width: aw, height: ah});
  if (tool === 'ellipse') drawing.set({left, top, rx: aw / 2, ry: ah / 2});
  if (tool === 'star') drawing.set({left, top, scaleX: Math.max(aw, 1) / drawing.width, scaleY: Math.max(ah, 1) / drawing.height});
  if (tool === 'line'){
    let x2 = sp.x, y2 = sp.y;
    if (o.e.shiftKey){ const a = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(w, h); x2 = start.x + d * Math.cos(a); y2 = start.y + d * Math.sin(a); }
    drawing.set({x2, y2});
  }
  drawing.setCoords(); canvas.requestRenderAll();
});
canvas.on('mouse:up', () => {
  if (!drawing) return;
  const o = drawing; drawing = null;
  const tiny = o.getScaledWidth() < 3 && o.getScaledHeight() < 3;
  if (tiny){
    if (tool === 'line'){ o.set({x2: o.x1 + 80, y2: o.y1}); }
    else if (tool === 'star'){ o.set({scaleX: 1, scaleY: 1}); }
    else if (tool === 'ellipse'){ o.set({rx: 40, ry: 40}); }
    else o.set({width: 80, height: 80});
  }
  o.setCoords(); Pick.clearGuides(); Pick.targets = null; setTool('pick'); canvas.setActiveObject(o); canvas.requestRenderAll(); queueSnapshot();
});
canvas.on('path:created', e => { e.path.set({name: tool === 'brush' ? 'Brush stroke' : 'Freehand', strokeLineCap:'round', strokeLineJoin:'round', strokeUniform:true}); queueSnapshot(); });

/* pen tool */
let penPts = [], penPreview = null;
function penClick(p){
  if (penPts.length >= 3 && Math.hypot(p.x - penPts[0].x, p.y - penPts[0].y) < 8 / zoom) return finishPen(true);
  const last = penPts[penPts.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
  penPts.push({x: p.x, y: p.y}); penMove(p);
}
function penMove(p){
  if (!penPts.length) return;
  if (penPreview) canvas.remove(penPreview);
  restoring = true;
  penPreview = new fabric.Polyline(penPts.concat([p]), {fill:'', stroke:'#3b82f6', strokeWidth:1.5 / zoom, strokeDashArray:[4 / zoom, 3 / zoom], selectable:false, evented:false, excludeFromExport:true, objectCaching:false});
  canvas.add(penPreview); restoring = false; canvas.requestRenderAll();
}
function finishPen(closed){
  if (penPreview){ restoring = true; canvas.remove(penPreview); restoring = false; penPreview = null; }
  const pts = penPts; penPts = [];
  if (pts.length >= 2){
    const o = closed
      ? styleNew(new fabric.Polygon(pts), {name:'Pen shape'})
      : new fabric.Polyline(pts, {fill:'', stroke: defStroke || defFill || '#111', strokeWidth:3, strokeLineJoin:'round', strokeLineCap:'round', name:'Pen path', strokeUniform:true});
    canvas.add(o); if (tool === 'pen'){ setTool('pick'); } canvas.setActiveObject(o); queueSnapshot();
  }
  canvas.requestRenderAll();
}
canvas.on('mouse:dblclick', o => { if (tool === 'pen'){ penPts.pop(); finishPen(false); } if (tool === 'shape') Nodes.dbl(o); if (FxTool.active()) FxTool.dbl(o); });
canvas.on('mouse:up', o => { if (tool === 'shape') Nodes.up(o); if (FxTool.active()) FxTool.up(o); });

/* snapping and alignment guides live in pick.js; these are their switches (Alt+Q, Alt+Shift+A) */
function setSnap(on){ Pick.snapOn = on; $('bSnap').style.background = on ? 'var(--accent-soft)' : ''; toast('Snapping ' + (on ? 'on' : 'off')); }
function setGuides(on){ Pick.guidesOn = on; $('bGuides').style.background = on ? 'var(--accent-soft)' : ''; toast('Alignment guides ' + (on ? 'on' : 'off')); }
$('bSnap').onclick = () => setSnap(!Pick.snapOn);
$('bGuides').onclick = () => setGuides(!Pick.guidesOn);

/* ===================== canvas events → UI ===================== */
['object:added','object:removed','object:modified'].forEach(ev => canvas.on(ev, () => { if (!restoring && !drawing){ queueSnapshot(); refresh(); } }));
canvas.on('text:editing:exited', () => queueSnapshot());
canvas.on('text:changed', e => { TextCurves.refit(e.target); queueSnapshot(); syncBars(); refreshLayersSoon(); });
['selection:created','selection:updated','selection:cleared'].forEach(ev => canvas.on(ev, refresh));
['object:scaling','object:rotating','object:resizing'].forEach(ev => canvas.on(ev, syncBars));

let layersT;
// the layers list and print checks only rebuild while they can be seen (on phones the panels are usually closed)
function panelVisible(d){
  const dock = document.querySelector('.dock');
  return $('d-' + d).classList.contains('on') && (!matchMedia('(max-width: 1099px)').matches || dock.classList.contains('open'));
}
function refreshLayersSoon(){ clearTimeout(layersT); layersT = setTimeout(() => { if (panelVisible('objects')) renderLayers(); if (panelVisible('props')) renderChecks(); }, 80); }
function refresh(){ syncBars(); syncProps(); refreshLayersSoon(); }

/* ===================== property bar ===================== */
FONTS.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; o.style.fontFamily = f; $('pFont').appendChild(o); });
function syncBars(){
  const a = canvas.getActiveObject(), objs = actives();
  const isText = objs.length && objs.every(o => o.text != null);
  $('pbNone').classList.toggle('on', !a && tool !== 'shape' && !FxTool.active());
  $('pbXform').classList.toggle('on', !!a);
  $('pbText').classList.toggle('on', !!a && isText);
  $('pbShape').classList.toggle('on', objs.length > 1);
  const onPath = objs.length === 1 && isText && !!a.fitD;
  $('pbPath').classList.toggle('on', onPath);
  $('pbBreak').classList.toggle('on', objs.length === 1 && a.type === 'path' && (a.path || []).filter(c => c[0] === 'M').length > 1);
  $('ctxLabel').textContent = a ? (objs.length > 1 ? `${objs.length} objects` : kindOf(a)) : TOOL_INFO[tool][0];
  $('toolHint').textContent = TOOL_INFO[tool][1];
  if (a){
    const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    const br = a.getBoundingRect(true, true);
    set('pX', inch(br.left) + '"'); set('pY', inch(br.top) + '"');
    set('pW', inch(a.getScaledWidth()) + '"'); set('pH', inch(a.getScaledHeight()) + '"');
    set('pA', Math.round(a.angle || 0) + '°');
    if (isText){
      const t = objs[0];
      set('pFont', t.fontFamily); $('pFont').style.fontFamily = t.fontFamily;
      set('pSize', Math.round(t.fontSize * (t.scaleY || 1) * 72 / PX_PER_IN));
      set('pSpacing', t.charSpacing || 0); set('pLine', t.lineHeight);
      $('pBold').classList.toggle('on', t.fontWeight === 'bold' || t.fontWeight >= 700);
      $('pItalic').classList.toggle('on', t.fontStyle === 'italic');
      $('pUnder').classList.toggle('on', !!t.underline);
      document.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === t.textAlign));
      set('pCurve', t.curve || 0); set('pCurveV', t.curve || 0);
      $('pCurve').disabled = $('pCurveV').disabled = !!t.fitD;
      if (t.fitD){
        set('pPlace', t.pathPlace || 'start'); set('pVAlign', t.pathAlign || 'baseline');
        set('pPathOff', inch(t.pathUserOffset || 0) + '"'); $('pSide').classList.toggle('on', t.pathSide === 'right');
      }
    }
    $('stSel').innerHTML = objs.length > 1 ? `Selected: <b>${objs.length} objects</b>` : `Selected: <b>${kindOf(a)} “${nameOf(a).slice(0, 30)}”</b>`;
    const f = objs.length === 1 ? fillHex(a) : null, s = objs.length === 1 ? (a.strokeWidth ? hex(a.stroke) : null) : null;
    $('stFill').style.background = f || 'transparent'; $('stFillT').textContent = f ? f.toUpperCase() : (a.fill && typeof a.fill === 'object' ? 'Gradient' : 'None');
    $('stStroke').style.background = s || 'transparent'; $('stStrokeT').textContent = s ? `${s.toUpperCase()} · ${(a.strokeWidth * 72 / PX_PER_IN).toFixed(1)} pt` : 'None';
  } else {
    $('stSel').textContent = 'Nothing selected';
    $('stFill').style.background = defFill || 'transparent'; $('stFillT').textContent = defFill ? defFill.toUpperCase() + ' (default)' : 'None';
    $('stStroke').style.background = defStroke || 'transparent'; $('stStrokeT').textContent = defStroke ? defStroke.toUpperCase() + ' (default)' : 'None';
  }
  const sf = a && actives().length === 1 ? fillHex(a) : defFill, ss = a && actives().length === 1 ? (a.strokeWidth ? hex(a.stroke) : null) : defStroke;
  $('swF').style.background = sf || 'repeating-linear-gradient(45deg,#fff 0 3px,#ef4444 3px 4px)';
  $('swS').style.boxShadow = ss ? `inset 0 0 0 4px ${ss}` : 'inset 0 0 0 4px #555';
}
function commit(o){ o.setCoords(); canvas.requestRenderAll(); canvas.fire('object:modified', {target:o}); syncBars(); }
function onEnter(id, fn){ const el = $(id); el.addEventListener('change', fn); el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); }); }
onEnter('pX', () => { const a = canvas.getActiveObject(); if (!a) return; const br = a.getBoundingRect(true, true); a.left += fromIn($('pX').value) - br.left; commit(a); });
onEnter('pY', () => { const a = canvas.getActiveObject(); if (!a) return; const br = a.getBoundingRect(true, true); a.top += fromIn($('pY').value) - br.top; commit(a); });
onEnter('pW', () => { const a = canvas.getActiveObject(); if (!a) return; const s = fromIn($('pW').value) / a.width; if (!(s > 0)) return; const r = a.scaleY / a.scaleX; a.set({scaleX: s}); if ($('pRatio').classList.contains('on')) a.set({scaleY: s * r}); commit(a); });
onEnter('pH', () => { const a = canvas.getActiveObject(); if (!a) return; const s = fromIn($('pH').value) / a.height; if (!(s > 0)) return; const r = a.scaleX / a.scaleY; a.set({scaleY: s}); if ($('pRatio').classList.contains('on')) a.set({scaleX: s * r}); commit(a); });
onEnter('pA', () => { const a = canvas.getActiveObject(); if (!a) return; a.rotate(parseFloat($('pA').value) || 0); commit(a); });
$('pRatio').onclick = () => $('pRatio').classList.toggle('on');

function eachText(fn){ actives().filter(o => o.text != null).forEach(t => { fn(t); t.initDimensions && t.initDimensions(); TextCurves.refit(t); t.setCoords(); }); canvas.requestRenderAll(); queueSnapshot(); syncBars(); }
$('pFont').onchange = () => { const f = $('pFont').value; document.fonts.load(`40px "${f}"`).finally(() => { fabric.util.clearFabricFontCache(f); eachText(t => t.set('fontFamily', f)); }); };
onEnter('pSize', () => { const pt = parseFloat($('pSize').value); if (pt > 0) eachText(t => t.set({fontSize: pt * PX_PER_IN / 72 / (t.scaleY || 1)})); });
onEnter('pSpacing', () => eachText(t => t.set('charSpacing', parseFloat($('pSpacing').value) || 0)));
onEnter('pLine', () => eachText(t => t.set('lineHeight', parseFloat($('pLine').value) || 1)));
$('pBold').onclick = () => { const on = !$('pBold').classList.contains('on'); eachText(t => t.set('fontWeight', on ? 'bold' : 'normal')); };
$('pItalic').onclick = () => { const on = !$('pItalic').classList.contains('on'); eachText(t => t.set('fontStyle', on ? 'italic' : 'normal')); };
// text on a curve / on a path
function curveSel(v, live){
  const t = canvas.getActiveObject(); if (!t || t.text == null) return;
  if (TextCurves.applyCurve(t, v)){ canvas.requestRenderAll(); if (!live){ canvas.fire('object:modified', {target: t}); } syncBars(); }
}
$('pCurve').oninput = () => { $('pCurveV').value = $('pCurve').value; curveSel($('pCurve').value, true); };
$('pCurve').onchange = () => curveSel($('pCurve').value, false);
onEnter('pCurveV', () => curveSel($('pCurveV').value, false));
function pathSel(fn){ const t = canvas.getActiveObject(); if (!t || !t.fitD) return; fn(t); TextCurves.refit(t); canvas.requestRenderAll(); canvas.fire('object:modified', {target: t}); syncBars(); }
$('pPlace').onchange = () => pathSel(t => { t.pathPlace = $('pPlace').value; t.pathUserOffset = 0; });
$('pVAlign').onchange = () => pathSel(t => t.set('pathAlign', $('pVAlign').value));
onEnter('pPathOff', () => pathSel(t => { t.pathUserOffset = fromIn($('pPathOff').value) || 0; }));
$('pSide').onclick = () => pathSel(t => t.set('pathSide', t.pathSide === 'right' ? 'left' : 'right'));
$('pUnder').onclick = () => { const on = !$('pUnder').classList.contains('on'); eachText(t => t.set('underline', on)); };
document.querySelectorAll('[data-align]').forEach(b => b.onclick = () => eachText(t => t.set('textAlign', b.dataset.align)));

/* ===================== properties docker ===================== */
function eachLeaf(fn){ const objs = actives(); leafs(objs).forEach(fn); objs.forEach(o => o.set('dirty', true)); canvas.requestRenderAll(); queueSnapshot(); syncBars(); renderLayersSoonAfter(); }
function renderLayersSoonAfter(){ refreshLayersSoon(); }
function gradientFor(c1, c2, dir){
  const coords = dir === 'h' ? {x1:0, y1:0, x2:1, y2:0} : dir === 'd' ? {x1:0, y1:0, x2:1, y2:1} : {x1:0, y1:0, x2:0, y2:1};
  return new fabric.Gradient({type:'linear', gradientUnits:'percentage', coords, colorStops:[{offset:0, color:c1}, {offset:1, color:c2}]});
}
function currentFillType(o){ return !o.fill ? 'none' : typeof o.fill === 'object' ? 'gradient' : 'solid'; }
function syncProps(){
  const objs = actives(), a = objs[0];
  $('propsEmpty').style.display = a ? 'none' : 'block';
  $('propsBody').style.display = a ? 'block' : 'none';
  if (!a) return;
  const leaf = leafs([a])[0] || a;
  const ft = currentFillType(leaf);
  document.querySelectorAll('#fillType button').forEach(b => b.classList.toggle('on', b.dataset.ft === ft));
  $('gradRow').style.display = ft === 'gradient' ? 'flex' : 'none';
  const f = fillHex(leaf) || '#ffffff'; $('fColor').value = f; $('fHex').value = ft === 'none' ? 'none' : f.toUpperCase();
  if (ft === 'gradient'){ $('fColor2').value = hex(leaf.fill.colorStops[leaf.fill.colorStops.length - 1].color); }
  const s = hex(leaf.stroke) || '#000000'; $('sColor').value = s; $('sHex').value = leaf.strokeWidth ? s.toUpperCase() : 'none';
  $('sWidth').value = +((leaf.strokeWidth || 0) * 72 / PX_PER_IN).toFixed(1);
  $('sDash').value = leaf.strokeDashArray ? leaf.strokeDashArray.join(',') : '';
  $('sJoin').value = leaf.strokeLineJoin || 'miter';
  $('oOpacity').value = Math.round((a.opacity ?? 1) * 100); $('oOpacityV').textContent = $('oOpacity').value + '%';
  $('oBlend').value = a.globalCompositeOperation || 'source-over';
  const sh = a.fx && a.fx.shadow; $('oShadow').value = sh ? (sh.preset && Effects.SHADOW_PRESETS[sh.preset] ? sh.preset : 'custom') : 'off';
  $('radiusRow').style.display = objs.length === 1 && a.type === 'rect' ? 'flex' : 'none';
  if (a.type === 'rect') $('oRadius').value = a.rx || 0;
}
document.querySelectorAll('#fillType button').forEach(b => b.onclick = () => {
  const ft = b.dataset.ft, c1 = $('fColor').value, c2 = $('fColor2').value === '#000000' ? shade(c1, -90) : $('fColor2').value;
  eachLeaf(o => o.set('fill', ft === 'none' ? '' : ft === 'gradient' ? gradientFor(c1, c2, $('gDir').value) : c1));
  if (ft === 'gradient') $('fColor2').value = c2;
  syncProps();
});
function applyFill(){ const ft = document.querySelector('#fillType .on').dataset.ft, c1 = $('fColor').value; eachLeaf(o => o.set('fill', ft === 'gradient' ? gradientFor(c1, $('fColor2').value, $('gDir').value) : c1)); if (ft === 'none') syncProps(); }
$('fColor').oninput = () => { $('fHex').value = $('fColor').value.toUpperCase(); if (document.querySelector('#fillType .on').dataset.ft === 'none') document.querySelector('[data-ft=solid]').click(); else applyFill(); };
$('fColor2').oninput = applyFill; $('gDir').onchange = applyFill;
onEnter('fHex', () => { const h = hex($('fHex').value); if (h){ $('fColor').value = h; $('fColor').oninput(); } });
function applyStroke(){ const w = parseFloat($('sWidth').value) || 0; eachLeaf(o => o.set({stroke: $('sColor').value, strokeWidth: w * PX_PER_IN / 72, strokeUniform:true})); }
$('sColor').oninput = () => { if (!(parseFloat($('sWidth').value) > 0)) $('sWidth').value = 3; $('sHex').value = $('sColor').value.toUpperCase(); applyStroke(); };
onEnter('sHex', () => { const h = hex($('sHex').value); if (h){ $('sColor').value = h; $('sColor').oninput(); } else if ($('sHex').value.trim() === 'none'){ $('sWidth').value = 0; applyStroke(); } });
onEnter('sWidth', applyStroke);
$('sDash').onchange = () => { const v = $('sDash').value; eachLeaf(o => o.set('strokeDashArray', v ? v.split(',').map(Number) : null)); };
$('sJoin').onchange = () => eachLeaf(o => o.set({strokeLineJoin: $('sJoin').value}));
$('oOpacity').oninput = () => { $('oOpacityV').textContent = $('oOpacity').value + '%'; actives().forEach(o => o.set('opacity', $('oOpacity').value / 100)); canvas.requestRenderAll(); };
$('oOpacity').onchange = () => { queueSnapshot(); refreshLayersSoon(); };
$('oBlend').onchange = () => { actives().forEach(o => o.set('globalCompositeOperation', $('oBlend').value)); canvas.requestRenderAll(); queueSnapshot(); };
// the Properties panel's shadow list puts TraceDraw's live drop shadow presets on the selection
function setShadow(kind){
  const objs = actives();
  if (kind === 'off') Effects.set(objs, 'shadow', null);
  else if (Effects.SHADOW_PRESETS[kind]) Effects.set(objs, 'shadow', Object.assign({}, Effects.defaults.shadow, Effects.SHADOW_PRESETS[kind], {preset: kind}), true);
  objs.forEach(o => o.set('shadow', null));
  canvas.requestRenderAll(); queueSnapshot(); syncProps(); refreshLayersSoon();
}
$('oShadow').onchange = () => setShadow($('oShadow').value);
onEnter('oRadius', () => { const a = canvas.getActiveObject(); if (a && a.type === 'rect'){ const r = parseFloat($('oRadius').value) || 0; a.set({rx: r, ry: r}); commit(a); } });

/* palette */
const pal = $('pal');
PALETTE.forEach(c => { const s = document.createElement('span'); s.style.background = c; s.title = c + ' — left: fill · right: outline'; s.dataset.c = c; pal.appendChild(s); });
function paletteApply(c, outline){
  const objs = actives();
  if (!objs.length){
    if (outline) defStroke = c; else defFill = c;
    toast(`Default ${outline ? 'outline' : 'fill'} for new objects: ${c ? c.toUpperCase() : 'none'}`); syncBars(); return;
  }
  eachLeaf(o => {
    if (outline){ if (c){ o.set({stroke: c, strokeUniform:true}); if (!o.strokeWidth) o.set('strokeWidth', DEF_STROKE); } else o.set({strokeWidth: 0, stroke: null}); }
    else o.set('fill', c || '');
  });
  syncProps();
}
pal.addEventListener('click', e => { const c = e.target.dataset.c; if (c) paletteApply(c, false); });
pal.addEventListener('contextmenu', e => { const c = e.target.dataset.c; if (c){ e.preventDefault(); paletteApply(c, true); } });
$('palNone').onclick = () => paletteApply(null, false);
$('palNone').oncontextmenu = e => { e.preventDefault(); paletteApply(null, true); };

/* ===================== layers docker ===================== */
let dragIdx = null;
// thumbnails are cached until what they show changes
function thumbKey(o){
  const f = o.fill && typeof o.fill === 'object' ? JSON.stringify(o.fill.colorStops || '') : o.fill;
  return [o.type, o.width, o.height, o.scaleX, o.scaleY, o.angle, o.flipX, o.flipY, o.skewX, f, o.stroke, o.strokeWidth, o.text, o.opacity, o.fontFamily, o.fontWeight,
          o.path && o.path.length, o._objects && o._objects.map(c => c.type + c.left + c.top + c.fill).join(), o.fx && JSON.stringify(o.fx).length].join('|');
}
function thumb(o){
  const k = thumbKey(o); if (o.__thumb && o.__thumb.k === k) return o.__thumb.url;
  const url = thumbRender(o); o.__thumb = {k, url}; return url;
}
function thumbRender(o){
  try {
    const w = o.getScaledWidth() || 1, h = o.getScaledHeight() || 1;
    return o.toDataURL({multiplier: 56 / Math.max(w, h) / zoom, format:'png'});
  } catch(e){ return ''; }
}
function renderLayers(){
  const list = $('layers'); list.innerHTML = '';
  const objs = canvas.getObjects().filter(o => !o.excludeFromExport);
  const act = new Set(actives());
  if (!objs.length){ list.innerHTML = '<div class="empty">No objects on this page yet. Pick a tool on the left and draw, or add something from Assets.</div>'; return; }
  for (let i = objs.length - 1; i >= 0; i--){
    const o = objs[i], row = document.createElement('div');
    const isG = o.type === 'group' || o.type === 'clipframe';
    row.className = 'layer' + (act.has(o) ? ' on' : '') + (isG ? ' group' : '') + (o.__focus ? ' infocus' : '') + (Focus.faded(o) ? ' faded' : '') + (o.visible ? '' : ' hidden');
    row.draggable = true; row.dataset.idx = canvas.getObjects().indexOf(o);
    row.innerHTML = `<span class="eye" title="Show / hide">${o.visible ? '👁' : '◌'}</span><span class="thumb"></span><span class="nm"></span><span class="kind">${kindOf(o)}${o.type === 'group' ? ' · ' + o.size() : o.type === 'clipframe' ? ' · ' + (o.size() - 1) : ''}</span><span class="lock" title="Lock / unlock">${o.lockedObj ? '🔒' : '🔓'}</span>`;
    row.querySelector('.thumb').style.backgroundImage = `url("${thumb(o)}")`;
    row.querySelector('.nm').textContent = nameOf(o);
    row.onclick = e => {
      if (e.target.closest('.eye')){ o.visible = !o.visible; if (!o.visible) canvas.discardActiveObject(); canvas.requestRenderAll(); queueSnapshot(); refresh(); return; }
      if (e.target.closest('.lock')){ o.lockedObj = !o.lockedObj; applyLock(o); if (o.lockedObj) canvas.discardActiveObject(); canvas.requestRenderAll(); queueSnapshot(); refresh(); return; }
      if (o.lockedObj || !o.visible){ toast(o.lockedObj ? 'Unlock the object to select it' : 'Show the object to select it'); return; }
      if (e.shiftKey || e.metaKey){ const sel = actives().filter(x => x !== o); if (!act.has(o)) sel.push(o); canvas.discardActiveObject(); if (sel.length) canvas.setActiveObject(sel.length > 1 ? new fabric.ActiveSelection(sel, {canvas}) : sel[0]); }
      else canvas.setActiveObject(o);
      canvas.requestRenderAll();
    };
    const nm = row.querySelector('.nm');
    nm.ondblclick = e => { e.stopPropagation(); nm.contentEditable = true; nm.focus(); document.getSelection().selectAllChildren(nm); };
    nm.onblur = () => { if (nm.isContentEditable){ nm.contentEditable = false; o.name = nm.textContent.trim() || null; queueSnapshot(); refresh(); } };
    nm.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); nm.blur(); } if (e.key === 'Escape'){ nm.textContent = nameOf(o); nm.blur(); } };
    row.ondragstart = () => { dragIdx = +row.dataset.idx; };
    row.ondragover = e => { e.preventDefault(); row.classList.add('drop'); };
    row.ondragleave = () => row.classList.remove('drop');
    row.ondrop = e => { e.preventDefault(); row.classList.remove('drop'); if (dragIdx == null) return; const target = +row.dataset.idx, obj = canvas.getObjects()[dragIdx]; canvas.moveTo(obj, target); dragIdx = null; canvas.requestRenderAll(); queueSnapshot(); refresh(); };
    list.appendChild(row);
    if (isG){
      o.getObjects().slice().reverse().forEach(c => {
        const r = document.createElement('div'); r.className = 'layer child';
        r.innerHTML = `<span class="thumb"></span><span class="nm"></span><span class="kind">${kindOf(c)}</span>`;
        r.querySelector('.nm').textContent = nameOf(c);
        r.querySelector('.thumb').style.backgroundImage = `url("${thumb(c)}")`;
        r.title = 'Ungroup (⇧⌘G) to edit parts separately';
        list.appendChild(r);
      });
    }
  }
}

/* ===================== print checks ===================== */
function renderChecks(){
  const objs = canvas.getObjects().filter(o => o.visible && !o.excludeFromExport), out = [];
  if (!objs.length){ $('checks').innerHTML = '<div class="empty">Nothing to check yet.</div>'; return; }
  const outside = objs.filter(o => { const b = o.getBoundingRect(true, true); return b.left < -0.5 || b.top < -0.5 || b.left + b.width > PA_W + 0.5 || b.top + b.height > PA_H + 0.5; });
  out.push(outside.length ? ['warn', `${outside.length} object(s) go past the print area and will be cropped: ${outside.map(nameOf).slice(0, 3).join(', ')}`] : ['ok', 'Everything is inside the print area']);
  const imgs = leafs(objs).filter(o => o.type === 'image');
  if (imgs.length){
    imgs.forEach(o => {
      const el = o.getElement(), dpi = Math.round(el.naturalWidth / (o.getScaledWidth() / PX_PER_IN));
      out.push([dpi >= 300 ? 'ok' : dpi >= 150 ? 'warn' : 'bad', `${nameOf(o)}: ${dpi} DPI at this size${dpi < 300 ? ' (aim for 300)' : ''}`]);
    });
  } else out.push(['ok', 'No bitmap images — vectors print sharp at any size']);
  const thin = leafs(objs).filter(o => o.stroke && o.strokeWidth && o.strokeWidth * (o.strokeUniform ? 1 : o.scaleX) * 72 / PX_PER_IN < 1);
  out.push(thin.length ? ['warn', `${thin.length} outline(s) thinner than 1 pt may not print`] : ['ok', 'No hairline outlines']);
  const colors = new Set();
  leafs(objs).forEach(o => {
    if (typeof o.fill === 'string' && o.fill) colors.add(hex(o.fill));
    else if (o.fill && o.fill.colorStops) colors.add('gradient');
    if (o.stroke && o.strokeWidth) colors.add(hex(o.stroke));
    if (o.type === 'image') colors.add('photo');
  });
  const grad = colors.has('gradient') || colors.has('photo'); colors.delete('gradient'); colors.delete('photo');
  out.push([grad ? 'warn' : 'ok', grad ? `${colors.size} solid colours + gradients/photos → DTG or DTF printing` : `${colors.size} solid colour(s) → ${colors.size} screen(s) for screen printing`]);
  $('checks').innerHTML = out.map(([k, t]) => `<div class="chk"><i class="${k}">${k === 'ok' ? '✓' : '!'}</i><span></span></div>`).join('');
  $('checks').querySelectorAll('.chk span').forEach((s, i) => s.textContent = out[i][1]);
}

/* ===================== commands ===================== */
function selectObjs(list){ canvas.discardActiveObject(); if (!list.length) return; canvas.setActiveObject(list.length > 1 ? new fabric.ActiveSelection(list, {canvas}) : list[0]); canvas.requestRenderAll(); }
function removeSel(){ const objs = actives(); if (!objs.length) return; canvas.discardActiveObject(); objs.forEach(o => canvas.remove(o)); canvas.requestRenderAll(); }
function cloneSel(offset, cb){
  const a = canvas.getActiveObject(); if (!a) return;
  a.clone(c => {
    canvas.discardActiveObject();
    c.set({left: c.left + offset, top: c.top + offset, evented: true});
    if (c.type === 'activeSelection'){ c.canvas = canvas; c.forEachObject(o => canvas.add(o)); c.setCoords(); }
    else canvas.add(c);
    canvas.setActiveObject(c); canvas.requestRenderAll(); cb && cb(c);
  }, PROPS);
}
function group(){
  const a = canvas.getActiveObject();
  if (!a || a.type !== 'activeSelection') return toast('Select two or more objects to group');
  const g = a.toGroup(); g.name = 'Group'; canvas.requestRenderAll(); queueSnapshot(); refresh();
}
function ungroup(){
  const a = canvas.getActiveObject();
  if (!a || a.type !== 'group') return toast('Select a group to ungroup');
  a.toActiveSelection(); canvas.requestRenderAll(); queueSnapshot(); refresh();
}
function alignObjs(mode){
  const objs = actives(); if (!objs.length) return toast('Select something to align');
  const single = objs.length === 1;
  canvas.discardActiveObject();
  const rects = objs.map(o => o.getBoundingRect(true, true));
  const box = single ? {l:0, t:0, r:PA_W, b:PA_H} : {l:Math.min(...rects.map(r => r.left)), t:Math.min(...rects.map(r => r.top)), r:Math.max(...rects.map(r => r.left + r.width)), b:Math.max(...rects.map(r => r.top + r.height))};
  objs.forEach((o, i) => {
    const r = rects[i]; let dx = 0, dy = 0;
    if (mode === 'l') dx = box.l - r.left;
    if (mode === 'r') dx = box.r - (r.left + r.width);
    if (mode === 'ch' || mode === 'c') dx = (box.l + box.r) / 2 - (r.left + r.width / 2);
    if (mode === 't') dy = box.t - r.top;
    if (mode === 'b') dy = box.b - (r.top + r.height);
    if (mode === 'cv' || mode === 'c') dy = (box.t + box.b) / 2 - (r.top + r.height / 2);
    o.set({left: o.left + dx, top: o.top + dy}); o.setCoords();
  });
  selectObjs(objs); queueSnapshot(); refresh();
}
document.querySelectorAll('[data-align-obj]').forEach(b => b.onclick = () => alignObjs(b.dataset.alignObj));
function arrange(how){
  const objs = actives(); if (!objs.length) return;
  const a = canvas.getActiveObject();
  if (how === 'front') objs.forEach(o => canvas.bringToFront(o));
  if (how === 'toback') objs.slice().reverse().forEach(o => canvas.sendToBack(o));
  if (how === 'fwd') canvas.bringForward(a);
  if (how === 'back') canvas.sendBackwards(a);
  canvas.requestRenderAll(); queueSnapshot(); refresh();
}
function importFile(file){
  const r = new FileReader();
  const place = o => {
    const s = Math.min(PA_W * 0.8 / o.width, PA_H * 0.6 / o.height, 1e9);
    o.scale(s); o.name = file.name.replace(/\.[^.]+$/, ''); addAndSelect(placeCenter(o));
  };
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)){
    r.onload = () => fabric.loadSVGFromString(r.result, (objs, opts) => { if (!objs.length) return toast('That SVG had nothing to import'); place(fabric.util.groupSVGElements(objs, opts)); });
    r.readAsText(file);
  } else {
    r.onload = () => fabric.Image.fromURL(r.result, img => place(img));
    r.readAsDataURL(file);
  }
}
$('fileImport').onchange = e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; };
$('fileOpen').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { let data; try { data = JSON.parse(r.result); } catch(err){ return toast('Could not read that project file'); } Store.openData(data, f.name); };
  r.readAsText(f); e.target.value = '';
};
$('stage').addEventListener('dragover', e => e.preventDefault());
$('stage').addEventListener('drop', e => { e.preventDefault(); [...e.dataTransfer.files].forEach(importFile); });

function setPreview(on){
  preview = on;
  $('stage').classList.toggle('preview', on);
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', (b.dataset.m === 'preview') === on));
  canvas.discardActiveObject();
  canvas.clipPath = on ? new fabric.Rect({left:0, top:0, width:PA_W, height:PA_H, absolutePositioned:true}) : null;
  canvas.requestRenderAll(); refresh();
}
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setPreview(b.dataset.m === 'preview'));

function run(cmd){
  if (cmd.startsWith('soon:')) return soon(cmd.slice(5));
  if (cmd.startsWith('tool:')) return setTool(cmd.slice(5));
  if (cmd.startsWith('shape:')) return Shaping.run(cmd.slice(6));
  const a = canvas.getActiveObject();
  switch (cmd){
    case 'new': case 'home': Home.show(); break;
    case 'open': $('fileOpen').click(); break;
    case 'save': Store.saveNow(true); break;
    case 'savecopy': download(URL.createObjectURL(new Blob([JSON.stringify(projectData())], {type:'application/json'})), Store.slug() + '.tee.json'); toast('Downloaded a copy of the project file'); break;
    case 'rename': Store.renamePrompt(); break;
    case 'folder': Store.connect(); break;
    case 'import': $('fileImport').click(); break;
    case 'export': openExport(); break;
    case 'quickpng': exportPNG(300, true, page).then(url => Store.output(dataURLToBlob(url), `${page}-300dpi.png`)); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'copy': if (a) a.clone(c => { clipboard = c; toast('Copied'); }, PROPS); break;
    case 'paste': if (clipboard) clipboard.clone(c => { canvas.discardActiveObject(); c.set({left: c.left + 10, top: c.top + 10}); if (c.type === 'activeSelection'){ c.canvas = canvas; c.forEachObject(o => canvas.add(o)); c.setCoords(); } else canvas.add(c); clipboard.set({left: clipboard.left + 10, top: clipboard.top + 10}); canvas.setActiveObject(c); canvas.requestRenderAll(); }, PROPS); break;
    case 'dup': Pick.duplicate(false); break;
    case 'dupinplace': Pick.duplicate(true); break;
    case 'del': removeSel(); break;
    case 'selall': selectObjs(canvas.getObjects().filter(o => o.selectable && o.visible)); break;
    case 'zin': setZoom(zoom * 1.25); break;
    case 'zout': setZoom(zoom * 0.8); break;
    case 'fit': autoFit = true; fitZoom(); break;
    case 'preview': setPreview(!preview); break;
    case 'group': group(); break;
    case 'ungroup': ungroup(); break;
    case 'togglegroup': a && a.type === 'group' ? ungroup() : group(); break;
    case 'front': case 'fwd': case 'back': case 'toback': arrange(cmd); break;
    case 'flipx': if (a){ a.set('flipX', !a.flipX); commit(a); } break;
    case 'flipy': if (a){ a.set('flipY', !a.flipY); commit(a); } break;
    case 'center': alignObjs('c'); break;
    case 'fitpath': TextCurves.fitToPath(); break;
    case 'clip:place': Clip.startPlace(); break;
    case 'clip:extract': Clip.extract(); break;
    case 'clip:edit': if (Clip.isFrame(a)) $('cbEdit').click(); else toast('Select a clip frame'); break;
    case 'clip:empty': Clip.emptyFrame(); break;
    case 'clip:noframe': Clip.noFrame(); break;
    case 'clip:mask': case 'clip:invert': { const fr = actives().filter(o => o.type === 'clipframe'); if (!fr.length) return toast('Only clip frames take an opacity mask');
      fr.forEach(f => { if (cmd === 'clip:mask') f.opacityMask = !f.opacityMask; else { f.invertMask = !f.invertMask; f.opacityMask = true; } f.dirty = true; });
      canvas.requestRenderAll(); snapshot(); Clip.bar(); toast(fr[0].opacityMask ? `Opacity mask${fr[0].invertMask ? ' (inverted)' : ''}: the frame's brightness shows the contents` : 'Opacity mask off'); break; }
    case 'focus': { const t = a && a.__focus ? null : a; if (t && (t.type === 'group' || t.type === 'clipframe')) Focus.enter(t); else toast('Select a group or clip frame'); break; }
    case 'focusout': Focus.exitAll(); break;
    case 'straighten': { const t = actives().filter(o => o.text != null); if (!t.length) return toast('Select a text on a path or curve'); t.forEach(o => TextCurves.straighten(o)); canvas.requestRenderAll(); queueSnapshot(); refresh(); break; }
    case 'shadow': { if (!a) return toast('Select an object first'); const on = !(a.fx && a.fx.shadow); setShadow(on ? 'soft' : 'off'); toast(on ? 'Drop shadow on' : 'Drop shadow off'); break; }
    case 'fxbreak': FxTool.breakApart(a); break;
    case 'opacity': case 'fill': showDock('props'); if (!a) toast('Select an object, then adjust it here'); if (cmd === 'opacity') $('oOpacity').focus(); break;
    case 'sample': buildSample(); break;
    case 'clear': if (confirm('Clear everything on this page?')){ canvas.clear(); refresh(); } break;
    case 'help': toast('V pick · R rect · E ellipse · S star · L line · P pen · F freehand · T text · ⌘Z undo · ⌘D duplicate · ⌘G group · Del delete · arrows nudge'); break;
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  const mi = e.target.closest('.mi');
  document.querySelectorAll('.mi.open').forEach(m => { if (m !== mi || b) m.classList.remove('open'); });
  if (mi && !b && e.target.closest('.mi > button')) mi.classList.toggle('open');
  if (b) run(b.dataset.cmd);
});
document.querySelectorAll('.menu .mi > button').forEach(btn => btn.addEventListener('mouseenter', () => {
  if (document.querySelector('.mi.open')){ document.querySelectorAll('.mi.open').forEach(m => m.classList.remove('open')); btn.parentNode.classList.add('open'); }
}));
function showDock(d){
  document.querySelectorAll('.dtabs button').forEach(x => x.classList.toggle('on', x.dataset.d === d));
  document.querySelectorAll('.dbody').forEach(x => x.classList.toggle('on', x.id === 'd-' + d));
  refreshLayersSoon();
}
document.querySelectorAll('.dtabs button').forEach(b => b.onclick = () => showDock(b.dataset.d));

/* keyboard */
const a0 = () => canvas.getActiveObject();
document.addEventListener('keydown', e => {
  if (tool === 'shape' && !isTyping(e) && Nodes.keydown(e)){ e.preventDefault(); return; }
  if (e.key === 'Escape'){ if (tool === 'pen'){ penPts = []; finishPen(false); } setTool('pick'); canvas.discardActiveObject(); canvas.requestRenderAll(); $('export').classList.remove('on'); return; }
  if (isTyping(e)) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (tool === 'pen' && e.key === 'Enter'){ finishPen(false); return; }
  if (mod){
    const map = {z: e.shiftKey ? 'redo' : 'undo', y:'redo', d:'dup', g: e.shiftKey ? 'ungroup' : 'group', c:'copy', v:'paste', a:'selall', s:'save', o:'open', i:'import', e:'export', n:'new', k: (FxTool.target || a0()) && Effects.hasAny(FxTool.target || a0()) ? 'fxbreak' : 'shape:breakapart'};
    if (map[k]){ e.preventDefault(); run(map[k]); }
    if (e.key === 'PageUp'){ e.preventDefault(); run('fwd'); } if (e.key === 'PageDown'){ e.preventDefault(); run('back'); }
    if (k === '=' || k === '+'){ e.preventDefault(); run('zin'); } if (k === '-'){ e.preventDefault(); run('zout'); } if (k === '0'){ e.preventDefault(); run('fit'); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); run('del'); return; }
  if (e.key === 'Tab' && tool === 'pick'){ e.preventDefault(); Pick.cycle(e.shiftKey); return; }
  if ((e.key === '+' || (e.code === 'NumpadAdd')) && canvas.getActiveObject()){ e.preventDefault(); run('dupinplace'); return; }
  if (e.altKey && e.code === 'KeyQ'){ e.preventDefault(); setSnap(!Pick.snapOn); return; }
  if (e.altKey && e.shiftKey && e.code === 'KeyA'){ e.preventDefault(); setGuides(!Pick.guidesOn); return; }
  if (e.key.startsWith('Arrow')){
    const a = canvas.getActiveObject(); if (!a) return; e.preventDefault();
    // TraceDraw nudges: 2.54 mm, Shift 5.08 mm, Ctrl 0.254 mm
    const d = PX_PER_IN * (e.shiftKey ? 0.2 : (e.ctrlKey || e.metaKey) ? 0.01 : 0.1);
    if (e.key === 'ArrowLeft') a.left -= d; if (e.key === 'ArrowRight') a.left += d; if (e.key === 'ArrowUp') a.top -= d; if (e.key === 'ArrowDown') a.top += d;
    commit(a); return;
  }
  if (e.shiftKey && e.key === 'PageUp') return run('front');
  if (e.shiftKey && e.key === 'PageDown') return run('toback');
  const tools = {v:'pick', r:'rect', e:'ellipse', s:'star', l:'line', p: canvas.getActiveObject() ? null : 'pen', f:'free', b:'brush', t:'text', z:'zoom', i:'eyedrop', F5:'free', F6:'rect', F7:'ellipse', F8:'text', F10:'shape'};
  if (k === 'p' && canvas.getActiveObject()) return run('center');
  const t = tools[e.key] || tools[k]; if (t){ e.preventDefault(); setTool(t); }
  if (e.key === 'F9'){ e.preventDefault(); run('preview'); }
  if (k === '+' || k === '='){ run('zin'); } if (k === '-'){ run('zout'); }
});

