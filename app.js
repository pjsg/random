'use strict';

// ---------- Storage ----------
const CFG_KEY = 'rng.configs.v1';
const stateKey = id => 'rng.state.v1.' + id;
const $ = id => document.getElementById(id);

function loadConfigs() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || []; } catch { return []; }
}
function saveConfigs(list) { localStorage.setItem(CFG_KEY, JSON.stringify(list)); }
function loadState(id) {
  try { return JSON.parse(localStorage.getItem(stateKey(id))) || { groups: {}, history: [] }; }
  catch { return { groups: {}, history: [] }; }
}
function saveState(id, st) { localStorage.setItem(stateKey(id), JSON.stringify(st)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- Random helpers ----------
const rngPool = new Uint32Array(512);
let rngPos = rngPool.length;
function u32() {
  if (rngPos >= rngPool.length) {
    const c = window.crypto;
    if (c && c.getRandomValues) c.getRandomValues(rngPool);
    else for (let i = 0; i < rngPool.length; i++) rngPool[i] = Math.floor(Math.random() * 0x100000000);
    rngPos = 0;
  }
  return rngPool[rngPos++];
}
function rand01() { // uniform in [0, 1) with 53 random bits
  return (u32() * 2097152 + (u32() >>> 11)) / 9007199254740992;
}
function randInt(n) { // uniform integer in [0, n) for n up to 2^53
  if (n <= 1) return 0;
  if (n <= 0x100000000) {
    const lim = Math.floor(0x100000000 / n) * n;
    let x;
    do { x = u32(); } while (x >= lim);
    return x % n;
  }
  return Math.floor(rand01() * n);
}
function randNormal() {
  return Math.sqrt(-2 * Math.log(1 - rand01())) * Math.cos(2 * Math.PI * rand01());
}
function randBinomial(n, p) { // sum of n Bernoulli trials (n is capped at 1000)
  let k = 0;
  for (let i = 0; i < n; i++) if (rand01() < p) k++;
  return k;
}
function randPoisson(mean) { // Knuth's method, in chunks of 30 so exp(-mean) never underflows
  let total = 0;
  while (mean > 0) {
    const m = Math.min(mean, 30); mean -= m;
    const L = Math.exp(-m);
    let k = 0, p = 1;
    do { k++; p *= rand01(); } while (p > L);
    total += k - 1;
  }
  return total;
}
function randTriangular(a, c, b) { // min a, mode c, max b
  if (b === a) return a;
  const u = rand01(), fc = (c - a) / (b - a);
  return u < fc ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}
function fmt(x, d) { // fixed decimals, never "-0"
  const s = x.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

// ---------- Field model ----------
// Field types. "number" is the uniform range; "list" is a (weighted) set of choices.
const TYPES = {
  number:      { label: 'Uniform range', indexed: true, params: [['min', 'Min', 1], ['max', 'Max', 100], ['step', 'Step', 1]] },
  list:        { label: 'List of choices', indexed: true, params: [] },
  normal:      { label: 'Normal (Gaussian)', params: [['mean', 'Mean', 0], ['sd', 'Std deviation', 1], ['decimals', 'Decimal places', 2]] },
  binomial:    { label: 'Binomial', params: [['trials', 'Trials', 10], ['p', 'Probability of success', 0.5]] },
  poisson:     { label: 'Poisson', params: [['mean', 'Mean (λ)', 4]] },
  exponential: { label: 'Exponential', params: [['mean', 'Mean', 1], ['decimals', 'Decimal places', 2]] },
  geometric:   { label: 'Geometric (trials to first success)', params: [['p', 'Probability of success', 0.5]] },
  triangular:  { label: 'Triangular', params: [['min', 'Min', 0], ['mode', 'Most likely', 5], ['max', 'Max', 10], ['decimals', 'Decimal places', 2]] }
};
const isIndexed = f => TYPES[f.type].indexed;

function decimals(x) {
  const s = String(x);
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

// A list value may be prefixed with a relative weight, e.g. "2:Likely".
const WEIGHT_RE = /^(\d+(?:\.\d+)?)\s*:\s*(.+)$/;
function parseChoice(str) {
  const m = WEIGHT_RE.exec(str);
  return m ? { label: m[2].trim(), w: Number(m[1]) } : { label: str, w: 1 };
}
const listCache = new WeakMap();
function listItems(f) {
  let it = listCache.get(f);
  if (!it || it.src !== f.values) {
    const items = f.values.map(parseChoice);
    let total = 0;
    const cum = items.map(x => (total += x.w));
    it = { src: f.values, items, cum, total };
    listCache.set(f, it);
  }
  return it;
}
function pickWeighted(f) { // index of a choice, chosen in proportion to its weight
  const { cum, total } = listItems(f);
  const r = rand01() * total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > r) hi = mid; else lo = mid + 1; }
  return lo;
}

function fieldSize(f) { // number of distinct values (indexed types only)
  if (f.type === 'list') return f.values.length;
  return Math.floor(Math.round((f.max - f.min) / f.step * 1e9) / 1e9) + 1;
}
function fieldValue(f, k) {
  if (f.type === 'list') return listItems(f).items[k].label;
  const d = Math.max(decimals(f.step), decimals(f.min));
  return (f.min + k * f.step).toFixed(d);
}

// Draw one display value for a field.
function randomDisplay(f) {
  switch (f.type) {
    case 'list': return fieldValue(f, pickWeighted(f));
    case 'number': return fieldValue(f, randInt(fieldSize(f)));
    case 'normal': return fmt(f.mean + f.sd * randNormal(), f.decimals);
    case 'binomial': return String(randBinomial(f.trials, f.p));
    case 'poisson': return String(randPoisson(f.mean));
    case 'exponential': return fmt(-f.mean * Math.log(1 - rand01()), f.decimals);
    case 'geometric': return String(f.p >= 1 ? 1 : Math.max(1, Math.ceil(Math.log(1 - rand01()) / Math.log1p(-f.p))));
    case 'triangular': return fmt(randTriangular(f.min, f.mode, f.max), f.decimals);
  }
}

// Theoretical mean and standard deviation, or null for non-numeric fields.
function theory(f) {
  switch (f.type) {
    case 'number': { const n = fieldSize(f); return { mean: f.min + (n - 1) * f.step / 2, sd: f.step * Math.sqrt((n * n - 1) / 12) }; }
    case 'normal': return { mean: f.mean, sd: f.sd };
    case 'binomial': return { mean: f.trials * f.p, sd: Math.sqrt(f.trials * f.p * (1 - f.p)) };
    case 'poisson': return { mean: f.mean, sd: Math.sqrt(f.mean) };
    case 'exponential': return { mean: f.mean, sd: f.mean };
    case 'geometric': return { mean: 1 / f.p, sd: Math.sqrt(1 - f.p) / f.p };
    case 'triangular': { const { min: a, mode: c, max: b } = f; return { mean: (a + b + c) / 3, sd: Math.sqrt((a * a + b * b + c * c - a * b - a * c - b * c) / 18) }; }
  }
  return null;
}

// Validate + normalise a config object (from editor or import). Throws Error with message.
function normalise(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Configuration must be a JSON object.');
  const name = String(raw.name || '').trim();
  if (!name) throw new Error('Configuration needs a name.');
  if (!Array.isArray(raw.fields) || !raw.fields.length) throw new Error('Configuration needs at least one field.');
  const fields = raw.fields.map((r, i) => {
    const where = `Field ${i + 1}: `;
    const fname = String(r.name || '').trim() || `Field ${i + 1}`;
    let type = r.type === 'uniform' ? 'number' : r.type;
    if (!TYPES[type]) type = Array.isArray(r.values) ? 'list' : 'number';
    const f = { name: fname, type, group: String(r.group || '').trim() };
    if (f.group && !TYPES[type].indexed) throw new Error(where + `${TYPES[type].label} fields can't be in a no-repeat group.`);
    const num = key => {
      const def = TYPES[type].params.find(p => p[0] === key)[2];
      const v = Number(r[key] ?? (key === 'mode' ? (Number(r.min ?? 0) + Number(r.max ?? 10)) / 2 : def));
      if (!Number.isFinite(v)) throw new Error(where + `${key} must be a number.`);
      return v;
    };
    TYPES[type].params.forEach(([key]) => { f[key] = num(key); });
    if ('decimals' in f && (!Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 10)) throw new Error(where + 'decimal places must be a whole number from 0 to 10.');
    switch (type) {
      case 'number':
        if (f.step <= 0) throw new Error(where + 'step must be greater than 0.');
        if (f.max < f.min) throw new Error(where + 'max must be ≥ min.');
        if (fieldSize(f) > 1e12) throw new Error(where + 'range is too large.');
        break;
      case 'list': {
        if (r.markdown === true || r.markdown === 'true') f.markdown = true;
        let vals = r.values;
        if (typeof vals === 'string') vals = vals.split(f.markdown ? /\n/ : /[\n,]/);
        if (!Array.isArray(vals)) throw new Error(where + 'values must be a list.');
        f.values = vals.map(v => String(v).trim()).filter(v => v !== '');
        if (!f.values.length) throw new Error(where + 'needs at least one value.');
        f.values.forEach(v => { const m = WEIGHT_RE.exec(v); if (m && Number(m[1]) <= 0) throw new Error(where + `weight in "${v}" must be greater than 0.`); });
        break;
      }
      case 'normal': if (!(f.sd > 0)) throw new Error(where + 'standard deviation must be greater than 0.'); break;
      case 'binomial':
        if (!Number.isInteger(f.trials) || f.trials < 1 || f.trials > 1000) throw new Error(where + 'trials must be a whole number from 1 to 1000.');
        if (f.p < 0 || f.p > 1) throw new Error(where + 'probability must be between 0 and 1.');
        break;
      case 'poisson': if (!(f.mean > 0 && f.mean <= 1000)) throw new Error(where + 'mean must be greater than 0 and at most 1000.'); break;
      case 'exponential': if (!(f.mean > 0)) throw new Error(where + 'mean must be greater than 0.'); break;
      case 'geometric': if (!(f.p > 0 && f.p <= 1)) throw new Error(where + 'probability must be greater than 0 and at most 1.'); break;
      case 'triangular':
        if (!(f.min < f.max)) throw new Error(where + 'max must be greater than min.');
        if (f.mode < f.min || f.mode > f.max) throw new Error(where + 'most likely value must be between min and max.');
        break;
    }
    return f;
  });
  // Optional top-level "groups": [["Field A","Field B"], ...] by field name
  if (Array.isArray(raw.groups)) {
    raw.groups.forEach((names, gi) => {
      if (!Array.isArray(names)) return;
      names.forEach(n => {
        const f = fields.find(x => x.name === n);
        if (f && !f.group) {
          if (!isIndexed(f)) throw new Error(`"${n}" is a ${TYPES[f.type].label} field and can't be in a no-repeat group.`);
          f.group = 'G' + (gi + 1);
        }
      });
    });
  }
  // Check group sizes are representable
  for (const [g, fs] of Object.entries(groupsOf({ fields }))) {
    const size = fs.reduce((p, f) => p * fieldSize(f), 1);
    if (size > Number.MAX_SAFE_INTEGER) throw new Error(`Group "${g}" has too many combinations.`);
  }
  return { id: raw.id || uid(), name, fields };
}

function groupsOf(cfg) {
  const g = {};
  cfg.fields.forEach(f => { if (f.group) (g[f.group] = g[f.group] || []).push(f); });
  return g;
}
function groupSize(fs) { return fs.reduce((p, f) => p * fieldSize(f), 1); }
function signature(cfg) { return JSON.stringify(cfg.fields); }

// ---------- Generation ----------
// Pick an unused combination of a group's fields, honouring list weights
// (a combination's weight is the product of its values' weights). Returns {index, reset}.
function pickUnused(fs, used) {
  const sizes = fs.map(fieldSize);
  const total = sizes.reduce((p, s) => p * s, 1);
  let reset = false;
  if (used.size >= total) { used.clear(); reset = true; }
  const draw = weighted => fs.reduce((idx, f, i) => idx * sizes[i] + (weighted && f.type === 'list' ? pickWeighted(f) : randInt(sizes[i])), 0);

  // Independent weighted draws, rejecting used combinations, give exactly the weighted distribution over the unused ones.
  const tries = total > 2e6 ? 1e5 : 200;
  for (let t = 0; t < tries; t++) { const n = draw(true); if (!used.has(n)) return { index: n, reset }; }

  if (total > 2e6) { // astronomically unlikely; fall back to an unweighted unused pick
    let n; do { n = draw(false); } while (used.has(n));
    return { index: n, reset };
  }
  // Mostly used up: enumerate the unused combinations and pick by weight.
  const weightOf = n => {
    let w = 1;
    for (let i = fs.length - 1; i >= 0; i--) {
      const k = n % sizes[i]; n = Math.floor(n / sizes[i]);
      if (fs[i].type === 'list') w *= listItems(fs[i]).items[k].w;
    }
    return w;
  };
  let sum = 0;
  for (let n = 0; n < total; n++) if (!used.has(n)) sum += weightOf(n);
  let r = rand01() * sum, last = -1;
  for (let n = 0; n < total; n++) {
    if (used.has(n)) continue;
    last = n;
    r -= weightOf(n);
    if (r < 0) break;
  }
  return { index: last, reset };
}

function generate(cfg, st) {
  const result = new Array(cfg.fields.length);
  const notes = [];
  const gs = groupsOf(cfg);
  for (const [g, fs] of Object.entries(gs)) {
    const used = new Set(st.groups[g] || []);
    const { index, reset } = pickUnused(fs, used);
    if (reset) notes.push(`Group "${g}" was exhausted – starting over.`);
    used.add(index);
    st.groups[g] = Array.from(used);
    let rem = index;
    for (let i = fs.length - 1; i >= 0; i--) { // mixed-radix decode
      const s = fieldSize(fs[i]);
      const k = rem % s; rem = Math.floor(rem / s);
      result[cfg.fields.indexOf(fs[i])] = fieldValue(fs[i], k);
    }
  }
  cfg.fields.forEach((f, i) => { if (!f.group) result[i] = randomDisplay(f); });
  return { values: result, notes };
}

// ---------- Markdown (for choices with "markdown": true) ----------
// Inline Markdown plus a small, sanitised subset of HTML (so choices can have colours, links, etc.).
// The sanitiser rebuilds the DOM from a whitelist, so imported configs can't inject scripts.
const MD_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'CODE', 'MARK', 'SMALL', 'SUB', 'SUP', 'SPAN', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG']);
const MD_STYLES = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-decoration', 'text-transform', 'letter-spacing', 'width', 'height', 'vertical-align']);

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function mdToHtml(src) {
  const stash = [];
  const hold = html => '\u0000' + (stash.push(html) - 1) + '\u0000';
  let s = src.replace(/`([^`]+)`/g, (_, c) => hold('<code>' + escapeHtml(c) + '</code>'));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => '<img src="' + url.replace(/"/g, '%22') + '" alt="' + alt.replace(/"/g, '&quot;') + '">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => '<a href="' + url.replace(/"/g, '%22') + '">' + text + '</a>');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, t => hold(t)); // keep tags (and their attributes) safe from emphasis rules
  s = s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, x, y) => '<strong>' + (x ?? y) + '</strong>')
       .replace(/~~(.+?)~~/g, '<s>$1</s>')
       .replace(/\*(.+?)\*/g, '<em>$1</em>')
       .replace(/(^|[^\w])_(.+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/^(#{1,6})\s+(.*)$/, (_, h, t) => `<h${h.length}>${t}</h${h.length}>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[+n]);
}

