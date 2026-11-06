/* ===================== Help: answers and guided tours, offline =====================
   Runs entirely in the page. It matches a question against the guides in help-data.js by their words, allowing for
   typos, synonyms and Hinglish. It isn't an AI and doesn't make things up: when no guide fits, it says so. */

const Help = {
  /* ---------- finding a guide ---------- */
  words(text){
    return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean)
      .map(w => HELP_SYNONYMS[w] || w).filter(w => !HELP_STOP.has(w)).map(w => this.stem(HELP_SYNONYMS[w] || w));
  },
  stem(w){ if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3); if (w.length > 4 && w.endsWith('es')) return w.slice(0, -1).replace(/e$/, ''); if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1); return w; },
  // edits between two words, stopping early past the limit
  near(a, b, max){
    if (Math.abs(a.length - b.length) > max) return false;
    let row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++){
      const next = [i]; let best = i;
      for (let j = 1; j <= b.length; j++){ const v = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); next.push(v); if (v < best) best = v; }
      if (best > max) return false;
      row = next;
    }
    return row[b.length] <= max;
  },
  // any tool without a written guide gets one from its own name and instructions
  addToolGuides(){
    const written = id => HELP_GUIDES.some(g => g.steps.some(s => s.target === 'tool:' + id || (s.do && s.do.tool === id)));
    Toolbox.groups.flatMap(g => g.tools).filter(t => !t.startsWith('cmd:') && !written(t)).forEach(t => {
      const d = Tools.defs[t] || {}, name = Toolbox.name(t), tip = Toolbox.tip(t), hint = typeof d.hint === 'function' ? '' : d.hint;
      HELP_GUIDES.push({id: 'tool-' + t, title: `Use the ${name} tool`, keys: name + ' ' + (d.keys || ''), answer: `${tip}. It is in the toolbox, also in the Tools menu.`,
        steps: [{text: `Choose ${name} in the toolbox. If you can't see it, tap the corner arrow on the button shown here.`, target: 'tool:' + t, do: {tool: t}}, {text: hint || tip, target: 'canvas'}]});
    });
  },
  index(){
    if (this.docs) return this.docs;
    this.docs = HELP_GUIDES.map(g => ({g, title: new Set(this.words(g.title)), keys: new Set(this.words(g.keys)), body: new Set(this.words(g.answer))}));
    return this.docs;
  },
  matchIn(word, set){
    if (set.has(word)) return 1;
    for (const w of set){
      if (word.length >= 4 && w.length >= 4 && (w.startsWith(word) || word.startsWith(w))) return 0.8;
      if (word.length >= 4 && this.near(word, w, word.length >= 7 ? 2 : 1)) return 0.7;
    }
    return 0;
  },
  // the guides that fit, best first; an empty list when nothing really does
  search(question){
    const q = this.words(question); if (!q.length) return [];
    const out = this.index().map(d => {
      let score = 0, hits = 0;
      q.forEach(w => {
        const t = this.matchIn(w, d.title), k = this.matchIn(w, d.keys), s = Math.max(t * 4, k * 3, this.matchIn(w, d.body));
        // a short word that is merely close to another ("life", "line") only counts when it's all that was asked
        const closeOnly = Math.max(t, k) === 0.7 && w.length < 5 && q.length > 1;
        if (closeOnly) return;
        score += s; if (s >= 2) hits++;
      });
      return {g: d.g, score, cover: hits / q.length};
    }).filter(r => r.score >= 2 && r.cover >= 0.4);
    out.sort((a, b) => b.score - a.score || b.cover - a.cover);
    return out.slice(0, 5).map(r => r.g);
  },

  /* ---------- the panel ---------- */
  el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  init(){
    this.addToolGuides();
    const body = $('d-help');
    body.innerHTML = `<div class="hpask"><input id="helpQ" type="search" placeholder="Ask, e.g. how do I blend?" enterkeyhint="search" autocomplete="off"><button class="btn primary" id="helpGo">Ask</button></div><div id="helpOut" class="hpout"></div><p class="hpnote">Built in, and works offline. Answers come from this app's own guides.</p>`;
    const go = () => this.ask($('helpQ').value);
    $('helpGo').onclick = go;
    $('helpQ').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); go(); } });
    $('helpQ').addEventListener('input', () => { if (!$('helpQ').value.trim()) this.home(); });
    this.home();
  },
  chips(box, title, guides){
    box.appendChild(this.el('h4', '', title));
    const list = this.el('div', 'hplist');
    guides.forEach(g => { const b = this.el('button', 'hpitem', g.title); b.onclick = () => this.show(g); list.appendChild(b); });
    box.appendChild(list);
  },
  home(){
    const out = $('helpOut'); out.replaceChildren();
    this.chips(out, 'Popular questions', HELP_POPULAR.map(id => HELP_GUIDES.find(g => g.id === id)));
    const all = this.el('button', 'btn ghost mini', 'See all topics');
    all.onclick = () => { out.replaceChildren(); this.chips(out, 'All topics', HELP_GUIDES); out.scrollTop = 0; };
    out.appendChild(all);
  },
  ask(question){
    if (!question.trim()) return this.home();
    const found = this.search(question), out = $('helpOut');
    if (found.length) return this.show(found[0], found.slice(1));
    out.replaceChildren();
    out.appendChild(this.el('p', 'hpmiss', 'I don\'t have a guide for that yet. Try a shorter question using the name of a tool, such as "blend" or "export", or pick a topic below.'));
    if (typeof AskClaude !== 'undefined' && AskClaude.sample){
      const b = this.el('button', 'btn ghost mini', 'Ask Claude instead');
      b.onclick = () => { run('askclaude'); setTimeout(() => { const t = $('aiText'); if (t) t.value = question; }, 80); };
      out.appendChild(b);
    }
    this.chips(out, 'Popular questions', HELP_POPULAR.map(id => HELP_GUIDES.find(g => g.id === id)));
  },
  show(g, others){
    const out = $('helpOut'); out.replaceChildren();
    out.appendChild(this.el('h3', 'hptitle', g.title));
    out.appendChild(this.el('p', 'hpanswer', g.answer));
    const ol = this.el('ol', 'hpsteps'); g.steps.forEach(s => ol.appendChild(this.el('li', '', s.text))); out.appendChild(ol);
    const row = this.el('div', 'hprow');
    const tour = this.el('button', 'btn primary', 'Show me step by step'); tour.id = 'helpTour'; tour.onclick = () => Tour.start(g);
    const back = this.el('button', 'btn ghost', 'All questions'); back.onclick = () => { $('helpQ').value = ''; this.home(); };
    row.append(tour, back); out.appendChild(row);
    if (others && others.length) this.chips(out, 'Did you mean', others);
    out.scrollTop = 0;
  },
  open(){ showDock('help'); setTimeout(() => { if (!COARSE) $('helpQ').focus(); }, 60); },
};

