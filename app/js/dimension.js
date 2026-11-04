/* ===================== Dimensions and callouts =====================
   Parallel, Horizontal/Vertical, Angular and Segment dimensions and the 3-Point Callout, as one object each
   (fabric.Dimension). The figure reads its own transform, so a dimension scaled to twice the size says twice
   the length. Behaviour follows TraceDraw's docs/behavior/dimensions.md. */

const DIM_DEFAULTS = {precision: 2, units: 'in', showUnits: true, prefix: '', suffix: '', textPos: 'above', labelPt: 10, fontFamily: 'Inter', textColor: '#111111', lineColor: '#111111', lineW: 0.4, head: 'arrow', gapMM: 0, overMM: 2, horizontal: false, caption: '', shape: 'underline', axis: null};
const DIM_KEYS = Object.keys(DIM_DEFAULTS);
fabric.Dimension = fabric.util.createClass(fabric.Object, {
  type: 'dimension', objectCaching: false, strokeWidth: 0, fill: '',
  initialize(o){
    this.callSuper('initialize', o);
    DIM_KEYS.forEach(k => { if (this[k] === undefined) this[k] = DIM_DEFAULTS[k]; });
    if (o && o.scene){ this.pts = o.scene.map(p => ({x: p.x, y: p.y})); delete this.scene; this.left = 0; this.top = 0; this.width = 0; this.height = 0; this.placeFromScene(); }
  },
  toObject(extra){ return JSON.parse(JSON.stringify(this.callSuper('toObject', DIM_KEYS.concat(['kind', 'pts']).concat(extra || [])))); },
  placeFromScene(){
    const b = this.bounds(this.figure()), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    this.pts = this.pts.map(p => ({x: p.x - cx, y: p.y - cy}));
    this.width = b.x1 - b.x0; this.height = b.y1 - b.y0;
    this.setPositionByOrigin(new fabric.Point(cx, cy), 'center', 'center'); this.setCoords();
  },
  // after a change to the figure: same place on the page, new bounds
  refit(){
    const b = this.bounds(this.figure()), lx = (b.x0 + b.x1) / 2, ly = (b.y0 + b.y1) / 2, c = this.getCenterPoint();
    const m = this.calcTransformMatrix(), to = {x: m[0] * lx + m[2] * ly + c.x, y: m[1] * lx + m[3] * ly + c.y};
    this.pts = this.pts.map(p => ({x: p.x - lx, y: p.y - ly}));
    this.width = b.x1 - b.x0; this.height = b.y1 - b.y0;
    this.setPositionByOrigin(new fabric.Point(to.x, to.y), 'center', 'center'); this.setCoords(); this.dirty = true;
  },
  // a length in the figure's own space -> page units, through the object's transform
  pageVec(a, b){ const m = this.group ? this.calcTransformMatrix() : this.calcOwnMatrix(), dx = b.x - a.x, dy = b.y - a.y; return {x: m[0] * dx + m[2] * dy, y: m[1] * dx + m[3] * dy}; },
  number(v){
    const u = this.units, k = u === 'mm' ? 25.4 : u === 'cm' ? 2.54 : 1;
    return (this.prefix || '') + (v / PX_PER_IN * k).toFixed(this.precision) + (this.showUnits ? (u === 'in' ? '"' : ' ' + u) : '') + (this.suffix || '');
  },
  labelText(){
    if (this.caption) return this.caption;
    const P = this.pts;
    if (this.kind === 'angular'){
      const a0 = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x), a1 = Math.atan2(P[2].y - P[0].y, P[2].x - P[0].x);
      let d = (a0 - a1) * 180 / Math.PI; while (d < 0) d += 360; while (d >= 360) d -= 360;
      return (this.prefix || '') + d.toFixed(this.precision) + (this.showUnits ? '°' : '') + (this.suffix || '');
    }
    const v = this.pageVec(P[0], P[1]);
    if (this.kind === 'hv') return this.number(this.axis === 'v' ? Math.abs(v.y) : Math.abs(v.x));
    return this.number(Math.hypot(v.x, v.y));
  },
  size(){ return this.labelPt * PX_PER_IN / 72; },
  measure(lines){
    const c = fabric.Table.mctx || (fabric.Table.mctx = document.createElement('canvas').getContext('2d'));
    c.font = `${this.size()}px "${this.fontFamily}", sans-serif`;
    return Math.max(...lines.map(l => c.measureText(l).width), 1);
  },
  endMark(F, p, ang){
    const L = 3 * MM, W = 1 * MM, c = Math.cos(ang), s = Math.sin(ang), at = (x, y) => ({x: p.x + c * x - s * y, y: p.y + s * x + c * y}), k = this.head;
    if (k === 'arrow') F.fills.push([at(0, 0), at(-L, W), at(-L, -W)]);
    else if (k === 'open') F.strokes.push([at(-L, W), at(0, 0), at(-L, -W)]);
    else if (k === 'dot'){ const pts = []; for (let i = 0; i < 16; i++){ const a = i / 16 * 2 * Math.PI; pts.push({x: p.x + W * Math.cos(a), y: p.y + W * Math.sin(a)}); } F.fills.push(pts); }
    else if (k === 'tick') F.strokes.push([at(W, W * 1.5), at(-W, -W * 1.5)]);
  },
  // everything drawn, as polylines, filled polygons and one label, in the figure's own space
  figure(){
    const F = {strokes: [], fills: [], label: null}, P = this.pts, sz = this.size(), over = this.overMM * MM, gap = this.gapMM * MM;
    if (this.kind === 'callout') return this.calloutFigure(F);
    if (this.kind === 'angular') return this.angularFigure(F);
    const a = P[0], b = P[1], c = P[2] || P[1];
    let u, a2, b2, n;
    if (this.kind === 'hv'){
      if (this.axis === 'v'){ a2 = {x: c.x, y: a.y}; b2 = {x: c.x, y: b.y}; u = {x: 0, y: Math.sign(b.y - a.y) || 1}; n = {x: 1, y: 0}; }
      else { a2 = {x: a.x, y: c.y}; b2 = {x: b.x, y: c.y}; u = {x: Math.sign(b.x - a.x) || 1, y: 0}; n = {x: 0, y: 1}; }
    } else {
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; u = {x: (b.x - a.x) / L, y: (b.y - a.y) / L}; n = {x: -u.y, y: u.x};
      const off = (c.x - a.x) * n.x + (c.y - a.y) * n.y; a2 = {x: a.x + n.x * off, y: a.y + n.y * off}; b2 = {x: b.x + n.x * off, y: b.y + n.y * off};
    }
    const ext = (from, to) => {
      const d = {x: to.x - from.x, y: to.y - from.y}, l = Math.hypot(d.x, d.y);
      if (l < 1e-6) return; const e = {x: d.x / l, y: d.y / l};
      if (l > gap) F.strokes.push([{x: from.x + e.x * gap, y: from.y + e.y * gap}, {x: to.x + e.x * over, y: to.y + e.y * over}]);
    };
    ext(a, a2); ext(b, b2);
    const text = this.labelText(), w = this.measure([text]) + sz * 0.5, mid = {x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2};
    let ang = Math.atan2(b2.y - a2.y, b2.x - a2.x); if (ang > Math.PI / 2 + 1e-6 || ang < -Math.PI / 2 + 1e-6) ang += Math.PI;
    if (this.captionPos === 'in' && !this.horizontal){
      const hw = w / 2, q1 = {x: mid.x - u.x * hw, y: mid.y - u.y * hw}, q2 = {x: mid.x + u.x * hw, y: mid.y + u.y * hw};
      F.strokes.push([a2, q1], [q2, b2]);
    } else F.strokes.push([a2, b2]);
    this.endMark(F, a2, Math.atan2(-u.y, -u.x)); this.endMark(F, b2, Math.atan2(u.y, u.x));
    const up = {x: Math.sin(ang), y: -Math.cos(ang)}, shift = this.captionPos === 'in' ? 0 : (this.captionPos === 'below' ? -1 : 1) * sz * 0.8;
    F.label = {lines: [text], x: mid.x + up.x * shift, y: mid.y + up.y * shift, ang: this.horizontal ? 0 : ang, w: w - sz * 0.5, h: sz, align: 'center'};
    return F;
  },
  angularFigure(F){
    const [v, A, B, R] = this.pts, sz = this.size(), over = this.overMM * MM;
    const a0 = Math.atan2(A.y - v.y, A.x - v.x), a1 = Math.atan2((B || A).y - v.y, (B || A).x - v.x);
    const r = Math.max(MM, R ? Math.hypot(R.x - v.x, R.y - v.y) : Math.hypot(A.x - v.x, A.y - v.y) * 0.6);
    let sweep = a0 - a1; while (sweep < 0) sweep += 2 * Math.PI; while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
    const n = Math.max(4, Math.ceil(sweep * 24)), arc = [];
    for (let i = 0; i <= n; i++){ const t = a0 - sweep * i / n; arc.push({x: v.x + r * Math.cos(t), y: v.y + r * Math.sin(t)}); }
    F.strokes.push(arc);
    [[A, a0], [B || A, a1]].forEach(([p, ang]) => { const d = Math.hypot(p.x - v.x, p.y - v.y), end = Math.max(d, r + over); F.strokes.push([{x: v.x, y: v.y}, {x: v.x + end * Math.cos(ang), y: v.y + end * Math.sin(ang)}]); });
    this.endMark(F, arc[0], a0 + Math.PI / 2); this.endMark(F, arc[arc.length - 1], a1 - Math.PI / 2);
    const mid = a0 - sweep / 2, text = this.labelText(), shift = this.captionPos === 'in' ? 0 : (this.captionPos === 'below' ? -1 : 1) * sz;
    let ang = mid + Math.PI / 2; if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; if (ang > Math.PI) ang -= 2 * Math.PI;
    F.label = {lines: [text], x: v.x + (r + shift) * Math.cos(mid), y: v.y + (r + shift) * Math.sin(mid), ang: this.horizontal ? 0 : ang, w: this.measure([text]), h: sz, align: 'center'};
    return F;
  },
  calloutFigure(F){
    const [tip, elbow] = this.pts, sz = this.size(), gap = Math.max(0.5, this.gapMM) * MM, lines = String(this.caption || '').split('\n'), w = Math.max(this.measure(lines), sz), h = lines.length * sz * 1.2;
    const dir = elbow.x >= tip.x ? 1 : -1, x0 = dir > 0 ? elbow.x + gap : elbow.x - gap - w, cy = elbow.y;
    F.strokes.push([tip, elbow]);
    this.endMark(F, tip, Math.atan2(tip.y - elbow.y, tip.x - elbow.x));
    F.label = {lines, x: x0 + w / 2, y: cy, ang: 0, w, h, align: 'center'};
    const X0 = x0 - gap / 2, X1 = x0 + w + gap / 2, Y0 = cy - h / 2 - gap / 2, Y1 = cy + h / 2 + gap / 2;
    if (this.shape === 'underline') F.strokes.push([{x: X0, y: Y1}, {x: X1, y: Y1}]);
    else if (this.shape === 'rectangle') F.strokes.push([{x: X0, y: Y0}, {x: X1, y: Y0}, {x: X1, y: Y1}, {x: X0, y: Y1}, {x: X0, y: Y0}]);
    else {
      const pts = [];
      if (this.shape === 'ellipse'){ const rx = (X1 - X0) / 2 * 1.2, ry = (Y1 - Y0) / 2 * 1.3; for (let i = 0; i <= 48; i++){ const a = i / 48 * 2 * Math.PI; pts.push({x: (X0 + X1) / 2 + rx * Math.cos(a), y: cy + ry * Math.sin(a)}); } }
      else { const r = Math.min((X1 - X0), (Y1 - Y0)) / 3, cn = [[X1 - r, Y0 + r, -90], [X1 - r, Y1 - r, 0], [X0 + r, Y1 - r, 90], [X0 + r, Y0 + r, 180]]; cn.forEach(([cx, cyy, s]) => { for (let i = 0; i <= 8; i++){ const a = (s + i / 8 * 90) * Math.PI / 180; pts.push({x: cx + r * Math.cos(a), y: cyy + r * Math.sin(a)}); } }); pts.push(pts[0]); }
      F.strokes.push(pts);
    }
    return F;
  },
  bounds(F){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    F.strokes.concat(F.fills).forEach(l => l.forEach(p => add(p.x, p.y)));
    if (F.label){ const L = F.label, c = Math.cos(L.ang), s = Math.sin(L.ang), hw = L.w / 2, hh = L.h / 2 + this.size() * 0.2; [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([x, y]) => add(L.x + c * x - s * y, L.y + s * x + c * y)); }
    return {x0, y0, x1, y1};
  },
  _render(ctx){
    const F = this.figure();
    ctx.save();
    ctx.strokeStyle = this.lineColor; ctx.fillStyle = this.lineColor; ctx.lineWidth = this.lineW; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    F.strokes.forEach(l => { ctx.beginPath(); l.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); });
    F.fills.forEach(l => { ctx.beginPath(); l.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); });
    if (F.label){
      const L = F.label, sz = this.size();
      ctx.translate(L.x, L.y); ctx.rotate(L.ang);
      ctx.font = `${sz}px "${this.fontFamily}", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = this.captionColor;
      L.lines.forEach((l, i) => ctx.fillText(l, 0, (i - (L.lines.length - 1) / 2) * sz * 1.2));
    }
    ctx.restore();
  },
  _toSVG(){
    const F = this.figure(), f = l => l.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(''), E = fabric.util.string.escapeXml, out = [];
    if (F.strokes.length) out.push(`<path d="${F.strokes.map(f).join('')}" fill="none" stroke="${this.lineColor}" stroke-width="${this.lineW}"/>\n`);
    if (F.fills.length) out.push(`<path d="${F.fills.map(l => f(l) + 'Z').join('')}" fill="${this.lineColor}"/>\n`);
    if (F.label){ const L = F.label, sz = this.size(); L.lines.forEach((l, i) => out.push(`<text transform="translate(${L.x} ${L.y}) rotate(${L.ang * 180 / Math.PI})" y="${(i - (L.lines.length - 1) / 2) * sz * 1.2 + sz * 0.35}" text-anchor="middle" font-family="${E(this.fontFamily)}" font-size="${sz}" fill="${this.captionColor}">${E(l)}</text>\n`)); }
    return out;
  },
});
fabric.Dimension.fromObject = (o, cb) => cb(new fabric.Dimension(JSON.parse(JSON.stringify(o))));

/* scaling with the Pick tool changes the figure, not the size of its label */
canvas.on('object:modified', e => {
  const t = e.target; if (!t || t.type !== 'dimension' || (t.scaleX === 1 && t.scaleY === 1)) return;
  const c = t.getCenterPoint(), sx = t.scaleX, sy = t.scaleY;
  t.pts = t.pts.map(p => ({x: p.x * sx, y: p.y * sy})); t.set({scaleX: 1, scaleY: 1});
  t.setPositionByOrigin(c, 'center', 'center'); t.refit(); canvas.requestRenderAll();
});

const Dimension = {
  opts: Object.assign({}, DIM_DEFAULTS),
  // the figure as plain objects: curves and a text
  breakApart(o){
    const F = o.figure(), m = o.calcTransformMatrix(), T = p => Effects.pt(m, p.x, p.y), f = l => l.map((p, i) => { const q = T(p); return `${i ? 'L' : 'M'}${q.x} ${q.y}`; }).join(''), out = [];
    F.strokes.forEach(l => out.push(new fabric.Path(f(l), {fill: '', stroke: o.lineColor, strokeWidth: o.lineW, strokeUniform: true, name: 'Dimension line'})));
    F.fills.forEach(l => out.push(new fabric.Path(f(l) + 'Z', {fill: o.lineColor, strokeWidth: 0, name: 'Arrowhead'})));
    if (F.label){
      const L = F.label, c = T(L), t = new fabric.IText(L.lines.join('\n'), {fontFamily: o.fontFamily, fontSize: o.size(), fill: o.textColor, textAlign: 'center', angle: (o.angle || 0) + L.ang * 180 / Math.PI, name: 'Dimension text', lineHeight: 1.2});
      t.setPositionByOrigin(new fabric.Point(c.x, c.y), 'center', 'center'); out.push(t);
    }
    return out;
  },
  breakSel(sel){
    canvas.discardActiveObject();
    const res = [];
    restoring = true;
    sel.forEach(o => { if (o.type !== 'dimension'){ res.push(o); return; } const list = this.breakApart(o); Edit.swap(o, list); res.push(...list); });
    restoring = false;
    selectObjs(res); snapshot(); refresh(); toast('Broken apart');
  },
  controls(o, callout){
    if (callout) return [{type: 'num', key: 'lineW', label: 'Line', min: 0.05, step: 0.1}, {type: 'sel', key: 'head', title: 'Head', options: [['arrow', 'Arrow'], ['open', 'Open'], ['dot', 'Dot'], ['tick', 'Tick'], ['none', 'No head']]}, {type: 'sel', key: 'shape', title: 'Shape', options: [['underline', 'Underline'], ['rectangle', 'Rectangle'], ['rounded', 'Rounded'], ['ellipse', 'Ellipse']]}, {type: 'num', key: 'labelPt', label: 'Size', min: 2, digits: 1}, {type: 'color', key: 'lineColor'}];
    return [{type: 'sel', key: 'units', title: 'Units', options: [['in', 'in'], ['cm', 'cm'], ['mm', 'mm']]}, {type: 'num', key: 'precision', label: 'Decimals', min: 0, max: 6, digits: 0}, {type: 'chk', key: 'showUnits', label: 'Units'}, {type: 'text', key: 'prefix', label: 'Prefix'}, {type: 'text', key: 'suffix', label: 'Suffix'},
      {type: 'sel', key: 'textPos', title: 'Text position', options: [['above', 'Above'], ['in', 'In line'], ['below', 'Below']]}, {type: 'chk', key: 'horizontal', label: 'Level text'}, {type: 'num', key: 'labelPt', label: 'Size', min: 2, digits: 1, title: 'Text size (pt)'},
      {type: 'sel', key: 'head', title: 'Line ends', options: [['arrow', 'Arrow'], ['open', 'Open'], ['dot', 'Dot'], ['tick', 'Tick'], ['none', 'None']]}, {type: 'num', key: 'lineW', label: 'Line', min: 0.05, step: 0.1}, {type: 'color', key: 'lineColor'}];
  },
  make(kind, pts, extra){ return new fabric.Dimension(Object.assign({}, this.opts, {kind, scene: pts, name: kind === 'callout' ? 'Callout' : 'Dimension'}, extra || {})); },
  preview(ctx, kind, pts, extra){ Tools.drawObject(ctx, this.make(kind, pts, Object.assign({lineColor: '#2563eb', textColor: '#2563eb'}, extra || {}))); },
  // the ends of the outline segment nearest the point
  segmentAt(p){
    Shaping.init();
    const tol = (COARSE ? 14 : 6) / zoom; let best = null, bd = tol;
    canvas.getObjects().filter(o => o.visible && Edit.shapeOnly(o) && o.text == null).forEach(o => Edit.subs(o).forEach(s => s.segs.forEach(q => {
      for (let i = 0; i <= 24; i++){ const r = Effects.bez(...q, i / 24), d = Math.hypot(r.x - p.x, r.y - p.y); if (d < bd){ bd = d; best = [q[0], q[3]]; } }
    })));
    paper.project.clear();
    return best;
  },
};
const dimInk = () => { if (!Dimension.custom) Object.assign(Dimension.opts, {lineColor: Tools.ink(), textColor: Tools.ink()}); };
const dimBase = {
  start: dimInk,
  changed(key){ if (key === 'lineColor') Dimension.custom = true; if (key === 'lineColor') Dimension.opts.textColor = Dimension.opts.lineColor; },
  bar(){ return Dimension.controls(Dimension.opts, false); },
  key(e){ if (e.key === 'Escape' && Tools.st){ Tools.st = null; canvas.requestRenderAll(); Tools.bar(); return true; } return false; },
};
const dimOpts = id => { Tools.opts[id] = Dimension.opts; };
// Parallel and Horizontal/Vertical: two points (a drag or two clicks), then click where the line goes
const linearDim = (id, name, tip, kind) => { Tools.def(id, Object.assign({}, dimBase, {
  name, tip, hint(){ return Tools.st && Tools.st.step === 3 ? 'Move to where the dimension line goes, then click' : 'Drag between the two points, or click them · Ctrl keeps to 15° steps'; },
  extra(st){ if (kind !== 'hv') return {}; const dx = Math.abs(st.b.x - st.a.x), dy = Math.abs(st.b.y - st.a.y); return {axis: dx >= dy ? 'h' : 'v'}; },
  down(p){
    const st = Tools.st, q = Tools.snap(p);
    if (!st){ Tools.st = {step: 1, a: q, b: q, press: true}; return; }
    if (st.step === 2){ st.b = q; st.step = 3; st.c = q; st.skipUp = true; return; }
    if (st.step === 3){ st.c = q; st.place = true; }
  },
  move(p, e){
    const st = Tools.st; if (!st) return; const q = Tools.snap(p);
    if (st.step === 1 && st.press) st.b = Tools.constrain(st.a, q, e);
    if (st.step === 2) st.b = Tools.constrain(st.a, q, e);
    if (st.step === 3) st.c = q;
    canvas.requestRenderAll();
  },
  up(p){
    const st = Tools.st; if (!st) return; Pick.clearGuides();
    if (st.skipUp){ st.skipUp = false; canvas.requestRenderAll(); return; }
    if (st.step === 1){ st.press = false; if (Tools.near(st.a, st.b, 3 / zoom)) st.step = 2; else { st.step = 3; st.c = st.b; } canvas.requestRenderAll(); return; }
    if (st.place){ const o = Dimension.make(kind, [st.a, st.b, st.c], this.extra(st)); canvas.add(o); Tools.finish(o); }
  },
  draw(ctx){
    const st = Tools.st; if (!st) return;
    if (st.step < 3){ Tools.blue(ctx, c => Tools.poly(c, [st.a, st.b])); return; }
    Dimension.preview(ctx, kind, [st.a, st.b, st.c], this.extra(st));
  },
})); dimOpts(id); };
linearDim('dimpar', 'Parallel Dimension', 'Draw slanted dimension lines', 'parallel');
linearDim('dimhv', 'Horizontal or Vertical Dimension', 'Draw horizontal or vertical dimension lines', 'hv');
// Segment: click a segment, then where the line goes
Tools.def('dimseg', Object.assign({}, dimBase, {
  name: 'Segment Dimension', tip: 'Display the distance between the end nodes of a segment',
  hint(){ return Tools.st ? 'Move to where the dimension line goes, then click' : 'Click a segment of a curve'; },
  down(p){
    const st = Tools.st;
    if (!st){ const s = Dimension.segmentAt(p); if (!s) return toast('Click right on a segment of a curve'); Tools.st = {a: s[0], b: s[1], c: p, fresh: true}; return; }
    st.c = Tools.snap(p); st.place = true;
  },
  move(p){ const st = Tools.st; if (st){ st.c = Tools.snap(p); canvas.requestRenderAll(); } },
  up(){ const st = Tools.st; if (!st) return; Pick.clearGuides(); if (st.place){ const o = Dimension.make('segment', [st.a, st.b, st.c]); canvas.add(o); Tools.finish(o); } },
  draw(ctx){ const st = Tools.st; if (st) Dimension.preview(ctx, 'segment', [st.a, st.b, st.c]); },
})); dimOpts('dimseg');
// Angular: the vertex, each side, then the radius of the arc
Tools.def('dimang', Object.assign({}, dimBase, {
  name: 'Angular Dimension', tip: 'Draw angular dimension lines',
  hint(){ const n = Tools.st ? Tools.st.pts.length : 0; return ['Click the corner of the angle', 'Click along the first side', 'Click along the second side', 'Click to set the size of the arc'][n]; },
  down(p, e){
    const st = Tools.st || (Tools.st = {pts: []}), P = st.pts, q = P.length ? Tools.constrain(P[0], Tools.snap(p), e) : Tools.snap(p);
    if (P.length === 3){ st.pts.push(q); st.done = true; return; }
    P.push(q); Tools.bar();
  },
  move(p, e){ const st = Tools.st; if (!st) return; st.cur = st.pts.length ? Tools.constrain(st.pts[0], Tools.snap(p), e) : p; canvas.requestRenderAll(); },
  up(){ const st = Tools.st; if (!st) return; Pick.clearGuides(); if (st.done){ const o = Dimension.make('angular', st.pts); canvas.add(o); Tools.finish(o); } },
  draw(ctx){
    const st = Tools.st; if (!st || !st.cur) return; const P = st.pts;
    if (P.length === 3) return Dimension.preview(ctx, 'angular', P.concat([st.cur]));
    Tools.blue(ctx, c => Tools.poly(c, [P[0], P[1] || st.cur]));
    if (P.length === 2) Tools.blue(ctx, c => Tools.poly(c, [P[0], st.cur]));
    P.forEach(q => Tools.square(ctx, Tools.S(q), true, 3));
  },
})); dimOpts('dimang');
// 3-point callout: the tip, the elbow, then type
Tools.def('callout3', {
  name: '3-Point Callout', tip: 'Draw a callout with a two-segment leader line', opts: {}, start: dimInk, changed: dimBase.changed,
  hint(){ return Tools.st ? 'Click where the leader bends, then type' : 'Click the point the callout refers to'; },
  bar(){ return Dimension.controls(Dimension.opts, true); },
  down(p, e){
    const st = Tools.st;
    if (!st){ Tools.st = {tip: Tools.snap(p), cur: p, press: true}; return; }
    st.elbow = Tools.constrain(st.tip, Tools.snap(p), e); st.done = true;
  },
  move(p, e){ const st = Tools.st; if (st){ st.cur = Tools.constrain(st.tip, Tools.snap(p), e); canvas.requestRenderAll(); } },
  up(p, e){
    const st = Tools.st; if (!st) return; Pick.clearGuides();
    if (st.press){ st.press = false; if (!Tools.near(st.tip, st.cur, 4 / zoom)){ st.elbow = st.cur; st.done = true; } else return; }
    if (!st.done) return;
    const tip = st.tip, elbow = st.elbow, a = Tools.S(elbow); Tools.st = null;
    Tools.inline({x: elbow.x + MM, y: elbow.y - 8, w: 90, h: 16}, 'Callout', v => {
      const o = Dimension.make('callout', [tip, elbow], {caption: v || 'Callout', head: Dimension.opts.head}); canvas.add(o); Tools.finish(o);
    }, {size: Dimension.opts.labelPt * PX_PER_IN / 72, font: Dimension.opts.fontFamily, multiline: false});
  },
  key(e){ if (e.key === 'Escape' && Tools.st){ Tools.st = null; canvas.requestRenderAll(); return true; } return false; },
  draw(ctx){ const st = Tools.st; if (st && st.cur) Tools.blue(ctx, c => Tools.poly(c, [st.tip, st.cur])); },
});
Tools.opts.callout3 = Dimension.opts;
// with the Pick tool: the controls of the selected dimension, and Break Apart
Tools.contextBars.dimension = (el, o) => {
  if (el._for === o) return;
  el._for = o; el.innerHTML = '';
  const O = {}; DIM_KEYS.forEach(k => { O[k] = o[k]; });
  const d = {changed: key => { o[key] = O[key]; if (key === 'lineColor') o.textColor = O[key]; o.refit(); canvas.requestRenderAll(); snapshot(); }};
  const list = Dimension.controls(O, o.kind === 'callout').concat([{type: 'text', key: 'caption', label: o.kind === 'callout' ? 'Text' : 'Label'}]);
  list.forEach(c => el.appendChild(Tools.control(c, O, d)));
  el.appendChild(Tools.control({type: 'btn', label: 'Break apart', title: 'Turn it into plain curves and text', on: () => Dimension.breakSel([o])}, O, d));
};

Toolbox.build(); Toolbox.menu(); Toolbox.sync('pick');
