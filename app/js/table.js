/* ===================== Table =====================
   A table is one object (fabric.Table): column widths, row heights and cells, drawn from its centre.
   Behaviour follows TraceDraw's docs/behavior/table.md. Scaling with the Pick tool is folded into the column
   widths and row heights, so text and borders keep their size. */

fabric.Table = fabric.util.createClass(fabric.Object, {
  type: 'table', objectCaching: false, strokeWidth: 0, fill: '',
  tableProps: ['colW', 'rowH', 'cells', 'cellFill', 'borderW', 'borderColor', 'borderStyle', 'margin', 'fontFamily', 'fontSize', 'textColor'],
  initialize(o){
    this.callSuper('initialize', o);
    this.borderW = this.borderW == null ? 0.5 : this.borderW;
    this.borderColor = this.borderColor || '#111111'; this.borderStyle = this.borderStyle || 'solid';
    this.margin = this.margin == null ? MM : this.margin; this.fontFamily = this.fontFamily || 'Inter';
    this.fontSize = this.fontSize || 12 * PX_PER_IN / 72; this.textColor = this.textColor || '#111111';
    this.cells = this.cells || this.colW && this.rowH.map(() => this.colW.map(() => ({t: ''})));
    this.fit();
  },
  fit(){ this.width = this.colW.reduce((a, b) => a + b, 0); this.height = this.rowH.reduce((a, b) => a + b, 0); },
  // keeps the top-left corner where it is while the table changes size
  reshape(fn){ const tl = this.getPointByOrigin('left', 'top'); fn(); this.fit(); this.setPositionByOrigin(tl, 'left', 'top'); this.setCoords(); this.dirty = true; },
  toObject(extra){ return JSON.parse(JSON.stringify(this.callSuper('toObject', this.tableProps.concat(extra || [])))); },
  x(c){ let v = 0; for (let i = 0; i < c; i++) v += this.colW[i]; return v; },
  y(r){ let v = 0; for (let i = 0; i < r; i++) v += this.rowH[i]; return v; },
  // cell box in table space (0,0 = top left), merged cells whole
  box(r, c){
    const cell = this.cells[r][c], rs = cell.rs || 1, cs = cell.cs || 1;
    return {x: this.x(c), y: this.y(r), w: this.x(c + cs) - this.x(c), h: this.y(r + rs) - this.y(r)};
  },
  head(r, c){ const by = this.cells[r][c].by; return by ? by : [r, c]; },
  lines(text, width, ctx){
    const out = [];
    String(text).split('\n').forEach(par => {
      let line = '';
      par.split(' ').forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (line && ctx.measureText(t).width > width){ out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  },
  font(cell){ return `${(cell && cell.size) || this.fontSize}px "${this.fontFamily}", sans-serif`; },
  dash(){ const w = Math.max(this.borderW, 0.3); return this.borderStyle === 'dashed' ? [w * 4, w * 3] : this.borderStyle === 'dotted' ? [w, w * 2] : []; },
  // the border lines, leaving out the ones inside merged cells: [[x0, y0, x1, y1]]
  rules(){
    const R = this.rowH.length, C = this.colW.length, out = [];
    for (let r = 0; r <= R; r++){ for (let c = 0; c < C; c++){ if (r > 0 && r < R && this.cells[r][c].by && this.head(r, c)[0] < r) continue; out.push([this.x(c), this.y(r), this.x(c + 1), this.y(r)]); } }
    for (let c = 0; c <= C; c++){ for (let r = 0; r < R; r++){ if (c > 0 && c < C && this.cells[r][c].by && this.head(r, c)[1] < c) continue; out.push([this.x(c), this.y(r), this.x(c), this.y(r + 1)]); } }
    return out;
  },
  _render(ctx){
    const W = this.width, H = this.height;
    ctx.save(); ctx.translate(-W / 2, -H / 2);
    this.eachCell((r, c, cell, b) => {
      const fill = cell.fill || this.cellFill;
      if (fill){ ctx.fillStyle = fill; ctx.fillRect(b.x, b.y, b.w, b.h); }
    });
    if (this.borderW > 0){
      ctx.strokeStyle = this.borderColor; ctx.lineWidth = this.borderW; ctx.setLineDash(this.dash()); ctx.lineCap = 'butt'; ctx.beginPath();
      this.rules().forEach(l => { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.textBaseline = 'alphabetic';
    this.eachCell((r, c, cell, b) => {
      if (!cell.t) return;
      const m = this.margin, sz = cell.size || this.fontSize;
      ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      ctx.font = this.font(cell); ctx.fillStyle = cell.color || this.textColor;
      this.lines(cell.t, b.w - 2 * m, ctx).forEach((l, i) => ctx.fillText(l, b.x + m, b.y + m + sz * (i + 0.9) * 1.15));
      ctx.restore();
    });
    ctx.restore();
  },
  eachCell(fn){ this.cells.forEach((row, r) => row.forEach((cell, c) => { if (!cell.by) fn(r, c, cell, this.box(r, c)); })); },
  _toSVG(){
    const W = this.width, H = this.height, E = fabric.util.string.escapeXml, out = [`<g transform="translate(${-W / 2} ${-H / 2})">\n`];
    const ctx = fabric.Table.mctx || (fabric.Table.mctx = document.createElement('canvas').getContext('2d'));
    this.eachCell((r, c, cell, b) => { const fill = cell.fill || this.cellFill; if (fill) out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}"/>\n`); });
    if (this.borderW > 0){ const d = this.rules().map(l => `M${l[0]} ${l[1]}L${l[2]} ${l[3]}`).join(''); out.push(`<path d="${d}" fill="none" stroke="${this.borderColor}" stroke-width="${this.borderW}"${this.borderStyle !== 'solid' ? ` stroke-dasharray="${this.dash().join(' ')}"` : ''}/>\n`); }
    this.eachCell((r, c, cell, b) => {
      if (!cell.t) return;
      const sz = cell.size || this.fontSize; ctx.font = this.font(cell);
      this.lines(cell.t, b.w - 2 * this.margin, ctx).forEach((l, i) => out.push(`<text x="${b.x + this.margin}" y="${b.y + this.margin + sz * (i + 0.9) * 1.15}" font-family="${E(this.fontFamily)}" font-size="${sz}" fill="${cell.color || this.textColor}">${E(l)}</text>\n`));
    });
    out.push('</g>\n');
    return out;
  },
  setCounts(rows, cols){
    this.reshape(() => {
      rows = Math.max(1, Math.min(200, rows)); cols = Math.max(1, Math.min(200, cols));
      this.unmergeAll();
      while (this.rowH.length < rows){ this.rowH.push(this.rowH[this.rowH.length - 1]); this.cells.push(this.colW.map(() => ({t: ''}))); }
      this.rowH.length = rows; this.cells.length = rows;
      while (this.colW.length < cols){ this.colW.push(this.colW[this.colW.length - 1]); this.cells.forEach(r => r.push({t: ''})); }
      this.colW.length = cols; this.cells.forEach(r => { r.length = cols; });
    });
  },
  unmergeAll(){ this.cells.forEach(row => row.forEach(c => { delete c.rs; delete c.cs; delete c.by; })); },
  merge(r0, c0, r1, c1){
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){ const cell = this.cells[r][c]; if (r === r0 && c === c0) continue; if (cell.t) this.cells[r0][c0].t = (this.cells[r0][c0].t ? this.cells[r0][c0].t + ' ' : '') + cell.t; this.cells[r][c] = {t: '', by: [r0, c0]}; }
    Object.assign(this.cells[r0][c0], {rs: r1 - r0 + 1, cs: c1 - c0 + 1}); this.dirty = true;
  },
  split(r0, c0){
    const h = this.cells[r0][c0], rs = h.rs || 1, cs = h.cs || 1;
    for (let r = r0; r < r0 + rs; r++) for (let c = c0; c < c0 + cs; c++) if (r !== r0 || c !== c0) this.cells[r][c] = {t: ''};
    delete h.rs; delete h.cs; this.dirty = true;
  },
});
fabric.Table.fromObject = (o, cb) => cb(new fabric.Table(JSON.parse(JSON.stringify(o))));

/* scaling with the Pick tool becomes real sizes */
canvas.on('object:modified', e => {
  const t = e.target; if (!t || t.type !== 'table' || (t.scaleX === 1 && t.scaleY === 1)) return;
  const c = t.getCenterPoint(), sx = t.scaleX, sy = t.scaleY;
  t.colW = t.colW.map(v => v * sx); t.rowH = t.rowH.map(v => v * sy); t.set({scaleX: 1, scaleY: 1}); t.fit();
  t.setPositionByOrigin(c, 'center', 'center'); t.setCoords(); canvas.requestRenderAll();
});

const TableBar = {
  controls(t, opts){
    const on = () => {};
    return [
      {type: 'num', key: 'rows', label: 'Rows', min: 1, max: 200, digits: 0}, {type: 'num', key: 'cols', label: 'Columns', min: 1, max: 200, digits: 0},
      {type: 'chk', key: 'fillOn', label: 'Cell fill'}, {type: 'color', key: 'cellFill'},
      {type: 'num', key: 'borderW', label: 'Border', min: 0, step: 0.1, title: 'Border width', digits: 2}, {type: 'color', key: 'borderColor'},
      {type: 'sel', key: 'borderStyle', title: 'Border style', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]},
      {type: 'sel', key: 'fontFamily', title: 'Font', options: FONTS.map(f => [f, f])}, {type: 'num', key: 'sizePt', label: 'Size', min: 2, digits: 1, title: 'Text size (pt)'}, {type: 'color', key: 'textColor'},
    ];
  },
  load(t, O){
    Object.assign(O, {rows: t.rowH.length, cols: t.colW.length, fillOn: !!t.cellFill, cellFill: t.cellFill || O.cellFill || '#ffffff', borderW: t.borderW, borderColor: t.borderColor, borderStyle: t.borderStyle, fontFamily: t.fontFamily, sizePt: t.fontSize * 72 / PX_PER_IN, textColor: t.textColor});
  },
  // a change from the bar: the selected cells when some are selected (fill), else the table
  apply(t, key, O, cells){
    if (key === 'rows' || key === 'cols') t.setCounts(Math.round(O.rows), Math.round(O.cols));
    else if (key === 'fillOn' || key === 'cellFill'){
      const v = O.fillOn || key === 'cellFill' ? O.cellFill : null;
      if (key === 'cellFill') O.fillOn = true;
      if (cells && cells.length) cells.forEach(([r, c]) => { const cl = t.cells[r][c]; if (v) cl.fill = v; else delete cl.fill; });
      else { t.cellFill = v; t.cells.forEach(row => row.forEach(cl => delete cl.fill)); }
    }
    else if (key === 'sizePt'){ const v = O.sizePt * PX_PER_IN / 72; if (cells && cells.length) cells.forEach(([r, c]) => { t.cells[r][c].size = v; }); else { t.fontSize = v; t.cells.forEach(row => row.forEach(cl => delete cl.size)); } }
    else if (key === 'textColor'){ if (cells && cells.length) cells.forEach(([r, c]) => { t.cells[r][c].color = O.textColor; }); else { t.textColor = O.textColor; t.cells.forEach(row => row.forEach(cl => delete cl.color)); } }
    else t[key] = O[key];
    t.dirty = true; canvas.requestRenderAll(); snapshot();
  },
};

Tools.def('table', {
  name: 'Table', tip: 'Draw, select and edit tables',
  opts: {rows: 3, cols: 4, fillOn: false, cellFill: '#ffffff', borderW: 0.5, borderColor: '#111111', borderStyle: 'solid', fontFamily: 'Inter', sizePt: 12, textColor: '#111111'},
  t: null, cells: [], active: null,
  usesSel: false,
  hint(){ return this.t ? 'Click a cell to type · drag across cells · drag a line to resize · click beside an edge for a row or column' : 'Drag to draw a table'; },
  list(){ return this.cells; },
  start(){
    const t = Tools.sel.find(o => o.type === 'table');
    this.t = t || null; this.cells = []; this.active = null;
    if (t) TableBar.load(t, Tools.opts.table);
    else if (!Tools.opts.table.custom) Object.assign(Tools.opts.table, {borderColor: Tools.ink(), textColor: Tools.ink()});
  },
  stop(){ Tools.closeInline(); this.t = null; this.cells = []; },
  bar(){
    const c = TableBar.controls(this.t, Tools.o());
    if (this.t && this.cells.length > 1) c.push({type: 'btn', label: 'Merge', on: () => this.merge()});
    if (this.t && this.cells.some(([r, k]) => this.t.cells[r][k].rs > 1 || this.t.cells[r][k].cs > 1)) c.push({type: 'btn', label: 'Split', on: () => this.split()});
    if (this.t) c.push({type: 'btn', label: 'Even rows', on: () => this.even('rowH')}, {type: 'btn', label: 'Even columns', on: () => this.even('colW')});
    return c;
  },
  changed(key){ if (!this.t && (key === 'borderColor' || key === 'textColor')) Tools.o().custom = true; if (this.t){ TableBar.apply(this.t, key, Tools.o(), this.cells); if (key === 'rows' || key === 'cols'){ this.cells = []; this.active = null; } Tools.bar(); } },
  even(key){ const t = this.t, n = t[key].length, tot = t[key].reduce((a, b) => a + b, 0); t.reshape(() => { t[key] = t[key].map(() => tot / n); }); canvas.requestRenderAll(); snapshot(); },
  merge(){
    const t = this.t, rs = this.cells.map(k => k[0]), cs = this.cells.map(k => k[1]);
    let r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
    this.cells.forEach(([r, c]) => { const h = t.cells[r][c]; r1 = Math.max(r1, r + (h.rs || 1) - 1); c1 = Math.max(c1, c + (h.cs || 1) - 1); });
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (t.cells[r][c].rs > 1 || t.cells[r][c].cs > 1) t.split(r, c);
    t.merge(r0, c0, r1, c1); this.cells = [[r0, c0]]; this.active = [r0, c0];
    canvas.requestRenderAll(); snapshot(); Tools.bar();
  },
  split(){ this.cells.forEach(([r, c]) => this.t.split(r, c)); canvas.requestRenderAll(); snapshot(); Tools.bar(); },
  // page point -> table space
  local(t, p){ const q = Effects.pt(Effects.inv(t.calcTransformMatrix()), p.x, p.y); return {x: q.x + t.width / 2, y: q.y + t.height / 2}; },
  cellAt(t, q){
    let r = 0, c = 0;
    while (r < t.rowH.length - 1 && q.y >= t.y(r + 1)) r++;
    while (c < t.colW.length - 1 && q.x >= t.x(c + 1)) c++;
    return t.head(r, c);
  },
  // a line near the point: {col: i} or {row: i}
  lineAt(t, q){
    const reach = (COARSE ? 10 : 4) / zoom;
    if (q.y > -reach && q.y < t.height + reach) for (let i = 1; i <= t.colW.length; i++) if (Math.abs(q.x - t.x(i)) < reach) return {col: i};
    if (q.x > -reach && q.x < t.width + reach) for (let i = 1; i <= t.rowH.length; i++) if (Math.abs(q.y - t.y(i)) < reach) return {row: i};
    return null;
  },
  block(t, a, b){
    let r0 = Math.min(a[0], b[0]), r1 = Math.max(a[0], b[0]), c0 = Math.min(a[1], b[1]), c1 = Math.max(a[1], b[1]);
    // grow to take in whole merged cells
    for (let again = true; again;){
      again = false;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
        const [hr, hc] = t.head(r, c), h = t.cells[hr][hc], r2 = hr + (h.rs || 1) - 1, c2 = hc + (h.cs || 1) - 1;
        if (hr < r0 || hc < c0 || r2 > r1 || c2 > c1){ r0 = Math.min(r0, hr); c0 = Math.min(c0, hc); r1 = Math.max(r1, r2); c1 = Math.max(c1, c2); again = true; }
      }
    }
    const out = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!t.cells[r][c].by) out.push([r, c]);
    return out;
  },
  setCells(list, active){ this.cells = list; if (active) this.active = active; canvas.requestRenderAll(); Tools.bar(); },
  down(p, e){
    Tools.closeInline();
    const under = Pick.under(e).find(o => o.type === 'table'), near = this.t && Edit.onCanvas(this.t) ? this.t : null;
    let t = near;
    if (near){
      const q = this.local(near, p), slack = 12 / zoom;
      if (q.x < -slack || q.y < -slack || q.x > near.width + slack || q.y > near.height + slack) t = null;
    }
    t = t || under || null;
    if (!t){
      if (near){ this.t = null; this.cells = []; this.active = null; Tools.bar(); }
      const a = Tools.snap(p); Tools.st = {draw: true, a, b: a}; return;
    }
    if (t !== this.t){ this.t = t; this.cells = []; this.active = null; TableBar.load(t, Tools.o()); Tools.bar(); }
    const q = this.local(t, p), out = 12 / zoom, inn = 3 / zoom, R = t.rowH.length, C = t.colW.length;
    // edge zones select whole rows and columns
    if (q.x < inn && q.y < inn) return this.setCells(this.block(t, [0, 0], [R - 1, C - 1]), [0, 0]);
    if (q.x < inn && q.x > -out){ const r = this.cellAt(t, {x: 0, y: q.y})[0]; return this.setCells(this.block(t, [e.shiftKey && this.active ? this.active[0] : r, 0], [r, C - 1]), [r, 0]); }
    if (q.y < inn && q.y > -out){ const c = this.cellAt(t, {x: q.x, y: 0})[1]; return this.setCells(this.block(t, [0, e.shiftKey && this.active ? this.active[1] : c], [R - 1, c]), [0, c]); }
    const line = this.lineAt(t, q);
    if (line){ Tools.st = {resize: line, from: q, col: t.colW.slice(), row: t.rowH.slice()}; return; }
    const cell = this.cellAt(t, q);
    if (Tools.ctrl(e)){
      const has = this.cells.findIndex(k => k[0] === cell[0] && k[1] === cell[1]);
      if (has >= 0 && this.cells.length > 1) this.cells.splice(has, 1); else if (has < 0) this.cells.push(cell);
      return this.setCells(this.cells, cell);
    }
    if (e.shiftKey && this.active) return this.setCells(this.block(t, this.active, cell));
    Tools.st = {select: cell, moved: false};
    this.setCells([cell], cell);
  },
  move(p){
    const st = Tools.st; if (!st) return;
    if (st.draw){ st.b = Tools.snap(p); canvas.requestRenderAll(); return; }
    const t = this.t, q = this.local(t, p);
    if (st.resize){
      const min = MM, L = st.resize;
      t.reshape(() => {
        if (L.col){
          const i = L.col - 1, d = q.x - st.from.x, W = st.col.slice();
          if (L.col < W.length){ const v = Math.max(min - W[i], Math.min(W[i + 1] - min, d)); W[i] += v; W[i + 1] -= v; } else W[i] = Math.max(min, W[i] + d);
          t.colW = W;
        } else {
          const i = L.row - 1, d = q.y - st.from.y, H = st.row.slice();
          if (L.row < H.length){ const v = Math.max(min - H[i], Math.min(H[i + 1] - min, d)); H[i] += v; H[i + 1] -= v; } else H[i] = Math.max(min, H[i] + d);
          t.rowH = H;
        }
      });
      canvas.requestRenderAll(); return;
    }
    if (st.select){
      const c = this.cellAt(t, {x: Math.max(0, Math.min(t.width - 0.01, q.x)), y: Math.max(0, Math.min(t.height - 0.01, q.y))});
      if (c[0] !== st.select[0] || c[1] !== st.select[1]) st.moved = true;
      if (st.moved) this.setCells(this.block(t, st.select, c));
    }
  },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    if (st.draw){
      Pick.clearGuides(); canvas.requestRenderAll();
      const w = Math.abs(st.b.x - st.a.x), h = Math.abs(st.b.y - st.a.y);
      if (w < MM || h < MM) return;
      const O = Tools.o(), R = Math.round(O.rows), C = Math.round(O.cols);
      const t = new fabric.Table({left: Math.min(st.a.x, st.b.x), top: Math.min(st.a.y, st.b.y), colW: Array(C).fill(w / C), rowH: Array(R).fill(h / R), cellFill: O.fillOn ? O.cellFill : null, borderW: O.borderW, borderColor: O.borderColor, borderStyle: O.borderStyle, fontFamily: O.fontFamily, fontSize: O.sizePt * PX_PER_IN / 72, textColor: O.textColor, name: 'Table'});
      canvas.add(t); this.t = t; this.cells = []; this.active = null; snapshot(); refresh(); Tools.bar();
      return;
    }
    if (st.resize){ snapshot(); return; }
    if (st.select && !st.moved) this.edit(st.select);
  },
  edit([r, c]){
    const t = this.t, b = t.box(r, c), m = t.calcTransformMatrix(), a = Effects.pt(m, b.x - t.width / 2, b.y - t.height / 2);
    this.active = [r, c]; this.cells = [[r, c]]; canvas.requestRenderAll();
    Tools.inline({x: a.x, y: a.y, w: b.w, h: b.h}, t.cells[r][c].t, v => { if (t.cells[r][c].t !== v){ t.cells[r][c].t = v; t.dirty = true; canvas.requestRenderAll(); snapshot(); } }, {
      size: t.fontSize, font: t.fontFamily, multiline: false,
      tab: back => this.edit(this.next([r, c], back)),
    });
  },
  next([r, c], back){
    const t = this.t, R = t.rowH.length, C = t.colW.length; let i = r * C + c;
    for (let n = 0; n < R * C; n++){ i = (i + (back ? -1 : 1) + R * C) % (R * C); const rr = Math.floor(i / C), cc = i % C; if (!t.cells[rr][cc].by) return [rr, cc]; }
    return [r, c];
  },
  key(e){
    if (e.key === 'Escape' && (this.cells.length || Tools.st)){ this.cells = []; this.active = null; Tools.st = null; canvas.requestRenderAll(); return true; }
    if (e.key === 'Tab' && this.active){ this.edit(this.next(this.active, e.shiftKey)); return true; }
    if ((e.key === 'Enter' || e.key === 'F2') && this.active){ this.edit(this.active); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.cells.length){ this.cells.forEach(([r, c]) => { this.t.cells[r][c].t = ''; }); canvas.requestRenderAll(); snapshot(); return true; }
    return false;
  },
  draw(ctx){
    const st = Tools.st;
    if (st && st.draw){
      const O = Tools.o(), x0 = Math.min(st.a.x, st.b.x), y0 = Math.min(st.a.y, st.b.y), x1 = Math.max(st.a.x, st.b.x), y1 = Math.max(st.a.y, st.b.y);
      for (let i = 0; i <= O.rows; i++){ const y = y0 + (y1 - y0) * i / O.rows; Tools.blue(ctx, c => Tools.poly(c, [{x: x0, y}, {x: x1, y}])); }
      for (let i = 0; i <= O.cols; i++){ const x = x0 + (x1 - x0) * i / O.cols; Tools.blue(ctx, c => Tools.poly(c, [{x, y: y0}, {x, y: y1}])); }
      return;
    }
    const t = this.t; if (!t || !Edit.onCanvas(t)) return;
    const m = t.calcTransformMatrix(), P = (x, y) => Tools.S(Effects.pt(m, x - t.width / 2, y - t.height / 2));
    const quad = b => { const a = [P(b.x, b.y), P(b.x + b.w, b.y), P(b.x + b.w, b.y + b.h), P(b.x, b.y + b.h)]; ctx.beginPath(); a.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); };
    this.cells.forEach(([r, c]) => { quad(t.box(r, c)); ctx.fillStyle = 'rgba(37,99,235,.28)'; ctx.fill(); });
    quad({x: 0, y: 0, w: t.width, h: t.height}); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.stroke();
  },
});
/* with the Pick tool: the same controls, on the selected table */
Tools.contextBars.table = (el, t) => {
  if (el._for === t) return;
  el._for = t; el.innerHTML = '';
  const O = Object.assign({}, Tools.opts.table); TableBar.load(t, O);
  const d = {changed: key => TableBar.apply(t, key, O, null)};
  TableBar.controls(t, O).forEach(c => el.appendChild(Tools.control(c, O, d)));
};
canvas.on('mouse:dblclick', o => { if (tool === 'pick' && o.target && o.target.type === 'table') setTool('table'); });
