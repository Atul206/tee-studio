/* ===================== shaping (Weld / Trim / Intersect …) =====================
   Fabric objects are exported to SVG, imported into paper.js (which does the boolean maths on real curves),
   and the result comes back as a fabric.Path in the same scene coordinates.
   CorelDRAW rules: the bottom-most selected object is the "target" — results take its fill, outline and effects. */

const Shaping = {
  ready: false,
  init(){ if (!this.ready){ paper.setup(document.createElement('canvas')); this.ready = true; } },

  // fabric object (absolute, not inside an ActiveSelection) -> one paper PathItem in scene coordinates.
  // Text (also inside groups) is turned into its letter outlines first.
  toItem(o){
    // a live envelope or distortion: shape the outline as it is drawn
    if (typeof Effects !== 'undefined' && Effects.warps(o)){
      const fx = Effects.compute(o);
      if (fx && fx.geomD){ const it = new paper.CompoundPath({pathData: fx.geomD, insert: false}); it.transform(new paper.Matrix(...o.calcTransformMatrix())); return it; }
    }
    const leaves = leafs([o]);
    if (!leaves.some(l => l.text != null)) return this.svgItem(o);
    const items = leaves.map(l => l.text != null ? TextCurves.item(l) : this.svgItem(l)).filter(Boolean);
    return items.length ? this.union(items) : null;
  },
  svgItem(o){
    const g0 = o.group ? `<g transform="matrix(${o.group.calcTransformMatrix().join(' ')})">` : '', g1 = o.group ? '</g>' : '';
    const g = paper.project.importSVG(`<svg xmlns="http://www.w3.org/2000/svg">${g0}${o.toSVG()}${g1}</svg>`, {expandShapes: true, insert: false});
    const parts = [];
    (function walk(it){
      if (it instanceof paper.CompoundPath || it instanceof paper.Path) parts.push(it);
      else if (it.children) it.children.forEach(walk);
    })(g);
    if (!parts.length) return null;
    parts.forEach(p => { p.closed = true; });
    return parts.reduce((a, b) => a.unite(b, {insert: false}));
  },
  union(items){ return items.reduce((a, b) => a.unite(b, {insert: false})); },
  empty(it){ return !it || it.isEmpty() || Math.abs(it.area) < 1e-3; },

  styleOf(o){
    const leaf = o.type === 'group' ? (leafs([o]).find(l => l.fill) || leafs([o])[0]) : o;
    const fill = leaf.fill && typeof leaf.fill === 'object' ? new fabric.Gradient(leaf.fill.toObject()) : (leaf.fill || '#000000');
    return {
      fill, stroke: leaf.stroke, strokeWidth: leaf.strokeWidth || 0, strokeUniform: true,
      strokeDashArray: leaf.strokeDashArray, strokeLineJoin: leaf.strokeLineJoin || 'miter',
      opacity: o.opacity ?? 1, globalCompositeOperation: o.globalCompositeOperation || 'source-over',
      shadow: o.shadow ? new fabric.Shadow(o.shadow) : null, fillRule: 'evenodd', paintFirst: leaf.paintFirst || 'fill',
    };
  },
  toFabric(item, styleFrom, name){
    if (this.empty(item)) return null;
    return new fabric.Path(item.pathData, Object.assign(this.styleOf(styleFrom), {name}));
  },

  unsupported(o){ return o.type === 'clipframe' || leafs([o]).some(l => l.type === 'image' || l.type === 'line'); },
  hasText(objs){ return leafs(objs).some(l => l.text != null); },
  ordered(objs){ const all = canvas.getObjects(); return objs.slice().sort((a, b) => all.indexOf(a) - all.indexOf(b)); },
  replace(oldObj, newObj){ const i = canvas.getObjects().indexOf(oldObj); canvas.remove(oldObj); if (newObj) canvas.insertAt(newObj, i); },

  async run(op){
    const NEEDS_TWO = ['weld', 'trim', 'intersect', 'simplify', 'fmb', 'bmf', 'combine'];
    const LABEL = {weld:'Weld', trim:'Trim', intersect:'Intersect', simplify:'Simplify', fmb:'Front minus back', bmf:'Back minus front', combine:'Combine', breakapart:'Break apart', curves:'Convert to curves'};
    const sel = this.ordered(actives());
    if (NEEDS_TWO.includes(op) && sel.length < 2) return toast(`${LABEL[op]}: select two or more shapes (Shift-click or drag a box)`);
    if (!sel.length) return toast(`${LABEL[op]}: select a shape first`);
    const bad = sel.filter(o => this.unsupported(o));
    if (bad.length) return toast(`${LABEL[op]} works on shapes and text — images and straight lines can’t be shaped (${bad.map(nameOf).slice(0, 2).join(', ')})`);
    if (this.hasText(sel)){
      toast('Loading letter outlines…');
      try { await TextCurves.ready(); } catch (e){ return toast(e.message); }
      // the drawing may have changed while the outlines loaded
      if (sel.some(o => !canvas.getObjects().includes(o))) return toast(`${LABEL[op]} cancelled — the selection changed`);
    }
    this.init();
    canvas.discardActiveObject();
    restoring = true;          // one undo step for the whole operation
    let result = [], msg = null;
    try {
      const items = sel.map(o => this.toItem(o));
      const bottom = sel[0], top = sel[sel.length - 1];
      switch (op){
        case 'weld': {
          const r = this.toFabric(this.union(items), bottom, 'Welded shape');
          canvas.insertAt(r, canvas.getObjects().indexOf(bottom));
          sel.forEach(o => canvas.remove(o)); result = [r]; break;
        }
        case 'trim': {   // bottom object is cut by everything above it; the cutters stay
          const r = this.toFabric(items[0].subtract(this.union(items.slice(1)), {insert: false}), bottom, nameOf(bottom));
          if (!r){ msg = 'Trim removed the whole shape — nothing left'; }
          this.replace(bottom, r); result = r ? [r] : []; break;
        }
        case 'intersect': {   // new shape from the overlap, originals stay
          const it = items.slice(1).reduce((a, b) => a.intersect(b, {insert: false}), items[0]);
          const r = this.toFabric(it, bottom, 'Intersection');
          if (!r){ msg = 'These shapes don’t overlap — nothing to intersect'; break; }
          canvas.insertAt(r, canvas.getObjects().indexOf(top) + 1); result = [r]; break;
        }
        case 'simplify': {   // every shape loses the parts hidden behind the shapes above it
          sel.forEach((o, i) => {
            if (i === sel.length - 1){ result.push(o); return; }
            const r = this.toFabric(items[i].subtract(this.union(items.slice(i + 1)), {insert: false}), o, nameOf(o));
            this.replace(o, r); if (r) result.push(r);
          });
          break;
        }
        case 'fmb': case 'bmf': {
          const keep = op === 'fmb' ? sel.length - 1 : 0;
          const rest = items.filter((_, i) => i !== keep);
          const r = this.toFabric(items[keep].subtract(this.union(rest), {insert: false}), sel[keep], nameOf(sel[keep]));
          if (!r) msg = 'Nothing is left after subtracting';
          sel.forEach((o, i) => { if (i !== keep) canvas.remove(o); });
          this.replace(sel[keep], r); result = r ? [r] : []; break;
        }
        case 'combine': {   // one object, no boolean — overlaps become holes (even-odd)
          const kids = [];
          items.forEach(it => (it instanceof paper.CompoundPath ? it.children.slice() : [it]).forEach(c => kids.push(c.clone({insert: false}))));
          const r = this.toFabric(new paper.CompoundPath({children: kids, insert: false}), bottom, 'Combined');
          canvas.insertAt(r, canvas.getObjects().indexOf(bottom));
          sel.forEach(o => canvas.remove(o)); result = [r]; break;
        }
        case 'breakapart': {
          sel.forEach((o, i) => {
            const it = items[i], subs = it instanceof paper.CompoundPath ? it.children.slice() : [it];
            if (subs.length < 2){ result.push(o); return; }
            let at = canvas.getObjects().indexOf(o); canvas.remove(o);
            subs.forEach((s, k) => { const r = this.toFabric(s.clone({insert: false}), o, `${nameOf(o)} ${k + 1}`); if (r){ canvas.insertAt(r, at++); result.push(r); } });
          });
          if (result.length === sel.length) msg = 'Nothing to break apart — each shape is already a single piece';
          break;
        }
        case 'curves': {
          sel.forEach((o, i) => {
            const warped = Effects.warps(o);
            if (o.type === 'path' && !warped){ result.push(o); return; }
            // text keeps every letter as its own sub-path (not welded), like CorelDRAW's Convert to Curves;
            // an envelope or distortion becomes the curve's own shape, other effects stay live on it
            const it = o.text != null && !warped ? TextCurves.item(o) : items[i];
            const r = this.toFabric(it, o, nameOf(o));
            if (r && o.text != null) r.set('fillRule', 'nonzero');
            if (r && o.fx){ const fx = Object.assign({}, o.fx); delete fx.envelope; delete fx.distort; if (Object.keys(fx).length){ r.fx = fx; r.objectCaching = false; } }
            this.replace(o, r); if (r) result.push(r);
          });
          break;
        }
      }
    } catch (err){
      console.error(err); msg = `${LABEL[op]} failed: ${err.message}`;
    } finally {
      paper.project.clear();
      restoring = false;
    }
    if (result.length) selectObjs(result);
    canvas.requestRenderAll(); snapshot(); refresh();
    toast(msg || `${LABEL[op]} done`);
  },
};