function cleanStyle(style) {
  return style.split(';').map(d => {
    const i = d.indexOf(':');
    if (i < 0) return '';
    const prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
    return MD_STYLES.has(prop) && /^[#\w\s.,%()\-]+$/.test(val) && !/url|expression|var|attr|image/i.test(val) ? `${prop}:${val}` : '';
  }).filter(Boolean).join(';');
}

function sanitizeInto(src, dest) {
  for (const n of Array.from(src.childNodes)) {
    if (n.nodeType === 3) { dest.append(document.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1) continue;
    if (!MD_TAGS.has(n.tagName)) { // unknown tag: drop it, keep its text (but never script/style contents)
      if (!/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) sanitizeInto(n, dest);
      continue;
    }
    const el = document.createElement(n.tagName.toLowerCase());
    const style = n.getAttribute('style');
    if (style) { const c = cleanStyle(style); if (c) el.setAttribute('style', c); }
    if (n.tagName === 'A') {
      const href = (n.getAttribute('href') || '').trim();
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        try { el.setAttribute('href', new URL(href).href); el.target = '_blank'; el.rel = 'noopener noreferrer'; } catch { /* ignore bad URL */ }
      }
    }
    if (n.tagName === 'IMG') {
      // https, embedded data:image, or a relative path on this site; never http, javascript:, or protocol-relative URLs
      const src = (n.getAttribute('src') || '').trim();
      const ok = /^https:\/\//i.test(src) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(src) ||
        (!/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[\\/]{2}/.test(src) && src !== '');
      if (!ok) continue;
      el.setAttribute('src', src);
      el.alt = n.getAttribute('alt') || '';
      el.referrerPolicy = 'no-referrer';
      for (const dim of ['width', 'height']) { const v = n.getAttribute(dim); if (/^\d{1,4}$/.test(v || '')) el.setAttribute(dim, v); }
    }
    sanitizeInto(n, el);
    dest.append(el);
  }
}

const mdCache = new Map();
function renderMarkdown(src) { // returns a fresh DocumentFragment
  let tpl = mdCache.get(src);
  if (!tpl) {
    tpl = document.createDocumentFragment();
    sanitizeInto(new DOMParser().parseFromString('<body>' + mdToHtml(src), 'text/html').body, tpl);
    if (mdCache.size > 500) mdCache.clear();
    mdCache.set(src, tpl);
  }
  return tpl.cloneNode(true);
}
function plainText(src) {
  const frag = renderMarkdown(src);
  frag.querySelectorAll('img').forEach(img => img.replaceWith(img.alt || '[image]'));
  return frag.textContent;
}

// Show a field's value (rendered as Markdown if the field asks for it).
function setValue(el, f, text) {
  if (f.markdown) el.replaceChildren(renderMarkdown(text));
  else el.textContent = text;
}

// ---------- Views ----------
let configs = loadConfigs();
let current = null;   // config being run / edited
let editing = null;   // draft while editing
let rolling = false;

function show(view) {
  for (const v of ['viewHome', 'viewRun', 'viewEdit']) $(v).classList.toggle('hidden', v !== view);
  window.scrollTo(0, 0);
}
function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : '') + (el.classList.contains('center') ? ' center' : ''); }