/* ---------- the step-by-step tour: a card and a ring over the real app, which stays usable ---------- */
const Tour = {
  g: null, i: 0, practice: [], timer: null, ring: null, card: null,
  small: () => matchMedia('(max-width: 1099px)').matches,
  phone: () => matchMedia('(max-width: 767px)').matches,
  start(g){
    this.stop(); this.g = g; this.i = 0; this.practice = [];
    if (this.small()) Touch.openDock(false);
    this.ring = Help.el('div', 'tourring'); this.card = Help.el('div', 'tourcard');
    document.body.append(this.ring, this.card);
    this.timer = setInterval(() => this.place(), 250);
    this.render();
  },
  stop(){ clearInterval(this.timer); this.timer = null; if (this.ring) this.ring.remove(); if (this.card) this.card.remove(); this.ring = this.card = null; this.g = null; if (this.dot){ this.dot.remove(); this.dot = null; } },
  // the element a step points at, opening what hides it
  find(target){
    if (!target) return null;
    if (target === 'canvas') return $('pa');
    if (target.startsWith('tool:')){
      const id = target.slice(5), i = Toolbox.groups.findIndex(g => g.tools.includes(id)); if (i < 0) return null;
      if (Toolbox.groups[i].adv && this.phone()) $('tools').classList.add('all');
      return document.querySelector(`.tool[data-group="${i}"]`);
    }
    if (target.startsWith('dock:')) return this.small() ? $('bPanels') : document.querySelector(`.dtabs [data-d="${target.slice(5)}"]`);
    if (target.startsWith('cmd:') || target === '#toolsMenu'){
      if (this.phone()) return $('bMenu');
      const item = target === '#toolsMenu' ? $('toolsMenu') : document.querySelector(`.dd [data-cmd="${target.slice(4)}"]`);
      return item ? item.closest('.mi').querySelector('button') : null;
    }
    return document.querySelector(target);
  },
  menuName(target){
    if (!target || (!target.startsWith('cmd:') && target !== '#toolsMenu')) return '';
    const item = target === '#toolsMenu' ? $('toolsMenu') : document.querySelector(`.dd [data-cmd="${target.slice(4)}"]`);
    if (!item) return '';
    const menu = item.closest('.mi').querySelector('button').textContent, name = target === '#toolsMenu' ? '' : item.childNodes[0].textContent.trim();
    return name ? `${menu} > ${name}` : menu;
  },
  place(){
    if (!this.g) return;
    const step = this.g.steps[this.i], el = this.find(step.target);
    const shown = el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    if (!shown){ this.ring.style.display = 'none'; this.card.style.top = ''; this.card.style.bottom = ''; return; }
    const r = el.getBoundingClientRect(), pad = 4;
    if (el.closest('.tools') && !this.seen !== el){ el.scrollIntoView({block: 'nearest', inline: 'nearest'}); this.seen = el; }
    Object.assign(this.ring.style, {display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px'});
    // the card keeps out of the way of what it points at, unless that fills the screen
    const c = this.card.getBoundingClientRect(), H = innerHeight;
    const lower = r.top + r.height / 2 > H / 2 && r.height < H * 0.5;
    this.card.style.top = lower ? '60px' : ''; this.card.style.bottom = lower ? 'auto' : '';
  },
  render(){
    const step = this.g.steps[this.i], n = this.g.steps.length, c = this.card; c.replaceChildren();
    const head = Help.el('div', 'tourhead'); head.append(Help.el('b', '', this.g.title));
    const x = Help.el('button', 'tourx', '✕'); x.setAttribute('aria-label', 'Close the guide'); x.onclick = () => this.stop(); head.append(x); c.append(head);
    c.append(Help.el('div', 'tourcount', `Step ${this.i + 1} of ${n}`));
    c.append(Help.el('p', 'tourtext', step.text));
    const where = this.menuName(step.target); if (where) c.append(Help.el('p', 'tourwhere', `Menu: ${where}`));
    const row = Help.el('div', 'tourrow');
    if (step.do){ const d = Help.el('button', 'btn ghost', this.doLabel(step.do)); d.id = 'tourDo'; d.onclick = async () => { d.disabled = true; try { await this.perform(step.do); d.textContent = 'Done ✓'; } catch (e){ d.disabled = false; toast(e.message); } }; row.append(d); }
    row.append(Help.el('span', 'tourgap'));
    if (this.i){ const b = Help.el('button', 'btn ghost', 'Back'); b.onclick = () => this.go(this.i - 1); row.append(b); }
    const next = Help.el('button', 'btn primary', this.i === n - 1 ? 'Finish' : 'Next'); next.id = 'tourNext'; next.onclick = () => this.i === n - 1 ? this.stop() : this.go(this.i + 1); row.append(next);
    c.append(row);
    this.seen = null; this.place();
  },
  go(i){ this.i = i; this.render(); },
  doLabel(d){ return d.sample ? 'Add practice shapes' : d.select ? 'Select them for me' : d.drag ? 'Show me the drag' : d.dock ? 'Open it' : d.tool ? 'Choose it for me' : 'Do it for me'; },
  async perform(d){
    if (d.sample) return this.addSample(d.sample);
    if (d.tool) return setTool(d.tool);
    if (d.dock){ showDock(d.dock); return; }
    if (d.select){ setTool('pick'); const list = this.alive(); if (list.length) selectObjs(list); else run('selall'); return; }
    if (d.cmd) return run(d.cmd);
    if (d.drag) return this.drag(d.drag[0], d.drag[1]);
  },
  alive(){ return this.practice.filter(o => canvas.getObjects().includes(o)); },
  /* ---------- practice shapes: real objects, one undo step ---------- */
  addSample(kind){
    setTool('pick');
    const m = Math.min(PA_W, PA_H), s = m * 0.28, make = [];
    const put = (o, x, y) => { placeCenter(o, x, y); make.push(o); };
    if (kind === 'text'){ const t = makeText('SUMMER', {fontSize: m * 0.2, fill: '#ffffff', name: 'Practice text'}); put(t, PA_W / 2, PA_H * 0.4); }
    else if (kind === 'one') put(new fabric.Rect({width: s * 1.2, height: s, rx: 6, ry: 6, fill: '#f97316', strokeWidth: 0, name: 'Practice shape'}), PA_W / 2, PA_H * 0.4);
    else if (kind === 'overlap'){
      put(new fabric.Rect({width: s * 1.1, height: s * 1.1, fill: '#f97316', strokeWidth: 0, name: 'Practice square'}), PA_W / 2 - s * 0.3, PA_H * 0.42);
      put(new fabric.Circle({radius: s * 0.55, fill: '#38bdf8', strokeWidth: 0, name: 'Practice circle'}), PA_W / 2 + s * 0.3, PA_H * 0.42);
    } else {
      put(new fabric.Circle({radius: s * 0.45, fill: '#f97316', strokeWidth: 0, name: 'Practice circle'}), PA_W * 0.28, PA_H * 0.3);
      put(new fabric.Circle({radius: s * 0.32, fill: '#38bdf8', strokeWidth: 0, name: 'Practice circle 2'}), PA_W * 0.72, PA_H * 0.65);
    }
    restoring = true; make.forEach(o => canvas.add(o)); restoring = false;
    canvas.getObjects().forEach(o => o.setCoords());
    this.practice = make;
    if (make.length === 1) canvas.setActiveObject(make[0]);
    canvas.requestRenderAll(); snapshot(); refresh();
    if (this.phone() || autoFit === false) run('fit');
  },
  /* ---------- a real drag on the canvas, with a dot to follow ---------- */
  screen(p){ const r = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform; return {x: p.x * v[0] + v[4] + r.left, y: p.y * v[3] + v[5] + r.top}; },
  async drag(from, to){
    const list = this.alive();
    const objAt = i => { const o = list[i] || canvas.getActiveObject() || canvas.getObjects().slice(-1)[0]; if (!o) throw new Error('Add a shape first'); return o.getCenterPoint(); };
    const a = this.screen(objAt(from));
    const b = typeof to === 'number' ? this.screen(objAt(to)) : (p => this.screen({x: p.x + to.dx * PX_PER_IN, y: p.y + to.dy * PX_PER_IN}))(objAt(from));
    const el = canvas.upperCanvasEl, ev = (type, p, buttons) => (type === 'mouseup' ? document : el).dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window, button: 0, buttons, clientX: p.x, clientY: p.y}));
    if (!this.dot){ this.dot = Help.el('div', 'tourdot'); document.body.append(this.dot); }
    const dot = p => { this.dot.style.left = p.x + 'px'; this.dot.style.top = p.y + 'px'; };
    dot(a); ev('mousemove', a, 0); ev('mousedown', a, 1);
    const N = 24;
    for (let i = 1; i <= N; i++){ const p = {x: a.x + (b.x - a.x) * i / N, y: a.y + (b.y - a.y) * i / N}; ev('mousemove', p, 1); dot(p); await new Promise(r => setTimeout(r, 25)); }
    ev('mouseup', b, 0);
    await new Promise(r => setTimeout(r, 300));
    if (this.dot){ this.dot.remove(); this.dot = null; }
  },
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Tour.g){ e.stopImmediatePropagation(); Tour.stop(); } if (e.key === 'F1'){ e.preventDefault(); Help.open(); } }, true);
Help.init();
