/* ===================== Shape tool (node editing) =====================
   Ported from TraceDraw's docs/behavior/shape-tool.md. The curve being edited has its transform baked into
   its points, so every node and control point lives in scene coordinates.
   Model: subs = [{closed, nodes: [{x, y, in, out, type}]}]. The segment from node i to the next is a cubic when
   node.out is set (the next node's .in is set with it), otherwise a straight line. A closed curve whose last
   segment ends on its first node holds that node once. */

const PICK = COARSE ? 14 : 6;   // screen pixels (wider for fingers)

const Nodes = {
  obj: null, idx: -1, subs: [], sel: new Set(), last: null, seg: null, drag: null, hover: null, menu: null,

  /* ---------- geometry helpers ---------- */
  P: (x, y) => ({x, y}),
  add: (a, b) => ({x: a.x + b.x, y: a.y + b.y}),
  sub: (a, b) => ({x: a.x - b.x, y: a.y - b.y}),
  mul: (a, k) => ({x: a.x * k, y: a.y * k}),
  len: a => Math.hypot(a.x, a.y),
  lerp: (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}),
  norm(a){ const l = Math.hypot(a.x, a.y) || 1; return {x: a.x / l, y: a.y / l}; },
  bez(p0, p1, p2, p3, t){ const u = 1 - t; return {x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x, y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y}; },
  split(p0, p1, p2, p3, t){   // de Casteljau
    const L = this.lerp, a = L(p0, p1, t), b = L(p1, p2, t), c = L(p2, p3, t), d = L(a, b, t), e = L(b, c, t), f = L(d, e, t);
    return {left: [p0, a, d, f], right: [f, e, c, p3]};
  },
  key: (s, i) => s + ':' + i,
  unkey: k => k.split(':').map(Number),
  node(s, i){ return this.subs[s].nodes[i]; },
  next(s, i){ const n = this.subs[s].nodes; return i + 1 < n.length ? i + 1 : this.subs[s].closed ? 0 : -1; },
  prev(s, i){ const n = this.subs[s].nodes; return i > 0 ? i - 1 : this.subs[s].closed ? n.length - 1 : -1; },
  segPts(s, i){   // [p0, c1, c2, p3] for the segment leaving node i (null when there is none)
    const j = this.next(s, i); if (j < 0) return null;
    const a = this.node(s, i), b = this.node(s, j);
    return a.out ? [a, a.out, b.in, b] : [a, this.lerp(a, b, 1 / 3), this.lerp(a, b, 2 / 3), b];
  },
  isEnd(s, i){ const sp = this.subs[s]; return !sp.closed && (i === 0 || i === sp.nodes.length - 1); },

  /* ---------- curve <-> model ---------- */
  bake(o){
    const m = o.calcTransformMatrix(), po = o.pathOffset;
    const cmds = o.path.map(c => { const out = [c[0]]; for (let k = 1; k + 1 < c.length; k += 2){ const p = fabric.util.transformPoint(new fabric.Point(c[k] - po.x, c[k + 1] - po.y), m); out.push(p.x, p.y); } return out; });
    o.set({angle: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false, originX: 'left', originY: 'top'});
    o._setPath(cmds, {}); o.setCoords();
  },
  parse(cmds){
    const subs = []; let cur = null, pen = null;
    for (const c of cmds){
      const t = c[0];
      if (t === 'M'){ cur = {closed: false, nodes: [{x: c[1], y: c[2], in: null, out: null}]}; subs.push(cur); pen = cur.nodes[0]; continue; }
      if (!cur) continue;
      const last = cur.nodes[cur.nodes.length - 1];
      if (t === 'L'){ cur.nodes.push({x: c[1], y: c[2], in: null, out: null}); }
      else if (t === 'C'){ last.out = {x: c[1], y: c[2]}; cur.nodes.push({x: c[5], y: c[6], in: {x: c[3], y: c[4]}, out: null}); }
      else if (t === 'Q'){
        const q = {x: c[1], y: c[2]}, p = {x: c[3], y: c[4]};
        last.out = this.lerp(last, q, 2 / 3); cur.nodes.push({x: p.x, y: p.y, in: this.lerp(p, q, 2 / 3), out: null});
      }
      else if (t === 'Z' || t === 'z'){
        cur.closed = true;
        const n = cur.nodes, f = n[0], l = n[n.length - 1];
        if (n.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-3){ f.in = l.in; n.pop(); if (n.length > 1 && !n[n.length - 1].out) f.in = null; }
        if (n.length === 1) cur.closed = false;
        cur = null;
      }
    }
    return subs.filter(s => s.nodes.length);
  },
  build(){
    const r = n => +n.toFixed(3), cmds = [];
    for (const sp of this.subs){
      const n = sp.nodes; if (!n.length) continue;
      cmds.push(['M', r(n[0].x), r(n[0].y)]);
      const segs = sp.closed ? n.length : n.length - 1;
      for (let i = 0; i < segs; i++){
        const a = n[i], b = n[(i + 1) % n.length];
        cmds.push(a.out && b.in ? ['C', r(a.out.x), r(a.out.y), r(b.in.x), r(b.in.y), r(b.x), r(b.y)] : ['L', r(b.x), r(b.y)]);
      }
      if (sp.closed) cmds.push(['Z']);
    }
    return cmds;
  },
  inferType(s, i){
    const n = this.node(s, i);
    if (!n.in || !n.out) return 'cusp';
    const a = this.sub(n.in, n), b = this.sub(n.out, n), la = this.len(a), lb = this.len(b);
    if (!la || !lb) return 'cusp';
    const cross = (a.x * b.y - a.y * b.x) / (la * lb), dot = (a.x * b.x + a.y * b.y) / (la * lb);
    if (Math.abs(cross) < 0.02 && dot < 0) return Math.abs(la - lb) / Math.max(la, lb) < 0.02 ? 'symmetric' : 'smooth';
    return 'cusp';
  },
  types(saved){
    this.subs.forEach((sp, s) => sp.nodes.forEach((n, i) => {
      const code = saved && saved[s] && saved[s][i];
      n.type = code === 'y' ? 'symmetric' : code === 's' ? 'smooth' : code === 'c' ? 'cusp' : this.inferType(s, i);
    }));
  },
  // writes the model back into the curve (live while dragging)
  apply(final){
    if (!this.obj) return;
    this.subs = this.subs.filter(sp => sp.nodes.length > 1 || (sp.nodes.length === 1 && this.subs.length === 1));
    if (!this.subs.length || this.subs.every(sp => sp.nodes.length < 2)){
      const o = this.obj; this.stop(); restoring = true; canvas.remove(o); restoring = false; snapshot(); refresh(); toast('The curve had no segments left and was deleted'); return;
    }
    this.obj._setPath(this.build(), {}); this.obj.setCoords(); this.obj.set('dirty', true);
    this.obj.nodeTypes = this.subs.map(sp => sp.nodes.map(n => ({cusp: 'c', smooth: 's', symmetric: 'y'})[n.type] || 'c').join(''));
    canvas.requestRenderAll();
    if (final){ snapshot(); refresh(); this.bar(); }
  },

  /* ---------- start / stop ---------- */
  convertible: o => o && ['rect', 'ellipse', 'circle', 'polygon', 'polyline', 'triangle', 'line'].includes(o.type),
  toPath(o){
    let d;
    if (o.type === 'line' || o.type === 'polyline'){
      const m = o.calcTransformMatrix();
      const pts = o.type === 'line' ? (p => [{x: p.x1, y: p.y1}, {x: p.x2, y: p.y2}])(o.calcLinePoints()) : o.points.map(p => ({x: p.x - o.pathOffset.x, y: p.y - o.pathOffset.y}));
      d = pts.map((p, k) => { const q = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m); return `${k ? 'L' : 'M'} ${q.x} ${q.y}`; }).join(' ');
    } else {
      Shaping.init(); d = Shaping.svgItem(o).pathData; paper.project.clear();
    }
    const style = Shaping.styleOf(o);
    if (o.type === 'line' || o.type === 'polyline') style.fill = '';
    const p = new fabric.Path(d, Object.assign(style, {fillRule: 'nonzero', name: nameOf(o)}));
    const i = canvas.getObjects().indexOf(o); restoring = true; canvas.remove(o); canvas.insertAt(p, i); restoring = false;
    return p;
  },
  edit(o){
    if (this.obj === o) return;
    this.stop(true);
    if (o.type !== 'path') return;
    this.bake(o);
    this.obj = o; this.idx = canvas.getObjects().indexOf(o);
    this.subs = this.parse(o.path); this.types(o.nodeTypes);
    this.sel.clear(); this.seg = null; this.last = null;
    canvas.discardActiveObject(); canvas.requestRenderAll(); this.bar(); this.status();
  },
  stop(keepTool){
    this.closeMenu();
    const o = this.obj; this.obj = null; this.subs = []; this.sel.clear(); this.seg = null; this.drag = null;
    if (!keepTool && o && canvas.getObjects().includes(o)) canvas.setActiveObject(o);
    canvas.requestRenderAll(); this.bar();
  },
  // after undo/redo/page change the objects are new: pick the curve back up by its place in the stack
  reattach(){
    if (tool !== 'shape') return;
    const o = canvas.getObjects()[this.idx];
    this.obj = null; this.sel.clear(); this.seg = null;
    if (o && o.type === 'path') this.edit(o); else { this.subs = []; this.bar(); }
  },

  /* ---------- hit testing (screen pixels) ---------- */
  d2s: d => d * zoom,
  hitNode(p){
    let best = null;
    this.subs.forEach((sp, s) => sp.nodes.forEach((n, i) => { const d = this.d2s(Math.hypot(n.x - p.x, n.y - p.y)); if (d <= PICK && (!best || d < best.d)) best = {s, i, d}; }));
    return best;
  },
  handleOwners(){   // nodes whose handles are visible: selected nodes + the chosen segment's ends
    const out = [];
    this.sel.forEach(k => { const [s, i] = this.unkey(k); out.push([s, i, 'in'], [s, i, 'out']); });
    if (this.seg){ const j = this.next(this.seg.s, this.seg.i); out.push([this.seg.s, this.seg.i, 'out'], [this.seg.s, j, 'in']); }
    return out.filter(([s, i, w]) => this.subs[s] && this.node(s, i) && this.node(s, i)[w]);
  },
  hitHandle(p){
    let best = null;
    this.handleOwners().forEach(([s, i, w]) => { const h = this.node(s, i)[w], d = this.d2s(Math.hypot(h.x - p.x, h.y - p.y)); if (d <= PICK && (!best || d < best.d)) best = {s, i, w, d}; });
    return best;
  },
  nearestOnSeg(s, i, p){
    const q = this.segPts(s, i); if (!q) return null;
    let bt = 0, bd = Infinity;
    for (let k = 0; k <= 48; k++){ const t = k / 48, b = this.bez(...q, t), d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd){ bd = d; bt = t; } }
    for (let step = 1 / 96; step > 1e-4; step /= 2){
      for (const t of [bt - step, bt + step]){ if (t < 0 || t > 1) continue; const b = this.bez(...q, t), d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd){ bd = d; bt = t; } }
    }
    return {s, i, t: bt, pt: this.bez(...q, bt), d: this.d2s(bd)};
  },
  hitSeg(p, extra = 1){
    let best = null;
    this.subs.forEach((sp, s) => sp.nodes.forEach((_, i) => { const r = this.nearestOnSeg(s, i, p); if (r && r.d <= PICK + extra && (!best || r.d < best.d)) best = r; }));
    return best;
  },
  nearMiss(p){
    const lim = PICK * 3;
    return this.subs.some(sp => sp.nodes.some(n => this.d2s(Math.hypot(n.x - p.x, n.y - p.y)) <= lim))
        || this.handleOwners().some(([s, i, w]) => { const h = this.node(s, i)[w]; return this.d2s(Math.hypot(h.x - p.x, h.y - p.y)) <= lim; });
  },
  objectAt(e){ canvas.skipTargetFind = false; const t = canvas.findTarget(e); canvas.skipTargetFind = true; return t; },

  /* ---------- node types ---------- */
  // keeps a smooth/symmetrical node's other handle in line after one handle moved
  constrain(s, i, moved){
    const n = this.node(s, i), other = moved === 'in' ? 'out' : 'in';
    if (!n[moved] || !n[other] || n.type === 'cusp') return;
    const dir = this.norm(this.sub(n, n[moved]));
    const l = n.type === 'symmetric' ? this.len(this.sub(n[moved], n)) : this.len(this.sub(n[other], n));
    n[other] = this.add(n, this.mul(dir, l));
  },
  setType(s, i, type){
    const n = this.node(s, i), sp = this.subs[s];
    if (this.isEnd(s, i) && type !== 'cusp'){ return; }     // an end node of an open curve stays as it is
    const p = this.prev(s, i), q = this.next(s, i);
    if (type !== 'cusp' && p >= 0 && q >= 0){
      const prev = this.node(s, p), next = this.node(s, q);
      const inCurve = !!n.in, outCurve = !!n.out;
      if (!inCurve && !outCurve){
        // two straight segments: both become curves (a closing line that only closes stays straight)
        this.toCurve(s, p); this.toCurve(s, i);
      }
      if (n.in && n.out){
        const a = this.sub(n, n.in), b = this.sub(n.out, n), la = this.len(a), lb = this.len(b);
        const dir = this.norm(this.add(this.norm(a), this.norm(b)));
        const L1 = type === 'symmetric' ? (la + lb) / 2 : la, L2 = type === 'symmetric' ? (la + lb) / 2 : lb;
        n.in = this.sub(n, this.mul(dir, L1)); n.out = this.add(n, this.mul(dir, L2));
      } else if (n.in && !n.out){       // curve arriving, straight leaving: line the curve's handle up with the line
        const dir = this.norm(this.sub(n, next)), l = this.len(this.sub(n.in, n)); n.in = this.add(n, this.mul(dir, l));
      } else if (n.out && !n.in){
        const dir = this.norm(this.sub(n, prev)), l = this.len(this.sub(n.out, n)); n.out = this.add(n, this.mul(dir, l));
      }
    }
    n.type = type;
  },
  toCurve(s, i){   // the segment leaving node i
    const j = this.next(s, i); if (j < 0) return;
    const a = this.node(s, i), b = this.node(s, j);
    if (!a.out){ a.out = this.lerp(a, b, 1 / 3); b.in = this.lerp(a, b, 2 / 3); }
  },
  toLine(s, i){
    const j = this.next(s, i); if (j < 0) return;
    const a = this.node(s, i), b = this.node(s, j); a.out = null; b.in = null;
    if (a.type !== 'cusp' && !a.in) a.type = 'cusp'; if (b.type !== 'cusp' && !b.out) b.type = 'cusp';
  },

  /* ---------- node operations ---------- */
  selList(){ return [...this.sel].map(this.unkey).filter(([s, i]) => this.subs[s] && this.subs[s].nodes[i]); },
  // segments "ending at" the chosen nodes, or the chosen segment
  segsForCmd(){
    if (this.seg) return [[this.seg.s, this.seg.i]];
    return this.selList().map(([s, i]) => [s, this.prev(s, i)]).filter(([, p]) => p >= 0);
  },
  insertAt(s, i, t){   // split the segment leaving node i at t; returns the new node's index
    const sp = this.subs[s], j = this.next(s, i), a = this.node(s, i), b = this.node(s, j);
    let nn;
    if (a.out){
      const {left, right} = this.split(a, a.out, b.in, b, t);
      a.out = left[1]; b.in = right[2];
      nn = {x: left[3].x, y: left[3].y, in: left[2], out: right[1], type: 'smooth'};
    } else nn = {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, in: null, out: null, type: 'cusp'};
    sp.nodes.splice(i + 1, 0, nn);
    return i + 1;
  },
  addNodes(){
    if (this.seg){ const k = this.insertAt(this.seg.s, this.seg.i, this.seg.t); this.sel = new Set([this.key(this.seg.s, k)]); this.seg = null; return this.apply(true); }
    const segs = this.segsForCmd(); if (!segs.length) return toast('Choose a node or click a segment first');
    // work from the end so indices stay valid
    const added = [];
    segs.sort((a, b) => b[0] - a[0] || b[1] - a[1]).forEach(([s, i]) => added.push([s, this.insertAt(s, i, 0.5)]));
    this.sel = new Set(added.map(([s, k]) => this.key(s, k)));
    this.apply(true);
  },
  // least-squares cubic through the old two segments with the outer tangents held (Graphics Gems / Schneider)
  refit(pts, A, B, t1, t2){
    let C00 = 0, C01 = 0, C11 = 0, X0 = 0, X1 = 0;
    const n = pts.length, us = [0]; let tot = 0;
    for (let k = 1; k < n; k++){ tot += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); us.push(tot); }
    pts.forEach((p, k) => {
      const u = tot ? us[k] / tot : k / (n - 1), b0 = (1 - u) ** 3, b1 = 3 * u * (1 - u) ** 2, b2 = 3 * u * u * (1 - u), b3 = u ** 3;
      const a1 = this.mul(t1, b1), a2 = this.mul(t2, b2);
      C00 += a1.x * a1.x + a1.y * a1.y; C01 += a1.x * a2.x + a1.y * a2.y; C11 += a2.x * a2.x + a2.y * a2.y;
      const tmp = this.sub(p, this.add(this.mul(A, b0 + b1), this.mul(B, b2 + b3)));
      X0 += a1.x * tmp.x + a1.y * tmp.y; X1 += a2.x * tmp.x + a2.y * tmp.y;
    });
    const det = C00 * C11 - C01 * C01, dist = Math.hypot(B.x - A.x, B.y - A.y);
    let al = det ? (X0 * C11 - X1 * C01) / det : 0, ar = det ? (C00 * X1 - C01 * X0) / det : 0;
    if (al < dist * 1e-3 || ar < dist * 1e-3 || !isFinite(al) || !isFinite(ar)) al = ar = dist / 3;
    return [this.add(A, this.mul(t1, al)), this.add(B, this.mul(t2, ar))];
  },
  removeNode(s, i){
    const sp = this.subs[s], n = sp.nodes;
    const p = this.prev(s, i), q = this.next(s, i);
    if (p >= 0 && q >= 0 && n.length > 2){
      const A = this.node(s, p), N = this.node(s, i), B = this.node(s, q);
      if (A.out || B.in || N.in || N.out){
        const q1 = this.segPts(s, p), q2 = this.segPts(s, i), pts = [];
        for (let k = 0; k <= 16; k++) pts.push(this.bez(...q1, k / 16));
        for (let k = 1; k <= 16; k++) pts.push(this.bez(...q2, k / 16));
        const t1 = this.norm(this.sub(A.out || this.bez(...q1, 0.02), A)), t2 = this.norm(this.sub(B.in || this.bez(...q2, 0.98), B));
        [A.out, B.in] = this.refit(pts, A, B, t1, t2);
      } else { A.out = null; B.in = null; }
    } else if (!sp.closed){
      if (i === 0 && n[1]) n[1].in = null;
      if (i === n.length - 1 && n[i - 1]) n[i - 1].out = null;
    }
    n.splice(i, 1);
    if (sp.closed && n.length < 3) sp.closed = false;
  },
  deleteNodes(){
    if (this.seg) return this.deleteSegment();
    const list = this.selList(); if (!list.length) return toast('Choose nodes to delete');
    list.sort((a, b) => b[0] - a[0] || b[1] - a[1]).forEach(([s, i]) => this.removeNode(s, i));
    this.sel.clear(); this.apply(true);
  },
  deleteSegment(){
    const {s, i} = this.seg, sp = this.subs[s], n = sp.nodes, j = this.next(s, i);
    this.node(s, i).out = null; this.node(s, j).in = null;
    if (sp.closed){ sp.nodes = n.slice(j).concat(n.slice(0, j)); sp.closed = false; }
    else {
      const a = n.slice(0, i + 1), b = n.slice(i + 1);
      this.subs.splice(s, 1, ...[{closed: false, nodes: a}, {closed: false, nodes: b}].filter(x => x.nodes.length > 1));
    }
    this.seg = null; this.sel.clear(); this.apply(true);
  },
  breakNodes(){
    const list = this.selList(); if (!list.length) return toast('Choose the node to break the curve at');
    list.sort((a, b) => b[0] - a[0] || b[1] - a[1]).forEach(([s, i]) => {
      const sp = this.subs[s], n = sp.nodes, node = n[i];
      const a = Object.assign({}, node, {out: null}), b = Object.assign({}, node, {in: null, type: 'cusp'}); a.type = 'cusp';
      if (sp.closed){ sp.nodes = [b].concat(n.slice(i + 1), n.slice(0, i), [a]); sp.closed = false; }
      else if (i > 0 && i < n.length - 1){ this.subs.splice(s, 1, {closed: false, nodes: n.slice(0, i).concat([a])}, {closed: false, nodes: [b].concat(n.slice(i + 1))}); }
    });
    this.sel.clear(); this.apply(true); toast('Curve broken — the ends can now be dragged apart');
  },
  // two chosen end nodes -> [[s, i], [s, i]] oriented so the first is a subpath's end and the second a start
  endPair(){
    const list = this.selList().filter(([s, i]) => this.isEnd(s, i));
    if (list.length !== 2) return null;
    return list;
  },
  orient(pair){
    let [[s1, i1], [s2, i2]] = pair;
    if (s1 === s2) return {same: true, s: s1};
    if (i1 === 0) this.reverse(s1);
    if (i2 !== 0) this.reverse(s2);
    return {same: false, s1, s2};
  },
  reverse(s){
    const sp = this.subs[s];
    sp.nodes = sp.nodes.reverse().map(n => Object.assign({}, n, {in: n.out, out: n.in}));
  },
  joinNodes(line){
    const pair = this.endPair(); if (!pair) return toast(line ? 'Extend to close: choose two end nodes' : 'Join: choose two end nodes (Shift-click or marquee)');
    const o = this.orient(pair);
    if (o.same){
      const sp = this.subs[o.s], n = sp.nodes, f = n[0], l = n[n.length - 1];
      if (line){ sp.closed = true; }
      else {
        const mid = this.lerp(f, l, 0.5);
        f.in = l.in ? this.add(l.in, this.sub(mid, l)) : null; if (f.out) f.out = this.add(f.out, this.sub(mid, f));
        f.x = mid.x; f.y = mid.y; n.pop(); sp.closed = true;
      }
      this.sel = new Set([this.key(o.s, 0)]);
    } else {
      const A = this.subs[o.s1], B = this.subs[o.s2], a = A.nodes[A.nodes.length - 1], b = B.nodes[0];
      let nodes;
      if (line) nodes = A.nodes.concat(B.nodes);
      else {
        const mid = this.lerp(a, b, 0.5);
        const m = {x: mid.x, y: mid.y, in: a.in ? this.add(a.in, this.sub(mid, a)) : null, out: b.out ? this.add(b.out, this.sub(mid, b)) : null, type: 'cusp'};
        nodes = A.nodes.slice(0, -1).concat([m], B.nodes.slice(1));
      }
      const keep = Math.min(o.s1, o.s2);
      this.subs[keep] = {closed: false, nodes};
      this.subs.splice(Math.max(o.s1, o.s2), 1);
      this.sel.clear();
    }
    this.apply(true);
  },
  extractSubpath(){
    const list = this.selList(); if (!list.length) return toast('Choose a node of the subpath to extract');
    if (this.subs.length < 2) return toast('This curve has only one subpath');
    const s = list[0][0], taken = this.subs.splice(s, 1)[0];
    const o = this.obj, keep = this.subs;
    this.subs = [taken]; const d = this.build(); this.subs = keep;
    const p = new fabric.Path(d, Object.assign(Shaping.styleOf(o), {fillRule: o.fillRule || 'nonzero', name: nameOf(o) + ' part'}));
    restoring = true; canvas.insertAt(p, canvas.getObjects().indexOf(o) + 1); restoring = false;
    this.sel.clear(); this.apply(true); toast('Subpath extracted into its own curve');
  },
  typeCmd(type){
    const list = this.selList(); if (!list.length) return toast('Choose nodes first');
    list.forEach(([s, i]) => this.setType(s, i, type)); this.apply(true);
  },
  lineCmd(toLine){
    const segs = this.segsForCmd(); if (!segs.length) return toast('Choose a node or click a segment first');
    segs.forEach(([s, i]) => toLine ? this.toLine(s, i) : this.toCurve(s, i)); this.apply(true);
  },
  reverseCmd(){
    const subs = new Set(this.selList().map(([s]) => s)); (subs.size ? [...subs] : this.subs.map((_, s) => s)).forEach(s => this.reverse(s));
    this.sel.clear(); this.apply(true); toast('Direction reversed');
  },
  selectAll(){ this.sel = new Set(); this.subs.forEach((sp, s) => sp.nodes.forEach((_, i) => this.sel.add(this.key(s, i)))); this.seg = null; canvas.requestRenderAll(); this.bar(); },
  run(cmd){
    if (!this.obj) return toast('Shape tool: click a curve to edit its nodes');
    ({add: () => this.addNodes(), del: () => this.deleteNodes(), join: () => this.joinNodes(false), close: () => this.joinNodes(true), break: () => this.breakNodes(),
      line: () => this.lineCmd(true), curve: () => this.lineCmd(false), cusp: () => this.typeCmd('cusp'), smooth: () => this.typeCmd('smooth'), symmetric: () => this.typeCmd('symmetric'),
      reverse: () => this.reverseCmd(), extract: () => this.extractSubpath(), all: () => this.selectAll()})[cmd]();
  },

  /* ---------- pointer ---------- */
  down(o){
    const e = o.e, p = canvas.getPointer(e), right = o.button === 3;
    this.closeMenu();
    if (this.obj){
      const hn = this.hitNode(p), hh = hn ? null : this.hitHandle(p), hs = hn || hh ? null : this.hitSeg(p);
      if (hn){
        const k = this.key(hn.s, hn.i);
        if (right){ if (!this.sel.has(k)) this.sel = new Set([k]); this.seg = null; return this.openMenu(e); }
        if (e.ctrlKey || e.metaKey){ this.sel.has(k) ? this.sel.delete(k) : this.sel.add(k); }
        else if (e.shiftKey && this.last && this.last[0] === hn.s) this.selectRun(this.last, [hn.s, hn.i]);
        else if (e.shiftKey) this.sel.add(k);
        else if (!this.sel.has(k)) this.sel = new Set([k]);
        this.last = [hn.s, hn.i]; this.seg = null;
        this.drag = {kind: 'nodes', start: p, orig: this.snapshotSel(), grab: [hn.s, hn.i], moved: false};
        return this.redraw();
      }
      if (hh){ this.drag = {kind: 'handle', s: hh.s, i: hh.i, w: hh.w, start: p, moved: false}; return this.redraw(); }
      if (hs){
        if (right){ const j = this.next(hs.s, hs.i); this.sel = new Set([this.key(hs.s, j)]); this.seg = null; return this.openMenu(e); }
        this.seg = hs; this.sel.clear();
        const q = this.segPts(hs.s, hs.i);
        this.drag = {kind: 'bend', s: hs.s, i: hs.i, t: Math.min(0.98, Math.max(0.02, hs.t)), start: p, c1: q[1], c2: q[2], wasLine: !this.node(hs.s, hs.i).out, moved: false};
        return this.redraw();
      }
      if (this.nearMiss(p) && !right) return;    // keeps the selection
    }
    const t = this.objectAt(e);
    if (t && t !== this.obj){
      if (t.type === 'path') return this.edit(t);
      if (this.convertible(t)){ this.stop(true); this.pending = t; canvas.setActiveObject(t); canvas.requestRenderAll(); this.bar(); return toast('Double-click to turn this shape into a curve and edit its nodes'); }
      return toast(t.text != null ? 'Text: use Convert to curves (Object menu) first' : 'Only curves have nodes to edit');
    }
    if (right) return;
    // empty canvas: marquee
    this.drag = {kind: 'marquee', start: p, cur: p, add: e.shiftKey || e.ctrlKey || e.metaKey, moved: false};
  },
  move(o){
    const e = o.e, p = canvas.getPointer(e), d = this.drag;
    if (!d){ this.cursor(p); return; }
    let dv = this.sub(p, d.start);
    if (Math.abs(dv.x) * zoom + Math.abs(dv.y) * zoom > 2) d.moved = true;
    if (!d.moved) return;
    if ((e.ctrlKey || e.shiftKey) && d.kind === 'nodes'){ if (Math.abs(dv.x) > Math.abs(dv.y)) dv.y = 0; else dv.x = 0; }
    if (d.kind === 'nodes'){
      d.orig.forEach(([s, i, n]) => { const t = this.node(s, i); t.x = n.x + dv.x; t.y = n.y + dv.y; t.in = n.in && this.add(n.in, dv); t.out = n.out && this.add(n.out, dv); });
    } else if (d.kind === 'handle'){
      const n = this.node(d.s, d.i);
      let q = p;
      if (e.ctrlKey || e.shiftKey){ const v = this.sub(p, n), a = Math.round(Math.atan2(v.y, v.x) / (Math.PI / 12)) * Math.PI / 12, l = this.len(v); q = this.add(n, {x: Math.cos(a) * l, y: Math.sin(a) * l}); }
      n[d.w] = {x: q.x, y: q.y};
      // the segment's other control point appears with it when a straight segment gets a handle
      this.constrain(d.s, d.i, d.w);
    } else if (d.kind === 'bend'){
      const a = this.node(d.s, d.i), j = this.next(d.s, d.i), b = this.node(d.s, j), t = d.t;
      const k = 1 / (3 * t * (1 - t) * ((1 - t) ** 2 + t ** 2));
      a.out = this.add(d.c1, this.mul(dv, k * (1 - t)));
      b.in = this.add(d.c2, this.mul(dv, k * t));
      // smooth or symmetrical ends stay so: their other handle turns along
      this.constrain(d.s, d.i, 'out'); this.constrain(d.s, j, 'in');
    } else if (d.kind === 'marquee'){ d.cur = p; return this.redraw(); }
    this.apply(false);
  },
  up(o){
    const d = this.drag; this.drag = null; if (!d) return;
    if (d.kind === 'marquee'){
      if (!d.moved){ if (!this.nearMiss(d.start)){ this.sel.clear(); this.seg = null; if (!this.obj) this.stop(true); } return this.redraw(); }
      const x0 = Math.min(d.start.x, d.cur.x), x1 = Math.max(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y), y1 = Math.max(d.start.y, d.cur.y);
      if (!d.add) this.sel.clear();
      this.subs.forEach((sp, s) => sp.nodes.forEach((n, i) => { if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) this.sel.add(this.key(s, i)); }));
      this.seg = null; return this.redraw();
    }
    if (!d.moved) return this.redraw();
    if (d.kind === 'nodes' && d.orig.length === 1 && this.isEnd(...d.grab)){
      // drop an end node on another end node: join them
      const [gs, gi] = d.grab, g = this.node(gs, gi);
      let target = null;
      this.subs.forEach((sp, s) => sp.nodes.forEach((n, i) => { if ((s !== gs || i !== gi) && this.isEnd(s, i) && this.d2s(Math.hypot(n.x - g.x, n.y - g.y)) <= PICK) target = [s, i]; }));
      if (target){ this.sel = new Set([this.key(gs, gi), this.key(...target)]); return this.joinNodes(false); }
    }
    this.apply(true);
  },
  dbl(o){
    const p = canvas.getPointer(o.e);
    if (!this.obj || (this.pending && !this.hitNode(p))){
      const t = this.pending || this.objectAt(o.e);
      if (t && this.convertible(t)){ this.pending = null; const c = this.toPath(t); this.edit(c); snapshot(); refresh(); toast('Converted to a curve — drag its nodes'); }
      return;
    }
    const hn = this.hitNode(p);
    if (hn){ this.sel = new Set([this.key(hn.s, hn.i)]); this.seg = null; return this.deleteNodes(); }
    const hs = this.hitSeg(p);
    if (hs){ this.seg = hs; return this.addNodes(); }
  },
  snapshotSel(){ return this.selList().map(([s, i]) => { const n = this.node(s, i); return [s, i, {x: n.x, y: n.y, in: n.in && {...n.in}, out: n.out && {...n.out}}]; }); },
  selectRun([s, a], [, b]){
    const n = this.subs[s].nodes.length, closed = this.subs[s].closed;
    let step = b >= a ? 1 : -1;
    if (closed){ const fwd = (b - a + n) % n, back = (a - b + n) % n; step = fwd <= back ? 1 : -1; if (this._lastRun === `${s}:${a}:${b}`){ step = -step; this._lastRun = null; } else this._lastRun = `${s}:${a}:${b}`; }
    this.sel = new Set();
    for (let i = a; ; i = (i + step + n) % n){ this.sel.add(this.key(s, i)); if (i === b) break; if (!closed && (i + step < 0 || i + step >= n)) break; }
  },
  cursor(p){
    if (!this.obj) return;
    const c = this.hitNode(p) ? 'move' : this.hitHandle(p) ? 'crosshair' : this.hitSeg(p) ? 'copy' : 'default';
    if (canvas.defaultCursor !== c){ canvas.defaultCursor = c; canvas.setCursor(c); }
  },
  redraw(){ canvas.requestRenderAll(); this.bar(); this.status(); },

  /* ---------- keyboard ---------- */
  keydown(e){
    if (!this.obj) return false;
    const k = e.key, mod = e.metaKey || e.ctrlKey, has = this.sel.size > 0;
    if (mod && k.toLowerCase() === 'a'){ this.selectAll(); return true; }
    if (k === 'Escape'){ if (this.sel.size || this.seg){ this.sel.clear(); this.seg = null; this.redraw(); return true; } return false; }
    if ((k === 'Delete' || k === 'Backspace') && (has || this.seg)){ this.deleteNodes(); return true; }
    if ((k === '+' || k === '=') && (has || this.seg)){ this.addNodes(); return true; }
    if (k === '-' && has){ this.deleteNodes(); return true; }
    if (!mod && has && ['c', 's', 'y'].includes(k.toLowerCase())){
      const list = this.selList(), l = k.toLowerCase();
      list.forEach(([s, i]) => { const n = this.node(s, i); this.setType(s, i, l === 'y' ? 'symmetric' : l === 'c' ? (n.type === 'cusp' ? 'smooth' : 'cusp') : (n.type === 'symmetric' ? 'smooth' : 'symmetric')); });
      this.apply(true); return true;
    }
    if (k === 'Tab'){
      const flat = []; this.subs.forEach((sp, s) => sp.nodes.forEach((_, i) => flat.push(this.key(s, i))));
      const cur = this.last ? flat.indexOf(this.key(...this.last)) : -1, nx = (cur + (e.shiftKey ? -1 : 1) + flat.length) % flat.length;
      this.sel = new Set([flat[nx]]); this.last = this.unkey(flat[nx]); this.seg = null; this.redraw(); return true;
    }
    if ((k === 'Home' || k === 'End') && has){
      const s = this.selList()[0][0], i = k === 'Home' ? 0 : this.subs[s].nodes.length - 1; this.sel = new Set([this.key(s, i)]); this.last = [s, i]; this.redraw(); return true;
    }
    if (k.startsWith('Arrow') && has){
      const step = (e.shiftKey ? 1 : (e.ctrlKey || e.metaKey) ? 0.01 : 0.1) * PX_PER_IN;
      const dv = {x: k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, y: k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0};
      this.selList().forEach(([s, i]) => { const n = this.node(s, i); n.x += dv.x; n.y += dv.y; if (n.in) n.in = this.add(n.in, dv); if (n.out) n.out = this.add(n.out, dv); });
      this.apply(true); return true;
    }
    return false;
  },

  /* ---------- drawing the nodes ---------- */
  draw(ctx){
    if (!this.obj) return;
    const r = canvas.getRetinaScaling(), v = canvas.viewportTransform;
    const S = p => ({x: (p.x * v[0] + v[4]), y: (p.y * v[3] + v[5])});
    ctx.save(); ctx.setTransform(r, 0, 0, r, 0, 0);
    // the curve in the node colour
    ctx.beginPath();
    this.subs.forEach((sp, s) => sp.nodes.forEach((n, i) => {
      const q = this.segPts(s, i), a = S(n);
      if (i === 0) ctx.moveTo(a.x, a.y);
      if (q){ const c1 = S(q[1]), c2 = S(q[2]), b = S(q[3]); this.node(s, i).out ? ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y) : ctx.lineTo(b.x, b.y); }
    }));
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.stroke();
    // the chosen segment, drawn over in the main colour, with a mark where it was clicked
    if (this.seg && this.segPts(this.seg.s, this.seg.i)){
      const q = this.segPts(this.seg.s, this.seg.i).map(S);
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.bezierCurveTo(q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y);
      ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5; ctx.stroke();
      const m = S(this.seg.pt); ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#f97316'; ctx.fill();
    }
    // handles of chosen nodes: dashed line on a white line twice as wide, control point with a white edge
    this.handleOwners().forEach(([s, i, w]) => {
      const n = S(this.node(s, i)), h = S(this.node(s, i)[w]);
      ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(h.x, h.y); ctx.stroke();
      ctx.setLineDash([3, 2]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(h.x, h.y); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(h.x, h.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    // nodes: squares (cusp), circles (smooth), diamonds (symmetrical); the first node of a subpath a triangle
    this.subs.forEach((sp, s) => sp.nodes.forEach((n, i) => {
      const a = S(n), on = this.sel.has(this.key(s, i)), z = on ? 4.5 : 3.5;
      ctx.beginPath();
      if (i === 0){ const t = z + 1.5; ctx.moveTo(a.x, a.y - t); ctx.lineTo(a.x + t, a.y + t * 0.8); ctx.lineTo(a.x - t, a.y + t * 0.8); ctx.closePath(); }
      else if (n.type === 'smooth') ctx.arc(a.x, a.y, z, 0, Math.PI * 2);
      else if (n.type === 'symmetric'){ ctx.moveTo(a.x, a.y - z - 1); ctx.lineTo(a.x + z + 1, a.y); ctx.lineTo(a.x, a.y + z + 1); ctx.lineTo(a.x - z - 1, a.y); ctx.closePath(); }
      else ctx.rect(a.x - z, a.y - z, z * 2, z * 2);
      ctx.fillStyle = on ? '#2563eb' : '#ffffff'; ctx.fill(); ctx.strokeStyle = on ? '#ffffff' : '#2563eb'; ctx.lineWidth = 1.2; ctx.stroke();
    }));
    if (this.drag && this.drag.kind === 'marquee' && this.drag.moved){
      const a = S(this.drag.start), b = S(this.drag.cur);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#3b82f6'; ctx.fillStyle = 'rgba(59,130,246,.08)'; ctx.lineWidth = 1;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x + .5, a.y + .5, b.x - a.x, b.y - a.y);
    }
    ctx.restore();
  },

  /* ---------- property bar, status, menu ---------- */
  bar(){
    const on = tool === 'shape';
    $('pbNodes').classList.toggle('on', on);
    if (!on) return;
    const n = this.sel.size, list = this.selList(), ends = list.filter(([s, i]) => this.isEnd(s, i)).length;
    $('nodeInfo').textContent = !this.obj ? 'Click a curve to edit its nodes (double-click a shape to turn it into a curve)'
      : n ? `${n} of ${this.subs.reduce((a, sp) => a + sp.nodes.length, 0)} nodes` : this.seg ? 'Segment chosen' : `${this.subs.reduce((a, sp) => a + sp.nodes.length, 0)} nodes · ${this.subs.length} subpath${this.subs.length > 1 ? 's' : ''}`;
    const types = new Set(list.map(([s, i]) => this.node(s, i).type));
    document.querySelectorAll('#pbNodes [data-node]').forEach(b => {
      const c = b.dataset.node;
      b.disabled = !this.obj || (['join', 'close'].includes(c) ? ends !== 2 : ['cusp', 'smooth', 'symmetric', 'break', 'extract'].includes(c) ? !n : ['line', 'curve', 'add', 'del'].includes(c) ? !(n || this.seg) : false);
      if (['cusp', 'smooth', 'symmetric'].includes(c)) b.classList.toggle('on', types.size === 1 && types.has(c));
    });
  },
  status(){ if (this.obj) $('stSel').innerHTML = `Shape tool: <b>${nameOf(this.obj)}</b> · ${this.sel.size} node(s) selected`; },
  openMenu(e){
    this.redraw();
    const m = document.createElement('div'); m.className = 'ctxmenu';
    const items = [['add', 'Add node', '+'], ['del', 'Delete', 'Del'], ['join', 'Join'], ['break', 'Break'], null, ['line', 'To line'], ['curve', 'To curve'], null,
                   ['cusp', 'Cusp', 'C'], ['smooth', 'Smooth', 'S'], ['symmetric', 'Symmetrical', 'Y'], null, ['reverse', 'Reverse direction'], ['extract', 'Extract subpath'], ['close', 'Extend curve to close']];
    m.innerHTML = items.map(it => it ? `<button data-n="${it[0]}">${it[1]}${it[2] ? `<kbd>${it[2]}</kbd>` : ''}</button>` : '<hr>').join('');
    m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
    m.onclick = ev => { const b = ev.target.closest('[data-n]'); if (b){ this.closeMenu(); this.run(b.dataset.n); } };
    document.body.appendChild(m); this.menu = m; this.menuEvent = e;
    const r = m.getBoundingClientRect(); if (r.bottom > innerHeight) m.style.top = (e.clientY - r.height) + 'px'; if (r.right > innerWidth) m.style.left = (e.clientX - r.width) + 'px';
  },
  closeMenu(){ if (this.menu){ this.menu.remove(); this.menu = null; } },
};

canvas.on('after:render', e => { if (e && e.ctx === canvas.contextContainer && tool === 'shape') Nodes.draw(e.ctx); });
// a press elsewhere closes the node menu (but not the press that just opened it)
document.addEventListener('mousedown', e => { if (Nodes.menu && e !== Nodes.menuEvent && !e.target.closest('.ctxmenu')) Nodes.closeMenu(); });
document.querySelectorAll('#pbNodes [data-node]').forEach(b => b.onclick = () => Nodes.run(b.dataset.node));