function summary(cfg) {
  const gs = Object.keys(groupsOf(cfg)).length;
  return `${cfg.fields.length} field${cfg.fields.length === 1 ? '' : 's'}` +
    (gs ? ` · ${gs} no-repeat group${gs === 1 ? '' : 's'}` : '') +
    ' — ' + cfg.fields.map(f => f.name).join(', ');
}

function renderHome() {
  setMsg($('homeMsg'), '');
  const box = $('configList');
  box.textContent = '';
  $('emptyMsg').classList.toggle('hidden', configs.length > 0);
  if (!configs.length) renderDefaults();
  configs.forEach(cfg => {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h3'); h.textContent = cfg.name;
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = summary(cfg);
    const row = document.createElement('div'); row.className = 'row';
    const use = document.createElement('button'); use.className = 'primary'; use.textContent = 'Use';
    use.onclick = () => openRun(cfg.id);
    const ed = document.createElement('button'); ed.textContent = 'Edit';
    ed.onclick = () => openEdit(cfg.id);
    row.append(use, ed);
    card.append(h, m, row);
    box.append(card);
  });
  show('viewHome');
}

// ----- Run view -----
function openRun(id) {
  current = configs.find(c => c.id === id);
  if (!current) return renderHome();
  const st = loadState(id);
  if (st.sig !== signature(current)) { st.groups = {}; st.history = []; st.stats = {}; st.mom = {}; st.n = 0; st.sig = signature(current); saveState(id, st); }
  $('runName').textContent = current.name;
  const tiles = $('tiles');
  tiles.textContent = '';
  current.fields.forEach(f => {
    const t = document.createElement('div'); t.className = 'tile';
    if (f.group) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '⟳̸ ' + f.group; tag.title = 'No-repeat group ' + f.group; t.append(tag); }
    const l = document.createElement('div'); l.className = 'label'; l.textContent = f.name;
    const v = document.createElement('div'); v.className = 'value'; v.textContent = '–';
    t.append(l, v);
    tiles.append(t);
  });
  setMsg($('runMsg'), '');
  renderHistory(st);
  renderStats(st);
  renderGroupInfo(st);
  show('viewRun');
}

