/* ===================== text → curves & text on a curve =====================
   Text to curves replays Fabric's own text rendering into a recording context. Every fillText / fillRect
   call is captured with its exact transform, then each string is rebuilt from the real font outlines
   (opentype.js) — so spacing, alignment, multi-line, underline and text-on-a-path all match the screen. */

const TextCurves = {
  fonts: {}, loading: null,

  // the outline fonts (~4 MB) load only the first time they are needed
  ready(){
    if (window.TEE_FONT_TTF) return Promise.resolve();
    if (!this.loading) this.loading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'fonts/outlines.js';
      s.onload = res; s.onerror = () => { this.loading = null; rej(new Error('fonts/outlines.js is missing')); };
      document.head.appendChild(s);
    });
    return this.loading;
  },
  font(family, weight){
    const want = (+weight || (weight === 'bold' ? 700 : 400)) >= 600 ? 700 : 400;
    const key = [`${family}|${want}`, `${family}|400`].find(k => window.TEE_FONT_TTF[k]);
    if (!key) return null;
    if (!this.fonts[key]){
      const bin = atob(window.TEE_FONT_TTF[key]), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      this.fonts[key] = {font: opentype.parse(buf.buffer), fakeBold: want === 700 && !key.endsWith('|700')};
    }
    return this.fonts[key];
  },

  // a stand-in CanvasRenderingContext2D that records what Fabric draws
  recorder(){
    const M = fabric.util.multiplyTransformMatrices;
    const st = {m: [1, 0, 0, 1, 0, 0], stack: [], calls: []};
    const props = {font: '10px sans-serif', textAlign: 'left', direction: 'ltr', canvas: {getAttribute: () => 'ltr', setAttribute(){}}};
    const api = {
      save(){ st.stack.push([st.m.slice(), props.font]); },
      restore(){ const s = st.stack.pop(); if (s){ st.m = s[0]; props.font = s[1]; } },
      translate(x, y){ st.m = M(st.m, [1, 0, 0, 1, x, y]); },
      scale(x, y){ st.m = M(st.m, [x, 0, 0, y, 0, 0]); },
      rotate(a){ const c = Math.cos(a), s = Math.sin(a); st.m = M(st.m, [c, s, -s, c, 0, 0]); },
      transform(a, b, c, d, e, f){ st.m = M(st.m, [a, b, c, d, e, f]); },
      setTransform(a, b, c, d, e, f){ st.m = [a, b, c, d, e, f]; },
      fillText(t, x, y){ st.calls.push({kind: 'fill', text: t, x, y, m: st.m.slice(), font: props.font}); },
      strokeText(t, x, y){ st.calls.push({kind: 'stroke', text: t, x, y, m: st.m.slice(), font: props.font}); },
      fillRect(x, y, w, h){ st.calls.push({kind: 'rect', x, y, w, h, m: st.m.slice()}); },
      measureText: () => ({width: 0}),
      createLinearGradient: () => ({addColorStop(){}}), createRadialGradient: () => ({addColorStop(){}}), createPattern: () => ({}),
    };
    const ctx = new Proxy(props, {
      get: (o, k) => k in api ? api[k] : k in o ? o[k] : () => {},
      set: (o, k, v) => { o[k] = v; return true; },
    });
    return {ctx, st};
  },
  parseFont(decl){
    // Fabric writes "<style> <weight> <size>px <family>"
    const m = decl.match(/^(\S+)\s+(\S+)\s+([\d.]+)px\s+(.+)$/);
    if (!m) return null;
    return {style: m[1], weight: m[2], size: +m[3], family: m[4].split(',')[0].replace(/["']/g, '').trim()};
  },

  // text object -> paper.CompoundPath in scene coordinates (needs paper.setup and ready())
  item(t){
    const {ctx, st} = this.recorder();
    const path = t.path; if (path) path.visible = false;
    // Fabric measures letters lazily (text on a path is placed while measuring) — make sure it has
    t._textLines.forEach((_, i) => t.getLineWidth(i));
    t._render(ctx);
    const fills = st.calls.filter(c => c.kind === 'fill'), texts = fills.length ? fills : st.calls.filter(c => c.kind === 'stroke');
    const parts = [];
    const outer = t.calcTransformMatrix();
    const missing = new Set();
    texts.forEach(c => {
      const f = this.parseFont(c.font), face = f && this.font(f.family, f.weight);
      if (!face){ missing.add(f ? f.family : c.font); return; }
      const d = face.font.getPath(c.text, c.x, c.y, f.size, {kerning: true}).toPathData(3);
      if (!d) return;
      const p = new paper.CompoundPath({pathData: d, insert: false});
      if (f.style === 'italic' || f.style === 'oblique') p.transform(new paper.Matrix(1, 0, -0.2, 1, 0.2 * c.y, 0));   // browser-style slant
      if (face.fakeBold && p.children.length) { /* weight not embedded: outlines use the regular face */ }
      p.transform(new paper.Matrix(...fabric.util.multiplyTransformMatrices(outer, c.m)));
      parts.push(p);
    });
    st.calls.filter(c => c.kind === 'rect').forEach(c => {
      const r = new paper.Path.Rectangle({point: [c.x, c.y], size: [c.w, c.h], insert: false});
      r.transform(new paper.Matrix(...fabric.util.multiplyTransformMatrices(outer, c.m)));
      parts.push(r);
    });
    if (missing.size) throw new Error(`no outlines for font ${[...missing].join(', ')}`);
    if (!parts.length) return null;
    const kids = [];
    parts.forEach(p => (p instanceof paper.CompoundPath ? p.children.slice() : [p]).forEach(k => kids.push(k.clone({insert: false}))));
    return new paper.CompoundPath({children: kids, fillRule: 'nonzero', insert: false});
  },

  /* ---------- text on a curve ---------- */
  // bend: -100..100 (% of a full circle). Positive arches up, negative smiles.
  applyCurve(t, bend){
    bend = Math.max(-100, Math.min(100, Math.round(+bend || 0)));
    const c = t.getCenterPoint();
    if (!bend){
      t.set({path: null, curve: 0, fitD: null, pathPlace: null, fitAnchor: null}); t.initDimensions(); t.setPositionByOrigin(c, 'center', 'center'); t.setCoords();
      return true;
    }
    if (t.text.includes('\n')){ toast('Curved text works on a single line — remove the line breaks first'); return false; }
    t.set({path: null}); t.initDimensions();
    const L = Math.max(t.calcTextWidth(), 1);
    const theta = Math.abs(bend) / 100 * Math.PI * 2 * 0.9, r = L / theta, s = Math.sign(bend);
    // the arc runs a little past both ends of the text so rounding never wraps a letter round to the other end
    const half = theta / 2 + Math.min(theta * 0.05, (Math.PI - theta / 2) * 0.5);
    const x0 = -r * Math.sin(half), y0 = s * r * (1 - Math.cos(half));
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${half * 2 > Math.PI ? 1 : 0} ${s > 0 ? 1 : 0} ${-x0} ${y0}`;
    t.set({path: new fabric.Path(d, {visible: false, fill: '', stroke: '', strokeWidth: 0}), pathSide: 'left', pathStartOffset: 0, pathAlign: 'baseline', curve: bend, textAlign: 'center', fitD: null, pathPlace: null, fitAnchor: null});
    t.initDimensions(); t.setPositionByOrigin(c, 'center', 'center'); t.setCoords();
    return true;
  },
  // TraceDraw / CorelDRAW "Fit text to path": the text follows the outline of another shape.
  // Closed paths are followed clockwise so letters stand outside; "top"/"bottom" centre the text on the
  // path's highest point (outside, upright) or lowest point (inside, reading left to right).
  async fitToPath(){
    const sel = actives();
    const text = sel.find(o => o.text != null), shape = sel.find(o => o.text == null);
    if (sel.length !== 2 || !text || !shape) return toast('Fit text to path: select one text and one shape or line (Shift-click both)');
    if (shape.type === 'image' || shape.type === 'group') return toast('Pick a single shape, line or path for the text to follow');
    if (text.text.includes('\n')) return toast('Text on a path works on a single line — remove the line breaks first');
    canvas.discardActiveObject();
    Shaping.init();
    let d, closed;
    try {
      if (shape.type === 'line'){
        const p = shape.calcLinePoints(), m = shape.calcTransformMatrix();
        const a = fabric.util.transformPoint(new fabric.Point(p.x1, p.y1), m), b = fabric.util.transformPoint(new fabric.Point(p.x2, p.y2), m);
        d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`; closed = false;
      } else {
        const it = Shaping.svgItem(shape), first = it instanceof paper.CompoundPath ? it.children[0] : it;
        closed = ['polyline', 'path'].includes(shape.type) ? first.closed && !!shape.fill : true;
        if (!closed) first.closed = false;
        if (closed && !first.clockwise) first.reverse();
        d = first.pathData;
      }
    } catch (e){ paper.project.clear(); return toast('Could not read that shape: ' + e.message); }
    paper.project.clear();
    text.set({angle: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false, curve: 0, pathUserOffset: 0, pathSide: 'left', pathAlign: 'baseline'});
    this.fit(text, d, closed ? 'top' : 'start', true);
    selectObjs([text]); canvas.requestRenderAll(); snapshot(); refresh();
    toast('Text fitted to the path — change placement, offset or side on the bar above');
  },
  // lays `t` on path `d` (scene coordinates, clockwise when closed). place: start | center | end | top | bottom
  fit(t, d, place, absolute){
    const c0 = t.getCenterPoint();   // before any re-measuring moves it
    const closed = /z\s*$/i.test(d.trim());
    if (!closed && (place === 'top' || place === 'bottom')) place = 'start';
    // the text's width when straight
    const keepPath = t.path; t.set({path: null}); t.initDimensions();
    const w = t.calcTextWidth(); t.set({path: keepPath});
    let pd = d, align = 'left', base = 0;
    if (place === 'center') align = 'center';
    if (place === 'end') align = 'right';
    if (place === 'top' || place === 'bottom'){
      Shaping.init();
      const it = new paper.Path({pathData: d, insert: false});
      if (place === 'bottom') it.reverse();
      const b = it.bounds, loc = it.getNearestLocation(new paper.Point(b.center.x, place === 'top' ? b.top : b.bottom));
      pd = it.pathData; base = loc.offset - w / 2;
      paper.project.clear();
    }
    const fp = new fabric.Path(pd, {visible: false, fill: '', stroke: '', strokeWidth: 0});
    const segs = fabric.util.getPathSegmentsInfo(fp.path), start = fabric.util.getPointOnPath(fp.path, 0, segs);
    // Fabric draws path text relative to (first point + pathOffset) of the path, from the text's centre
    const anchor = new fabric.Point(start.x + fp.pathOffset.x, start.y + fp.pathOffset.y);
    const before = t.fitAnchor ? new fabric.Point(t.fitAnchor.x, t.fitAnchor.y) : null;
    t.set({path: fp, textAlign: align, pathStartOffset: base + (t.pathUserOffset || 0), fitD: d, pathPlace: place, fitAnchor: {x: anchor.x, y: anchor.y}});
    t.initDimensions();
    if (absolute || !before) t.setPositionByOrigin(anchor, 'center', 'center');
    else {
      // keep the text where the user put it: shift only by how far the path's anchor moved, in the text's own frame
      const m = t.calcTransformMatrix().slice(); m[4] = m[5] = 0;   // copy: Fabric caches this array
      const shift = fabric.util.transformPoint(anchor.subtract(before), m);
      t.setPositionByOrigin(c0.add(shift), 'center', 'center');
    }
    t.setCoords();
  },
  straighten(t){
    const c = t.getCenterPoint();
    t.set({path: null, curve: 0, fitD: null, pathPlace: null, fitAnchor: null, pathUserOffset: 0, pathStartOffset: 0, pathSide: 'left'});
    t.initDimensions(); t.setPositionByOrigin(c, 'center', 'center'); t.setCoords();
  },
  // keeps a curved text's arc length in step with its content (called after edits)
  refit(t){ if (!t) return; if (t.curve) this.applyCurve(t, t.curve); else if (t.fitD) this.fit(t, t.fitD, t.pathPlace || 'start'); },
};
