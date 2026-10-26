/* ===================== Pick tool, alignment guides, snapping =====================
   Ported from TraceDraw's docs/behavior/pick-tool.md, live-guides.md and snapping.md.
   • Scale mode: eight black square handles with a white edge; a corner scales in proportion by where the
     pointer falls along the diagonal; Shift from the centre, Ctrl in whole 100 % steps, Alt freely.
   • A second click on the selection toggles rotate mode: curved arrows at the corners turn about the centre of
     rotation (a ring you can drag; double-click puts it back), straight arrows at the sides slant.
   • Space drops a copy during a move/scale/turn/slant; a right click mid-drag leaves the original; Esc cancels.
   • Right-button drag shows where the selection would go and opens Move / Copy Here … on release.
   • Moves, scales and drawing snap to the edges and centres of other objects and the print area, with
     magenta alignment lines, equal spacing and equal sizes. */

const GUIDE = 'rgb(230,40,150)';
const Pick = {
  guides: [], marks: [], targets: null, snapOn: true, guidesOn: true,
  radius(){ return 10 / zoom; },     // 10 screen px, in scene units

  /* ---------- targets for snapping: other visible objects + the print area ---------- */
  collect(exclude){
    const ex = new Set(exclude || []);
    const boxes = canvas.getObjects().filter(o => o.visible && !o.excludeFromExport && !ex.has(o)).map(o => {
      const b = o.getBoundingRect(true, true); return {l: b.left, t: b.top, r: b.left + b.width, b: b.top + b.height, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2, obj: o};
    });
    const page = {l: 0, t: 0, r: PA_W, b: PA_H, w: PA_W, h: PA_H, cx: PA_W / 2, cy: PA_H / 2, page: true};
    this.targets = {boxes, all: boxes.concat([page])};
    return this.targets;
  },
  movingObjs(t){ return t ? (t.type === 'activeSelection' ? t.getObjects() : [t]) : []; },
  box(o){ const b = o.getBoundingRect(true, true); return {l: b.left, t: b.top, r: b.left + b.width, b: b.top + b.height, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2}; },

  // best correction on one axis: values of the moving box against the targets' values
  best(vals, axis, tg){
    const keys = axis === 'x' ? ['l', 'cx', 'r'] : ['t', 'cy', 'b'], R = this.radius();
    let best = null;
    for (const T of tg){ for (const k of keys){ const tv = T[k]; for (const [vk, v] of vals){ const d = tv - v; if (Math.abs(d) <= R && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, v: tv, vk, T}; } } }
    return best;
  },
  // equal spacing: the moving box between its neighbours on one axis
  spacing(B, axis, tg){
    const R = this.radius(), [lo, hi, clo, chi] = axis === 'x' ? ['l', 'r', 't', 'b'] : ['t', 'b', 'l', 'r'];
    const band = tg.filter(T => !T.page && T[chi] > B[clo] && T[clo] < B[chi]);
    const before = band.filter(T => T[hi] <= B[lo] + R).sort((a, b) => b[hi] - a[hi]), after = band.filter(T => T[lo] >= B[hi] - R).sort((a, b) => a[lo] - b[lo]);
    const size = B[hi] - B[lo], cands = [];
    if (before[0] && after[0]){ const g = (after[0][lo] - before[0][hi] - size) / 2; if (g > 0) cands.push({pos: before[0][hi] + g, gaps: [[before[0], null, g], [null, after[0], g]]}); }
    if (before[1] && before[0]){ const g = before[0][lo] - before[1][hi]; if (g > 0) cands.push({pos: before[0][hi] + g, gaps: [[before[1], before[0], g], [before[0], null, g]]}); }
    if (after[1] && after[0]){ const g = after[1][lo] - after[0][hi]; if (g > 0) cands.push({pos: after[0][lo] - g - size, gaps: [[null, after[0], g], [after[0], after[1], g]]}); }
    let best = null;
    cands.forEach(c => { const d = c.pos - B[lo]; if (Math.abs(d) <= R && (!best || Math.abs(d) < Math.abs(best.d))) best = Object.assign(c, {d}); });
    return best;
  },
  line(axis, v, A, T){   // a guide through value v from box A to box T, 6 px past both ends
    const e = 6 / zoom;
    if (axis === 'x'){ const y0 = Math.min(A.t, T.t) - e, y1 = Math.max(A.b, T.b) + e; this.guides.push([v, y0, v, y1]); }
    else { const x0 = Math.min(A.l, T.l) - e, x1 = Math.max(A.r, T.r) + e; this.guides.push([x0, v, x1, v]); }
  },
  clearGuides(){ if (this.guides.length || this.marks.length){ this.guides = []; this.marks = []; canvas.requestRenderAll(); } },

  /* ---------- moving ---------- */
  onMoving(e){
    const t = e.target; this.guides = []; this.marks = [];
    if (!this.snapOn) return;
    const ev = e.e || {}, tr = e.transform;
    // Ctrl keeps the move horizontal or vertical, whichever is longer
    if ((ev.ctrlKey || ev.metaKey) && tr && tr.original){
      const dx = t.left - tr.original.left, dy = t.top - tr.original.top;
      if (Math.abs(dx) > Math.abs(dy)) t.top = tr.original.top; else t.left = tr.original.left;
      t.setCoords();
    }
    if (!this.targets) this.collect(this.movingObjs(t));
    const tg = this.targets.all, B = this.box(t);
    const fixAxis = (axis) => {
      const vals = axis === 'x' ? [['l', B.l], ['cx', B.cx], ['r', B.r]] : [['t', B.t], ['cy', B.cy], ['b', B.b]];
      const al = this.best(vals, axis, tg), sp = this.guidesOn ? this.spacing(B, axis, tg) : null;
      const pick = al && (!sp || Math.abs(al.d) <= Math.abs(sp.d)) ? al : sp;
      if (!pick) return 0;
      if (pick === al && this.guidesOn) this.pendingLine = [axis, al.v, al.T];
      if (pick === sp) this.pendingGap = [axis, sp];
      return pick.d;
    };
    this.pendingLine = null; this.pendingGap = null;
    const lockX = (ev.ctrlKey || ev.metaKey) && tr && t.left === tr.original.left, lockY = (ev.ctrlKey || ev.metaKey) && tr && t.top === tr.original.top;
    const dx = lockX ? 0 : fixAxis('x'); const lx = lockX ? null : this.pendingLine, gx = lockX ? null : this.pendingGap; this.pendingLine = this.pendingGap = null;
    const dy = lockY ? 0 : fixAxis('y'); const ly = lockY ? null : this.pendingLine, gy = lockY ? null : this.pendingGap;
    if (dx || dy){ t.set({left: t.left + dx, top: t.top + dy}); t.setCoords(); }
    const NB = this.box(t);
    if (lx) this.line('x', lx[1], NB, lx[2]); if (ly) this.line('y', ly[1], NB, ly[2]);
    [[gx, 'x'], [gy, 'y']].forEach(([g, axis]) => g && g[1].gaps.forEach(([a, b]) => this.marks.push({axis, a: a || NB, b: b || NB, band: NB})));
  },

  /* ---------- scaling handlers (TraceDraw formulas) ---------- */
  scaleHandler(by){
    return (ev, tr, x, y) => {
      const t = tr.target, o = tr.original;
      if (!tr.td){
        // remembered once: the start size, the opposite corner/side and the centre where the drag began
        const corner = tr.corner, dirX = corner.includes('r') ? 1 : corner.includes('l') ? -1 : 0, dirY = corner.includes('b') ? 1 : corner.includes('t') ? -1 : 0;
        const ox = dirX > 0 ? 'left' : dirX < 0 ? 'right' : 'center', oy = dirY > 0 ? 'top' : dirY < 0 ? 'bottom' : 'center';
        const dim = t._getTransformedDimensions(), anchor = t.translateToOriginPoint(t.getCenterPoint(), ox, oy), center = t.getCenterPoint();
        // the handle follows the pointer from where it was pressed (it sits a little outside the box), without a jump
        const a0 = fabric.util.degreesToRadians(t.angle || 0), L = (b) => { const vx = tr.ex - b.x, vy = tr.ey - b.y; return {x: vx * Math.cos(a0) + vy * Math.sin(a0), y: -vx * Math.sin(a0) + vy * Math.cos(a0)}; };
        const g = L(anchor), gc = L(center);
        tr.td = {dirX, dirY, ox, oy, dim, anchor, center,
          off: {x: dirX ? g.x - dirX * dim.x : 0, y: dirY ? g.y - dirY * dim.y : 0}, offC: {x: dirX ? gc.x - dirX * dim.x / 2 : 0, y: dirY ? gc.y - dirY * dim.y / 2 : 0}};
      }
      const T = tr.td, centered = !!ev.shiftKey, a = fabric.util.degreesToRadians(t.angle || 0);
      const base = centered ? T.center : T.anchor, off = centered ? T.offC : T.off;
      const vx = x - base.x, vy = y - base.y, lx = vx * Math.cos(a) + vy * Math.sin(a) - off.x, ly = -vx * Math.sin(a) + vy * Math.cos(a) - off.y;
      // Fabric's left/right origins don't swap when an object is flipped, so the local frame needs no flip
      const k = centered ? 2 : 1;
      let sx = T.dirX ? (lx * k) / (T.dim.x * T.dirX) : 1, sy = T.dirY ? (ly * k) / (T.dim.y * T.dirY) : 1;
      if (!by && !ev.altKey){
        // proportional along the diagonal: s = (|sx| w² + |sy| h²) / (w² + h²), each side keeping its sign
        const w2 = T.dim.x ** 2, h2 = T.dim.y ** 2, s = (Math.abs(sx) * w2 + Math.abs(sy) * h2) / (w2 + h2);
        sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s;
      }
      if (by === 'x') sy = 1; if (by === 'y') sx = 1;
      if (ev.ctrlKey || ev.metaKey){ sx = Math.sign(sx || 1) * Math.max(1, Math.round(Math.abs(sx))); sy = Math.sign(sy || 1) * Math.max(1, Math.round(Math.abs(sy))); }
      // snapping the dragged edges (upright objects): to other objects' edges/centres and to their sizes
      if (this.snapOn && !(ev.ctrlKey || ev.metaKey) && !((t.angle || 0) % 360) && !t.skewX && !t.skewY){
        [sx, sy] = this.snapScale(t, T, sx, sy, by, centered, ev.altKey);
      } else this.guides = [];
      const MIN = 0.01;
      t.set({scaleX: Math.max(MIN, Math.abs(o.scaleX * sx)), scaleY: Math.max(MIN, Math.abs(o.scaleY * sy)), flipX: (sx < 0) !== !!o.flipX, flipY: (sy < 0) !== !!o.flipY});
      // keep the anchor (opposite corner or side, or the centre) exactly where it was; past it, the object
      // mirrors and the anchor becomes its other side
      const opp = {left: 'right', right: 'left', top: 'bottom', bottom: 'top', center: 'center'};
      const ox = centered ? 'center' : (sx < 0 ? opp[T.ox] : T.ox), oy = centered ? 'center' : (sy < 0 ? opp[T.oy] : T.oy);
      t.setPositionByOrigin(centered ? T.center : T.anchor, ox, oy);
      return true;
    };
  },
  snapScale(t, T, sx, sy, by, centered, free){
    this.guides = []; this.marks = [];
    if (!this.targets) this.collect(this.movingObjs(t));
    const tg = this.targets.all, R = this.radius(), W0 = T.dim.x, H0 = T.dim.y;
    const anchor = centered ? T.center : T.anchor;
    const axisFix = (axis, s) => {
      const size0 = axis === 'x' ? W0 : H0, dir = axis === 'x' ? T.dirX : T.dirY, a = axis === 'x' ? anchor.x : anchor.y;
      if (!dir) return null;
      const size = Math.abs(s) * size0, edge = centered ? a + dir * size / 2 : a + dir * Math.sign(s) * size;
      let best = null;
      const keys = axis === 'x' ? ['l', 'cx', 'r'] : ['t', 'cy', 'b'];
      for (const B of tg){
        for (const k of keys){ const d = B[k] - edge; if (Math.abs(d) <= R && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, v: B[k], B, kind: 'edge'}; }
        if (this.guidesOn && !B.page){ const other = axis === 'x' ? B.w : B.h, d = other - size; if (Math.abs(d) <= R && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, size: other, B, kind: 'size'}; }
      }
      if (!best) return null;
      const newSize = best.kind === 'size' ? best.size : (centered ? Math.abs(best.v - a) * 2 : Math.abs(best.v - a));
      return {s: Math.sign(s || 1) * newSize / size0, best, axis};
    };
    const fx = by === 'y' ? null : axisFix('x', sx), fy = by === 'x' ? null : axisFix('y', sy);
    let pick = [fx, fy];
    if (!by && !free){
      // proportional: the nearer axis wins and the other follows it
      const w = [fx, fy].filter(Boolean).sort((a, b) => Math.abs(a.best.d) - Math.abs(b.best.d))[0];
      if (w){ const r = Math.abs(w.s) / Math.abs(w.axis === 'x' ? sx : sy); sx *= r; sy *= r; pick = [w.axis === 'x' ? w : null, w.axis === 'y' ? w : null]; }
    } else { if (fx) sx = fx.s; if (fy) sy = fy.s; }
    // marks: alignment line through the snapped edge, or a size bar
    pick.filter(Boolean).forEach(f => {
      if (f.best.kind === 'edge' && this.guidesOn){ const v = f.best.v, B = f.best.B; this.guides.push(f.axis === 'x' ? [v, Math.min(B.t, anchor.y) - 12 / zoom, v, Math.max(B.b, anchor.y) + 12 / zoom] : [Math.min(B.l, anchor.x) - 12 / zoom, v, Math.max(B.r, anchor.x) + 12 / zoom, v]); }
      if (f.best.kind === 'size') this.marks.push({size: f.axis, B: f.best.B});
    });
    return [sx, sy];
  },

  /* ---------- rotate mode ---------- */
  pivotScene(t){
    const d = t._getTransformedDimensions(), a = fabric.util.degreesToRadians(t.angle || 0), c = t.getCenterPoint();
    const px = (t.pivotU || 0) * d.x, py = (t.pivotV || 0) * d.y;
    return new fabric.Point(c.x + px * Math.cos(a) - py * Math.sin(a), c.y + px * Math.sin(a) + py * Math.cos(a));
  },
  rotateHandler(ev, tr, x, y){
    const t = tr.target;
    // measured from where the button went down, not from the first move
    if (!tr.rot){ const pv = Pick.pivotScene(t); tr.rot = {pv, a0: Math.atan2(tr.ey - pv.y, tr.ex - pv.x), ang0: t.angle || 0, c0: t.getCenterPoint()}; }
    const R = tr.rot;
    let ang = R.ang0 + fabric.util.radiansToDegrees(Math.atan2(y - R.pv.y, x - R.pv.x) - R.a0);
    if (ev.ctrlKey || ev.metaKey) ang = Math.round(ang / 15) * 15;      // the constrain angle
    const d = fabric.util.degreesToRadians(ang - R.ang0), vx = R.c0.x - R.pv.x, vy = R.c0.y - R.pv.y;
    t.set('angle', ((ang % 360) + 360) % 360);
    t.setPositionByOrigin(new fabric.Point(R.pv.x + vx * Math.cos(d) - vy * Math.sin(d), R.pv.y + vx * Math.sin(d) + vy * Math.cos(d)), 'center', 'center');
    Pick.guides = [];
    return true;
  },
  pivotHandler(ev, tr, x, y){
    const t = tr.target, d = t._getTransformedDimensions(), a = -fabric.util.degreesToRadians(t.angle || 0), c = t.getCenterPoint();
    const vx = x - c.x, vy = y - c.y;
    t.pivotU = (vx * Math.cos(a) - vy * Math.sin(a)) / d.x; t.pivotV = (vx * Math.sin(a) + vy * Math.cos(a)) / d.y;
    t.setCoords(); return true;
  },
  skew(base){
    return (ev, tr, x, y) => {
      const r = base(ev, tr, x, y), t = tr.target;
      if (ev.ctrlKey || ev.metaKey){
        const anchor = t.translateToOriginPoint(t.getCenterPoint(), tr.originX, tr.originY);
        ['skewX', 'skewY'].forEach(k => { if (t[k]) t[k] = Math.round(t[k] / 15) * 15; });
        t.setPositionByOrigin(anchor, tr.originX, tr.originY);
      }
      return r;
    };
  },
  setMode(t, rotate){
    if (!t) return;
    t.rotateMode = !!rotate;
    if (rotate) t.controls = this.ROTATE; else delete t.controls;
    t.setCoords(); canvas.requestRenderAll();
  },

  /* ---------- copies ---------- */
  // clone objects as they are drawn now (also members of an ActiveSelection, whose own transform is folded in)
  cloneAbsolute(objs, host){
    const m = host && host.type === 'activeSelection' ? host.calcTransformMatrix() : null;
    return Promise.all(objs.map(o => new Promise(res => o.clone(c => {
      if (m) fabric.util.applyTransformToObject(c, fabric.util.multiplyTransformMatrices(m, o.calcOwnMatrix()));
      c.set({evented: true}); c.uid = undefined; applyLock(c); res(c);
    }, PROPS))));
  },
  async dropCopy(t){
    const objs = this.movingObjs(t), copies = await this.cloneAbsolute(objs, t);
    restoring = true;
    copies.forEach((c, i) => canvas.insertAt(c, canvas.getObjects().indexOf(objs[i])));   // under the ones still moving
    restoring = false; queueSnapshot(); canvas.requestRenderAll();
    toast('Copy dropped — the move goes on');
  },
  restore(t, orig){
    const keys = ['left', 'top', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'flipX', 'flipY'];
    keys.forEach(k => { if (k in orig) t[k] = orig[k]; }); t.setCoords();
  },
  // + key and Ctrl+D (smart duplicate: repeats what was done to the last copy)
  async duplicate(inPlace){
    const a = canvas.getActiveObject(); if (!a) return;
    const objs = this.movingObjs(a);
    let step = {dx: inPlace ? 0 : PX_PER_IN * 0.25, dy: inPlace ? 0 : -PX_PER_IN * 0.25, sx: 1, sy: 1, da: 0};
    const L = this.lastDup;
    if (!inPlace && L && L.copies.length === objs.length && objs.every(o => L.copies.includes(o))){
      // the selection is still the copies: repeat the change from each original to its copy
      const o = L.origs[0], c = L.copies[0];
      if (canvas.getObjects().includes(o)){
        const oc = o.getCenterPoint(), cc = c.getCenterPoint();
        step = {dx: cc.x - oc.x, dy: cc.y - oc.y, sx: c.scaleX / o.scaleX, sy: c.scaleY / o.scaleY, da: (c.angle || 0) - (o.angle || 0)};
      }
    }
    const copies = await this.cloneAbsolute(objs, a);
    canvas.discardActiveObject();
    restoring = true;
    copies.forEach(c => {
      const ctr = c.getCenterPoint();
      c.set({scaleX: c.scaleX * step.sx, scaleY: c.scaleY * step.sy, angle: (c.angle || 0) + step.da});
      c.setPositionByOrigin(new fabric.Point(ctr.x + step.dx, ctr.y + step.dy), 'center', 'center'); c.setCoords();
      canvas.add(c);
    });
    restoring = false;
    const origs = objs.map(o => o);
    this.lastDup = {origs, copies};
    selectObjs(copies); snapshot(); refresh();
  },
  cycle(back){
    const list = canvas.getObjects().filter(o => o.visible && o.selectable);
    if (!list.length) return;
    const cur = list.indexOf(canvas.getActiveObject()), n = (cur + (back ? -1 : 1) + list.length) % list.length;
    canvas.setActiveObject(list[cur < 0 ? (back ? list.length - 1 : 0) : n]); canvas.requestRenderAll();
  },
  under(e, skipSel){
    const p = canvas.getPointer(e, true), sel = new Set(skipSel ? actives() : []);
    return canvas.getObjects().filter(o => o.visible && o.evented && !sel.has(o) && o.containsPoint(p)).reverse();
  },

  /* ---------- drawing tools: snap a point ---------- */
  snapPoint(p){
    this.guides = [];
    if (!this.snapOn) return p;
    if (!this.targets) this.collect(drawing ? [drawing] : []);
    const tg = this.targets.all, q = {x: p.x, y: p.y};
    const bx = this.best([['p', p.x]], 'x', tg), by = this.best([['p', p.y]], 'y', tg);
    if (bx){ q.x = bx.v; if (this.guidesOn) this.line('x', bx.v, {l: q.x, r: q.x, t: q.y, b: q.y}, bx.T); }
    if (by){ q.y = by.v; if (this.guidesOn) this.line('y', by.v, {l: q.x, r: q.x, t: q.y, b: q.y}, by.T); }
    return q;
  },

  /* ---------- drawing the guides ---------- */
  draw(ctx){
    if (!this.guides.length && !this.marks.length && !this.ghost) return;
    const r = canvas.getRetinaScaling(), v = canvas.viewportTransform, S = (x, y) => [x * v[0] + v[4], y * v[3] + v[5]];
    ctx.save(); ctx.setTransform(r, 0, 0, r, 0, 0); ctx.lineWidth = 1; ctx.strokeStyle = GUIDE; ctx.fillStyle = GUIDE;
    this.guides.forEach(([x0, y0, x1, y1]) => { const a = S(x0, y0), b = S(x1, y1); ctx.beginPath(); ctx.moveTo(Math.round(a[0]) + .5, Math.round(a[1]) + .5); ctx.lineTo(Math.round(b[0]) + .5, Math.round(b[1]) + .5); ctx.stroke(); });
    const bar = (a, b, cross) => {   // a line with end bars (and strokes across the middle for sizes)
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      const nx = b[1] - a[1], ny = a[0] - b[0], l = Math.hypot(nx, ny) || 1, ux = nx / l * 4, uy = ny / l * 4;
      [a, b].forEach(p => { ctx.moveTo(p[0] - ux, p[1] - uy); ctx.lineTo(p[0] + ux, p[1] + uy); });
      if (cross){ const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = (b[0] - a[0]) / l * 2, dy = (b[1] - a[1]) / l * 2; [-1, 1].forEach(s => { ctx.moveTo(m[0] + s * dx - ux, m[1] + s * dy - uy); ctx.lineTo(m[0] + s * dx + ux, m[1] + s * dy + uy); }); }
      ctx.stroke();
    };
    this.marks.forEach(m => {
      if (m.size){ const B = m.B; m.size === 'x' ? bar(S(B.l, B.b + 7 / zoom), S(B.r, B.b + 7 / zoom), true) : bar(S(B.l - 7 / zoom, B.t), S(B.l - 7 / zoom, B.b), true); return; }
      const {axis, a, b, band} = m;
      if (axis === 'x'){ const y = band.cy; bar(S(a.r, y), S(b.l, y)); } else { const x = band.cx; bar(S(x, a.b), S(x, b.t)); }
    });
    if (this.ghost){
      const {objs, dx, dy} = this.ghost;
      objs.forEach(o => {
        const c = o.getCoords(true, true).map(p => S(p.x + dx, p.y + dy));
        ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.stroke();
      });
    }
    ctx.restore();
  },

  /* ---------- context menus ---------- */
  menu(e, items){
    this.closeMenu();
    const m = document.createElement('div'); m.className = 'ctxmenu';
    m.innerHTML = items.map(it => !it ? '<hr>' : `<button data-i="${it[0]}" ${it[3] ? 'disabled' : ''}>${it[1]}${it[2] ? `<kbd>${it[2]}</kbd>` : ''}</button>`).join('');
    m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
    m.onclick = ev => { const b = ev.target.closest('[data-i]'); if (b && !b.disabled){ this.closeMenu(); const it = items.find(x => x && x[0] === b.dataset.i); it[4](); } };
    document.body.appendChild(m); this.menuEl = m; this.menuEvent = e;
    const r = m.getBoundingClientRect(); if (r.bottom > innerHeight) m.style.top = (e.clientY - r.height) + 'px'; if (r.right > innerWidth) m.style.left = (e.clientX - r.width) + 'px';
  },
  closeMenu(){ if (this.menuEl){ this.menuEl.remove(); this.menuEl = null; } },
  contextMenu(e){
    const has = !!canvas.getActiveObject(), grp = has && canvas.getActiveObject().type === 'group';
    this.menu(e, [
      ['copy', 'Copy', '⌘C', !has, () => run('copy')], ['paste', 'Paste', '⌘V', !clipboard, () => run('paste')], ['dup', 'Duplicate', '⌘D', !has, () => run('dup')], ['del', 'Delete', 'Del', !has, () => run('del')], null,
      ['grp', grp ? 'Ungroup' : 'Group', grp ? '⇧⌘G' : '⌘G', !has, () => run(grp ? 'ungroup' : 'group')], ['front', 'To front', '⇧PgUp', !has, () => run('front')], ['back', 'To back', '⇧PgDn', !has, () => run('toback')], null,
      ['curves', 'Convert to curves', '', !has, () => run('shape:curves')], ['center', 'Center in print area', 'P', !has, () => run('center')], null,
      ['place', 'Place inside frame…', '', !has, () => run('clip:place')], ['extract', 'Extract contents', '', !(has && canvas.getActiveObject().type === 'clipframe'), () => run('clip:extract')],
      ['empty', 'Create empty clip frame', '', !has, () => run('clip:empty')], ['focus', 'Bring into focus', '', !(has && ['group', 'clipframe'].includes(canvas.getActiveObject().type)), () => run('focus')],
      ...(Focus.stack.length ? [['out', 'Leave focus mode', '', false, () => run('focusout')]] : []),
    ]);
  },
  dropMenu(e, objs, dx, dy){
    const under = this.under(e, true)[0], src = objs[0];
    const props = o => leafs([o])[0] || o;
    const copyProps = keys => { const s = props(src); leafs([under]).forEach(l => keys.forEach(k => l.set(k, k === 'fill' && s.fill && typeof s.fill === 'object' ? new fabric.Gradient(s.fill.toObject()) : s[k]))); under.set('dirty', true); canvas.requestRenderAll(); snapshot(); refresh(); };
    const move = () => { const a = canvas.getActiveObject(); a.set({left: a.left + dx, top: a.top + dy}); a.setCoords(); canvas.fire('object:modified', {target: a}); canvas.requestRenderAll(); };
    this.menu(e, [
      ['move', 'Move Here', '', false, move],
      ['copy', 'Copy Here', '', false, async () => { const a = canvas.getActiveObject(), copies = await this.cloneAbsolute(objs, a); canvas.discardActiveObject(); copies.forEach(c => { c.set({left: c.left + dx, top: c.top + dy}); c.setCoords(); canvas.add(c); }); selectObjs(copies); }],
      null,
      ['fill', 'Copy Fill Here', '', !under, () => copyProps(['fill'])],
      ['outline', 'Copy Outline Here', '', !under, () => copyProps(['stroke', 'strokeWidth', 'strokeDashArray', 'strokeLineJoin', 'strokeLineCap'])],
      ['all', 'Copy All Properties', '', !under, () => { copyProps(['fill', 'stroke', 'strokeWidth', 'strokeDashArray', 'strokeLineJoin', 'strokeLineCap']); under.set({opacity: src.opacity, globalCompositeOperation: src.globalCompositeOperation}); canvas.requestRenderAll(); }],
      null, ['cancel', 'Cancel', '', false, () => {}],
    ]);
  },
};