function renderHistory(st) {
  const ol = $('history');
  ol.textContent = '';
  if (!st.history.length) { const li = document.createElement('li'); li.textContent = 'Nothing generated yet.'; ol.append(li); return; }
  st.history.forEach(h => {
    const li = document.createElement('li');
    h.forEach((v, i) => {
      if (i) li.append(' · ');
      const b = document.createElement('b'); setValue(b, current.fields[i], v); li.append(b);
    });
    ol.append(li);
  });
}

const MAX_STAT_ROWS = 60;

// Expected probability of each possible value for fields small enough to chart; null otherwise.
function expectedRows(f) {
  if (f.type === 'list') {
    const { items, total } = listItems(f);
    return items.map(x => ({ label: x.label, p: x.w / total }));
  }
  if (f.type === 'number') {
    const size = fieldSize(f);
    if (size > MAX_STAT_ROWS) return null;
    return Array.from({ length: size }, (_, k) => ({ label: fieldValue(f, k), p: 1 / size }));
  }
  if (f.type === 'binomial' && f.trials + 1 <= MAX_STAT_ROWS) {
    const { trials: n, p } = f;
    const rows = [];
    let pk = Math.pow(1 - p, n);
    for (let k = 0; k <= n; k++) {
      if (p === 1) pk = k === n ? 1 : 0;
      rows.push({ label: String(k), p: pk });
      if (p > 0 && p < 1) pk *= (n - k) / (k + 1) * p / (1 - p);
    }
    return rows;
  }
  return null;
}

