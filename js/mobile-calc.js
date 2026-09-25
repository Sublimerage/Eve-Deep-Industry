'use strict';

// Phone layout: the Calculator screen. The build is priced by MB.E (see js/mobile-core.js) on a
// flattened copy of the site's own full recipe tree, so Build/Buy, stations, runs and ME/TE all
// recalculate instantly. Everything the Calculator remembers uses the desktop's own localStorage
// keys (eve_active_product, eve_build_self_overrides, eve_custom_buy_modes, ...), so a phone and a
// desktop tab in the same browser pick up where the other left off.
(() => {
  const MB = window.MB;
  const { $, $$, esc, MINUS, full, compact, qty, dur, ICON, LS, toast, prefs } = MB;

  /* =====================  State  ===================== */
  const SELL_KEY = { auto: 'market-sell', market: 'custom-market-sell', contract: 'custom-contract' };
  const SELL_FROM = { 'market-sell': 'auto', 'custom-market-sell': 'market', 'custom-contract': 'contract' };
  const C = {
    product: normalizeProduct(LS.get('eve_active_product', null)),
    ov: LS.get('eve_build_self_overrides', {}),
    sources: LS.get('eve_custom_buy_modes', {}),
    meOv: LS.get('eve_custom_me_overrides', {}),
    teOv: LS.get('eve_custom_te_overrides', {}),
    bulk: { target: LS.get('eve_bulk_me_target', null), snapshot: LS.get('eve_bulk_me_snapshot', null) },
    runs: Math.max(1, parseInt(LS.raw('eve_global_runs')) || 1),
    jobs: Math.max(1, parseInt(LS.raw('eve_global_jobs')) || 1),
    sell: { mode: SELL_FROM[LS.raw('eve_root_sell_strategy')] || 'auto', price: parseFloat(LS.raw('eve_root_custom_price')) || 0 },
    lastBp: LS.get('eve_last_loaded_blueprint_source', null),
    item: null, loading: false, loadMsg: '', error: null, token: 0,
    focusId: null, expanded: new Set(), view: 'tree', lpCtx: null
  };
  // The desktop remembers the item as {id, name}; normally a blueprint. A product id (possible from
  // older saves) is swapped for its blueprint so the build choices line up with the desktop's.
  function normalizeProduct(p) {
    let id = p && p.id ? parseInt(p.id) : 944;
    const r = window.recipeMap && window.recipeMap[id];
    if (r && r.blueprintTypeID && parseInt(r.blueprintTypeID) !== id) id = parseInt(r.blueprintTypeID);
    return { id, name: (window.EVE_ITEMS && window.EVE_ITEMS[id]) || (p && p.name) || 'Punisher Blueprint' };
  }
  function saveState() {
    LS.set('eve_active_product', C.product);
    LS.set('eve_build_self_overrides', C.ov);
    LS.set('eve_custom_buy_modes', C.sources);
    LS.set('eve_custom_me_overrides', C.meOv);
    LS.set('eve_custom_te_overrides', C.teOv);
    LS.set('eve_bulk_me_target', C.bulk.target || null);
    LS.set('eve_bulk_me_snapshot', C.bulk.snapshot || null);
    LS.set('eve_global_runs', String(C.runs));
    LS.set('eve_global_jobs', String(C.jobs));
    LS.set('eve_root_sell_strategy', SELL_KEY[C.sell.mode]);
    LS.set('eve_root_custom_price', String(C.sell.price || 0));
  }

  // Engine items built this session, by blueprint, so going back to an item (or scanning blueprints)
  // doesn't rebuild its tree. Prices come from the shared window.priceCache.
  const itemCache = new Map();
  async function getItem(bpId, onProgress) {
    let item = itemCache.get(bpId);
    if (!item) {
      item = await MB.loadFullItem(bpId, onProgress);
      itemCache.set(bpId, item);
      if (itemCache.size > 16) itemCache.delete(itemCache.keys().next().value);
    }
    MB.refreshEIV(item);
    MB.refreshDefaults(item);
    return item;
  }

  /* =====================  The item and its choices  ===================== */
  const cur = () => C.item;
  const priceOf = pt => window.priceCache[pt] || { sell: 0, buy: 0 };
  const isEst = pt => !!(window.priceCache[pt] && window.priceCache[pt].isEstimated);
  const estMark = pt => (isEst(pt) ? '<span class="est" title="No Jita orders right now. This is EVE\'s estimated price.">~</span>' : '');
  const sourceOf = n => C.sources[n.k] || prefs.priceMode;
  const unitPrice = n => (sourceOf(n) === 'buy' ? priceOf(n.pt).buy * (1 + MB.feeFrac().brokerFee) : priceOf(n.pt).sell);
  const reactionOff = n => !prefs.reactions && n.r;
  const wantsBuild = n => (C.ov[n.k] !== undefined ? C.ov[n.k] : n.d === 0) && !reactionOff(n);
  const isBuilt = n => wantsBuild(n) && n.kids.length > 0;
  const canBuild = n => n.m && n.kids.length > 0 && !reactionOff(n);
  const meOf = n => (C.meOv[n.k] !== undefined ? C.meOv[n.k] : n.me);
  const teOf = n => (C.teOv[n.k] !== undefined ? C.teOv[n.k] : n.te);
  const cfgFor = (st, extra) => ({
    runs: C.runs, jobs: C.jobs, station: MB.engineStation(st), ov: C.ov, sources: C.sources, defaultSource: prefs.priceMode,
    meOv: C.meOv, teOv: C.teOv, skills: MB.skillsForEngine(), implantPct: MB.implantPct(), fee: MB.feeFrac(),
    reactions: prefs.reactions, sell: C.sell, ...(extra || {})
  });
  // Prices the build at a station and leaves every node set for it, so anything that evaluates
  // something else has to call evaluate() again afterwards.
  const evaluate = (st = MB.activeStation()) => MB.E.evaluate(cur(), cfgFor(st));
  function liveNodes(from) {
    const out = [];
    const walk = n => { for (const c of n.kids) { out.push(c); if (isBuilt(c)) walk(c); } };
    if (from && isBuilt(from)) walk(from);
    return out;
  }
  function allNodes() {
    const out = [];
    (function walk(n) { out.push(n); n.kids.forEach(walk); })(cur().root);
    return out;
  }
  const productTypes = () => new Set(cur() ? cur().nodes.filter(n => n.hasMats).map(n => n.pt) : []);

  /* =====================  Optimizers (js/optimizers.js)  ===================== */
  // Build or buy: start from "build everything", keep a part on Build only if that raises profit
  // (net sale at Jita sell minus cost) by at least the threshold, as a share of the fully-built cost.
  function optimize() {
    const keys = [], seen = new Set();
    const collect = n => { if (n.d > 0 && n.m && !seen.has(n.k)) { seen.add(n.k); keys.push(n.k); } n.kids.forEach(collect); };
    collect(cur().root);
    for (const k of keys) C.ov[k] = true;
    const base = evaluate().cost;
    const profit = () => { const r = evaluate(); return r.marketNet - r.cost; };
    for (const k of keys) {
      C.ov[k] = false; const whenBought = profit();
      C.ov[k] = true; const whenBuilt = profit();
      C.ov[k] = whenBuilt > whenBought && ((whenBuilt - whenBought) / base) * 100 >= prefs.opt.build;
    }
  }
  // Bulk ME/TE (stampBulkMETargetIfArmed): while a target is armed, parts switched to Build get it.
  function stampBulk(n) {
    const t = C.bulk.target;
    if (!t || !n.m || !n.hasMats || n.r) return;
    C.meOv[n.k] = t.me;
    C.teOv[n.k] = t.te;
  }
  function plusLayer() {
    const add = [];
    const walk = n => { if (!isBuilt(n)) return; for (const c of n.kids) { if (canBuild(c) && !wantsBuild(c)) add.push(c); walk(c); } };
    walk(cur().root);
    add.forEach(n => { C.ov[n.k] = true; stampBulk(n); });
    return new Set(add.map(n => n.k)).size;
  }
  function minusLayer() {
    const rm = [];
    const walk = n => {
      if (!isBuilt(n)) return false;
      let kidBuilt = false;
      for (const c of n.kids) if (walk(c)) kidBuilt = true;
      if (!kidBuilt && n.d > 0) rm.push(n.k);
      return true;
    };
    walk(cur().root);
    rm.forEach(k => { C.ov[k] = false; });
    return new Set(rm).size;
  }
  function buildAll() { for (const n of cur().nodes) if (n.d > 0 && canBuild(n)) { C.ov[n.k] = true; stampBulk(n); } }
  // The desktop's "Buy all" also re-picks every price source with the market-spread rule afterwards.
  function buyAll() { for (const n of cur().nodes) if (n.d > 0 && canBuild(n)) C.ov[n.k] = false; return pickSources(); }
  const orderCount = () => new Set(liveNodes(cur().root).filter(n => !isBuilt(n) && sourceOf(n) === 'buy').map(n => n.k)).size;
  function pickSources() {
    for (const n of allNodes()) {
      if (isBuilt(n)) continue;
      const { sell, buy } = priceOf(n.pt);
      C.sources[n.k] = sell > 0 && buy > 0 && sell > buy && ((sell - buy) / sell) * 100 >= prefs.opt.spread ? 'buy' : 'sell';
    }
    return orderCount();
  }
  function pickSourcesByBudget() {
    const total = evaluate().cost;
    for (const n of allNodes()) {
      if (isBuilt(n)) continue;
      const { sell, buy } = priceOf(n.pt);
      const q = Math.max(0, n.q - (prefs.deduct && MB.isLoggedIn() ? MB.stockOf(n.pt) : 0));
      const saving = (sell - buy) * q;
      C.sources[n.k] = sell * q > 0 && buy * q > 0 && sell > buy && total > 0 && (saving / total) * 100 >= prefs.opt.budget ? 'buy' : 'sell';
    }
    return orderCount();
  }

  /* =====================  Skills  ===================== */
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
  const skillName = id => MB.nameOf(id);
  // js/app.js computeMissingSkills: every part you build, checked against its blueprint's required
  // levels. Nothing to check without a real skill sheet.
  function missingSkills(realOnly) {
    if (!MB.hasSkillSheet() || !cur()) return [];
    const raw = MB.rawSkills().allSkills || {};
    const lv = id => (realOnly || !prefs.simV ? raw[id] || 0 : Math.max(raw[id] || 0, 5));
    const out = [], seen = new Set();
    (function walk(n) {
      if (!isBuilt(n)) return;
      if (!seen.has(n.k)) {
        seen.add(n.k);
        const miss = (n.rsl || []).filter(([id, need]) => lv(id) < need).map(([id, need]) => ({ id, name: skillName(id), need, have: lv(id) }));
        if (miss.length) out.push({ k: n.k, pt: n.pt, name: n.n, miss });
      }
      n.kids.forEach(walk);
    })(cur().root);
    return out;
  }
  function skillsSummary() {
    if (!MB.hasSkillSheet()) return MB.isLoggedIn() ? 'Loading your skills…' : 'Log in to check your skills against these blueprints';
    const miss = missingSkills(true);
    if (!miss.length) return 'You have every skill this build needs';
    const count = new Set(miss.flatMap(m => m.miss.map(s => s.id))).size;
    return `${count} skill${count === 1 ? '' : 's'} missing${prefs.simV ? ' (simulating V right now)' : ''}`;
  }

  /* =====================  Rendering  ===================== */
  const runsText = (runs, jobs) => (jobs > 1 ? `${jobs} jobs × ${runs} run${runs === 1 ? '' : 's'}` : `${runs} run${runs === 1 ? '' : 's'}`);
  const pathTo = id => { const p = []; let n = cur().byId.get(id); while (n) { p.unshift(n); n = n.p == null ? null : cur().byId.get(n.p); } return p; };
  function normalizeFocus() {
    const it = cur();
    if (!it.byId.has(C.focusId)) { C.focusId = it.root.i; return; }
    const path = pathTo(C.focusId);
    for (let j = 1; j < path.length; j++) if (!isBuilt(path[j])) { C.focusId = path[j - 1].i; return; }
  }

  function renderProduct() {
    const it = cur();
    const pt = it ? it.pt : productOfBp(C.product.id);
    $('#p-icon').innerHTML = pt ? `<img src="${MB.iconUrl(pt)}" alt="" onerror="this.remove()">` : '';
    $('#p-name').textContent = it ? it.name : productName(C.product.name);
    $('#p-sub').textContent = `${(it && it.group) || 'Item'} · tap to change item`;
    $('#item-open').setAttribute('aria-label', `${$('#p-name').textContent}. Change item`);
    if (document.activeElement !== $('#in-runs')) $('#in-runs').value = C.runs;
    if (document.activeElement !== $('#in-jobs')) $('#in-jobs').value = C.jobs;
    const ctx = C.lpCtx;
    const banner = $('#lp-banner');
    banner.hidden = !(ctx && it && ctx.pt === it.pt);
    if (!banner.hidden) {
      banner.innerHTML = `<p>Opened from the <b>${esc(ctx.corp)}</b> LP store: a ${ctx.runs}-run copy for <b>${qty(ctx.lp)} LP</b>${ctx.isk ? ` + <b>${compact(ctx.isk)} ISK</b>` : ''}${ctx.reqCost ? ` + items worth ${compact(ctx.reqCost)}` : ''}. Those are paid on top of the build cost below.</p><button type="button" data-lpbanner aria-label="Dismiss">${ICON.x}</button>`;
    }
    const chip = $('#root-mete');
    if (!it) { chip.disabled = true; chip.textContent = 'ME · TE'; return; }
    if (it.root.r) {
      chip.disabled = true;
      chip.textContent = 'Reaction · no ME/TE';
      chip.removeAttribute('aria-label');
    } else {
      chip.disabled = false;
      chip.innerHTML = `${ICON.edit}ME ${meOf(it.root)} · TE ${teOf(it.root)}`;
      chip.setAttribute('aria-label', `${it.name} blueprint: ME ${meOf(it.root)}, TE ${teOf(it.root)}. Change`);
    }
  }

  let lastTotals = null;
  function renderStats() {
    const t = evaluate();
    $('#v-cost').textContent = compact(t.cost);
    $('#v-cost-full').textContent = full(t.cost);
    $('#v-sell').textContent = compact(t.net);
    $('#v-sell-sub').textContent = C.sell.mode === 'auto' ? 'net of fees' : C.sell.mode === 'market' ? 'your price, net' : 'contract, net';
    $('#stat-sell').setAttribute('aria-label', `Sells for ${compact(t.net)}, ${C.sell.mode === 'auto' ? 'at Jita sell' : C.sell.mode === 'market' ? 'at your own price' : 'on contract'}, net of fees. Change how you sell it`);
    const p = $('#v-profit');
    p.textContent = compact(t.profit, true);
    p.className = 'val ' + (t.profit >= 0 ? 'pos' : 'neg');
    $('#v-roi').textContent = t.cost > 0 ? 'ROI ' + (t.profit >= 0 ? '+' : MINUS) + Math.abs((t.profit / t.cost) * 100).toFixed(1) + '%' : '';
    $('#t-time').textContent = t.seconds > 0 ? `${dur(t.seconds)} to build` : isBuilt(cur().root) ? 'No build time data' : 'Bought, not built';
    const perHour = t.seconds > 0 ? t.profit / (t.seconds / 3600) : 0;
    $('#t-sub').textContent = (t.seconds > 0 ? `${compact(perHour, true)} ISK/hour` : '') + (t.surplus > 0.5 ? `${t.seconds > 0 ? ' · ' : ''}includes ${compact(t.surplus)} of leftovers` : '') + (MB.eivLoaded ? '' : ' · job fees loading');
    if (lastTotals && Math.abs(lastTotals.cost - t.cost) > 0.5) {
      for (const id of ['stat-cost', 'stat-profit']) {
        const el = document.getElementById(id);
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 80);
      }
    }
    lastTotals = t;
    return t;
  }

  function renderSkillBar() {
    const bar = $('#skillbar');
    if (!MB.hasSkillSheet() || !MB.isLoggedIn()) { bar.hidden = true; return; }
    if (prefs.simV) {
      bar.hidden = false;
      bar.className = 'skillbar sim';
      bar.innerHTML = `${ICON.skill}<p>Build times assume <b>every skill at V</b>.</p><button type="button" data-skill="open">Skills</button><button type="button" data-skill="stop">Stop</button>`;
      return;
    }
    const miss = missingSkills();
    if (!miss.length) { bar.hidden = true; return; }
    const count = new Set(miss.flatMap(m => m.miss.map(s => s.id))).size;
    bar.hidden = false;
    bar.className = 'skillbar';
    bar.innerHTML = `${ICON.warn}<p><b>${count} skill${count === 1 ? '' : 's'} missing</b> for ${miss.length === 1 ? esc(miss[0].name) : `${miss.length} parts you build`}</p><button type="button" data-skill="open">See which</button>`;
  }

  function srcPill(n) {
    const order = sourceOf(n) === 'buy';
    const aria = order ? `${n.n} is priced as a Jita buy order. Switch to Jita sell` : `${n.n} is priced at Jita sell. Switch to a Jita buy order`;
    return `<button class="src ${order ? 'buy' : 'sell'}" type="button" data-act="src" data-i="${n.i}" aria-label="${esc(aria)}">${order ? ICON.order : ICON.bolt}${order ? 'Jita buy' : 'Jita sell'}</button>`;
  }
  function haveTag(pt, need) {
    const h = MB.have(pt);
    if (!h) return '';
    return h >= need ? '<span class="have full">In stock</span>' : `<span class="have">Have ${qty(h)}</span>`;
  }
  function rowHTML(n, lvl) {
    const built = isBuilt(n);
    const buildable = canBuild(n);
    const open = built && C.expanded.has(n.i);
    const chev = built
      ? `<button class="chev" type="button" data-act="toggle" data-i="${n.i}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} what ${esc(n.n)} is made of">${ICON.chev}</button>`
      : '<span class="chev-sp" aria-hidden="true"></span>';
    let hint = '';
    if (buildable) {
      const buildSaves = n.buy - n.build;
      const threshold = Math.max(1000, n.buy * 0.01);
      if (built && -buildSaves > threshold) hint = `<span class="hint warn">Buying it is ${compact(-buildSaves)} cheaper</span>`;
      if (!built && buildSaves > threshold) hint = `<span class="hint save">Building it saves ${compact(buildSaves)}</span>`;
    } else if (reactionOff(n) && n.kids.length) {
      hint = '<span class="hint muted">Reaction · bought while reactions are off</span>';
    }
    let main;
    if (built) {
      const research = n.r ? '' : `<span class="tags"><button class="chip-me" type="button" data-act="mete" data-i="${n.i}" aria-label="${esc(n.n)} blueprint: ME ${meOf(n)}, TE ${teOf(n)}. Change">ME ${meOf(n)} · TE ${teOf(n)}</button></span>`;
      main = `<div class="main"><button class="main-open" type="button" data-act="focus" data-i="${n.i}" aria-label="Open ${esc(n.n)} on its own"><span class="nm">${esc(n.n)}</span><span class="sub">×${qty(n.q)} · ${n.kids.length} input${n.kids.length === 1 ? '' : 's'}${n.r ? ' · reaction' : ''}<span class="open">${ICON.chev}</span></span></button>${research}${hint}</div>`;
    } else {
      main = `<div class="main"><span class="nm">${esc(n.n)}</span><span class="sub">×${qty(n.q)} · ${compact(unitPrice(n))} each${estMark(n.pt)}</span><span class="tags">${srcPill(n)}${haveTag(n.pt, n.q)}</span>${hint}</div>`;
    }
    const seg = buildable
      ? `<div class="seg" role="group" aria-label="Buy or build ${esc(n.n)}"><button class="buy" type="button" data-act="buy" data-i="${n.i}" aria-pressed="${!built}">Buy</button><button class="build" type="button" data-act="build" data-i="${n.i}" aria-pressed="${built}">Build</button></div>`
      : '';
    return `<li class="row" style="--lvl:${Math.min(lvl, 5)}">${chev}${MB.iconHTML(n.pt)}${main}<div class="right"><span class="cost">${compact(n.all)}</span>${seg}</div></li>`;
  }

  function renderTree() {
    const it = cur();
    normalizeFocus();
    const focus = it.byId.get(C.focusId);
    const rows = [];
    const walk = (n, lvl) => { for (const c of n.kids) { rows.push(rowHTML(c, lvl)); if (isBuilt(c) && C.expanded.has(c.i)) walk(c, lvl + 1); } };
    if (isBuilt(focus)) walk(focus, 0);
    else if (it.root.r && !prefs.reactions) rows.push(`<li class="tree-note">${ICON.warn}<p>${esc(it.root.n)} is made by a reaction, and reactions are off in Settings, so it's priced as bought at Jita: <b>${compact(it.root.buy)}</b>.</p><button class="btn" type="button" data-act="react-on">Turn reactions on</button></li>`);
    else rows.push(`<li class="tree-note">${ICON.warn}<p>No recipe materials were found for ${esc(it.root.n)}, so it's priced as bought at Jita.</p></li>`);
    $('#tree').innerHTML = rows.join('');

    const path = $('#path');
    if (focus === it.root) {
      path.hidden = true;
      path.innerHTML = '';
      $('#parts-title').textContent = 'Parts';
    } else {
      const trail = pathTo(C.focusId);
      path.hidden = false;
      path.innerHTML = `<button class="back" type="button" data-act="up" aria-label="Back to ${esc(trail[trail.length - 2].n)}">${ICON.back}</button><div class="crumbs">` +
        trail.map((n, j) => (j ? '<span class="crumb-sep" aria-hidden="true">›</span>' : '') +
          `<button class="crumb" type="button" data-act="goto" data-i="${n.i}"${n === focus ? ' aria-current="location"' : ''}>${esc(n.n)}</button>`).join('') + '</div>';
      const crumbs = path.querySelector('.crumbs');
      crumbs.scrollLeft = crumbs.scrollWidth;
      $('#parts-title').textContent = 'Inputs';
    }
    const live = liveNodes(focus);
    const builtCount = live.filter(isBuilt).length;
    $('#parts-count').textContent = live.length ? `${builtCount} built · ${live.length - builtCount} bought` : '';
    const anyExpandable = isBuilt(focus) && focus.kids.some(isBuilt);
    let allOpen = anyExpandable;
    const w = n => { for (const c of n.kids) if (isBuilt(c)) { if (!C.expanded.has(c.i)) allOpen = false; w(c); } };
    if (anyExpandable) w(focus);
    const ex = $('#expand-all');
    ex.hidden = !anyExpandable;
    ex.textContent = allOpen ? 'Collapse all' : 'Expand all';
    ex.dataset.mode = allOpen ? 'collapse' : 'expand';
  }

  /* ---------- Shopping list ---------- */
  const BOM_CATS = [['minerals', 'Minerals'], ['pigas', 'PI & gas'], ['fuel', 'Fuel'], ['ships', 'Ships'], ['others', 'Other']];
  function shoppingList() {
    const it = cur();
    const map = new Map();
    for (const n of isBuilt(it.root) ? liveNodes(it.root) : [it.root]) {
      if (isBuilt(n)) continue;
      const e = map.get(n.pt) || { pt: n.pt, name: n.n, need: 0, node: n };
      e.need += n.q;
      map.set(n.pt, e);
    }
    return [...map.values()].map(e => {
      const unit = unitPrice(e.node);
      const h = MB.have(e.pt);
      const toBuy = Math.max(0, e.need - h);
      const vol = (window.EVE_VOLUMES && window.EVE_VOLUMES[e.pt]) || 0;
      return { ...e, unit, have: h, toBuy, cost: toBuy * unit, fullCost: e.need * unit, vol: vol * toBuy, cat: window.getItemCategory(e.pt, e.name), order: sourceOf(e.node) };
    }).sort((a, b) => (b.toBuy > 0) - (a.toBuy > 0) || b.cost - a.cost || b.fullCost - a.fullCost);
  }
  const bomShown = list => list.filter(x => (prefs.bom.cat === 'all' || x.cat === prefs.bom.cat) && (prefs.bom.order === 'all' || x.order === prefs.bom.order));
  const volText = v => (v >= 1e5 ? compact(v) : v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 0 })) + ' m³';

  function stockControlsHTML() {
    if (!MB.isLoggedIn()) {
      return `<div class="login-card">${ICON.lock}<p>Log in to take what you already own off this list.</p><button class="btn primary" type="button" data-open="account">Log in</button></div>`;
    }
    const synced = parseInt(LS.raw('eve_assets_last_synced')) || 0;
    const locs = MB.stockLocations();
    if (!locs.some(([v]) => v === prefs.stockLoc)) prefs.stockLoc = 'all';
    return `<div class="card-title">Your stock</div>
      <div class="card">
        <div class="kv"><span class="k">Take what I own off the list<small>${esc(MB.activeChar().charName)} · ${synced ? `assets refreshed ${MB.ago(synced)}` : 'assets loading'}</small></span><button class="switch" type="button" role="switch" data-ctl="deduct" aria-checked="${prefs.deduct}" aria-label="Take what I own off the list"></button></div>
        <div class="kv"><span class="k">Count stock from</span><span class="pillset"><button class="chip small" type="button" data-ctl="personal" aria-pressed="${prefs.stockPersonal}">Personal</button><button class="chip small" type="button" data-ctl="corp" aria-pressed="${prefs.stockCorp}">Corp</button></span></div>
        <div class="kv"><label class="k" for="loc">Location</label><span style="flex:1.4;min-width:0"><select id="loc" data-ctl="loc">${locs.map(([v, l]) => `<option value="${esc(v)}"${v === prefs.stockLoc ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span></div>
      </div>`;
  }
  function shopFiltersHTML(all) {
    const cats = BOM_CATS.filter(([key]) => all.some(x => x.cat === key));
    const filtered = prefs.bom.cat !== 'all' || prefs.bom.order !== 'all';
    return `<div class="chiprow" role="group" aria-label="Show by category">
        <button class="chip" type="button" data-bomcat="all" aria-pressed="${prefs.bom.cat === 'all'}">All</button>
        ${cats.map(([key, label]) => `<button class="chip" type="button" data-bomcat="${key}" aria-pressed="${prefs.bom.cat === key}">${label} <span class="chip-n">${all.filter(x => x.cat === key).length}</span></button>`).join('')}
      </div>
      <div class="shopbar">
        <span class="segctl" role="group" aria-label="Show by price source">
          <button type="button" data-bomorder="all" aria-pressed="${prefs.bom.order === 'all'}">All</button>
          <button type="button" data-bomorder="sell" data-mode="sell" aria-pressed="${prefs.bom.order === 'sell'}">${ICON.bolt}Jita sell</button>
          <button type="button" data-bomorder="buy" data-mode="buy" aria-pressed="${prefs.bom.order === 'buy'}">${ICON.order}Jita buy</button>
        </span>
        <button class="viewbtn" type="button" data-bomview aria-label="${prefs.bom.compact ? 'Show detailed rows' : 'Show compact rows'}">${prefs.bom.compact ? ICON.rows : ICON.list}${prefs.bom.compact ? 'Detailed' : 'Compact'}</button>
      </div>
      ${filtered ? `<p class="note filtnote">Showing ${prefs.bom.cat === 'all' ? 'every category' : BOM_CATS.find(c => c[0] === prefs.bom.cat)[1]}${prefs.bom.order === 'all' ? '' : prefs.bom.order === 'buy' ? ', Jita buy orders only' : ', Jita sell only'}. Totals and Copy Multibuy follow the filter. <button class="inlink" type="button" data-bomclear>Show everything</button></p>` : ''}`;
  }
  function shopRowHTML(x) {
    if (prefs.bom.compact) {
      return `<li class="shop-row compact${x.toBuy ? '' : ' done'}">${MB.iconHTML(x.pt)}<span class="nm1">${esc(x.name)}</span><span class="qty1">${x.toBuy ? '×' + qty(x.toBuy) : ''}</span><span class="cost">${x.toBuy ? compact(x.cost) : 'in stock'}</span></li>`;
    }
    return `<li class="shop-row${x.toBuy ? '' : ' done'}">${MB.iconHTML(x.pt)}
        <div class="main"><span class="nm">${esc(x.name)}</span><span class="sub">need ${qty(x.need)}${x.have ? ` · have ${qty(x.have)}` : ''} · ${compact(x.unit)} each${estMark(x.pt)}${x.toBuy && x.vol ? ` · ${volText(x.vol)}` : ''}</span><span class="tags">${srcPill(x.node)}</span></div>
        <div class="right"><span class="cost">${x.toBuy ? compact(x.cost) : '—'}</span><span class="buyqty">${x.toBuy ? 'buy ' + qty(x.toBuy) : 'in stock'}</span></div>
      </li>`;
  }
  function renderShop() {
    const all = shoppingList();
    if (prefs.bom.cat !== 'all' && !all.some(x => x.cat === prefs.bom.cat)) prefs.bom.cat = 'all';
    const list = bomShown(all);
    const toBuyItems = list.filter(x => x.toBuy > 0);
    $('#shop-count').textContent = all.filter(x => x.toBuy > 0).length;
    if (C.view !== 'shop') return;
    const still = list.reduce((s, x) => s + x.cost, 0);
    const fullValue = list.reduce((s, x) => s + x.fullCost, 0);
    const vol = list.reduce((s, x) => s + x.vol, 0);
    const covered = list.length - toBuyItems.length;
    $('#p-shop').innerHTML = `
      ${stockControlsHTML()}
      ${shopFiltersHTML(all)}
      <div class="shop-sum">
        <div><div class="lbl">Still to buy</div><div class="big">${compact(still)}</div></div>
        <div class="side">${toBuyItems.length} item${toBuyItems.length === 1 ? '' : 's'}${covered ? ` · ${covered} in stock` : ''}<br>${vol ? `${volText(vol)} · ` : ''}full value ${compact(fullValue)}</div>
      </div>
      ${list.length ? `<ul class="shop" id="shop">${list.map(shopRowHTML).join('')}</ul>` : '<p class="empty"><b>Nothing here</b>No items match this filter.</p>'}
      <div style="height:12px"></div>
      <button class="btn primary" type="button" id="copy-shop"${toBuyItems.length ? '' : ' disabled'}>${ICON.copy}Copy Multibuy · ${toBuyItems.length} item${toBuyItems.length === 1 ? '' : 's'}</button>
      <p class="note">Build cost at the top always counts every material at full value, same as the desktop. Your stock only changes what's left to buy here and what Copy Multibuy copies. Stock used by started Ledger jobs isn't counted twice.</p>`;
  }

  function renderStationBar() {
    const st = MB.activeStation();
    $('#st-name').textContent = st.name;
    $('#st-meta').innerHTML = MB.stationMeta(st);
  }

  function setView(v) {
    C.view = v;
    $('#t-tree').setAttribute('aria-selected', String(v === 'tree'));
    $('#t-shop').setAttribute('aria-selected', String(v === 'shop'));
    $('#p-tree').hidden = v !== 'tree';
    $('#p-shop').hidden = v !== 'shop';
    if (cur()) renderShop();
  }

  function renderLoading() {
    $('#tree').innerHTML = C.error
      ? `<li class="tree-note">${ICON.warn}<p>${esc(C.error)}</p><button class="btn" type="button" data-act="retry">Try again</button></li>`
      : `<li class="loading-row"><span class="spin" aria-hidden="true"></span>${esc(C.loadMsg || 'Loading the build…')}</li>`;
    $('#parts-count').textContent = '';
    $('#expand-all').hidden = true;
    $('#path').hidden = true;
    for (const id of ['v-cost', 'v-sell', 'v-profit']) $('#' + id).textContent = '—';
    $('#v-cost-full').textContent = '';
    $('#v-roi').textContent = '';
    $('#t-time').textContent = C.error ? 'Not loaded' : 'Loading…';
    $('#t-sub').textContent = '';
    $('#p-shop').innerHTML = C.view === 'shop' ? '<div class="loading-row"><span class="spin" aria-hidden="true"></span>Loading…</div>' : '';
    $('#shop-count').textContent = '';
    $('#skillbar').hidden = true;
  }

  function render() {
    renderProduct();
    renderStationBar();
    $('#tip').hidden = !!prefs.tipDismissed;
    $('#add-ledger').disabled = !cur() || C.loading;
    if (!cur() || C.loading) { renderLoading(); return; }
    renderStats();
    renderSkillBar();
    renderTree();
    renderShop();
  }
  MB.screens.calc = {
    title: 'Calculator',
    render,
    enter() {
      if (!cur() && !C.loading) selectItem(C.product.id, { preserve: true });
      else render();
    },
    always() { if (cur()) MB.refreshDefaults(cur()); }
  };

  /* =====================  Picking an item  ===================== */
  function productOfBp(bpId) {
    const r = window.recipeMap && window.recipeMap[bpId];
    const p = r && parseInt(r.productTypeID);
    if (p && p !== bpId) return p;
    return (window.BLUEPRINT_TO_PRODUCT_MAP && window.BLUEPRINT_TO_PRODUCT_MAP[bpId]) || window.resolveProductIdFromBlueprintName((window.EVE_ITEMS && window.EVE_ITEMS[bpId]) || '') || null;
  }
  const productName = bpName => String(bpName || '').replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();

  // Loads an item. A fresh pick starts clean (build choices, price sources, ME/TE, runs, selling),
  // like the desktop's selectItem; preserve keeps them (reopening, or loading one of your blueprints).
  async function selectItem(bpId, opts = {}) {
    const token = ++C.token;
    if (!opts.preserve) {
      C.ov = {}; C.sources = {}; C.meOv = {}; C.teOv = {};
      C.runs = 1; C.jobs = 1; C.sell = { mode: 'auto', price: 0 };
    }
    if (!opts.keepLp) C.lpCtx = null;
    C.product = { id: bpId, name: (window.EVE_ITEMS && window.EVE_ITEMS[bpId]) || MB.nameOf(bpId) };
    const recent = (prefs.recent || []).filter(id => id !== bpId);
    recent.unshift(bpId);
    prefs.recent = recent.slice(0, 8);
    MB.savePrefs();
    saveState();
    C.item = null; C.loading = true; C.error = null; C.loadMsg = ''; C.expanded.clear(); C.focusId = null; lastTotals = null;
    if (MB.screen() === 'calc') render();
    try {
      const item = await getItem(bpId, msg => { if (token === C.token) { C.loadMsg = msg; if (MB.screen() === 'calc' && !cur()) renderLoading(); } });
      if (token !== C.token) return;
      C.item = item;
      C.loading = false;
      C.focusId = item.root.i;
      const firstBuilt = item.root.kids.find(isBuilt);
      if (firstBuilt) C.expanded.add(firstBuilt.i);
    } catch (e) {
      if (token !== C.token) return;
      console.error('[Phone] Could not load', bpId, e);
      C.loading = false;
      C.error = `Couldn't load ${productName(C.product.name)}: ${e.message || e}. Check your connection and try again.`;
    }
    if (MB.screen() === 'calc') { render(); $('#screen-calc').scrollTo({ top: 0 }); }
  }

  // Blueprint and reaction-formula names that have a recipe, like the desktop's searchItems.
  function searchBlueprints(q, limit = 25) {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const exact = [], starts = [], contains = [];
    for (const [k, v] of Object.entries(window.IDX || {})) {
      if (!window.isBlueprintName(k) || !window.recipeMap[v.id]) continue;
      const pn = productName(k);
      if (pn === ql || k === ql) exact.push(v);
      else if (pn.startsWith(ql)) starts.push(v);
      else if (k.includes(ql)) contains.push(v);
      if (exact.length + starts.length >= limit) break;
    }
    return [...exact, ...starts, ...contains].slice(0, limit);
  }
  const POPULAR = ['Rifter', 'Caracal', 'Drake', 'Hurricane', 'Raven', 'Ishtar', 'Hobgoblin II', 'Damage Control II', 'Nanite Repair Paste', 'Hydrogen Fuel Block'];
  function bpForName(name) {
    const l = name.toLowerCase();
    for (const suffix of [' blueprint', ' reaction formula', ' formula']) {
      const v = window.IDX[l + suffix];
      if (v && window.recipeMap[v.id]) return v.id;
    }
    return null;
  }
  function itemRowHTML(bpId) {
    const pt = productOfBp(bpId);
    const bpName = (window.EVE_ITEMS && window.EVE_ITEMS[bpId]) || '';
    const group = (pt && window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[pt]) || '';
    const kind = /reaction formula$|formula$/i.test(bpName) ? 'Reaction' : 'Blueprint';
    const p = pt && window.priceCache[pt];
    return `<li><button type="button" data-item="${bpId}" aria-current="${!!cur() && cur().bp === bpId}">${MB.iconHTML(pt)}<span><b>${esc(productName(bpName))}</b><small>${esc(group || kind)}</small></span><span class="r">${p && p.sell ? `${compact(p.sell)}<br><small>Jita sell</small>` : ''}</span></button></li>`;
  }

  /* =====================  Add to Ledger (js/app.js addCurrentJobToLedger)  ===================== */
  // Rebuilds the build with the site's own tree builder and your current choices, then writes the
  // job exactly as the desktop does: every part you build becomes its own prerequisite job, sized
  // down to what your stock doesn't already cover, and the item itself goes in last.
  function addToLedger() {
    const it = cur();
    if (!it) return;
    const btn = $('#add-ledger');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Adding…';
    return MB.treeLock(() => addToLedgerNow(it, btn, label));
  }
  async function addToLedgerNow(it, btn, label) {
    const saved = { b: window.buildSelfOverrides, me: window.customMEOverrides, te: window.customTEOverrides, m: window.customBuyModes };
    try {
      MB.syncShim();
      MB.setStationGlobals();
      window.buildSelfOverrides = { ...C.ov };
      window.customBuyModes = { ...C.sources };
      window.customMEOverrides = { ...C.meOv };
      window.customTEOverrides = { ...C.teOv };
      window.recipeTreeRootProductTypeId = it.pt;
      const root = await window.buildRecursiveRecipeTree(it.bp, it.bpName, 1, 0, 10, new Set(), null, C.jobs);
      window.recipeTreeRootProductTypeId = null;
      const facility = (window.getActiveStructureType().meBonus || 0) / 100;
      root.qtyNeeded = (root.batchYield || 1) * C.runs * C.jobs;
      root.runsNeeded = C.runs * C.jobs;
      root.jobCount = C.jobs;
      window.scaleTreeQuantities(root, facility);
      window.calculateNodeEIV(root);
      const f = MB.feeFrac();
      const costBonus = (window.getActiveStructureType().costBonus || 0) / 100;
      let matCost = 0;
      if (root.isBuildingSelf && root.children && root.children.length) root.children.forEach(c => { matCost += window.calculateTreeNodeCost(c); });
      else matCost = window.calculateTreeNodeCost(root);
      const jobFees = window.calculateNodeJobFee(root, f.facilityTax, f.sccSurcharge, costBonus);
      root.calculatedCost = matCost + jobFees;
      const t = evaluate();

      const { rootMaterials, subBuilds } = resolveStockAwareSubBuilds(root, facility);
      const rootJobName = root.productName || productName(root.name);
      const sel = LS.get('eve_selected_system', {});
      const productionSnapshot = {
        systemId: sel.id || null, systemName: sel.name || null,
        facilityKey: LS.raw('eve_active_facility_key') || 'sotiyo',
        rig1: LS.raw('eve_rig_slot_1') || '', rig2: LS.raw('eve_rig_slot_2') || '', rig3: LS.raw('eve_rig_slot_3') || ''
      };
      const snapME = { ...C.meOv }, snapTE = { ...C.teOv };
      (function backfill(n) {
        if (!n) return;
        if (n.typeId !== undefined) {
          if (snapME[n.typeId] === undefined) snapME[n.typeId] = n.customME || 0;
          if (snapTE[n.typeId] === undefined) snapTE[n.typeId] = n.customTE || 0;
        }
        (n.children || []).forEach(backfill);
      })(root);
      const buildConfigSnapshot = { buildSelfOverrides: { ...C.ov }, customBuyModes: { ...C.sources }, customMEOverrides: snapME, customTEOverrides: snapTE };
      // Same id recipe as the desktop (time + random + node), but checked against the queue and this
      // batch so two parts added in one click can never share an id.
      const queue = LS.get('eve_ledger_jobs', []);
      const taken = new Set(queue.map(j => j && j.id));
      const unique = id => { while (taken.has(id)) id++; taken.add(id); return id; };
      const rootJobId = unique(Date.now() + Math.floor(Math.random() * 1000));
      const ownerCharId = window.getActiveCharId ? window.getActiveCharId() : null;
      const addedAt = new Date().toISOString();
      const subJobs = subBuilds.map(sb => ({
        id: unique(Date.now() + Math.floor(Math.random() * 1000) + sb.node.instanceId),
        typeId: sb.node.typeId, productTypeId: sb.node.productTypeId,
        name: sb.node.productName || productName(sb.node.name),
        runsNeeded: sb.netRunsNeeded, qtyNeeded: sb.netQtyNeeded, calculatedCost: sb.calculatedCost || 0,
        baseTime: window.extractBuildTime(sb.node.recipe), totalBuildSeconds: sb.totalBuildSeconds, materials: sb.materials,
        isSubBuild: true, parentJobId: rootJobId, parentJobName: rootJobName,
        productionSnapshot, buildConfigSnapshot, scope: 'personal', ownerCharId, addedAt
      }));
      const sourceBlueprintItemId = C.lastBp && C.lastBp.typeId === root.typeId ? C.lastBp.itemId : undefined;
      const job = {
        id: rootJobId, typeId: root.typeId, name: rootJobName, productTypeId: root.productTypeId,
        runsNeeded: root.runsNeeded, qtyNeeded: root.qtyNeeded, calculatedCost: root.calculatedCost,
        baseTime: window.extractBuildTime(root.recipe), totalBuildSeconds: window.calculateTotalBuildSeconds(root),
        netProfit: t.profit, sellStrategy: SELL_KEY[C.sell.mode], unitSellPrice: C.sell.mode === 'auto' ? priceOf(it.pt).sell : (C.sell.price || 0),
        materials: rootMaterials, sourceBlueprintItemId, productionSnapshot, buildConfigSnapshot,
        jobCount: C.jobs, runsPerJob: C.runs, scope: 'personal', ownerCharId, addedAt
      };
      queue.push(...subJobs, job);
      LS.set('eve_ledger_jobs', queue);
      LS.set('eve_user_stock_map', window.userStockMap || {});
      MB.rebuildStock();
      if (MB.updateLedgerBadge) MB.updateLedgerBadge();
      toast(subJobs.length ? `Added ${rootJobName} and ${subJobs.length} part${subJobs.length === 1 ? '' : 's'} to build first` : `Added ${rootJobName}, ${runsText(C.runs, C.jobs)}, to the Ledger`, { label: 'View', run: () => MB.goScreen('ledger') });
    } catch (e) {
      console.error('[Phone] Add to Ledger failed:', e);
      toast('Could not add this to the Ledger. Try again.');
    } finally {
      window.recipeTreeRootProductTypeId = null;
      window.buildSelfOverrides = saved.b; window.customMEOverrides = saved.me; window.customTEOverrides = saved.te; window.customBuyModes = saved.m;
      btn.innerHTML = label;
      btn.disabled = false;
      if (cur()) evaluate();
    }
  }
  // js/app.js resolveStockAwareSubBuilds + mergeDuplicateSubBuilds, on a site tree.
  function resolveStockAwareSubBuilds(root, facility) {
    const subBuilds = [];
    function resolveLevel(parentMaterials, parentNode) {
      (parentNode.children || []).forEach(child => {
        const isBoundary = child.depth > 0 && child.isBuildingSelf && child.children && child.children.length > 0;
        if (!isBoundary) return;
        const productTypeId = child.productTypeId || child.typeId;
        const materialEntry = parentMaterials.find(m => m.typeId === productTypeId);
        const netQtyNeeded = materialEntry ? materialEntry.netQtyNeeded : child.qtyNeeded;
        const stockConsumed = materialEntry ? materialEntry.stockQty : 0;
        const batchYield = child.batchYield || 1;
        const netRunsNeeded = Math.ceil(netQtyNeeded / batchYield);
        const origRuns = child.runsNeeded, origQty = child.qtyNeeded;
        child.runsNeeded = netRunsNeeded;
        child.qtyNeeded = netRunsNeeded * batchYield;
        window.scaleTreeQuantities(child, facility);
        const childMaterials = window.extractJobMaterialsForNode(child);
        const calculatedCost = window.calculateTreeNodeCost(child);
        const totalBuildSeconds = window.calculateTotalBuildSeconds(child);
        resolveLevel(childMaterials, child);
        if (netRunsNeeded > 0) subBuilds.push({ node: child, stockConsumed, netQtyNeeded, netRunsNeeded, materials: childMaterials, calculatedCost, totalBuildSeconds });
        child.runsNeeded = origRuns;
        child.qtyNeeded = origQty;
        window.scaleTreeQuantities(child, facility);
      });
    }
    const rootMaterials = window.extractJobMaterialsForNode(root);
    resolveLevel(rootMaterials, root);
    const groups = new Map();
    subBuilds.forEach(sb => {
      const pid = sb.node.productTypeId || sb.node.typeId;
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push(sb);
    });
    const merged = [];
    groups.forEach(group => {
      if (group.length < 2) { merged.push(group[0]); return; }
      const rep = group[0].node;
      const combinedNetQty = group.reduce((s, sb) => s + sb.netQtyNeeded, 0);
      const combinedStock = group.reduce((s, sb) => s + (sb.stockConsumed || 0), 0);
      const y = rep.batchYield || 1;
      const runs = Math.ceil(combinedNetQty / y);
      const origRuns = rep.runsNeeded, origQty = rep.qtyNeeded;
      rep.runsNeeded = runs;
      rep.qtyNeeded = runs * y;
      window.scaleTreeQuantities(rep, facility);
      merged.push({ node: rep, stockConsumed: combinedStock, netQtyNeeded: runs * y, netRunsNeeded: runs, materials: window.extractJobMaterialsForNode(rep), calculatedCost: window.calculateTreeNodeCost(rep), totalBuildSeconds: window.calculateTotalBuildSeconds(rep) });
      rep.runsNeeded = origRuns;
      rep.qtyNeeded = origQty;
      window.scaleTreeQuantities(rep, facility);
    });
    return { rootMaterials, subBuilds: merged };
  }

  /* =====================  Screen events  ===================== */
  function flipSource(n) {
    C.sources[n.k] = sourceOf(n) === 'buy' ? 'sell' : 'buy';
    const same = liveNodes(cur().root).filter(x => x.k === n.k && !isBuilt(x)).length;
    saveState();
    render();
    const where = C.sources[n.k] === 'buy' ? 'Jita buy order' : 'Jita sell';
    toast(same > 1 ? `All ${same} ${n.n} now priced at ${where}` : `${n.n} now priced at ${where}`);
  }
  let meteKey = null;
  function openMete(n, from) {
    if (n.r) return;
    meteKey = n.k;
    MB.openSheet('mete', from);
  }

  $('#tree').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'retry') { selectItem(C.product.id, { preserve: true }); return; }
    if (act === 'react-on') { prefs.reactions = true; MB.savePrefs(); MB.syncShim(); render(); toast('Reactions on: reaction products can be built again'); return; }
    const n = cur().byId.get(+b.dataset.i);
    if (!n) return;
    if (act === 'src') { flipSource(n); return; }
    if (act === 'mete') { openMete(n, b); return; }
    if (act === 'toggle') { C.expanded.has(n.i) ? C.expanded.delete(n.i) : C.expanded.add(n.i); renderTree(); return; }
    if (act === 'focus') { C.focusId = n.i; renderTree(); $('#screen-calc').scrollTo({ top: $('#path').offsetTop - 12 }); return; }
    if (act === 'buy' || act === 'build') {
      const wasBuilt = isBuilt(n);
      C.ov[n.k] = act === 'build';
      if (act === 'build' && !wasBuilt) { C.expanded.add(n.i); stampBulk(n); }
      const same = liveNodes(cur().root).filter(x => x.k === n.k).length;
      saveState();
      render();
      if (same > 1) toast(`Applied to all ${same} ${n.n} in this build`);
    }
  });
  $('#path').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'up') C.focusId = cur().byId.get(C.focusId).p;
    if (b.dataset.act === 'goto') C.focusId = +b.dataset.i;
    renderTree();
  });
  $('#expand-all').addEventListener('click', e => {
    const collapse = e.currentTarget.dataset.mode === 'collapse';
    const w = n => { for (const c of n.kids) if (isBuilt(c)) { collapse ? C.expanded.delete(c.i) : C.expanded.add(c.i); w(c); } };
    w(cur().byId.get(C.focusId));
    renderTree();
  });
  $('#p-shop').addEventListener('click', async e => {
    const b = e.target.closest('[data-act], [data-ctl], [data-open], [data-bomcat], [data-bomorder], [data-bomview], [data-bomclear], #copy-shop');
    if (!b || !cur()) return;
    if (b.dataset.act === 'src') { flipSource(cur().byId.get(+b.dataset.i)); return; }
    if (b.dataset.open === 'account') { MB.openSheet('account', b); return; }
    if (b.dataset.ctl === 'deduct') { prefs.deduct = !prefs.deduct; MB.savePrefs(); MB.syncShim(); render(); return; }
    if (b.dataset.ctl === 'personal' || b.dataset.ctl === 'corp') {
      const k = b.dataset.ctl === 'personal' ? 'stockPersonal' : 'stockCorp';
      prefs[k] = !prefs[k];
      MB.savePrefs(); MB.rebuildStock(); render();
      return;
    }
    if (b.dataset.bomcat || b.dataset.bomorder || b.hasAttribute('data-bomview') || b.hasAttribute('data-bomclear')) {
      if (b.dataset.bomcat) prefs.bom.cat = b.dataset.bomcat;
      if (b.dataset.bomorder) prefs.bom.order = b.dataset.bomorder;
      if (b.hasAttribute('data-bomview')) prefs.bom.compact = !prefs.bom.compact;
      if (b.hasAttribute('data-bomclear')) { prefs.bom.cat = 'all'; prefs.bom.order = 'all'; }
      MB.savePrefs();
      const sel = b.dataset.bomcat ? `[data-bomcat="${b.dataset.bomcat}"]` : b.dataset.bomorder ? `[data-bomorder="${b.dataset.bomorder}"]` : b.hasAttribute('data-bomview') ? '[data-bomview]' : '[data-bomcat="all"]';
      renderShop();
      const again = $('#p-shop ' + sel);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    if (b.id === 'copy-shop') {
      const items = bomShown(shoppingList()).filter(x => x.toBuy > 0);
      const ok = await MB.copyText(items.map(x => `${x.name} x${Math.round(x.toBuy)}`).join('\n'));
      toast(ok ? `Copied ${items.length} items for EVE's Multibuy` : 'Copy was blocked by the browser');
    }
  });
  $('#p-shop').addEventListener('change', e => {
    if (e.target.id === 'loc') { prefs.stockLoc = e.target.value; MB.savePrefs(); MB.rebuildStock(); render(); }
  });
  $('#t-tree').addEventListener('click', () => setView('tree'));
  $('#t-shop').addEventListener('click', () => setView('shop'));
  $('#tip-close').addEventListener('click', () => { prefs.tipDismissed = true; MB.savePrefs(); $('#tip').hidden = true; });
  $('#lp-banner').addEventListener('click', e => { if (e.target.closest('[data-lpbanner]')) { C.lpCtx = null; renderProduct(); } });
  $('#item-open').addEventListener('click', e => MB.openSheet('items', e.currentTarget));
  $('#root-mete').addEventListener('click', e => { if (cur()) openMete(cur().root, e.currentTarget); });
  $('#stat-sell').addEventListener('click', e => { if (cur()) MB.openSheet('sell', e.currentTarget); });
  $('#station-open').addEventListener('click', e => MB.openSheet('stations', e.currentTarget));
  $('#station-best').addEventListener('click', switchToCheapest);
  $('#add-ledger').addEventListener('click', addToLedger);
  $('#settings-btn').addEventListener('click', e => MB.openSheet('settings', e.currentTarget));
  $('#skillbar').addEventListener('click', e => {
    const b = e.target.closest('[data-skill]');
    if (!b) return;
    if (b.dataset.skill === 'open') MB.openSheet('skills', b);
    if (b.dataset.skill === 'stop') { prefs.simV = false; MB.savePrefs(); MB.syncShim(); render(); toast('Back to your real skills'); }
  });
  $$('[data-tool]').forEach(b => b.addEventListener('click', () => {
    if (!cur()) return;
    const tool = b.dataset.tool;
    if (tool === 'optimize' || tool === 'bulk') { MB.openSheet(tool, b); return; }
    const armed = C.bulk.target ? `, blueprints set to ME ${C.bulk.target.me} · TE ${C.bulk.target.te}` : '';
    if (tool === 'plus') { const c = plusLayer(); toast(c ? `Now building ${c} more part type${c === 1 ? '' : 's'}${armed}` : 'Nothing left to build'); }
    if (tool === 'minus') { const c = minusLayer(); toast(c ? `Now buying ${c} more part type${c === 1 ? '' : 's'}` : 'Already buying every part'); }
    if (tool === 'all') { buildAll(); toast(`Building every part down to raw materials${armed}`); }
    if (tool === 'none') { const c = buyAll(); C.focusId = cur().root.i; toast(`Buying every part ready-made${c ? `, ${c} on Jita buy orders (spread of ${prefs.opt.spread}% or more)` : ''}`); }
    saveState();
    render();
  }));
  const LIMITS = { runs: [1, 100000], jobs: [1, 1000] };
  function setNum(key, v) {
    const [lo, hi] = LIMITS[key];
    const n = Math.round(Number(String(v).replace(/[^\d.-]/g, '')));
    C[key] = Math.min(hi, Math.max(lo, Number.isFinite(n) && String(v).trim() !== '' ? n : C[key]));
    $('#in-' + key).value = C[key];
    saveState();
    if (cur()) render();
  }
  $$('[data-num]').forEach(b => b.addEventListener('click', () => setNum(b.dataset.num, C[b.dataset.num] + Number(b.dataset.d))));
  for (const key of ['runs', 'jobs']) {
    const el = $('#in-' + key);
    el.addEventListener('change', () => setNum(key, el.value));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
  }
  window.addEventListener('mb:eiv-ready', () => {
    itemCache.forEach(MB.refreshEIV);
    if (MB.screen() === 'calc' && cur()) render();
  });

  /* =====================  Sheets  ===================== */
  const SH = MB.SHEETS;

  /* ---------- Choose an item (with My blueprints) ---------- */
  let itemQuery = '';
  let itemTab = 'all';
  function itemResultsHTML(q) {
    const ql = q.trim();
    if (!ql) {
      const recent = (prefs.recent || []).filter(id => window.recipeMap[id]);
      const popular = POPULAR.map(bpForName).filter(id => id && !recent.includes(id));
      return (recent.length ? `<li class="listhead">Recent</li>${recent.map(itemRowHTML).join('')}` : '') + `<li class="listhead">Popular</li>${popular.map(itemRowHTML).join('')}`;
    }
    const hits = searchBlueprints(ql);
    if (!hits.length) return `<li class="note" style="padding:10px">Nothing buildable matches “${esc(ql)}”.</li>`;
    return hits.map(h => itemRowHTML(h.id)).join('');
  }
  SH.items = {
    title: () => 'Choose an item',
    html() {
      const tabs = `<div class="segtabs two" role="tablist" aria-label="Where to pick from">
          <button type="button" role="tab" data-itemtab="all" aria-selected="${itemTab === 'all'}">All items</button>
          <button type="button" role="tab" data-itemtab="bps" aria-selected="${itemTab === 'bps'}">My blueprints${BPB.data ? ` <span class="tabcount">${BPB.data.length}</span>` : ''}</button>
        </div>`;
      if (itemTab === 'bps') return tabs + blueprintsHTML();
      return tabs + `<div class="searchbox">${ICON.search}<input type="text" id="f-itemq" placeholder="Search any item you can build" autocomplete="off" value="${esc(itemQuery)}" aria-label="Search items"></div>
        <ul class="itemlist" id="item-results">${itemResultsHTML(itemQuery)}</ul>`;
    },
    open() { if (itemTab === 'bps' && MB.isLoggedIn() && !BPB.data && !BPB.loading) loadBlueprints(); },
    input(e) {
      if (e.target.id === 'f-itemq') { itemQuery = e.target.value; $('#item-results').innerHTML = itemResultsHTML(itemQuery); }
      if (e.target.id === 'bp-q') { BPB.q = e.target.value; refreshBpList(); }
    },
    change(e) {
      if (e.target.id === 'bp-cat') { BPB.cat = e.target.value; MB.fillSheet(); $('#bp-cat').focus(); }
      if (e.target.id === 'bp-loc') { BPB.loc = e.target.value; MB.fillSheet(); $('#bp-loc').focus(); }
    },
    click(e) {
      const hit = sel => e.target.closest(sel);
      let el;
      if ((el = hit('[data-item]'))) { MB.closeSheet(); selectItem(+el.dataset.item); return; }
      if ((el = hit('[data-itemtab]'))) {
        itemTab = el.dataset.itemtab;
        if (itemTab === 'bps' && MB.isLoggedIn() && !BPB.data && !BPB.loading) loadBlueprints();
        MB.fillSheet();
        $(`#sheet-body [data-itemtab="${itemTab}"]`).focus();
        return;
      }
      if ((el = hit('[data-bptype]'))) { BPB.type = el.dataset.bptype; MB.fillSheet(); $(`#sheet-body [data-bptype="${BPB.type}"]`).focus(); return; }
      if ((el = hit('[data-bpflag]'))) { const f = el.dataset.bpflag; BPB[f] = !BPB[f]; MB.fillSheet(); $(`#sheet-body [data-bpflag="${f}"]`).focus(); return; }
      if ((el = hit('#bp-reload'))) { loadBlueprints(); return; }
      if ((el = hit('#bp-scan'))) { if (!el.disabled) scanAllBps(); return; }
      if ((el = hit('#bp-ready'))) {
        const rows = bpStack(bpFiltered());
        if (!BPB.ready && !rows.some(b => { const r = bpReady(b); return r && r.buildableRuns > 0; })) { toast('Nothing here can be built with your current stock'); return; }
        BPB.ready = !BPB.ready;
        MB.fillSheet();
        $('#bp-ready').focus();
        return;
      }
      if ((el = hit('[data-bpscan]'))) { scanOneBp(el); return; }
      if ((el = hit('[data-bpload]'))) { const b = (BPB.data || []).find(x => String(x.item_id) === el.dataset.bpload); if (b) loadBlueprint(b); }
    }
  };

  /* ---------- My blueprints (js/app.js blueprint browser) ---------- */
  const BPB = { data: null, loading: false, error: null, q: '', type: 'all', cat: 'all', loc: 'all', personal: true, corp: true, stack: true, byProfit: false, ready: false, scanning: null };
  const BP_CATS = [[6, 'Ships'], [7, 'Modules'], [18, 'Drones'], [8, 'Ammo & charges'], [65, 'Structures'], [32, 'Subsystems'], ['other', 'Other']];
  const BP_KNOWN = new Set([6, 7, 18, 8, 65, 32]);
  const PROFIT_KEY = 'eve_blueprint_profit_cache_v2';   // shared with the desktop
  const profitCache = () => LS.get(PROFIT_KEY, {});
  const bpKey = b => (b.quantity === -1 ? `bpo|${b.type_id}|${b.material_efficiency}|${b.time_efficiency}` : `bpc|${b.type_id}|${b.material_efficiency}|${b.time_efficiency}|${b.runs}`);
  async function loadBlueprints() {
    BPB.loading = true; BPB.error = null;
    MB.refillSheet('items');
    try {
      const [charBps, corpBps] = await Promise.all([window.fetchCharacterBlueprints(), window.fetchCorpBlueprints()]);
      const all = [...(charBps || []).map(b => ({ ...b, source: 'Personal' })), ...(corpBps || []).map(b => ({ ...b, source: 'Corp' }))];
      const map = window.buildItemIdToAssetMap();
      all.forEach(b => {
        const h = window.resolveItemLocationHierarchy(b.location_id, map);
        b.rootLocationId = h.rootLocationId;
        b.containerId = h.containerId;
      });
      await window.resolveLocationIds([...new Set(all.map(b => b.rootLocationId))]);
      all.forEach(b => {
        b.stationName = MB.titleCase(window.resolvedLocationNames[b.rootLocationId] || `Location ${b.rootLocationId}`);
        if (b.containerId) {
          const can = map[b.containerId];
          const custom = window.resolvedLocationNames[b.containerId];
          b.containerName = custom ? MB.titleCase(custom) : `${can ? MB.nameOf(can.type_id) : 'Container'} (#${String(b.containerId).slice(-5)})`;
        }
        b.productTypeId = productOfBp(b.type_id);
        b.categoryId = b.productTypeId && window.EVE_CATEGORIES ? window.EVE_CATEGORIES[b.productTypeId] : undefined;
        b.name = (window.EVE_ITEMS && window.EVE_ITEMS[b.type_id]) || MB.nameOf(b.type_id);
      });
      BPB.data = all.filter(b => window.recipeMap[b.type_id]);
    } catch (e) {
      console.warn('[Phone] Blueprints failed to load:', e);
      BPB.error = 'Your blueprints could not be loaded. Check your connection and try again.';
    }
    BPB.loading = false;
    MB.refillSheet('items');
  }
  function bpMatchesLoc(b) {
    const f = BPB.loc;
    if (f === 'all') return true;
    if (f === 'industry_system') return (b.stationName || '').toUpperCase().includes(String(MB.liveStation().systemName || '').toUpperCase());
    if (f.startsWith('loc_')) return b.rootLocationId === parseInt(f.slice(4));
    if (f.startsWith('corpsag_')) { const p = f.split('_'); return b.rootLocationId === parseInt(p[1]) && b.location_flag === p[2]; }
    if (f.startsWith('container_')) return b.containerId === parseInt(f.slice(10));
    return true;
  }
  function bpFiltered() {
    const q = BPB.q.trim().toLowerCase();
    return (BPB.data || []).filter(b => (b.source === 'Personal' ? BPB.personal : BPB.corp)
      && (!q || b.name.toLowerCase().includes(q))
      && bpMatchesLoc(b)
      && (BPB.type === 'all' || (BPB.type === 'bpo') === (b.quantity === -1))
      && (BPB.cat === 'all' || (BPB.cat === 'other' ? !BP_KNOWN.has(b.categoryId) : b.categoryId === Number(BPB.cat))));
  }
  // js/app.js stackBlueprints: identical copies in the same place show as one row with a count.
  function bpStack(list) {
    if (!BPB.stack) return list.map(b => ({ ...b, count: (b.quantity > 0 ? b.quantity : 1), members: [{ itemId: b.item_id, count: b.quantity > 0 ? b.quantity : 1 }] }));
    const groups = new Map();
    for (const b of list) {
      const isBPO = b.quantity === -1;
      const key = `${bpKey(b)}|${b.rootLocationId}|${b.containerId || ''}`;
      const n = (!isBPO && b.quantity > 0) ? b.quantity : 1;
      if (!groups.has(key)) groups.set(key, { ...b, count: 0, members: [] });
      const g = groups.get(key);
      g.count += n;
      g.members.push({ itemId: b.item_id, count: n });
    }
    return [...groups.values()];
  }
  function bpQueued(row) {
    if (row.quantity === -1) return null;
    const byId = new Map();
    LS.get('eve_ledger_jobs', []).forEach(j => { if (j && j.sourceBlueprintItemId != null) byId.set(j.sourceBlueprintItemId, (byId.get(j.sourceBlueprintItemId) || 0) + (j.runsNeeded || 0)); });
    const total = row.members.reduce((s, m) => s + m.count, 0) * (row.runs || 1);
    const used = row.members.reduce((s, m) => s + (byId.get(m.itemId) || 0), 0);
    return used ? { used: Math.min(used, total), total } : null;
  }
  // js/app.js computeBlueprintReadiness: whole runs your stock covers of the blueprint's own direct
  // materials (not the whole tree), capped at the runs left on a copy.
  function bpReady(b) {
    const recipe = window.recipeMap[b.type_id];
    if (!recipe) return null;
    const isReaction = !!(recipe.reactionMaterials && recipe.reactionMaterials.length);
    const mats = isReaction ? recipe.reactionMaterials : recipe.mfgMaterials;
    if (!mats || !mats.length) return null;
    const fac = (window.getActiveStructureType().meBonus || 0) / 100;
    const rig = window.getEffectiveRigBonusForTypeId(b.productTypeId, 'ME');
    let max = Infinity;
    mats.forEach(m => {
      const per = window.calculateInputQuantity(m.baseQty !== undefined ? m.baseQty : (m.qty || 1), 1, b.material_efficiency || 0, fac, isReaction, rig);
      const runs = per > 0 ? Math.floor(MB.freeStockOf(m.typeId) / per) : Infinity;
      if (runs < max) max = runs;
    });
    if (!isFinite(max)) max = 0;
    return { buildableRuns: b.quantity === -1 ? max : Math.min(max, Math.max(1, b.runs)), isReaction };
  }
  // js/app.js computeBlueprintManufacturingProfit: 1 run for an original, every run left on a copy,
  // at your current build choices, station and fees. Jita sell after tax and broker, minus materials
  // and job fees (no leftover credit). Saved in the desktop's own cache.
  async function scanBp(b) {
    const item = await getItem(b.type_id);
    const runs = b.quantity === -1 ? 1 : Math.max(1, b.runs);
    const r = MB.E.evaluate(item, cfgFor(MB.activeStation(), { runs, jobs: 1, sell: { mode: 'auto' }, meOv: { ...C.meOv, [item.root.k]: b.material_efficiency }, teOv: { ...C.teOv, [item.root.k]: b.time_efficiency } }));
    const profit = r.marketNet - r.cost;
    const cache = profitCache();
    cache[bpKey(b)] = { profit, iskPerHour: r.seconds > 0 ? profit / (r.seconds / 3600) : null, runsUsed: runs, qtyProduced: item.root.q, scannedAt: Date.now() };
    LS.set(PROFIT_KEY, cache);
    if (cur()) evaluate();
    return cache[bpKey(b)];
  }
  async function scanOneBp(el) {
    const b = bpStack(bpFiltered()).find(x => x.members.some(m => String(m.itemId) === el.dataset.bpscan));
    if (!b) return;
    el.disabled = true;
    el.innerHTML = '<span class="spin" aria-hidden="true"></span>';
    try {
      const s = await scanBp(b);
      toast(`${productName(b.name)}: ${compact(s.profit, true)} ISK for ${s.runsUsed} run${s.runsUsed === 1 ? '' : 's'}`);
    } catch (e) { toast(`Could not scan ${productName(b.name)}`); }
    refreshBpList();
  }
  async function scanAllBps() {
    const rows = bpStack(bpFiltered());
    for (let i = 0; i < rows.length; i++) {
      BPB.scanning = [i + 1, rows.length];
      const btn = $('#bp-scan');
      if (btn) btn.innerHTML = `<span class="spin" aria-hidden="true"></span>Scanning ${i + 1}/${rows.length}…`;
      try { await scanBp(rows[i]); } catch (e) { console.warn('[Phone] Scan failed for', rows[i].type_id, e); }
      refreshBpList();
      await MB.sleep(20);
    }
    BPB.scanning = null;
    MB.refillSheet('items');
    toast(`Scanned ${rows.length} blueprint${rows.length === 1 ? '' : 's'} at ${MB.activeStation().name}`);
  }
  function bpLocOptions() {
    const locs = {};
    (BPB.data || []).forEach(b => {
      const id = b.rootLocationId;
      if (!locs[id]) locs[id] = { name: b.stationName, n: 0, divs: {}, cans: {} };
      locs[id].n++;
      if (b.source === 'Corp' && b.location_flag && b.location_flag.startsWith('Corp')) locs[id].divs[b.location_flag] = (locs[id].divs[b.location_flag] || 0) + 1;
      if (b.containerId) locs[id].cans[b.containerId] = { name: b.containerName, n: ((locs[id].cans[b.containerId] || {}).n || 0) + 1 };
    });
    const div = f => (window.corpDivisionNames && window.corpDivisionNames[f.replace('CorpSAG', '')]) ? MB.titleCase(window.corpDivisionNames[f.replace('CorpSAG', '')]) : f.replace('CorpSAG', 'Division ');
    const opts = [['all', 'All locations'], ['industry_system', `This station's system (${MB.systemName(MB.liveStation().systemId, MB.liveStation().systemName)})`]];
    Object.entries(locs).forEach(([id, d]) => {
      opts.push([`loc_${id}`, `${d.name} (${d.n})`]);
      Object.entries(d.divs).forEach(([f, n]) => opts.push([`corpsag_${id}_${f}`, `  └ Corp: ${div(f)} (${n})`]));
      Object.entries(d.cans).forEach(([cid, c]) => opts.push([`container_${cid}`, `  └ Container: ${c.name} (${c.n})`]));
    });
    if (!opts.some(o => o[0] === BPB.loc)) BPB.loc = 'all';
    return opts.map(([v, l]) => `<option value="${esc(v)}"${v === BPB.loc ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }
  function bpRowHTML(b, showStation, cache) {
    const isBPO = b.quantity === -1;
    const pt = b.productTypeId;
    const loaded = C.lastBp && b.members.some(m => m.itemId === C.lastBp.itemId);
    const queued = bpQueued(b);
    const scan = cache[bpKey(b)];
    const ready = BPB.ready ? bpReady(b) : undefined;
    const isReaction = window.recipeMap[b.type_id] && window.recipeMap[b.type_id].reactionMaterials && window.recipeMap[b.type_id].reactionMaterials.length && !(window.recipeMap[b.type_id].mfgMaterials || []).length;
    const tags = [
      loaded ? `<span class="spill ok">${ICON.check}Loaded</span>` : '',
      queued ? `<span class="spill warnp">${ICON.lock}${queued.used}/${queued.total} runs queued</span>` : '',
      ready === undefined ? '' : ready === null ? '<span class="spill planned">No material data</span>' : ready.buildableRuns > 0 ? `<span class="spill ok">${ICON.check}Stock covers ${qty(ready.buildableRuns)} run${ready.buildableRuns === 1 ? '' : 's'}</span>` : '<span class="spill warnp">Not enough for 1 run</span>',
      b.containerName ? `<span class="spill planned">${ICON.box}${esc(b.containerName)}</span>` : '',
      showStation ? `<span class="spill planned">${ICON.pin}${esc(String(b.stationName).split(' - ')[0])}</span>` : ''
    ].join('');
    const research = isReaction ? '<span class="chip-me">Reaction · no ME/TE</span>' : `<span class="chip-me">ME ${b.material_efficiency} · TE ${b.time_efficiency}</span>`;
    const right = scan === null ? '<span class="bp-rate">scan failed</span>'
      : scan ? `<span class="bp-profit ${scan.profit >= 0 ? 'pos' : 'neg'}">${compact(scan.profit, true)}</span><span class="bp-rate">${scan.iskPerHour == null ? `${scan.runsUsed} run${scan.runsUsed === 1 ? '' : 's'}` : `${compact(scan.iskPerHour, true)}/h`} · ${MB.ago(scan.scannedAt)}</span>`
      : '<span class="bp-rate">not scanned</span>';
    return `<li class="bpcard${loaded ? ' is-loaded' : ''}">
        <div class="bp-top">
          <span class="bpic">${MB.iconHTML(b.type_id, '', isBPO ? 'bp' : 'bpc')}<span class="bpo-tag ${isBPO ? 'o' : 'c'}">${isBPO ? 'BPO' : 'BPC'}</span></span>
          <div class="bp-main"><b>${esc(b.name)}</b><span class="bp-meta">${isBPO ? 'Original · unlimited runs' : `Copy · ${b.runs} run${b.runs === 1 ? '' : 's'}`}${b.count > 1 ? ` · ×${b.count}` : ''} · ${b.source}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</div>
          <div class="bp-right">${right}</div>
        </div>
        <div class="bp-foot">${research}<button class="minibtn" type="button" data-bpscan="${b.item_id}" aria-label="Scan profit for ${esc(b.name)}"${pt ? '' : ' disabled'}>${ICON.chart}</button><button class="btn bp-load" type="button" data-bpload="${b.item_id}">Load</button></div>
      </li>`;
  }
  function bpListHTML() {
    let rows = bpStack(bpFiltered());
    if (BPB.ready) rows = rows.filter(b => { const r = bpReady(b); return r && r.buildableRuns > 0; });
    if (!rows.length) return `<p class="empty"><b>No blueprints here</b>${BPB.ready ? 'Nothing you can build with your current stock under these filters.' : 'None match your search and filters.'}</p>`;
    const cache = profitCache();
    if (BPB.byProfit) {
      const val = b => { const s = cache[bpKey(b)]; return s ? s.profit : -Infinity; };
      const sorted = rows.slice().sort((a, b) => val(b) - val(a));
      const unscanned = sorted.filter(b => !cache[bpKey(b)]).length;
      return `${unscanned ? `<p class="note" style="margin:0 2px 8px">${unscanned} not scanned yet. Scan profit to rank them too.</p>` : ''}<ul class="bplist">${sorted.map(b => bpRowHTML(b, true, cache)).join('')}</ul>`;
    }
    const byStation = new Map();
    rows.forEach(b => { if (!byStation.has(b.stationName)) byStation.set(b.stationName, []); byStation.get(b.stationName).push(b); });
    return [...byStation.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([name, list]) => `<div class="card-title">${ICON.pin}${esc(name)}</div><ul class="bplist">${list.map(b => bpRowHTML(b, false, cache)).join('')}</ul>`).join('');
  }
  function blueprintsHTML() {
    if (!MB.isLoggedIn()) return `<div class="login-card">${ICON.lock}<p>Log in to see your own and your corp's blueprints, with their real ME/TE and runs.</p><button class="btn primary" type="button" data-goto-sheet="account">Log in</button></div>`;
    if (BPB.loading) return '<div class="loading-row"><span class="spin" aria-hidden="true"></span>Loading your blueprints from EVE…</div>';
    if (BPB.error) return `<div class="errbox">${ICON.warn}<p>${esc(BPB.error)}</p></div><button class="btn" type="button" id="bp-reload">${ICON.refresh}Try again</button>`;
    if (!BPB.data) return '<div class="loading-row"><span class="spin" aria-hidden="true"></span>Loading…</div>';
    if (!BPB.data.length) return `<p class="empty"><b>No blueprints found</b>${esc(MB.activeChar().charName)} and their corp don't have any blueprints the site can read.</p><button class="btn" type="button" id="bp-reload">${ICON.refresh}Load again</button>`;
    const cats = BP_CATS.filter(([c]) => BPB.data.some(b => (c === 'other' ? !BP_KNOWN.has(b.categoryId) : b.categoryId === c)));
    const visible = bpStack(bpFiltered()).length;
    return `<div class="searchbox">${ICON.search}<input type="text" id="bp-q" placeholder="Search your blueprints" autocomplete="off" value="${esc(BPB.q)}" aria-label="Search your blueprints"></div>
      <div class="chiprow" role="group" aria-label="Blueprint filters">
        <button class="chip" type="button" data-bptype="all" aria-pressed="${BPB.type === 'all'}">All</button>
        <button class="chip" type="button" data-bptype="bpo" aria-pressed="${BPB.type === 'bpo'}">Originals</button>
        <button class="chip" type="button" data-bptype="bpc" aria-pressed="${BPB.type === 'bpc'}">Copies</button>
        <span class="chipsep" aria-hidden="true"></span>
        <button class="chip" type="button" data-bpflag="personal" aria-pressed="${BPB.personal}">Personal</button>
        <button class="chip" type="button" data-bpflag="corp" aria-pressed="${BPB.corp}">Corp</button>
        <button class="chip" type="button" data-bpflag="stack" aria-pressed="${BPB.stack}">Stack copies</button>
        <button class="chip" type="button" data-bpflag="byProfit" aria-pressed="${BPB.byProfit}">Sort by profit</button>
      </div>
      <div class="twosel">
        <select id="bp-cat" aria-label="Category"><option value="all">All categories</option>${cats.map(([c, l]) => `<option value="${c}"${String(c) === String(BPB.cat) ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select id="bp-loc" aria-label="Location">${bpLocOptions()}</select>
      </div>
      <div class="btnpair">
        <button class="btn" type="button" id="bp-scan"${visible && !BPB.scanning ? '' : ' disabled'}>${ICON.chart}${BPB.scanning ? `Scanning ${BPB.scanning[0]}/${BPB.scanning[1]}…` : `Scan profit (${visible})`}</button>
        <button class="btn${BPB.ready ? ' on' : ''}" type="button" id="bp-ready" aria-pressed="${BPB.ready}">${BPB.ready ? `${ICON.x}Show all` : `${ICON.bolt}What can I build?`}</button>
      </div>
      <div id="bp-list">${bpListHTML()}</div>
      <p class="note">Load sets the calculator to that blueprint's ME/TE and, for a copy, its runs. Add to Ledger then counts those runs as queued here. <button class="inlink" type="button" id="bp-reload">Reload from EVE</button></p>`;
  }
  function refreshBpList() {
    if (MB.sheetKind() === 'items' && itemTab === 'bps' && $('#bp-list')) {
      $('#bp-list').innerHTML = bpListHTML();
      const b = $('#bp-scan');
      if (b && !BPB.scanning) { const n = bpStack(bpFiltered()).length; b.innerHTML = `${ICON.chart}Scan profit (${n})`; b.disabled = !n; }
    }
  }
  // js/app.js loadBlueprintIntoCalculator
  function loadBlueprint(b) {
    C.meOv[b.type_id] = b.material_efficiency;
    C.teOv[b.type_id] = b.time_efficiency;
    C.lastBp = { itemId: b.item_id, typeId: b.type_id };
    LS.set('eve_last_loaded_blueprint_source', C.lastBp);
    if (typeof b.runs === 'number' && b.runs > 0) C.runs = b.runs;
    const other = !cur() || cur().bp !== b.type_id;
    if (other) C.sell = { mode: 'auto', price: 0 };
    MB.closeSheet();
    if (other) selectItem(b.type_id, { preserve: true });
    else { saveState(); render(); }
    const isBPO = b.quantity === -1;
    toast(`Loaded ${b.name}: ${isBPO ? 'original' : `copy with ${b.runs} run${b.runs === 1 ? '' : 's'}`}, ME ${b.material_efficiency} · TE ${b.time_efficiency}`);
  }

  /* ---------- ME/TE for one blueprint ---------- */
  const meteNode = () => (cur() && cur().nodes.find(n => n.k === meteKey)) || (cur() && cur().root);
  SH.mete = {
    title: () => `Research: ${meteNode().n}`,
    html() {
      const n = meteNode();
      const same = cur().nodes.filter(x => x.k === n.k).length;
      const owned = window.getBestOwnedBpoMeTe ? window.getBestOwnedBpoMeTe(n.k) : null;
      const custom = C.meOv[n.k] !== undefined || C.teOv[n.k] !== undefined;
      return `<p class="sheet-lead">Blueprint research for ${esc(n.n)}${same > 1 ? `. Applies to all ${same} in this build` : ''}.</p>
        <div class="card">
          <div class="kv"><span class="k">Material efficiency<small>less material per run, 0 to 10</small></span>${MB.stepper('me', meOf(n), 0, 10, 'material efficiency')}</div>
          <div class="kv"><span class="k">Time efficiency<small>shorter jobs, 0 to 20 in steps of 2</small></span>${MB.stepper('te', teOf(n), 0, 20, 'time efficiency')}</div>
        </div>
        ${custom ? `<button class="btn" type="button" data-mete="reset">${ICON.undo}Use ${owned ? `your blueprint's ME ${owned.me} · TE ${owned.te}` : 'the default (ME 0 · TE 0)'}</button>` : ''}
        <div class="card-title">Every part you build here</div>
        <div class="card">
          <div class="kv"><span class="k">Bulk ME/TE<small>${C.bulk.target ? `On: ME ${C.bulk.target.me} · TE ${C.bulk.target.te} for everything you build` : 'Set every blueprint in this build at once'}</small></span><button class="btn" style="width:auto;height:40px" type="button" data-goto-sheet="bulk">Open</button></div>
        </div>
        <p class="note">${owned ? `You own this blueprint at ME ${owned.me} · TE ${owned.te}, so that's the default.` : 'Blueprints you own fill these in automatically once you log in.'} Reactions have no ME/TE.</p>`;
    },
    click(e) {
      const el = e.target.closest('[data-step], [data-mete]');
      if (!el || el.disabled) return;
      const n = meteNode();
      if (el.dataset.mete === 'reset') { delete C.meOv[n.k]; delete C.teOv[n.k]; }
      else {
        const d = Number(el.dataset.d);
        if (el.dataset.step === 'me') C.meOv[n.k] = Math.min(10, Math.max(0, meOf(n) + d));
        if (el.dataset.step === 'te') C.teOv[n.k] = Math.min(20, Math.max(0, teOf(n) + d * 2));
      }
      saveState();
      render();
      MB.fillSheet();
      const again = el.dataset.step ? $(`#sheet-body [data-step="${el.dataset.step}"][data-d="${el.dataset.d}"]`) : null;
      if (again && !again.disabled) again.focus();
    }
  };

  /* ---------- Bulk ME/TE (js/optimizers.js applyBulkMETarget) ---------- */
  let bulkDraft = { me: 10, te: 20 };
  const bulkTargets = () => [...new Set([cur().root, ...liveNodes(cur().root)].filter(n => isBuilt(n) && n.m && n.hasMats && !n.r).map(n => n.k))];
  SH.bulk = {
    title: () => 'Bulk ME/TE',
    html() {
      const t = C.bulk.target;
      const count = bulkTargets().length;
      return `<p class="sheet-lead">Sets every blueprint you're building to one ME/TE, ${esc(cur().name)} included. While it's on, parts you switch to Build later get it too.</p>
        <div class="card">
          <div class="kv"><span class="k">Material efficiency<small>0 to 10</small></span>${MB.stepper('bme', bulkDraft.me, 0, 10, 'material efficiency')}</div>
          <div class="kv"><span class="k">Time efficiency<small>0 to 20, in steps of 2</small></span>${MB.stepper('bte', bulkDraft.te, 0, 20, 'time efficiency')}</div>
        </div>
        <button class="btn primary" type="button" data-bulkact="apply"${count ? '' : ' disabled'}>Apply ME ${bulkDraft.me} · TE ${bulkDraft.te} to ${count} blueprint${count === 1 ? '' : 's'}</button>
        <button class="btn" type="button" data-bulkact="max"${count ? '' : ' disabled'}>Max everything: ME 10 · TE 20</button>
        ${t || C.bulk.snapshot ? `<div class="statusrow${t ? ' on' : ''}">${t ? ICON.check : ICON.clock}<p>${t ? `On: parts you switch to Build get <b>ME ${t.me} · TE ${t.te}</b>` : 'Stopped. Every blueprint keeps the ME/TE it has now.'}</p>${t ? '<button type="button" data-bulkact="stop">Stop</button>' : ''}</div>
          ${C.bulk.snapshot ? `<button class="btn" type="button" data-bulkact="reset">${ICON.undo}Restore every original ME/TE</button>` : ''}` : ''}
        <p class="note">Restore goes back to how every blueprint was before you first used Bulk ME/TE. Reactions have no ME/TE.</p>`;
    },
    click(e) {
      const el = e.target.closest('[data-step], [data-bulkact]');
      if (!el || el.disabled) return;
      if (el.dataset.step) {
        const d = Number(el.dataset.d);
        if (el.dataset.step === 'bme') bulkDraft.me = Math.min(10, Math.max(0, bulkDraft.me + d));
        if (el.dataset.step === 'bte') bulkDraft.te = Math.min(20, Math.max(0, bulkDraft.te + d * 2));
        MB.fillSheet();
        const again = $(`#sheet-body [data-step="${el.dataset.step}"][data-d="${d}"]`);
        if (again && !again.disabled) again.focus();
        return;
      }
      const act = el.dataset.bulkact;
      if (act === 'apply' || act === 'max') {
        if (act === 'max') bulkDraft = { me: 10, te: 20 };
        const { me, te } = bulkDraft;
        if (!C.bulk.snapshot) C.bulk.snapshot = { me: { ...C.meOv }, te: { ...C.teOv } };
        C.bulk.target = { me, te };
        const keys = bulkTargets();
        keys.forEach(k => { C.meOv[k] = me; C.teOv[k] = te; });
        saveState(); render(); MB.fillSheet();
        toast(`${keys.length} blueprint${keys.length === 1 ? '' : 's'} set to ME ${me} · TE ${te}, and parts you build later get it too`, { label: 'Stop', run: stopBulk });
      }
      if (act === 'stop') stopBulk();
      if (act === 'reset') {
        C.meOv = { ...C.bulk.snapshot.me };
        C.teOv = { ...C.bulk.snapshot.te };
        C.bulk = { target: null, snapshot: null };
        saveState(); render(); MB.fillSheet();
        toast('Every blueprint is back to its ME/TE from before Bulk ME/TE');
      }
    }
  };
  function stopBulk() {
    C.bulk.target = null;
    saveState(); render(); MB.refillSheet('bulk', 'mete');
    toast('Bulk ME/TE stopped. Values already set stay as they are.');
  }

  /* ---------- Optimize ---------- */
  const pctIn = (key, label) => `<span class="suffix inline"><input type="text" inputmode="decimal" data-opt="${key}" value="${prefs.opt[key]}" aria-label="${label}" autocomplete="off"><span>%</span></span>`;
  SH.optimize = {
    title: () => 'Optimize',
    html() {
      const set = Object.keys(C.sources).length;
      return `<p class="sheet-lead">The desktop's three optimizers. Each changes this build straight away, using the threshold you set.</p>
        <div class="optcard">
          <div class="oc-head">${ICON.sparkle}<b>Build or buy</b></div>
          <p>Builds a part only if that adds at least ${pctIn('build', 'Build or buy threshold, percent')} of the build cost to profit. Everything else is bought.</p>
          <button class="btn primary" type="button" data-run="build">Choose what to build</button>
        </div>
        <div class="optcard">
          <div class="oc-head">${ICON.order}<b>Market spread</b></div>
          <p>Puts a Jita buy order on anything whose sell price is at least ${pctIn('spread', 'Market spread threshold, percent')} above its buy price. The rest is bought at Jita sell.</p>
          <button class="btn" type="button" data-run="spread">Choose price sources by spread</button>
        </div>
        <div class="optcard">
          <div class="oc-head">${ICON.chart}<b>Budget impact</b></div>
          <p>Puts a Jita buy order only where it saves at least ${pctIn('budget', 'Budget impact threshold, percent')} of the whole build cost${MB.isLoggedIn() && prefs.deduct ? ', on what you still have to buy' : ''}.</p>
          <button class="btn" type="button" data-run="budget">Choose price sources by budget</button>
        </div>
        <button class="btn" type="button" data-run="reset"${set ? '' : ' disabled'}>${ICON.undo}Reset price sources</button>
        <p class="note">Reset puts every item back on your default from Settings (${prefs.priceMode === 'buy' ? 'Jita buy' : 'Jita sell'}).</p>`;
    },
    change(e) {
      const key = e.target.dataset.opt;
      if (!key) return;
      const v = MB.readPct(e.target, prefs.opt[key]);
      if (v !== null) { prefs.opt[key] = v; MB.savePrefs(); MB.syncShim(); }
    },
    click(e) {
      const el = e.target.closest('[data-run]');
      if (!el || el.disabled) return;
      const run = el.dataset.run;
      if (run === 'reset') {
        const before = { ...C.sources };
        C.sources = {};
        saveState(); render(); MB.fillSheet();
        toast('Every price source is back on your default', { label: 'Undo', run: () => { C.sources = before; saveState(); render(); MB.refillSheet('optimize'); } });
        return;
      }
      MB.closeSheet();
      if (run === 'build') {
        optimize();
        C.focusId = cur().root.i;
        saveState(); render();
        const built = new Set(liveNodes(cur().root).filter(isBuilt).map(n => n.k)).size;
        toast(built ? `Building ${built} part type${built === 1 ? ' that adds' : 's that add'} at least ${prefs.opt.build}% each, buying the rest` : `Nothing adds ${prefs.opt.build}% or more by building it, so every part is bought`);
      } else {
        const c = run === 'spread' ? pickSources() : pickSourcesByBudget();
        saveState(); render();
        toast(c ? `${c} item${c === 1 ? '' : 's'} on Jita buy orders (${run === 'spread' ? `spread of ${prefs.opt.spread}%` : `saving ${prefs.opt.budget}% of build cost`} or more)` : run === 'spread' ? 'Jita sell is best for everything right now' : `No buy order saves ${prefs.opt.budget}% of the build cost, so everything is at Jita sell`);
      }
    }
  };

  /* ---------- Selling the finished item ---------- */
  const modeFees = mode => {
    const f = MB.readFees();
    return mode === 'contract' ? `${f.contractTax}% contract tax + ${f.contractBroker}% broker + 10,000 ISK` : `${f.salesTax}% sales tax + ${f.brokerFee}% broker fee`;
  };
  function sellBreakdownHTML() {
    const t = evaluate();
    const f = MB.readFees();
    const root = cur().root;
    const unit = root.q ? t.gross / root.q : 0;
    const feeRows = C.sell.mode === 'contract'
      ? `<li><span>Contract tax (${f.contractTax}%)</span><span class="v">${MINUS}${compact(t.contractTax)}</span></li>
         <li><span>Contract broker (${f.contractBroker}% + 10,000)</span><span class="v">${MINUS}${compact(t.contractBroker)}</span></li>`
      : `<li><span>Sales tax + broker (${Math.round((f.salesTax + f.brokerFee) * 1000) / 1000}%)</span><span class="v">${MINUS}${compact(t.gross - t.net)}</span></li>`;
    return `<li><span>${qty(root.q)} × ${compact(unit)}</span><span class="v">${compact(t.gross)}</span></li>
      ${feeRows}
      <li><span>You get</span><span class="v">${compact(t.net)}</span></li>
      <li><span>Profit after build cost${t.surplus > 0.5 ? ' and leftovers' : ''}</span><span class="v ${t.profit >= 0 ? 'pos' : 'neg'}">${compact(t.profit, true)}</span></li>`;
  }
  SH.sell = {
    title: () => 'Selling it',
    html() {
      const jita = priceOf(cur().pt).sell;
      const opt = (mode, title, sub) => `<li class="st-card"><button class="st-pick" type="button" data-sellmode="${mode}" aria-pressed="${C.sell.mode === mode}"><span class="radio" aria-hidden="true"></span><span class="st-body"><b>${title}</b><small>${sub}</small></span></button></li>`;
      return `<p class="sheet-lead">How you plan to sell ${qty(cur().root.q)} ${esc(cur().name)}.</p>
        <ul class="stlist">
          ${opt('auto', 'Auto: Jita sell price', `${full(jita)} ISK each${isEst(cur().pt) ? ' (estimate)' : ''} · ${modeFees('auto')}`)}
          ${opt('market', 'Sell order at your price', modeFees('market'))}
          ${opt('contract', 'Contract at your price', modeFees('contract'))}
        </ul>
        ${C.sell.mode === 'auto' ? '' : `<div class="field"><label for="f-sellprice">Your price, per unit</label><div class="suffix isk"><input type="text" inputmode="decimal" id="f-sellprice" value="${C.sell.price ? Math.round(C.sell.price * 100) / 100 : ''}" placeholder="${Math.round(jita)}" autocomplete="off"><span>ISK</span></div><small>Jita sell is ${full(jita)} ISK each right now.</small></div>`}
        <ul class="brk" id="sell-brk">${sellBreakdownHTML()}</ul>
        <p class="note">Change the fees in Settings. Picking another item starts it on Auto, as on the desktop.</p>`;
    },
    input(e) {
      if (e.target.id !== 'f-sellprice') return;
      const v = parseFloat(String(e.target.value).replace(/[,\s]/g, ''));
      C.sell.price = v >= 0 ? v : 0;
      saveState();
      render();
      $('#sell-brk').innerHTML = sellBreakdownHTML();
    },
    click(e) {
      const el = e.target.closest('[data-sellmode]');
      if (!el) return;
      const mode = el.dataset.sellmode;
      if (mode === C.sell.mode) return;
      if (mode !== 'auto' && !C.sell.price) C.sell.price = Math.round(priceOf(cur().pt).sell);
      C.sell.mode = mode;
      saveState(); render(); MB.fillSheet();
      const again = $(`#sheet-body [data-sellmode="${mode}"]`);
      if (again) again.focus();
      toast(mode === 'auto' ? 'Selling at Jita sell' : mode === 'market' ? 'Selling with your own sell order' : 'Selling on contract');
    }
  };

  /* ---------- Skills for this build ---------- */
  SH.skills = {
    title: () => 'Skills for this build',
    html() {
      if (!MB.isLoggedIn()) return `<div class="login-card">${ICON.lock}<p>Log in to check your trained skills against what these blueprints need.</p><button class="btn primary" type="button" data-goto-sheet="account">Log in</button></div>`;
      if (!MB.hasSkillSheet()) return '<div class="loading-row"><span class="spin" aria-hidden="true"></span>Loading your skills from EVE…</div>';
      const real = missingSkills(true);
      const who = esc(MB.activeChar().charName);
      const group = list => list.map(m => `<div class="card-title">${MB.iconHTML(m.pt, 'sm')}${esc(m.name)}</div>
        <div class="card">${m.miss.map(s => `<div class="kv"><span class="k">${esc(s.name)}</span><span class="v ${prefs.simV ? 'mutev' : 'neg'}">need ${ROMAN[s.need] || s.need} · have ${ROMAN[s.have] || s.have}</span></div>`).join('')}</div>`).join('');
      return `<div class="card">
          <div class="kv"><span class="k">Simulate all skills at V<small>Build time and this check as if every skill were trained to V</small></span><button class="switch" type="button" role="switch" data-set="simv" aria-checked="${prefs.simV}" aria-label="Simulate all skills at V"></button></div>
        </div>
        ${!real.length ? `<p class="okline">${ICON.check}Every part you're building is covered by ${who}'s skills.</p>`
          : prefs.simV ? `<p class="sheet-lead">Simulating V, so nothing counts as missing. Still to train for real:</p>${group(real)}`
          : `<p class="sheet-lead">${who} can't start these jobs yet:</p>${group(real)}`}
        <p class="note">Checks every part you're set to build, including the item itself. Parts you buy don't need skills.</p>`;
    },
    click: e => settingsSwitch(e)
  };

  /* ---------- Settings ---------- */
  function settingsSwitch(e) {
    const el = e.target.closest('[data-set]');
    if (!el || el.disabled) return false;
    if (el.dataset.set === 'reactions') {
      prefs.reactions = !prefs.reactions;
      toast(prefs.reactions ? 'Reactions on: reaction products can be built again' : 'Reactions off: reaction products are bought');
    } else {
      prefs.simV = !prefs.simV;
      toast(prefs.simV ? 'Simulating every skill at V' : 'Back to your real skills');
    }
    MB.savePrefs(); MB.syncShim();
    MB.renderAll();
    MB.fillSheet();
    const again = $(`#sheet-body [data-set="${el.dataset.set}"]`);
    if (again) again.focus();
    return true;
  }
  const feeRow = (key, label, sub) => `<div class="kv"><label class="k" for="fee-${key}">${label}<small>${sub}</small></label><span class="suffix feein"><input type="text" inputmode="decimal" id="fee-${key}" data-fee="${key}" value="${MB.readFees()[key]}" autocomplete="off"><span>%</span></span></div>`;
  SH.settings = {
    title: () => 'Settings',
    html() {
      const st = MB.activeStation();
      const imp = MB.implantPct();
      return `<div class="card-title">Production station</div>
        <div class="card">
          <div class="kv"><span class="k">${esc(st.name)}<small>${MB.stationMeta(st)}</small></span><button class="btn" style="width:auto;height:40px" type="button" data-goto-sheet="stations">Change</button></div>
        </div>
        <div class="card-title">Prices</div>
        <div class="card">
          <div class="kv"><span class="k">Material cost<small>for anything set to Buy, unless you change it on the item</small></span>
            <span class="segctl" role="group" aria-label="Default price source">
              <button type="button" data-mode="sell" aria-pressed="${prefs.priceMode === 'sell'}">${ICON.bolt}Jita sell</button>
              <button type="button" data-mode="buy" aria-pressed="${prefs.priceMode === 'buy'}">${ICON.order}Jita buy</button>
            </span></div>
        </div>
        <p class="note" style="margin:-4px 2px 12px">Jita sell: buy instantly from sell orders. Jita buy: place your own buy order. It's cheaper but slower, and your broker fee is added.</p>
        <div class="card-title">Build</div>
        <div class="card">
          <div class="kv"><span class="k">Reactions<small>${prefs.reactions ? 'Reaction products can be built from their inputs' : 'Off: reaction products are always bought'}</small></span><button class="switch" type="button" role="switch" data-set="reactions" aria-checked="${prefs.reactions}" aria-label="Build reactions"></button></div>
        </div>
        <div class="card-title">Pilot</div>
        <div class="card">
          <div class="kv"><label class="k" for="f-implant">Manufacturing implant<small>Zainou 'Beancounter', shortens build time</small></label><span style="flex:1.2;min-width:0"><select id="f-implant">${[[0, 'None'], [1, 'BX-801 (−1%)'], [2, 'BX-802 (−2%)'], [4, 'BX-804 (−4%)']].map(([v, l]) => `<option value="${v}"${imp === v ? ' selected' : ''}>${l}</option>`).join('')}</select></span></div>
          <div class="kv"><span class="k">Simulate all skills at V<small>${MB.hasSkillSheet() ? 'Build time as if every skill were trained to V. Your real skills stay as they are.' : 'Log in first: there are no real skills to compare with yet'}</small></span><button class="switch" type="button" role="switch" data-set="simv" aria-checked="${prefs.simV}" aria-label="Simulate all skills at V"${MB.hasSkillSheet() ? '' : ' disabled'}></button></div>
          <div class="kv"><span class="k">Skills for this build<small>${cur() ? skillsSummary() : 'Pick an item first'}</small></span><button class="btn" style="width:auto;height:40px" type="button" data-goto-sheet="skills"${cur() ? '' : ' disabled'}>Check</button></div>
        </div>
        <div class="card-title">Taxes and fees</div>
        <div class="card">
          ${feeRow('salesTax', 'Sales tax', 'when you sell at Jita')}
          ${feeRow('brokerFee', 'Broker fee', 'on your sell orders, and buy orders you place')}
          ${feeRow('sccSurcharge', 'SCC surcharge', 'on every industry job')}
          ${feeRow('contractTax', 'Contract sales tax', 'when you sell on contract')}
          ${feeRow('contractBroker', 'Contract broker fee', 'plus 10,000 ISK per contract')}
        </div>
        <p class="note">Job tax is set on each station. Any of these can be 0%. These are shared with the desktop site.</p>
        <div class="card-title">Site</div>
        <div class="card">
          <div class="kv"><span class="k">Use the desktop site<small>Everything you've set up here carries over. It stays the desktop site on this phone until you switch back.</small></span><button class="btn" style="width:auto;height:40px" type="button" data-desktop>${ICON.desktop}Switch</button></div>
        </div>`;
    },
    click(e) {
      if (settingsSwitch(e)) return;
      if (e.target.closest('[data-desktop]')) { MB.goDesktop(); return; }
      const m = e.target.closest('[data-mode]');
      if (m) {
        prefs.priceMode = m.dataset.mode;
        MB.savePrefs(); MB.syncShim();
        MB.fillSheet();
        if (cur()) render();
        toast(`Default price source: ${prefs.priceMode === 'buy' ? 'Jita buy order' : 'Jita sell'}`);
      }
    },
    change(e) {
      if (e.target.id === 'f-implant') {
        window.saveManufacturingImplantSetting(e.target.value);
        if (cur()) render();
        const v = Number(e.target.value);
        toast(v ? `Build time now ${v}% shorter` : 'No manufacturing implant');
        return;
      }
      const key = e.target.dataset.fee;
      if (!key) return;
      const old = MB.readFees()[key];
      const v = MB.readPct(e.target, old);
      if (v === null || v === old) return;
      MB.writeFees({ [key]: v });
      if (cur()) render();
      toast(`${e.target.closest('.kv').querySelector('.k').firstChild.textContent} now ${v}%`);
    }
  };

  /* ---------- Production stations: list + add/edit ---------- */
  let stView = 'list';
  let draft = null;
  let rigPickSlot = null;
  function costAtEachStation() {
    const list = MB.stationList();
    const out = list.map(st => ({ st, cost: cur() ? MB.E.evaluate(cur(), cfgFor(st)).cost : 0 }));
    if (cur()) evaluate();
    return out;
  }
  function stationsListHTML() {
    const active = MB.activeStation();
    const costs = costAtEachStation();
    const withCost = costs.filter(c => c.cost > 0);
    const min = withCost.length ? Math.min(...withCost.map(c => c.cost)) : 0;
    const current = costs.find(c => c.st.id === active.id) || costs[0];
    return `<p class="sheet-lead">${cur() ? `What ${esc(cur().name)} costs at each saved station right now. Tap one to build there.` : 'Tap a station to build there.'}</p>
      <ul class="stlist">${costs.map(({ st, cost }) => {
        const on = st.id === active.id;
        const diff = cost - current.cost;
        return `<li class="st-card">
          <button class="st-pick" type="button" data-pick="${esc(st.id)}" aria-pressed="${on}">
            <span class="radio" aria-hidden="true"></span>
            <span class="st-body"><b>${esc(st.name)}${st.saved ? '' : ' <span class="spill planned">not saved</span>'}</b><small>${MB.stationMeta(st)}</small></span>
            <span class="st-cost">${cur() ? `${withCost.length > 1 && Math.abs(cost - min) < 0.5 ? '<small class="cheap">Cheapest</small>' : ''}<b>${compact(cost)}</b><small>${on ? 'current' : (diff >= 0 ? '+' : MINUS) + compact(Math.abs(diff))}</small>` : ''}</span>
          </button>
          <button class="iconbtn" type="button" data-edit="${esc(st.id)}" aria-label="${st.saved ? 'Edit' : 'Save'} ${esc(st.name)}">${st.saved ? ICON.edit : ICON.plus}</button>
        </li>`;
      }).join('')}</ul>
      <button class="btn primary" type="button" data-st="add">${ICON.plus}Add a station</button>
      ${cur() && current && current.cost > min + 0.5 && withCost.length > 1 ? `<button class="btn" type="button" data-st="best">${ICON.bolt}Switch to the cheapest</button>` : ''}
      <p class="note">These are your desktop site's saved production stations, so both stay in step.</p>`;
  }
  function sysInfoHTML(id) {
    if (!id) return 'Pick a system to see its cost index.';
    const i = MB.sysInfo(id);
    return `${esc(MB.systemName(id))} ${MB.secHTML(i.sec)} · manufacturing index ${MB.pctText(i.mfg)} · reactions ${MB.pctText(i.react)} · rig bonus ×${MB.secMult(i.sec).toFixed(1)}`;
  }
  function structInfo(key) {
    const t = MB.STRUCT[key];
    return `${t.meBonus}% material saving · ${t.costBonus}% job cost bonus · ${t.teBonus}% faster · ${t.rigSize ? t.rigSize + '-Set rigs' : 'no rig slots'}`;
  }
  const rigHits = rig => { const pts = productTypes(); let n = 0; pts.forEach(pt => { if (rig.matches(pt)) n++; }); return n; };
  function rigEffect(rig) {
    const mult = MB.secMult(draft && draft.systemId ? MB.sysInfo(draft.systemId).sec : null);
    const parts = [];
    if (rig.bonusType !== 'TE') parts.push(`−${(RIG_ME_BASE[rig.tier] * mult).toFixed(2)}% materials`);
    if (rig.bonusType !== 'ME') parts.push(`−${(RIG_TE_BASE[rig.tier] * mult).toFixed(1)}% time`);
    if (!cur()) return { text: parts.join(', '), hit: false };
    const n = rigHits(rig);
    return n ? { text: `${parts.join(', ')} on ${n} part type${n === 1 ? '' : 's'} in this build`, hit: true } : { text: `${parts.join(', ')}, but nothing in this build uses it`, hit: false };
  }
  function rigResultsHTML(q) {
    const size = MB.STRUCT[draft.facilityKey].rigSize;
    const ql = q.trim().toLowerCase();
    const taken = [draft.rig1, draft.rig2, draft.rig3].map(Number);
    const list = MB.rigCatalog().filter(r => r.size === size && !taken.includes(r.typeId) && (!ql || r.name.toLowerCase().includes(ql)))
      .map(r => MB.rigInfo(r.typeId)).filter(Boolean)
      .sort((a, b) => (cur() ? (rigHits(b) > 0) - (rigHits(a) > 0) : 0) || a.name.localeCompare(b.name));
    if (!list.length) return '<li class="note" style="padding:10px">No rigs match.</li>';
    return list.slice(0, 40).map(r => {
      const eff = rigEffect(r);
      return `<li><button type="button" data-rigpick="${r.typeId}"><span class="r-name">${esc(r.name.replace(/^Standup /, ''))}<span class="r-sub${eff.hit ? ' hit' : ''}">${eff.text}</span></span></button></li>`;
    }).join('');
  }
  function rigsHTML() {
    const size = MB.STRUCT[draft.facilityKey].rigSize;
    if (!size) return '<p class="note" style="margin:0">NPC stations have no rig slots.</p>';
    return [1, 2, 3].map(slot => {
      if (rigPickSlot === slot) {
        return `<div class="field" style="margin-bottom:6px"><input type="text" id="f-rigq" placeholder="Search ${size}-Set rigs" autocomplete="off" aria-label="Search rigs for slot ${slot}"><ul class="results" id="f-rig-results">${rigResultsHTML('')}</ul><button class="backlink" type="button" data-st="rig-cancel">Cancel</button></div>`;
      }
      const rig = MB.rigInfo(parseInt(draft['rig' + slot]) || 0);
      if (!rig) return `<button class="rigslot empty" type="button" data-rigslot="${slot}">+ Fit a rig in slot ${slot}</button>`;
      const eff = rigEffect(rig);
      const fits = rig.size === size;
      return `<div class="rigslot"><span class="rig-num">${slot}</span><span class="rig-body"><b>${esc(rig.name)}</b><small class="${fits && eff.hit ? 'hit' : ''}">${fits ? eff.text : `Wrong size for a ${esc(MB.STRUCT[draft.facilityKey].shortLabel)}, so it does nothing`}</small></span><button class="iconbtn" type="button" data-rigclear="${slot}" aria-label="Remove ${esc(rig.name)}">${ICON.x}</button></div>`;
    }).join('');
  }
  function systemResultsHTML(q) {
    const hits = MB.searchSystems(q);
    if (!q.trim()) return '';
    if (!hits.length) return '<li class="note" style="padding:10px">No system by that name.</li>';
    return hits.map(s => `<li><button type="button" data-sys="${s.id}"><span class="r-name">${esc(MB.systemName(s.id, s.name))} ${MB.secHTML(MB.sysInfo(s.id).sec)}</span><span class="r-meta">mfg ${MB.pctText(MB.sysInfo(s.id).mfg)}</span></button></li>`).join('');
  }
  function stationFormHTML() {
    const d = draft;
    return `<button class="backlink" type="button" data-st="list">${ICON.back}Saved stations</button>
      <div class="field"><label for="f-name">Name</label><input type="text" id="f-name" value="${esc(d.name)}" placeholder="e.g. Home Sotiyo" autocomplete="off" maxlength="40"></div>
      <div class="field"><label for="f-sys">Solar system</label><input type="text" id="f-sys" value="${d.systemId ? esc(MB.systemName(d.systemId, d.systemName)) : ''}" placeholder="Search any system" autocomplete="off"><ul class="results" id="f-sys-results"></ul><div class="sysinfo" id="f-sysinfo">${sysInfoHTML(d.systemId)}</div></div>
      <div class="field"><label for="f-struct">Structure</label><select id="f-struct">${MB.STRUCT_ORDER.map(k => `<option value="${k}"${k === d.facilityKey ? ' selected' : ''}>${esc(MB.STRUCT[k].label)}</option>`).join('')}</select><small id="f-structinfo">${structInfo(d.facilityKey)}</small></div>
      <div class="field"><label for="f-tax">Job tax</label><div class="suffix"><input type="text" id="f-tax" inputmode="decimal" value="${esc(d.facilityTax)}" autocomplete="off"><span>%</span></div><small>Set by whoever owns the structure. 0% is fine.</small></div>
      <div class="field"><span class="label" id="rigs-label">Rigs</span><div id="f-rigs" role="group" aria-labelledby="rigs-label">${rigsHTML()}</div></div>
      <div class="formerr" id="f-err" role="alert"></div>
      <button class="btn primary" type="button" data-st="save">${d.oldName ? 'Save changes' : 'Save station'}</button>
      ${d.oldName ? '<button class="btn" type="button" data-st="delete">Delete station</button>' : ''}`;
  }
  function showStationView(view) {
    stView = view;
    if (view === 'list') { draft = null; rigPickSlot = null; }
    MB.fillSheet();
    $('#sheet').scrollTop = 0;
    const first = $('#sheet-body').querySelector('button, input');
    if (first) first.focus({ preventScroll: true });
  }
  async function pickStation(id) {
    const st = MB.stationList().find(s => s.id === id);
    if (!st) return;
    await MB.applyStation(st);
    MB.rebuildStock();
    MB.renderAll();
    if (MB.sheetKind() === 'stations') MB.fillSheet();
    toast(`Building at “${st.name}”`);
  }
  async function switchToCheapest() {
    if (!cur()) return;
    await Promise.all(MB.stationList().map(s => MB.loadSecurity(s.systemId)));
    const costs = costAtEachStation().filter(c => c.cost > 0);
    const active = MB.activeStation();
    const here = costs.find(c => c.st.id === active.id);
    if (costs.length < 2 || !here) { toast('Save at least two stations to compare them'); return; }
    const best = costs.reduce((a, b) => (b.cost < a.cost ? b : a));
    if (best.cost >= here.cost - 0.5) { toast(`“${here.st.name}” is already your cheapest of ${costs.length}`); return; }
    await MB.applyStation(best.st);
    MB.rebuildStock();
    MB.renderAll();
    if (MB.sheetKind() === 'stations') MB.fillSheet();
    toast(`Switched to “${best.st.name}”, saves ${compact(here.cost - best.cost)} vs “${here.st.name}”`);
  }
  async function saveDraft() {
    const name = $('#f-name').value.trim();
    const tax = parseFloat(String($('#f-tax').value).replace(',', '.'));
    const presets = MB.presets();
    const err = !name ? 'Give the station a name.'
      : (name !== draft.oldName && presets[name]) ? `You already have a station called “${name}”.`
      : !draft.systemId ? 'Pick a solar system from the list.'
      : !(tax >= 0 && tax <= 100) ? 'Job tax needs to be a number from 0 to 100.'
      : '';
    if (err) { $('#f-err').textContent = err; return; }
    const st = { systemId: draft.systemId, systemName: draft.systemName, facilityKey: draft.facilityKey, facilityTax: Math.round(tax * 1000) / 1000, rig1: draft.rig1, rig2: draft.rig2, rig3: draft.rig3 };
    const wasActive = draft.wasActive;
    MB.savePreset(name, st, draft.oldName);
    if (wasActive || !draft.oldName) await MB.applyStation(st);
    MB.rebuildStock();
    MB.renderAll();
    showStationView('list');
    toast(draft && draft.oldName ? `Saved “${name}”` : `Saved “${name}” and switched to it`);
  }
  function deleteDraft() {
    const name = draft.oldName;
    const removed = MB.deletePreset(name);
    MB.renderAll();
    showStationView('list');
    toast(`Deleted “${name}”`, { label: 'Undo', run: () => { MB.restorePreset(name, removed); MB.renderAll(); if (MB.sheetKind() === 'stations' && stView === 'list') MB.fillSheet(); } });
  }
  SH.stations = {
    title: () => (stView === 'form' ? (draft && draft.oldName ? 'Edit station' : 'Add a station') : 'Production station'),
    html: () => (stView === 'form' ? stationFormHTML() : stationsListHTML()),
    open() {
      stView = 'list'; draft = null; rigPickSlot = null;
      Promise.all(MB.stationList().map(s => MB.loadSecurity(s.systemId))).then(() => { if (MB.sheetKind() === 'stations' && stView === 'list') MB.fillSheet(); });
    },
    input(e) {
      if (!draft) return;
      if (e.target.id === 'f-name') draft.name = e.target.value;
      if (e.target.id === 'f-tax') draft.facilityTax = e.target.value;
      if (e.target.id === 'f-sys') $('#f-sys-results').innerHTML = systemResultsHTML(e.target.value);
      if (e.target.id === 'f-rigq') $('#f-rig-results').innerHTML = rigResultsHTML(e.target.value);
    },
    change(e) {
      if (!draft || e.target.id !== 'f-struct') return;
      const key = e.target.value;
      const size = MB.STRUCT[key].rigSize;
      const dropped = [1, 2, 3].filter(i => draft['rig' + i] && (!MB.rigInfo(parseInt(draft['rig' + i])) || MB.rigInfo(parseInt(draft['rig' + i])).size !== size)).length;
      draft.facilityKey = key;
      [1, 2, 3].forEach(i => { const r = MB.rigInfo(parseInt(draft['rig' + i]) || 0); if (!r || r.size !== size) draft['rig' + i] = ''; });
      rigPickSlot = null;
      $('#f-structinfo').textContent = structInfo(key);
      $('#f-rigs').innerHTML = rigsHTML();
      const why = size ? `${MB.STRUCT[key].shortLabel} only takes ${size}-Set rigs` : 'NPC stations have no rig slots';
      if (dropped) toast(`Removed ${dropped} rig${dropped === 1 ? '' : 's'}: ${why}`);
    },
    async click(e) {
      const hit = sel => e.target.closest(sel);
      let el;
      if ((el = hit('[data-pick]'))) { pickStation(el.dataset.pick); return; }
      if ((el = hit('[data-edit]'))) {
        const st = MB.stationList().find(s => s.id === el.dataset.edit);
        const active = MB.activeStation();
        draft = { ...st, name: st.saved ? st.name : '', oldName: st.saved ? st.name : null, facilityTax: String(st.facilityTax), wasActive: active.id === st.id };
        rigPickSlot = null;
        showStationView('form');
        return;
      }
      if ((el = hit('[data-sys]'))) {
        const id = +el.dataset.sys;
        draft.systemId = id;
        draft.systemName = (window.systemNameCache && window.systemNameCache[id]) || MB.systemName(id).toUpperCase();
        $('#f-sys').value = MB.systemName(id, draft.systemName);
        $('#f-sys-results').innerHTML = '';
        $('#f-sysinfo').innerHTML = sysInfoHTML(id) + ' <span class="spin" aria-hidden="true"></span>';
        await MB.loadSecurity(id);
        if (draft && draft.systemId === id) { $('#f-sysinfo').innerHTML = sysInfoHTML(id); $('#f-rigs').innerHTML = rigsHTML(); }
        return;
      }
      if ((el = hit('[data-rigslot]'))) { rigPickSlot = +el.dataset.rigslot; $('#f-rigs').innerHTML = rigsHTML(); $('#f-rigq').focus(); return; }
      if ((el = hit('[data-rigpick]'))) { draft['rig' + rigPickSlot] = String(el.dataset.rigpick); rigPickSlot = null; $('#f-rigs').innerHTML = rigsHTML(); return; }
      if ((el = hit('[data-rigclear]'))) { draft['rig' + el.dataset.rigclear] = ''; $('#f-rigs').innerHTML = rigsHTML(); return; }
      if ((el = hit('[data-st]'))) {
        const act = el.dataset.st;
        if (act === 'add') {
          const live = MB.liveStation();
          draft = { name: '', oldName: null, systemId: live.systemId, systemName: live.systemName, facilityKey: live.facilityKey, facilityTax: String(live.facilityTax), rig1: '', rig2: '', rig3: '', wasActive: false };
          rigPickSlot = null;
          showStationView('form');
        }
        if (act === 'list') showStationView('list');
        if (act === 'best') switchToCheapest();
        if (act === 'save') saveDraft();
        if (act === 'delete') deleteDraft();
        if (act === 'rig-cancel') { rigPickSlot = null; $('#f-rigs').innerHTML = rigsHTML(); }
      }
    }
  };

  /* =====================  For other screens  ===================== */
  MB.calc = {
    state: C,
    current: cur,
    selectItem,
    getItem,
    productOfBp,
    productName,
    // LP Store "Build it in the Calculator": a BPC with a fixed run count, plus what it cost in LP.
    openFromLP(ctx) {
      C.lpCtx = ctx;
      C.ov = {}; C.sources = {}; C.meOv = {}; C.teOv = {};
      C.runs = ctx.runs || 1; C.jobs = 1; C.sell = { mode: 'auto', price: 0 };
      selectItem(ctx.bp, { preserve: true, keepLp: true });
      MB.goScreen('calc');
    },
    // Invention "Build it in the Calculator": an invented copy with its own ME/TE and run count,
    // like the desktop's ?build= link from the Invention page.
    openBlueprint({ bp, runs, me, te }) {
      C.ov = {}; C.sources = {}; C.meOv = {}; C.teOv = {};
      if (Number.isFinite(me)) C.meOv[bp] = me;
      if (Number.isFinite(te)) C.teOv[bp] = te;
      C.runs = Math.max(1, runs || 1); C.jobs = 1; C.sell = { mode: 'auto', price: 0 };
      selectItem(bp, { preserve: true });
      MB.goScreen('calc');
    }
  };
})();