/* ---------- handles ---------- */
(function(){
  const U = fabric.controlsUtils;
  const square = (ctx, left, top, styleOverride, o) => {
    const z = COARSE ? 13 : 8; ctx.save(); ctx.translate(left, top); ctx.rotate(fabric.util.degreesToRadians(o.angle || 0));
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.fillRect(-z / 2, -z / 2, z, z); ctx.strokeRect(-z / 2 + .5, -z / 2 + .5, z - 1, z - 1); ctx.restore();
  };
  const arrowHead = (ctx, x, y, ang) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, -3.5); ctx.lineTo(-6, 3.5); ctx.closePath(); ctx.fill(); ctx.restore(); };
  const halo = (ctx, draw) => { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; draw(); ctx.stroke(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; draw(); ctx.stroke(); };
  const curved = (sx, sy) => (ctx, left, top, s, o) => {      // a curved double arrow round a corner, bulging outwards
    ctx.save(); ctx.translate(left, top); ctx.rotate(fabric.util.degreesToRadians(o.angle || 0)); ctx.scale(sx, sy);
    const R = 12, path = () => { ctx.beginPath(); ctx.arc(-R * 0.6, -R * 0.6, R, Math.PI * 0.05, Math.PI * 0.45); };
    halo(ctx, path); ctx.fillStyle = '#111';
    arrowHead(ctx, -R * 0.6 + R * Math.cos(Math.PI * 0.05), -R * 0.6 + R * Math.sin(Math.PI * 0.05), -Math.PI / 2 + 0.05);
    arrowHead(ctx, -R * 0.6 + R * Math.cos(Math.PI * 0.45), -R * 0.6 + R * Math.sin(Math.PI * 0.45), Math.PI + 0.45);
    ctx.restore();
  };
  const straight = horiz => (ctx, left, top, s, o) => {      // a straight double arrow along a side
    ctx.save(); ctx.translate(left, top); ctx.rotate(fabric.util.degreesToRadians(o.angle || 0) + (horiz ? 0 : Math.PI / 2));
    halo(ctx, () => { ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); }); ctx.fillStyle = '#111';
    arrowHead(ctx, 9, 0, 0); arrowHead(ctx, -9, 0, Math.PI); ctx.restore();
  };
  const ring = (ctx, left, top) => { ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(left, top, 8, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#111'; ctx.stroke(); ctx.beginPath(); ctx.arc(left, top, 2, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); ctx.restore(); };
  const cross = (ctx, left, top) => { ctx.save(); halo(ctx, () => { ctx.beginPath(); ctx.moveTo(left - 4, top); ctx.lineTo(left + 4, top); ctx.moveTo(left, top - 4); ctx.lineTo(left, top + 4); }); ctx.restore(); };
  const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M5 12a7 7 0 1 1 3 5.7" fill="none" stroke="white" stroke-width="4"/><path d="M5 12a7 7 0 1 1 3 5.7" fill="none" stroke="black" stroke-width="2"/><path d="M2 9l3 4 3-4z"/></svg>')}") 12 12, alias`;
  const fire = U.wrapWithFireEvent;
  const C = o => new fabric.Control(o);
  const corner = (x, y) => C({x, y, cursorStyleHandler: U.scaleCursorStyleHandler, actionHandler: fire('scaling', Pick.scaleHandler()), actionName: 'scale', render: square});
  const side = (x, y, by) => C({x, y, cursorStyleHandler: U.scaleCursorStyleHandler, actionHandler: fire('scaling', Pick.scaleHandler(by)), actionName: by === 'x' ? 'scaleX' : 'scaleY', render: square});
  Pick.SCALE = {
    tl: corner(-.5, -.5), tr: corner(.5, -.5), bl: corner(-.5, .5), br: corner(.5, .5),
    ml: side(-.5, 0, 'x'), mr: side(.5, 0, 'x'), mt: side(0, -.5, 'y'), mb: side(0, .5, 'y'),
    c: C({x: 0, y: 0, cursorStyle: 'move', actionHandler: U.dragHandler, actionName: 'drag', render: cross, sizeX: 12, sizeY: 12}),
  };
  const rot = (x, y, sx, sy) => C({x, y, offsetX: x * 6, offsetY: y * 6, cursorStyle: ROT_CURSOR, actionHandler: fire('rotating', Pick.rotateHandler), actionName: 'rotate', render: curved(sx, sy), sizeX: 18, sizeY: 18});
  Pick.ROTATE = {
    tl: rot(-.5, -.5, 1, 1), tr: rot(.5, -.5, -1, 1), bl: rot(-.5, .5, 1, -1), br: rot(.5, .5, -1, -1),
    mt: C({x: 0, y: -.5, offsetY: -3, cursorStyle: 'ew-resize', actionHandler: Pick.skew(U.skewHandlerX), actionName: 'skewX', render: straight(true), sizeX: 20, sizeY: 12}),
    mb: C({x: 0, y: .5, offsetY: 3, cursorStyle: 'ew-resize', actionHandler: Pick.skew(U.skewHandlerX), actionName: 'skewX', render: straight(true), sizeX: 20, sizeY: 12}),
    ml: C({x: -.5, y: 0, offsetX: -3, cursorStyle: 'ns-resize', actionHandler: Pick.skew(U.skewHandlerY), actionName: 'skewY', render: straight(false), sizeX: 12, sizeY: 20}),
    mr: C({x: .5, y: 0, offsetX: 3, cursorStyle: 'ns-resize', actionHandler: Pick.skew(U.skewHandlerY), actionName: 'skewY', render: straight(false), sizeX: 12, sizeY: 20}),
    pivot: C({cursorStyle: 'move', actionHandler: Pick.pivotHandler, actionName: 'pivot', render: ring, sizeX: 18, sizeY: 18,
              positionHandler: (dim, m, o) => fabric.util.transformPoint({x: (o.pivotU || 0) * dim.x, y: (o.pivotV || 0) * dim.y}, m)}),
  };
  fabric.Object.prototype.controls = Pick.SCALE;
  fabric.Object.prototype.set({hasBorders: false, padding: COARSE ? 10 : 7, cornerSize: 12, touchCornerSize: 34, transparentCorners: false});
  Object.assign(canvas, {centeredKey: 'shiftKey', uniScaleKey: null, altActionKey: null, selectionFullyContained: true});
})();

/* ---------- events ---------- */
let pickDown = null;
canvas.on('mouse:down:before', o => {
  pickDown = tool === 'pick' ? {prev: canvas.getActiveObject(), prevSel: actives().slice(), e: o.e} : null;
  Pick.targets = null;
  if (tool === 'pick') canvas.selectionFullyContained = true;
});
canvas.on('mouse:down', o => {
  if (tool !== 'pick' || o.button === 3 || !pickDown) return;
  const e = o.e;
  // Alt+click digs to the object beneath the selected one
  if (e.altKey && !o.transform?.corner){
    const list = Pick.under(e), prev = pickDown.prev;
    if (list.length){
      const i = prev ? list.indexOf(prev) : -1, next = list[(i + 1) % list.length];
      canvas._currentTransform = null; canvas.setActiveObject(next); canvas.requestRenderAll();
    }
    pickDown.dug = true;
  }
});
canvas.on('mouse:up:before', o => { if (tool === 'pick') canvas.selectionFullyContained = !(o.e && o.e.altKey); });
canvas.on('mouse:up', o => {
  const was = pickDown; pickDown = null;
  Pick.clearGuides(); Pick.targets = null;
  if (tool !== 'pick' || !was || was.dug || o.button === 3 || (typeof Touch !== 'undefined' && Touch.suppressClick)) return;
  const a = canvas.getActiveObject(), tr = o.transform;
  // a click (no drag) on the selection, or on its centre mark, toggles the rotate/skew handles
  if (o.isClick && a && was.prev === a && (!tr || !tr.corner || tr.corner === 'c') && (o.target === a || (a.type === 'activeSelection' && a.contains(o.target)) || (tr && tr.corner === 'c'))){
    Pick.setMode(a, !a.rotateMode);
  }
});
canvas.on('mouse:dblclick', o => {
  const a = canvas.getActiveObject();
  if (tool !== 'pick' || !a) return;
  if (a.rotateMode && a.__corner === 'pivot'){ a.pivotU = a.pivotV = 0; a.setCoords(); canvas.requestRenderAll(); toast('Centre of rotation back in the middle'); return; }
  if (a.type === 'path') setTool('shape');
});
['selection:created', 'selection:updated'].forEach(ev => canvas.on(ev, e => { (e.deselected || []).forEach(o => o.rotateMode && Pick.setMode(o, false)); }));
canvas.on('selection:cleared', e => (e.deselected || []).forEach(o => o.rotateMode && Pick.setMode(o, false)));
canvas.on('object:moving', e => { Pick.onMoving(e); syncBars(); });
canvas.on('object:modified', e => {
  const tr = e.transform;
  if (tr && tr.copyMode){
    // right click during the drag: the original goes back, a copy takes the change
    const t = e.target, objs = Pick.movingObjs(t);
    Pick.cloneAbsolute(objs, t).then(copies => {
      Pick.restore(t, tr.original);
      if (t.type === 'activeSelection') t.forEachObject(o => o.setCoords());
      canvas.discardActiveObject();
      restoring = true; copies.forEach(c => canvas.add(c)); restoring = false;
      selectObjs(copies); snapshot(); refresh(); toast('Copy made — the original stayed');
    });
  }
  Pick.clearGuides();
});
canvas.on('after:render', e => { if (e && e.ctx === canvas.contextContainer) Pick.draw(e.ctx); });

// Space drops a copy, right click switches to "leave the original", Esc cancels — all while a transform runs
document.addEventListener('keydown', e => {
  const tr = canvas._currentTransform;
  if (!tr || tool !== 'pick') return;
  if (e.key === ' '){ e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) Pick.dropCopy(tr.target); }
  if (e.key === 'Escape'){
    e.preventDefault(); e.stopImmediatePropagation();
    Pick.restore(tr.target, tr.original); canvas._currentTransform = null; Pick.clearGuides(); canvas.requestRenderAll(); syncBars(); toast('Cancelled');
  }
}, true);
canvas.upperCanvasEl.addEventListener('mousedown', e => {
  if (e.button !== 2 || tool !== 'pick') return;
  const tr = canvas._currentTransform;
  if (tr){ tr.copyMode = !tr.copyMode; $('stSel').innerHTML = tr.copyMode ? '<b>Leave original</b> — a copy takes the change (right-click again to undo that)' : 'Moving the original'; return; }
  // right-button drag on an object: preview, then a menu on release
  const t = Pick.under(e)[0];
  if (!t){ Pick.rdrag = {menuOnly: true, x: e.clientX, y: e.clientY}; return; }
  if (!actives().includes(t)){ canvas.setActiveObject(t); canvas.requestRenderAll(); }
  Pick.rdrag = {x: e.clientX, y: e.clientY, p: canvas.getPointer(e), objs: actives().slice(), moved: false};
});
document.addEventListener('mousemove', e => {
  const R = Pick.rdrag; if (!R || R.menuOnly) return;
  if (Math.hypot(e.clientX - R.x, e.clientY - R.y) > 3) R.moved = true;
  if (!R.moved) return;
  const p = canvas.getPointer(e); let dx = p.x - R.p.x, dy = p.y - R.p.y;
  if (e.ctrlKey || e.metaKey){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  Pick.ghost = {objs: canvas.getActiveObject() && canvas.getActiveObject().type === 'activeSelection' ? [canvas.getActiveObject()] : R.objs, dx, dy};
  canvas.requestRenderAll();
});
document.addEventListener('mouseup', e => {
  const R = Pick.rdrag; if (!R || e.button !== 2) return;
  Pick.rdrag = null; const g = Pick.ghost; Pick.ghost = null; canvas.requestRenderAll();
  if (R.menuOnly || !R.moved) return Pick.contextMenu(e);
  Pick.dropMenu(e, R.objs, g ? g.dx : 0, g ? g.dy : 0);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Pick.rdrag){ Pick.rdrag = null; Pick.ghost = null; canvas.requestRenderAll(); } }, true);
document.addEventListener('mousedown', e => { if (Pick.menuEl && e !== Pick.menuEvent && !e.target.closest('.ctxmenu')) Pick.closeMenu(); });