function note(box, text, bad) {
  const p = document.createElement('p'); p.className = 'small ' + (bad ? 'err' : 'muted'); p.textContent = text; box.append(p);
}

function renderStats(st) {
  const box = $('stats');
  box.textContent = '';
  const n = st.n || 0;
  if (!n) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Nothing generated yet.'; box.append(p); return; }
  const groups = groupsOf(current);
  current.fields.forEach((f, i) => {
    const h = document.createElement('h4'); h.textContent = `${f.name} — ${n} generated`;
    box.append(h);
    const rows = expectedRows(f);
    const th = theory(f);
    const mom = (st.mom && st.mom[i]) || { n: 0, s: 0, q: 0 };
    let verdict = null; // { bad, text }

    if (rows) {
      const counts = (st.stats && st.stats[i]) || {};
      const nf = Object.values(counts).reduce((s, c) => s + c, 0);
      // Expected shares don't hold when weighted choices are drawn without replacement.
      const skewedGroup = f.group && groups[f.group].some(g => g.type === 'list' && listItems(g).items.some(x => x.w !== listItems(g).items[0].w));
      const data = rows.map(r => ({ ...r, c: counts[r.label] || 0, e: nf * r.p }));
      const scale = Math.max(...data.map(d => Math.max(d.c, skewedGroup ? 0 : d.e))) || 1;
      const wrap = document.createElement('div'); wrap.className = 'bars';
      data.forEach(d => {
        const row = document.createElement('div'); row.className = 'bar-row';
        const l = document.createElement('span'); l.className = 'bar-label'; l.textContent = f.markdown ? plainText(d.label) : d.label;
        const track = document.createElement('div'); track.className = 'bar-track';
        const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = (d.c / scale * 100) + '%';
        track.append(fill);
        if (!skewedGroup) {
          const mark = document.createElement('div'); mark.className = 'bar-expected'; mark.style.left = (d.e / scale * 100) + '%';
          mark.title = `expected ${(d.p * 100).toFixed(1)}%`;
          track.append(mark);
        }
        const t = document.createElement('span'); t.className = 'bar-count'; t.textContent = `${d.c} (${nf ? (d.c / nf * 100).toFixed(1) : '0.0'}%)`;
        row.append(l, track, t); wrap.append(row);
      });
      box.append(wrap);

      if (skewedGroup) verdict = { text: 'Expected shares are not shown: weighted choices in a no-repeat group are drawn without replacement.' };
      else if (nf < 30) verdict = { text: 'Line on each bar = expected count. Too few samples to judge bias yet.' };
      else {
        // chi-square vs expected; bins with expected count < 5 are pooled (Wilson-Hilferty approximation for the p < 0.01 cutoff)
        let bins = data.filter(d => d.e >= 5).map(d => ({ c: d.c, e: d.e }));
        const pool = data.filter(d => d.e < 5).reduce((s, d) => ({ c: s.c + d.c, e: s.e + d.e }), { c: 0, e: 0 });
        if (pool.e > 0) {
          if (pool.e >= 5 || !bins.length) bins.push(pool);
          else { const m = bins.reduce((a, b) => (b.e < a.e ? b : a)); m.c += pool.c; m.e += pool.e; }
        }
        const df = bins.length - 1;
        if (df < 1) verdict = { text: 'Line on each bar = expected count. Too few samples to judge bias yet.' };
        else {
          const chi = bins.reduce((s, b) => s + (b.c - b.e) ** 2 / b.e, 0);
          const z = (Math.cbrt(chi / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
          verdict = z > 2.33
            ? { bad: true, text: 'Line on each bar = expected count. This looks unlikely for the configured distribution (p < 0.01).' }
            : { text: 'Line on each bar = expected count. Consistent with the configured distribution.' };
        }
      }
    }

    if (th) { // numeric: compare sample mean / sd with theory
      if (!mom.n) note(box, 'No numeric samples recorded yet.');
      else {
        const mean = mom.s / mom.n;
        const sd = mom.n > 1 ? Math.sqrt(Math.max(0, (mom.q - mom.s * mom.s / mom.n) / (mom.n - 1))) : NaN;
        note(box, `Mean ${mean.toFixed(3)} (expected ${th.mean.toFixed(3)}) · Std dev ${Number.isNaN(sd) ? '–' : sd.toFixed(3)} (expected ${th.sd.toFixed(3)})`);
        if (!verdict) {
          if (mom.n < 30) verdict = { text: 'Too few samples to judge bias yet.' };
          else {
            const z = (mean - th.mean) / (th.sd / Math.sqrt(mom.n));
            verdict = Math.abs(z) > 3
              ? { bad: true, text: 'The average is further from the expected mean than chance should allow.' }
              : { text: 'Average is consistent with the configured distribution.' };
          }
        }
      }
    }
    if (verdict) note(box, verdict.text, verdict.bad);
  });
}

function renderGroupInfo(st) {
  const box = $('groupInfo');
  box.textContent = '';
  const gs = groupsOf(current);
  const names = Object.keys(gs);
  box.classList.toggle('hidden', !names.length);
  if (!names.length) return;
  const h = document.createElement('h3'); h.textContent = 'Without-replacement groups'; box.append(h);
  names.forEach(g => {
    const total = groupSize(gs[g]);
    const used = (st.groups[g] || []).length;
    const row = document.createElement('div'); row.className = 'ginfo';
    const t = document.createElement('span');
    t.textContent = `${g} (${gs[g].map(f => f.name).join(' + ')}): ${used} of ${total.toLocaleString()} combinations used`;
    const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Reset';
    b.onclick = () => {
      const s = loadState(current.id); delete s.groups[g]; saveState(current.id, s);
      renderGroupInfo(s); setMsg($('runMsg'), `Group "${g}" reset.`, 'ok');
    };
    row.append(t, b); box.append(row);
  });
}

// Hold Generate to spin; the result settles ~1s after release.
let pressing = false;   // button/key currently held
let released = null;    // timestamp of release, null while held
let finals = null;      // result chosen at release

function onPress() {
  if (rolling || pressing || !current) return;
  pressing = true; rolling = true; released = null; finals = null;
  setMsg($('runMsg'), '');
  $('genBtn').classList.add('held');
  spin(current);
}

function onRelease() {
  if (!pressing) return;
  pressing = false;
  $('genBtn').classList.remove('held');
  const cfg = current;
  const st = loadState(cfg.id);
  st.sig = signature(cfg);
  const { values, notes } = generate(cfg, st);
  st.history = [values, ...st.history].slice(0, 50);
  st.stats = st.stats || {};
  st.n = (st.n || 0) + 1;
  st.mom = st.mom || {};
  values.forEach((v, i) => {
    const f = cfg.fields[i];
    if (expectedRows(f)) { const s = st.stats[i] = st.stats[i] || {}; s[v] = (s[v] || 0) + 1; }
    if (f.type !== 'list') { const x = parseFloat(v), m = st.mom[i] = st.mom[i] || { n: 0, s: 0, q: 0 }; m.n++; m.s += x; m.q += x * x; }
  });
  saveState(cfg.id, st); // persist immediately so a reload can't replay a value
  finals = { values, st, notes };
  released = performance.now();
}

function spin(cfg) {
  const tiles = Array.from($('tiles').children);
  const n = tiles.length;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stopOffset = tiles.map((_, i) => 650 + (n > 1 ? (i / (n - 1)) * 350 : 350)); // after release; all settled within ~1s
  const lastSwap = tiles.map(() => 0);
  const settled = tiles.map(() => false);
  tiles.forEach(t => { t.classList.remove('landed'); t.classList.add('rolling'); });

  function frame(now) {
    const dt = released === null ? -1 : now - released;
    let pending = 0;
    tiles.forEach((t, i) => {
      if (settled[i]) return;
      const val = t.querySelector('.value');
      if (finals && (dt >= stopOffset[i] || reduce && dt >= 100)) {
        settled[i] = true;
        setValue(val, cfg.fields[i], finals.values[i]);
        t.classList.remove('rolling');
        void t.offsetWidth; // restart pop animation
        t.classList.add('landed');
      } else {
        pending++;
        // flicker at full speed while held, then slow down as we approach the end
        const gap = 40 + (dt < 0 ? 0 : (dt / stopOffset[i]) * 90);
        if (now - lastSwap[i] > gap) { setValue(val, cfg.fields[i], randomDisplay(cfg.fields[i])); lastSwap[i] = now; }
      }
    });
    if (pending) { requestAnimationFrame(frame); return; }
    rolling = false;
    if (current === cfg) {
      renderHistory(finals.st);
      renderStats(finals.st);
      renderGroupInfo(finals.st);
      if (finals.notes.length) setMsg($('runMsg'), finals.notes.join(' '), 'ok');
    }
  }
  requestAnimationFrame(frame);
}

// ----- Edit view -----
function openEdit(id) {
  if (id) {
    const c = configs.find(x => x.id === id);
    editing = JSON.parse(JSON.stringify(c));
    $('editTitle').textContent = 'Edit configuration';
    $('deleteBtn').classList.remove('hidden');
  } else {
    editing = {
      id: uid(), name: '',
      fields: [{ name: 'Number', type: 'number', min: 1, max: 100, step: 1, group: '' }]
    };
    $('editTitle').textContent = 'New configuration';
    $('deleteBtn').classList.add('hidden');
  }
  $('cfgName').value = editing.name;
  renderFieldEditors();
  setMsg($('editMsg'), '');
  show('viewEdit');
}

// ----- Pasting / dropping images into a Markdown choices box -----
function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
const MAX_IMAGE_CHARS = 300000;
// Downscale raster images (choice images are small); keep SVG and animated GIF as they are.
async function imageToDataUrl(file, max = 256) {
  let out;
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') out = await fileToDataUrl(file);
  else {
    const objUrl = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = objUrl; await img.decode();
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/png');
      if (out.length > 60000) { const w = c.toDataURL('image/webp', 0.85); if (w.startsWith('data:image/webp') && w.length < out.length) out = w; }
    } finally { URL.revokeObjectURL(objUrl); }
  }
  if (out.length > MAX_IMAGE_CHARS) throw new Error(`Image is too large (${Math.round(out.length / 1024)} KB after processing; the limit is ${Math.round(MAX_IMAGE_CHARS / 1024)} KB).`);
  return out;
}

function renderFieldEditors() {
  const box = $('fieldEditors');
  box.textContent = '';
  editing.fields.forEach((f, i) => {
    const w = document.createElement('div'); w.className = 'field-ed';
    const typeOpts = Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
    const spec = TYPES[f.type];
    w.innerHTML = `
      <div class="head"><b>Field ${i + 1}</b>
        <span><button class="small up">↑</button> <button class="small down">↓</button> <button class="small danger rm">Remove</button></span></div>
      <div class="grid">
        <label>Name<input class="f-name"></label>
        <label>Type<select class="f-type">${typeOpts}</select></label>
        <label class="grp">No-repeat group<input class="f-group" placeholder="(none)" maxlength="20" list="groupNames"></label>
      </div>
      <div class="params grid3"></div>
      <div class="lst">
        <label style="margin-top:10px"><span class="lst-help"></span> Optional weight prefix, e.g. <code>2:Likely</code> and <code>1:Unlikely</code>.<textarea class="f-values" rows="4" placeholder="2:Likely&#10;1:Unlikely"></textarea></label>
        <label class="check"><input type="checkbox" class="f-md"> Render choices as Markdown (one choice per line). Supports **bold**, *italic*, [links](https://example.com) and colours such as &lt;span style="color:red"&gt;red&lt;/span&gt;.</label>
      </div>`;
    const q = s => w.querySelector(s);
    q('.f-name').value = f.name;
    q('.f-type').value = f.type;
    q('.f-group').value = f.group || '';
    q('.f-values').value = (f.values || []).join('\n');
    q('.f-md').checked = !!f.markdown;
    const splitter = () => (f.markdown ? /\n/ : /[\n,]/);
    const syncMd = () => {
      q('.f-md').checked = !!f.markdown;
      q('.lst-help').textContent = f.markdown ? 'Choices (one per line).' : 'Choices (one per line, or comma separated).';
      q('.f-values').wrap = f.markdown ? 'off' : 'soft'; // long data: URLs stay on one line
    };
    syncMd();
    q('.grp').classList.toggle('hidden', !spec.indexed);
    q('.lst').classList.toggle('hidden', f.type !== 'list');
    spec.params.forEach(([key, label]) => {
      const l = document.createElement('label'); l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = 'any'; inp.value = f[key];
      inp.oninput = e => { f[key] = e.target.value; };
      l.append(inp); q('.params').append(l);
    });
    q('.params').classList.toggle('hidden', !spec.params.length);
    q('.f-name').oninput = e => f.name = e.target.value;
    q('.f-group').oninput = e => f.group = e.target.value;
    q('.f-type').onchange = e => {
      f.type = e.target.value;
      const next = TYPES[f.type];
      next.params.forEach(([key, , def]) => { f[key] = def; });  // start from the new type's defaults
      if (!next.indexed) f.group = '';
      if (f.type === 'list' && !(f.values || []).length) f.values = ['2:Likely', '1:Unlikely'];
      renderFieldEditors();
    };
    q('.f-values').oninput = e => f.values = e.target.value.split(splitter());
    q('.f-md').onchange = e => {
      f.markdown = e.target.checked;
      f.values = q('.f-values').value.split(splitter());
      syncMd();
    };
    // Paste (or drop) an image into the choices: it is shrunk and inserted as a data: URL.
    const ta = q('.f-values');
    const takeImages = e => {
      const dt = e.clipboardData || e.dataTransfer;
      const files = Array.from((dt && dt.files) || []).filter(x => x.type.startsWith('image/'));
      if (!files.length) return; // ordinary text paste/drop
      e.preventDefault();
      if (!f.markdown) { f.markdown = true; syncMd(); } // images need Markdown (and its newline-only splitting)
      files.reduce((p, file) => p.then(async () => {
        const url = await imageToDataUrl(file);
        ta.setRangeText(`![image](${url})`, ta.selectionStart, ta.selectionEnd, 'end');
        f.values = ta.value.split(splitter());
        setMsg($('editMsg'), `Image added (${Math.round(url.length / 1024)} KB). Give it a better description by editing the text inside [ ].`, 'ok');
      }), Promise.resolve()).catch(err => setMsg($('editMsg'), err.message || 'Could not add that image.', 'err'));
    };
    ta.addEventListener('paste', takeImages);
    ta.addEventListener('drop', takeImages);
    ta.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
    q('.rm').onclick = () => { if (editing.fields.length > 1) { editing.fields.splice(i, 1); renderFieldEditors(); } };
    q('.up').onclick = () => { if (i > 0) { [editing.fields[i - 1], editing.fields[i]] = [f, editing.fields[i - 1]]; renderFieldEditors(); } };
    q('.down').onclick = () => { if (i < editing.fields.length - 1) { [editing.fields[i + 1], editing.fields[i]] = [f, editing.fields[i + 1]]; renderFieldEditors(); } };
    box.append(w);
  });
  let dl = $('groupNames');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'groupNames'; document.body.append(dl); }
  dl.textContent = '';
  ['A', 'B', 'C'].forEach(g => { const o = document.createElement('option'); o.value = g; dl.append(o); });
}

function onSave() {
  editing.name = $('cfgName').value;
  let cfg;
  try { cfg = normalise(editing); } catch (e) { return setMsg($('editMsg'), e.message, 'err'); }
  cfg.id = editing.id;
  upsert(cfg);
  localStorage.removeItem(stateKey(cfg.id)); // structure may have changed
  renderHome();
}

function upsert(cfg) {
  const i = configs.findIndex(c => c.id === cfg.id);
  if (i >= 0) configs[i] = cfg; else configs.push(cfg);
  saveConfigs(configs);
}

// ----- Defaults (offered when there are no saved configurations) -----
let defaultsPromise = null;
function loadDefaults() {
  defaultsPromise = defaultsPromise || fetch('default.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => (Array.isArray(j) ? j : [j]).filter(o => { try { normalise(o); return true; } catch { return false; } }))
    .catch(() => { defaultsPromise = null; return []; }); // don't remember a failure
  return defaultsPromise;
}
async function renderDefaults() {
  const box = $('defaultList');
  box.textContent = '';
  const list = await loadDefaults();
  if (configs.length) return; // something was added while loading
  list.forEach(def => {
    const card = document.createElement('div'); card.className = 'card';
    const h = document.createElement('h3'); h.textContent = def.name;
    const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Create';
    b.onclick = () => { const cfg = normalise({ ...def, id: undefined }); upsert(cfg); openRun(cfg.id); };
    card.append(h, b); box.append(card);
  });
}

async function fillDefaultSelect() {
  const list = await loadDefaults();
  const sel = $('defaultSelect');
  sel.textContent = '';
  list.forEach((d, i) => { const o = document.createElement('option'); o.value = i; o.textContent = d.name; sel.append(o); });
  $('defaultRow').classList.toggle('hidden', !list.length);
}

// ----- Import / export -----
function importObject(obj) {
  const arr = Array.isArray(obj) ? obj : [obj];
  const added = arr.map(o => {
    const cfg = normalise({ ...o, id: undefined }); // always a fresh id
    upsert(cfg);
    return cfg.name;
  });
  $('newDlg').close();
  renderHome();
  setMsg($('homeMsg'), `Imported: ${added.join(', ')}`, 'ok');
}

async function importFromUrl(url) {
  setMsg($('importMsg'), 'Fetching…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    importObject(await res.json());
  } catch (e) {
    setMsg($('importMsg'), 'Import failed: ' + e.message, 'err');
  }
}

function onExport() {
  editing.name = $('cfgName').value;
  let cfg;
  try { cfg = normalise(editing); } catch (e) { return setMsg($('editMsg'), e.message, 'err'); }
  setMsg($('editMsg'), '');
  const { id, ...rest } = cfg;
  $('exportText').value = JSON.stringify(rest, null, 2);
  $('exportDlg').showModal();
}

// ---------- Wiring ----------
$('homeLink').onclick = e => { e.preventDefault(); renderHome(); };
$('newBtn').onclick = () => { setMsg($('importMsg'), ''); fillDefaultSelect(); $('newDlg').showModal(); };
$('addDefault').onclick = async () => {
  const def = (await loadDefaults())[$('defaultSelect').value];
  if (!def) return;
  const cfg = normalise({ ...def, id: undefined });
  upsert(cfg);
  $('newDlg').close();
  renderHome();
  setMsg($('homeMsg'), `Added: ${cfg.name}`, 'ok');
};
$('newBlank').onclick = () => { $('newDlg').close(); openEdit(null); };
$('closeNew').onclick = () => $('newDlg').close();
$('addField').onclick = () => {
  editing.fields.push({ name: 'Field ' + (editing.fields.length + 1), type: 'number', min: 1, max: 100, step: 1, group: '' });
  renderFieldEditors();
};
$('saveBtn').onclick = onSave;
$('cancelBtn').onclick = renderHome;
$('deleteBtn').onclick = () => {
  if (!confirm('Delete this configuration and its saved state?')) return;
  configs = configs.filter(c => c.id !== editing.id);
  saveConfigs(configs);
  localStorage.removeItem(stateKey(editing.id));
  renderHome();
};
$('genBtn').addEventListener('pointerdown', e => { if (e.button === 0 || e.pointerType !== 'mouse') { e.preventDefault(); onPress(); } });
window.addEventListener('pointerup', onRelease);
window.addEventListener('pointercancel', onRelease);
$('genBtn').addEventListener('contextmenu', e => e.preventDefault());
$('resetStats').onclick = () => {
  if (!current || rolling) return;
  const s = loadState(current.id); s.stats = {}; s.mom = {}; s.n = 0; saveState(current.id, s); renderStats(s);
};
$('runEdit').onclick = () => openEdit(current.id);
$('exportBtn').onclick = onExport;
$('closeExport').onclick = () => $('exportDlg').close();
$('copyBtn').onclick = () => { $('exportText').select(); navigator.clipboard?.writeText($('exportText').value); };
$('importUrlBtn').onclick = () => { const u = $('importUrl').value.trim(); if (u) importFromUrl(u); };
$('importTextBtn').onclick = () => {
  try { importObject(JSON.parse($('importText').value)); $('importText').value = ''; }
  catch (e) { setMsg($('importMsg'), 'Import failed: ' + e.message, 'err'); }
};
const isGenKey = e => (e.key === ' ' || e.key === 'Enter') && !$('viewRun').classList.contains('hidden') &&
  (document.activeElement === $('genBtn') || !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement.tagName));
document.addEventListener('keydown', e => { if (isGenKey(e)) { e.preventDefault(); if (!e.repeat) onPress(); } });
document.addEventListener('keyup', e => { if ((e.key === ' ' || e.key === 'Enter') && pressing) { e.preventDefault(); onRelease(); } });

// Start: honour ?import=URL
renderHome();
const params = new URLSearchParams(location.search);
if (params.has('stats')) $('statsPanel').classList.remove('hidden'); // stats are hidden unless the URL has ?stats
if (params.get('import')) {
  $('importUrl').value = params.get('import');
  importFromUrl(params.get('import')).then(() => {
    params.delete('import');
    const q = params.toString().replace(/=(&|$)/g, '$1'); // keep ?stats without a trailing '='
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
    if ($('homeMsg').textContent === '') $('newDlg').showModal(); // failed: show the error
  });
}

// PWA: offline support via service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // When an updated service worker takes over, reload once so the new files are used straight away.
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !rolling && !pressing && $('viewEdit').classList.contains('hidden')) { reloaded = true; location.reload(); } });
  }
}
