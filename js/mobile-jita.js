'use strict';

// Phone layout: the Jita Shopping screen. Reads and writes the desktop Jita Shopping page's own saved
// list, favorites, wishlist, "grabbed" checkmarks and hauler size (eve_sl_* keys) in the same format,
// so both pages show the same list. The rules are ports of js/shoppinglist.js: exact-name lookup for
// pasted lists and EFT fits, the same item filter for search, packaged volume for ships, the same
// market-spread rule, the fit EFT copy and Multibuy lines as "Name xQty". Volume always counts
// everything you haul; price and Multibuy leave out what you already own.
//
// One deliberate difference: the desktop takes your stock off each row separately, so two fits that
// need the same module can both count the same stack. Here your stock is shared out once, top to
// bottom, so the rows add up to the total and the Multibuy.
(() => {
  const MB = window.MB;
  const { $, esc, compact, qty, ICON, LS, toast, prefs, iconHTML } = MB;

  const KEY = { session: 'eve_sl_session_v1', wish: 'eve_sl_wishlist_v1', favs: 'eve_sl_favorites_v1', pulled: 'eve_sl_pull_checked_v1', cap: 'eve_sl_hauler_m3' };
  const DEFAULT_CAP = 62000; // the desktop page's own starting value
  prefs.jita = Object.assign({ mode: 'sell', spread: 5 }, prefs.jita || {});

  /* =====================  Saved state (shared with the desktop page)  ===================== */
  // items: [{typeId, name, qty, volume}]
  // fits:  [{fitId, name, shipName, shipTypeId, copies, collapsed, baseItems: [{typeId, name, qty, volume}], fitText}]
  // favorites: [{kind:'item', typeId, name} | {kind:'fit', name, shipName, shipTypeId, fitText} | {kind:'list', name, ts, items, fits}]
  // wishlist:  [{kind:'fit', fitName, shipName, shipTypeId, copies, fitText} | {kind:'item', typeId, name, qty}]
  const arr = a => (Array.isArray(a) ? a.filter(x => x && typeof x === 'object') : []);
  let S = { items: [], fits: [], fitCounter: 0 };
  let wish = [], favs = [], pulled = {};
  function load() {
    const d = LS.get(KEY.session, null) || {};
    S = {
      items: arr(d.items).filter(i => i.typeId),
      fits: arr(d.fits).filter(f => Array.isArray(f.baseItems)),
      fitCounter: Number(d.fitCounter) || 0
    };
    S.fitCounter = Math.max(S.fitCounter, ...S.fits.map(f => Number(f.fitId) || 0));
    wish = arr(LS.get(KEY.wish, []));
    favs = arr(LS.get(KEY.favs, []));
    const p = LS.get(KEY.pulled, {});
    pulled = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  }
  const saveSession = () => LS.set(KEY.session, { formatVersion: 1, items: S.items, fits: S.fits, fitCounter: S.fitCounter });
  const saveWish = () => LS.set(KEY.wish, wish);
  const saveFavs = () => LS.set(KEY.favs, favs);
  const savePulled = () => LS.set(KEY.pulled, pulled);
  function hauler() {
    const raw = LS.raw(KEY.cap);
    const v = parseFloat(raw);
    return raw && Number.isFinite(v) && v >= 0 ? v : DEFAULT_CAP;
  }

  // What's on screen but not saved: tabs, search boxes, text being typed, open sheets.
  const J = {
    tab: 'list', modes: {}, pricing: false,
    picked: null, addQty: 1, q: '', favQ: '', paste: '', eft: '', copies: 1, favEft: '', saveName: '',
    qfilter: 'all', favEdit: false, qtyFor: null, qtyN: 1, view: null, importText: ''
  };

  /* =====================  Items: lookup, search, volume  ===================== */
  // EVE copies exact names, so a plain lowercase lookup in the site's own name index resolves them.
  function lookup(name) {
    const hit = window.IDX && window.IDX[String(name).toLowerCase().trim()];
    return hit ? { id: hit.id, name: hit.name } : null;
  }
  const volumeFor = id => (window.EVE_VOLUMES && window.EVE_VOLUMES[id]) || 0;
  const isShip = id => !!(window.EVE_CATEGORIES && window.EVE_CATEGORIES[id] === 6);
  // js/shoppinglist.js slIsRealShoppableItem: no scenery, celestials, event junk, QA test items, or
  // "Limited" reward items (never on the market).
  const EXCLUDED_CATEGORIES = new Set([2, 3, 11, 63]);
  function shoppable(id, name) {
    if (name && /^Limited\s/i.test(name)) return false;
    const cat = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[id] : undefined;
    if (cat === undefined) return true;
    return cat < 1000 && !EXCLUDED_CATEGORIES.has(cat);
  }
  let shopIndex = null; // built once: every shoppable [lowercase name, {id, name}]
  function search(q, limit) {
    const ql = String(q || '').toLowerCase().trim();
    if (ql.length < 2 || !window.IDX) return [];
    if (!shopIndex) shopIndex = Object.entries(window.IDX).filter(([k, v]) => !window.isBlueprintName(k) && shoppable(v.id, v.name));
    const exact = [], starts = [], contains = [];
    for (const [k, v] of shopIndex) {
      if (k === ql) exact.push(v);
      else if (k.startsWith(ql)) starts.push(v);
      else if (k.includes(ql)) contains.push(v);
    }
    starts.sort((a, b) => a.name.localeCompare(b.name));
    contains.sort((a, b) => a.name.localeCompare(b.name));
    return [...exact, ...starts, ...contains].slice(0, limit || 12);
  }
  // Ships use their packaged volume (what a hauler carries), fetched once per hull and cached by the site.
  function refreshShipVolumes(ids) {
    const ships = [...new Set(ids)].filter(isShip);
    if (!ships.length) return;
    Promise.all(ships.map(id => window.fetchPackagedVolume(id).then(vol => {
      if (!vol) return false;
      let changed = false;
      const fix = it => { if (it.typeId === id && it.volume !== vol) { it.volume = vol; changed = true; } };
      S.items.forEach(fix);
      S.fits.forEach(f => f.baseItems.forEach(fix));
      return changed;
    }))).then(r => { if (r.some(Boolean)) { saveSession(); refreshShown(); } });
  }
  const listIds = () => [...new Set([...S.items.map(i => i.typeId), ...S.fits.flatMap(f => f.baseItems.map(i => i.typeId))])];

  /* =====================  EFT fits (js/shoppinglist.js)  ===================== */
  function parseEFT(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const raw = [];
    let fitName = '', shipName = '';
    for (const line of lines) {
      if (line.startsWith('//') || line.startsWith('#')) continue;
      if (/^\[empty/i.test(line)) continue;
      if (line.startsWith('[') && line.endsWith(']')) {
        if (line.includes(',')) {
          const inner = line.slice(1, -1), ci = inner.indexOf(',');
          shipName = inner.slice(0, ci).trim();
          fitName = inner.slice(ci + 1).trim() || shipName;
        }
        continue;
      }
      let name = line, n = 1;
      const m = line.match(/^(.+?)\s+x\s*(\d[\d,]*)\s*$/i);
      if (m) { name = m[1].trim(); n = parseInt(m[2].replace(/,/g, ''), 10); }
      const parts = name.split(', ').map(s => s.trim()).filter(Boolean);
      raw.push({ name: parts[0], qty: n });
      for (let i = 1; i < parts.length; i++) raw.push({ name: parts[i], qty: 1 });
    }
    const map = {};
    for (const { name, qty: n } of raw) { const k = name.toLowerCase(); map[k] = map[k] ? { ...map[k], qty: map[k].qty + n } : { name, qty: n }; }
    return { fitName: fitName || 'Imported Fit', shipName, items: Object.values(map) };
  }
  // The hull is added as an item when the fit doesn't list it. Returns null when nothing matched.
  function buildFit(text, copies) {
    const { fitName, shipName, items: parsed } = parseEFT(text);
    const found = [];
    for (const p of parsed) { const r = lookup(p.name); if (r) found.push({ typeId: r.id, name: r.name, qty: p.qty, volume: volumeFor(r.id) }); }
    let shipTypeId = 0, shipResolved = shipName;
    if (shipName) { const sr = lookup(shipName); if (sr) { shipTypeId = sr.id; shipResolved = sr.name; } }
    const map = {};
    for (const it of found) { if (map[it.typeId]) map[it.typeId].qty += it.qty; else map[it.typeId] = { ...it }; }
    if (shipTypeId && !map[shipTypeId]) map[shipTypeId] = { typeId: shipTypeId, name: shipResolved, qty: 1, volume: volumeFor(shipTypeId) };
    const baseItems = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    if (!baseItems.length) return null;
    return { fitId: 0, name: fitName, shipName: shipResolved, shipTypeId, copies: copies || 1, collapsed: false, baseItems, fitText: text, skipped: parsed.length - found.length };
  }
  function pushFit(fit) {
    fit.fitId = ++S.fitCounter;
    S.fits.push(fit);
  }
  // slCopyFitMultibuy: the fit's own EFT text with every line multiplied by the copies.
  function fitEFT(fit) {
    if (fit.fitText) {
      const lines = fit.fitText.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('['); });
      return `[${fit.shipName || 'Unknown Ship'}, ${fit.name}]\n` + (fit.copies > 1
        ? lines.map(line => { const m = line.match(/^(.+?)\s+x(\d+)\s*$/i); return m ? `${m[1].trim()} x${parseInt(m[2], 10) * fit.copies}` : `${line.trim()} x${fit.copies}`; }).join('\n')
        : lines.join('\n'));
    }
    const mods = fit.baseItems.filter(it => it.typeId !== fit.shipTypeId).map(it => { const q = it.qty * fit.copies; return q > 1 ? `${it.name} x${q}` : it.name; });
    return [`[${fit.shipName || 'Unknown Ship'}, ${fit.name}]`, ...mods].join('\n');
  }

  /* =====================  Adding to the list  ===================== */
  function addItem(typeId, name, n) {
    const ex = S.items.find(i => i.typeId === typeId);
    if (ex) ex.qty += n;
    else S.items.push({ typeId, name, qty: n, volume: volumeFor(typeId) });
  }
  // After any add: save, fetch prices for what's new, fix ship volumes.
  function afterAdd(ids) {
    saveSession();
    fetchPrices(ids);
    refreshShipVolumes(ids);
  }
  const viewList = { label: 'View', run: () => setTab('list') };
  function useFavorite(i) {
    const f = favs[i];
    if (!f) return;
    if (f.kind === 'item') { addItem(f.typeId, f.name, 1); afterAdd([f.typeId]); }
    else if (f.kind === 'fit') {
      const fit = buildFit(f.fitText, 1);
      if (!fit) { toast('No items in that fit matched'); return; }
      fit.name = f.name;
      pushFit(fit);
      afterAdd(fit.baseItems.map(x => x.typeId));
    } else {
      (f.items || []).forEach(it => addItem(it.typeId, it.name, it.qty));
      (f.fits || []).forEach(ft => pushFit({ ...ft, baseItems: (ft.baseItems || []).map(x => ({ ...x })) }));
      afterAdd(listIds());
    }
    toast(`${f.name} added to your list`, viewList);
  }
  function replaceWithFavorite(i) {
    const f = favs[i];
    if (!f || f.kind !== 'list') return;
    const before = { items: S.items, fits: S.fits };
    S.items = (f.items || []).map(x => ({ ...x }));
    S.fits = [];
    (f.fits || []).forEach(ft => pushFit({ ...ft, baseItems: (ft.baseItems || []).map(x => ({ ...x })) }));
    J.modes = {};
    afterAdd(listIds());
    toast(`Your list is now “${f.name}”`, { label: 'Undo', run: () => { S.items = before.items; S.fits = before.fits; saveSession(); rerender(); } });
  }
  function addWish(i) {
    const w = wish[i];
    if (!w) return;
    if (w.kind === 'item') { addItem(w.typeId, w.name, w.qty || 1); afterAdd([w.typeId]); toast(`Added ${qty(w.qty || 1)} × ${w.name}`, viewList); return; }
    const fit = buildFit(w.fitText, w.copies || 1);
    if (!fit) { toast('No items in that fit matched'); return; }
    fit.name = w.fitName;
    pushFit(fit);
    afterAdd(fit.baseItems.map(x => x.typeId));
    toast(`${w.fitName}${(w.copies || 1) > 1 ? ` ×${w.copies}` : ''} added to your list`, viewList);
  }

  /* =====================  Prices and stock  ===================== */
  // Prices come from the site's own fetcher (Fuzzwork, Jita 4-4 unless a home station is set).
  async function fetchPrices(ids) {
    const want = [...new Set(ids)].filter(id => !window.priceCache[id]);
    if (!want.length) return;
    J.pricing = true;
    try { await window.fetchMarketPrices(want); } catch (e) { console.warn('[Phone] Price fetch failed:', e); }
    J.pricing = false;
    refreshShown();
  }
  function price(id) {
    const p = window.priceCache && window.priceCache[id];
    if (!p) return 0;
    return ((J.modes[id] || prefs.jita.mode) === 'buy' ? p.buy : p.sell) || 0;
  }
  const deducting = () => prefs.deduct && MB.isLoggedIn();
  // Share your stock out once over the list, fits first, the way the rows are shown.
  function allocate() {
    const left = {};
    const rows = new Map();
    const deduct = deducting();
    const claim = (id, need) => {
      if (!deduct) return 0;
      if (left[id] === undefined) left[id] = MB.stockOf(id);
      const h = Math.min(need, left[id]);
      left[id] -= h;
      return h;
    };
    S.fits.forEach(f => f.baseItems.forEach(i => { const need = i.qty * f.copies; const h = claim(i.typeId, need); rows.set(`f${f.fitId}:${i.typeId}`, { need, have: h, net: need - h }); }));
    S.items.forEach(i => { const h = claim(i.typeId, i.qty); rows.set(`i:${i.typeId}`, { need: i.qty, have: h, net: i.qty - h }); });
    return rows;
  }
  const rowOf = (rows, fit, it) => rows.get(fit ? `f${fit.fitId}:${it.typeId}` : `i:${it.typeId}`) || { need: 0, have: 0, net: 0 };
  function totals(rows) {
    let vol = 0, cost = 0, units = 0;
    const add = (it, r) => { vol += (it.volume || 0) * r.need; cost += price(it.typeId) * r.net; units += r.net; };
    S.fits.forEach(f => f.baseItems.forEach(it => add(it, rowOf(rows, f, it))));
    S.items.forEach(it => add(it, rowOf(rows, null, it)));
    return { vol, cost, units, types: S.fits.reduce((s, f) => s + f.baseItems.length, 0) + S.items.length };
  }
  // Everything on the list, one line per item type (what the pull list and Multibuy work from).
  function needs(rows) {
    const map = new Map();
    const add = (it, need, net) => { const e = map.get(it.typeId) || { id: it.typeId, name: it.name, qty: 0, net: 0 }; e.qty += need; e.net += net; map.set(it.typeId, e); };
    S.fits.forEach(f => f.baseItems.forEach(it => { const r = rowOf(rows, f, it); add(it, r.need, r.net); }));
    S.items.forEach(it => { const r = rowOf(rows, null, it); add(it, r.need, r.net); });
    return [...map.values()];
  }
  const multibuy = list => list.filter(e => e.net > 0).map(e => (e.net > 1 ? `${e.name} x${e.net}` : e.name));
  function fmtVol(v) {
    if (!v) return '0';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  const eachText = id => { const p = price(id); return p ? `${compact(p)} each` : (window.priceCache[id] ? 'no price' : 'price loading'); };

  /* =====================  Small pieces  ===================== */
  // A stepper whose number can also be typed (quantities in the thousands are common here).
  function numField(key, v, min, label) {
    const w = Math.max(36, String(v).length * 9 + 12);
    return `<span class="stepper sm"><button type="button" data-step="${key}" data-d="-1" aria-label="Lower ${esc(label)}"${v <= min ? ' disabled' : ''}>−</button><input type="text" inputmode="numeric" data-jnum="${key}" value="${v}" style="width:${w}px" aria-label="${esc(label)}"><button type="button" data-step="${key}" data-d="1" aria-label="Raise ${esc(label)}">+</button></span>`;
  }
  const spreadBadge = id => (J.modes[id] ? (J.modes[id] === 'buy' ? '<span class="spill order">Buy order</span>' : '<span class="spill instant">Instant</span>') : '');
  const favIndex = id => favs.findIndex(f => f.kind === 'item' && f.typeId === id);
  const favBtn = (id, name) => {
    const on = favIndex(id) !== -1;
    return `<button class="minibtn" type="button" data-jact="fav" data-id="${id}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(name)} ${on ? 'from' : 'to'} favorites">${ICON.star}</button>`;
  };
  const QFAV = [['all', 'All'], [7, 'Modules'], [8, 'Charges & Consumables'], [18, 'Drones'], [20, 'Implants & Boosters'], [4, 'Materials'], [16, 'Skills'], ['other', 'Other']];
  const qfavCat = id => { const c = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[id] : undefined; return QFAV.some(q => q[0] === c) ? c : 'other'; };
  const setTab = tab => { J.tab = tab; render(); $('#screen-jita').scrollTop = 0; };
  // Prices or volumes arrived: only the List tab and a saved-fit view show them. (Redrawing the
  // other tabs would take the cursor out of a box you're typing in.)
  const refreshShown = () => { if (MB.screen() === 'jita' && J.tab === 'list') renderList(); MB.refillSheet('jview'); };
  // The saved list changed from elsewhere (an import, the desktop page in another tab).
  const rerender = () => { if (MB.screen() === 'jita') render(); MB.refillSheet('jview'); };
  function removeFit(fit) {
    const i = S.fits.indexOf(fit);
    if (i === -1) return;
    S.fits.splice(i, 1);
    saveSession();
    renderList();
    toast(`Removed ${fit.name}`, { label: 'Undo', run: () => { S.fits.splice(i, 0, fit); saveSession(); renderList(); } });
  }

  /* =====================  List tab  ===================== */
  function stockHTML() {
    if (!MB.isLoggedIn()) {
      return `<div class="login-card">${ICON.lock}<p>Log in to take what you already own off this list.</p><button class="btn primary" type="button" data-jact="login">Log in</button></div>`;
    }
    const synced = parseInt(LS.raw('eve_assets_last_synced')) || 0;
    const locs = MB.stockLocations();
    if (!locs.some(([v]) => v === prefs.stockLoc)) prefs.stockLoc = 'all';
    return `<div class="card-title">Your stock</div>
      <div class="card">
        <div class="kv"><span class="k">Take what I own off the list<small>${esc(MB.activeChar().charName)} · ${synced ? `assets refreshed ${MB.ago(synced)}` : 'assets loading'}</small></span><button class="switch" type="button" role="switch" data-jact="deduct" aria-checked="${prefs.deduct}" aria-label="Take what I own off the list"></button></div>
        <div class="kv"><span class="k">Count stock from</span><span class="pillset"><button class="chip small" type="button" data-jact="personal" aria-pressed="${prefs.stockPersonal}">Personal</button><button class="chip small" type="button" data-jact="corp" aria-pressed="${prefs.stockCorp}">Corp</button></span></div>
        <div class="kv"><label class="k" for="j-loc">Location</label><span style="flex:1.4;min-width:0"><select id="j-loc">${locs.map(([v, l]) => `<option value="${esc(v)}"${v === prefs.stockLoc ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span></div>
      </div>`;
  }
  // What to grab from one container before you undock (js/shoppinglist.js slRenderPullList): only
  // once Location is a single container, so it means "empty this can", not "everything you own".
  function pullHTML(rows) {
    if (!MB.isLoggedIn() || !(window.rawAssetItems || []).length || (!S.items.length && !S.fits.length)) return '';
    const loc = prefs.stockLoc || 'all';
    if (!loc.startsWith('container_')) return '<p class="note" style="margin:0 2px 12px">Pick a container under Location to get a checklist of what to grab from it.</p>';
    const canName = MB.titleCase((window.resolvedLocationNames && window.resolvedLocationNames[loc.slice(10)]) || 'this container');
    const list = needs(rows).map(e => ({ ...e, pull: Math.min(e.qty, MB.stockOf(e.id)) })).filter(r => r.pull > 0).sort((a, b) => a.name.localeCompare(b.name));
    const done = list.filter(r => pulled[r.id]).length;
    return `<div class="card-title">Already in ${esc(canName)} <span class="count" style="letter-spacing:0;text-transform:none;font-weight:600">${done}/${list.length} grabbed</span>${done ? '<button class="linkbtn" style="margin-left:auto;padding:0" type="button" data-jact="resetpull">Reset</button>' : ''}</div>
      <div class="card">${list.length ? `<ul class="pull">${list.map(r => `<li><button type="button" data-jpull="${r.id}" aria-pressed="${!!pulled[r.id]}"><span class="check" aria-hidden="true">${pulled[r.id] ? ICON.check : ''}</span>${iconHTML(r.id)}<span class="n">${esc(r.name)}</span><span class="q">${qty(r.pull)}</span></button></li>`).join('')}</ul>` : '<p class="note" style="padding:10px 0">Nothing in this container is on your list.</p>'}</div>`;
  }
  function fitItemHTML(fit, it, rows) {
    const r = rowOf(rows, fit, it);
    const deduct = deducting();
    return `<div class="irow">${iconHTML(it.typeId)}<div class="main"><span class="nm">${esc(it.name)}</span><span class="sub">${qty(it.qty)}×/fit · ${eachText(it.typeId)}${r.have ? ` · ${qty(r.have)} owned` : ''}</span><span class="tags">${it.typeId === fit.shipTypeId ? '<span class="spill ship">Ship</span>' : ''}${spreadBadge(it.typeId)}${favBtn(it.typeId, it.name)}<button class="minibtn" type="button" data-jact="rmfititem" data-fid="${fit.fitId}" data-id="${it.typeId}" aria-label="Remove ${esc(it.name)} from the fit">${ICON.x}</button></span></div><div class="right"><span class="cost">${price(it.typeId) ? compact(price(it.typeId) * r.net) : '—'}</span><span class="buyqty">${deduct ? `buy ${qty(r.net)}` : `×${qty(r.need)}`}</span></div></div>`;
  }
  function itemRowHTML(it, rows) {
    const r = rowOf(rows, null, it);
    return `<div class="irow">${iconHTML(it.typeId)}<div class="main"><span class="nm">${esc(it.name)}</span><span class="sub">${eachText(it.typeId)} · ${fmtVol(it.volume)} m³${r.have ? ` · ${qty(r.have)} owned` : ''}</span><span class="tags">${spreadBadge(it.typeId)}${favBtn(it.typeId, it.name)}<button class="minibtn" type="button" data-jact="rmitem" data-id="${it.typeId}" aria-label="Remove ${esc(it.name)}">${ICON.x}</button></span></div><div class="right"><span class="cost">${price(it.typeId) ? compact(price(it.typeId) * r.net) : '—'}</span>${numField('j:item:' + it.typeId, it.qty, 1, it.name)}</div></div>`;
  }
  function fitHTML(f, rows) {
    const sub = f.baseItems.reduce((s, it) => s + price(it.typeId) * rowOf(rows, f, it).net, 0);
    const vol = f.baseItems.reduce((s, it) => s + (it.volume || 0) * it.qty, 0) * f.copies;
    const mods = f.baseItems.filter(i => i.typeId !== f.shipTypeId).length;
    const ship = f.shipTypeId ? f.baseItems.find(i => i.typeId === f.shipTypeId) : null;
    const ordered = ship ? [ship, ...f.baseItems.filter(i => i !== ship)] : f.baseItems;
    const open = !f.collapsed;
    return `<div class="fit">
      <div class="fit-head">
        <button class="chev" type="button" data-jact="togglefit" data-fid="${f.fitId}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(f.name)}">${ICON.chev}</button>
        ${iconHTML(f.shipTypeId)}
        <div style="min-width:0"><div class="fit-name">${esc(f.name)}</div><div class="fit-sub">${esc(f.shipName || 'Fit')} · ${mods} module${mods === 1 ? '' : 's'} · ${fmtVol(vol)} m³ · ${sub ? compact(sub) : '—'}</div></div>
        ${numField('j:copies:' + f.fitId, f.copies, 1, 'copies of ' + f.name)}
      </div>
      <div class="fit-body"${open ? '' : ' hidden'}>
        ${ordered.map(it => fitItemHTML(f, it, rows)).join('')}
        <div class="fit-foot">
          <button class="btn" type="button" data-jact="copyeft" data-fid="${f.fitId}">${ICON.copy}Copy EFT</button>
          <button class="btn" type="button" data-jact="fitmb" data-fid="${f.fitId}">${ICON.copy}Multibuy</button>
          <button class="btn" type="button" data-jact="rmfit" data-fid="${f.fitId}" aria-label="Remove ${esc(f.name)}" style="flex:0 0 48px">${ICON.trash}</button>
        </div>
      </div>
    </div>`;
  }
  function renderList() {
    const rows = allocate();
    const t = totals(rows);
    const empty = !S.items.length && !S.fits.length;
    const cap = hauler();
    const pct = cap > 0 ? Math.min(100, (t.vol / cap) * 100) : 0;
    const over = cap > 0 && t.vol > cap;
    const optimized = Object.keys(J.modes).length > 0;
    const modeLabel = optimized ? 'optimized, mixed' : prefs.jita.mode === 'sell' ? 'Jita sell' : 'Jita buy';
    const lines = multibuy(needs(rows));
    $('#p-jl').innerHTML = `
      <div class="jsum">
        <div class="top"><div><div class="lbl">Total, ${modeLabel}${deducting() ? ', stock taken off' : ''}</div><div class="big">${empty ? '—' : J.pricing && !t.cost ? '<span class="spin" aria-label="Loading prices"></span>' : compact(t.cost)}</div></div><div class="side">${t.types} type${t.types === 1 ? '' : 's'}<br>${qty(t.units)} to buy</div></div>
        ${cap > 0 ? `<div class="hbar${over ? ' over' : pct > 70 ? ' warn' : ''}" role="progressbar" aria-label="Hauler space used" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ''}
        <div class="hline${over ? ' over' : ''}"${cap > 0 ? '' : ' style="margin-top:10px"'}><span>${fmtVol(t.vol)}${cap > 0 ? ` / ${fmtVol(cap)}` : ''} m³${over ? ' · won’t fit in one trip' : ''}</span><label class="capin">Hauler <input type="text" inputmode="numeric" id="j-cap" value="${cap}" aria-label="Hauler capacity in cubic meters"> m³</label></div>
      </div>
      <div class="ctlrow">
        <span class="segctl" role="group" aria-label="Price everything at">
          <button type="button" data-jmode="sell" data-mode="sell" aria-pressed="${!optimized && prefs.jita.mode === 'sell'}">${ICON.bolt}Jita sell</button>
          <button type="button" data-jmode="buy" data-mode="buy" aria-pressed="${!optimized && prefs.jita.mode === 'buy'}">${ICON.order}Jita buy</button>
        </span>
        <button class="chip small" type="button" data-jact="spread">Pick buy orders</button>
        <span class="nlabel" style="letter-spacing:0.06em">Min spread %</span>
        ${MB.stepper('j:spread', prefs.jita.spread, 0, 50, 'minimum spread')}
      </div>
      ${stockHTML()}
      ${pullHTML(rows)}
      ${empty ? '<div class="empty"><b>Your list is empty</b>Add items, paste a list or import a fit under “Add items”.</div>' : ''}
      ${S.fits.map(f => fitHTML(f, rows)).join('')}
      ${S.items.length ? `<div class="card-title">Single items</div><div class="card">${S.items.map(it => itemRowHTML(it, rows)).join('')}</div>` : ''}
      ${empty ? '' : `
        <button class="btn primary" type="button" data-jact="mball"${lines.length ? '' : ' disabled'}>${ICON.copy}Copy Multibuy · ${lines.length} item${lines.length === 1 ? '' : 's'}</button>
        <div class="addrow" style="margin-top:8px"><input type="text" id="j-savename" placeholder="Name this list to save it" value="${esc(J.saveName)}" aria-label="Name for this list" style="flex:1;min-width:0;height:44px;border-radius:12px;border:1px solid var(--line-2);background:var(--panel);padding:0 12px;font-size:14px"><button class="btn" type="button" data-jact="savelist" style="flex:none;width:auto">${ICON.star}Save</button></div>
        <div class="addrow" style="margin-top:8px"><button class="btn" type="button" data-jact="refresh">${ICON.refresh}Refresh prices</button><button class="btn" type="button" data-jact="clear">${ICON.trash}Clear list</button></div>
        <p class="note">Volume counts everything you haul. Price and Multibuy leave out what you already own${deducting() ? '' : ' when you log in and turn that on'}.</p>`}`;
  }

  /* =====================  Add items tab  ===================== */
  let searchTimer = null;
  function resultRow(c, attr) {
    const p = window.priceCache && window.priceCache[c.id];
    return `<li><button type="button" ${attr}="${c.id}">${iconHTML(c.id)}<span><b>${esc(c.name)}</b><small>${p ? (p.isEstimated ? 'estimated price' : 'Jita sell') : 'price loading'}</small></span><span class="r">${p ? (p.sell ? compact(p.sell) : '—') : ''}</span></button></li>`;
  }
  // Search results show a price; fetched once typing pauses.
  function resultsFor(listSel, q, attr, limit) {
    const hits = search(q, limit);
    const el = $(listSel);
    if (!el) return;
    el.innerHTML = hits.map(c => resultRow(c, attr)).join('') + (String(q || '').trim().length >= 2 && !hits.length ? '<li class="note" style="padding:6px 2px">No items match that.</li>' : '');
    clearTimeout(searchTimer);
    const missing = hits.map(c => c.id).filter(id => !window.priceCache[id]);
    if (!missing.length) return;
    searchTimer = setTimeout(async () => {
      try { await window.fetchMarketPrices(missing); } catch (e) { /* shown as loading */ }
      const now = $(listSel);
      if (now) now.innerHTML = search(q, limit).map(c => resultRow(c, attr)).join('');
    }, 350);
  }
  function pickedHTML() {
    if (!J.picked) return '';
    const c = J.picked;
    return `<div class="picked">${iconHTML(c.id)}<b>${esc(c.name)}</b>${numField('j:addqty', J.addQty, 1, 'quantity')}</div><button class="btn primary" type="button" data-jact="additem" style="margin-bottom:10px">Add ${qty(J.addQty)} to the list</button>`;
  }
  function renderAdd() {
    $('#p-ja').innerHTML = `
      <div class="card-title">Add one item</div>
      <div class="searchbox">${ICON.search}<input type="text" id="j-q" placeholder="Search items" autocomplete="off" value="${esc(J.q)}" aria-label="Search items"></div>
      <div id="j-picked">${pickedHTML()}</div>
      <ul class="itemlist" id="j-results"></ul>
      <div class="card-title">Paste a list</div>
      <textarea class="big" id="j-paste" placeholder="Nanite Repair Paste x50&#10;Warp Disruptor II x2&#10;Hobgoblin II x5" aria-label="Item list, one per line">${esc(J.paste)}</textarea>
      <button class="btn primary" type="button" data-jact="paste">Add all to the list</button>
      <div class="card-title">Import an EFT fit</div>
      <textarea class="big" id="j-eft" placeholder="[Wolf, My Wolf]&#10;Damage Control II&#10;200mm AutoCannon II&#10;…" aria-label="Fit in EFT format">${esc(J.eft)}</textarea>
      <div class="addrow"><span class="nlabel" style="flex:none">Copies</span>${numField('j:newcopies', J.copies, 1, 'copies')}<button class="btn primary" type="button" data-jact="import">Import fit</button></div>
      <p class="note">Names are matched exactly, the way EVE copies them. Anything that doesn't match is skipped and counted in the message.</p>`;
    resultsFor('#j-results', J.q, 'data-jpick');
  }

  /* =====================  Favorites tab  ===================== */
  function renderFav() {
    const items = favs.map((f, i) => ({ ...f, i })).filter(f => f.kind === 'item');
    const shown = J.qfilter === 'all' ? items : items.filter(f => qfavCat(f.typeId) === J.qfilter);
    const saved = favs.map((f, i) => ({ ...f, i })).filter(f => f.kind === 'fit' || f.kind === 'list');
    $('#p-jf').innerHTML = `
      <div class="card-title">Favorite items${items.length ? `<button class="linkbtn" style="margin-left:auto;padding:0" type="button" data-jact="favedit">${J.favEdit ? 'Done' : 'Edit'}</button>` : ''}</div>
      ${items.length >= 6 ? `<div class="chiprow" role="group" aria-label="Filter favorites">${QFAV.map(([k, l]) => `<button class="chip" type="button" data-jqf="${k}" aria-pressed="${String(J.qfilter) === String(k)}">${l}</button>`).join('')}</div>` : ''}
      <div class="favchips">${shown.length ? shown.map(f => `<button class="favchip" type="button" data-jfav="${f.i}" aria-label="${J.favEdit ? `Remove ${esc(f.name)} from favorites` : `Add ${esc(f.name)} to the list`}">${iconHTML(f.typeId)}${esc(f.name)}${J.favEdit ? `<span class="x">${ICON.x}</span>` : ''}</button>`).join('') : `<p class="note" style="margin:0">${items.length ? 'No favorites in this category.' : 'No favorite items yet. Search below or tap the star on any item in your list.'}</p>`}</div>
      <div class="searchbox" style="margin-top:12px">${ICON.search}<input type="text" id="j-favq" placeholder="Find an item to favorite" autocomplete="off" value="${esc(J.favQ)}" aria-label="Find an item to favorite"></div>
      <ul class="itemlist" id="j-favresults"></ul>
      <div class="card-title">Favorite fits and lists</div>
      ${saved.length ? saved.map(f => {
        const isFit = f.kind === 'fit';
        const sub = isFit ? `${esc(f.shipName || 'Fit')} · fit` : `list · ${(f.fits || []).length} fit${(f.fits || []).length === 1 ? '' : 's'}, ${(f.items || []).length} item${(f.items || []).length === 1 ? '' : 's'}`;
        return `<div class="favcard">${isFit ? iconHTML(f.shipTypeId) : `<span class="ic ic-none" aria-hidden="true">${ICON.list}</span>`}<div style="min-width:0"><b style="display:block;font-size:14.5px">${esc(f.name)}</b><small style="color:var(--mute);font-size:12px">${sub}</small></div>
          <div class="acts"><button class="btn primary" type="button" data-favact="use" data-i="${f.i}">Add to list</button>${isFit ? '' : `<button class="btn" type="button" data-favact="replace" data-i="${f.i}">Replace list</button>`}<button class="btn" type="button" data-favact="view" data-i="${f.i}">View</button><button class="btn" type="button" data-favact="rm" data-i="${f.i}" aria-label="Remove ${esc(f.name)}" style="flex:0 0 44px">${ICON.trash}</button></div></div>`;
      }).join('') : '<p class="note">Save a list from the List tab, or add a fit below.</p>'}
      <div class="card-title">Wishlist${wish.length > 1 ? `<button class="linkbtn" style="margin-left:auto;padding:0" type="button" data-jact="wishall">Add all to list</button>` : ''}</div>
      ${wish.length ? wish.map((w, i) => {
        const isFit = w.kind !== 'item';
        const n = isFit ? w.copies || 1 : w.qty || 1;
        return `<div class="favcard">${iconHTML(isFit ? w.shipTypeId : w.typeId)}<div style="min-width:0"><b style="display:block;font-size:14.5px">${esc(isFit ? w.fitName : w.name)}${n > 1 ? ` <span class="count">×${qty(n)}</span>` : ''}</b><small style="color:var(--mute);font-size:12px">${esc(isFit ? w.shipName || 'Fit' : 'item')}</small></div>
          <div class="acts"><button class="btn primary" type="button" data-wishact="add" data-i="${i}">Add to list</button>${isFit ? `<button class="btn" type="button" data-wishact="view" data-i="${i}">View</button>` : ''}<button class="btn" type="button" data-wishact="rm" data-i="${i}" aria-label="Remove ${esc(isFit ? w.fitName : w.name)}" style="flex:0 0 44px">${ICON.trash}</button></div></div>`;
      }).join('') : '<p class="note">Fits you want to buy later.</p>'}
      <div class="card-title">Add a fit</div>
      <textarea class="big" id="j-faveft" placeholder="Paste a fit in EFT format" aria-label="Fit in EFT format">${esc(J.favEft)}</textarea>
      <div class="addrow"><button class="btn" type="button" data-jact="favfit">${ICON.star}To favorites</button><button class="btn" type="button" data-jact="wishfit">To wishlist</button></div>
      <div class="card-title">Back up</div>
      <div class="addrow"><button class="btn" type="button" data-jact="export">${ICON.copy}Copy</button><button class="btn" type="button" data-jact="exportfile">Save file</button><button class="btn" type="button" data-jact="import-favs">Import</button></div>
      <p class="note">Your favorites and wishlist as text or a file, to keep or move to another device. The desktop page can import the saved file too.</p>`;
    resultsFor('#j-favresults', J.favQ, 'data-jfavadd', 8);
  }

  function render() {
    const scr = $('#screen-jita');
    if (!$('#p-jl', scr)) {
      scr.innerHTML = `<div class="segtabs" role="tablist" aria-label="Jita Shopping views">
          <button type="button" role="tab" id="t-jl" aria-controls="p-jl">List</button>
          <button type="button" role="tab" id="t-ja" aria-controls="p-ja">Add items</button>
          <button type="button" role="tab" id="t-jf" aria-controls="p-jf">Favorites</button>
        </div>
        <section id="p-jl" role="tabpanel" aria-labelledby="t-jl"></section>
        <section id="p-ja" role="tabpanel" aria-labelledby="t-ja" hidden></section>
        <section id="p-jf" role="tabpanel" aria-labelledby="t-jf" hidden></section>`;
    }
    for (const [k, id] of [['list', 'jl'], ['add', 'ja'], ['fav', 'jf']]) {
      $('#t-' + id).setAttribute('aria-selected', String(J.tab === k));
      $('#p-' + id).hidden = J.tab !== k;
    }
    if (J.tab === 'list') renderList();
    if (J.tab === 'add') renderAdd();
    if (J.tab === 'fav') renderFav();
  }

  /* =====================  Numbers: steppers and typed values  ===================== */
  function numOf(key) {
    const [, kind, arg] = key.split(':');
    if (kind === 'item') { const it = S.items.find(i => i.typeId === Number(arg)); return it ? it.qty : null; }
    if (kind === 'copies') { const f = S.fits.find(x => x.fitId === Number(arg)); return f ? f.copies : null; }
    if (kind === 'spread') return prefs.jita.spread;
    if (kind === 'addqty') return J.addQty;
    if (kind === 'newcopies') return J.copies;
    if (kind === 'qtyN') return J.qtyN;
    return null;
  }
  function setNum(key, v) {
    const [, kind, arg] = key.split(':');
    if (!Number.isFinite(v)) return;
    v = Math.round(v);
    if (kind === 'spread') { prefs.jita.spread = Math.min(50, Math.max(0, v)); MB.savePrefs(); renderList(); return; }
    v = Math.min(1e9, Math.max(1, v));
    if (kind === 'item') { const it = S.items.find(i => i.typeId === Number(arg)); if (it) { it.qty = v; saveSession(); renderList(); } return; }
    if (kind === 'copies') { const f = S.fits.find(x => x.fitId === Number(arg)); if (f) { f.copies = Math.min(99999, v); saveSession(); renderList(); } return; }
    if (kind === 'addqty') { J.addQty = v; $('#j-picked').innerHTML = pickedHTML(); return; }
    if (kind === 'newcopies') { J.copies = Math.min(99999, v); renderAdd(); return; }
    if (kind === 'qtyN') { J.qtyN = v; MB.fillSheet(); }
  }
  const readNum = s => parseFloat(String(s).replace(/[,\s]/g, ''));
  function stepClick(el, root) {
    if (el.disabled) return;
    const key = el.dataset.step;
    const d = Number(el.dataset.d);
    const cur = numOf(key);
    if (cur === null) return;
    setNum(key, cur + d);
    const again = root.querySelector(`[data-step="${key}"][data-d="${d}"]`);
    if (again && !again.disabled) again.focus();
  }

  /* =====================  Events  ===================== */
  const scr = $('#screen-jita');
  scr.addEventListener('input', e => {
    const id = e.target.id;
    if (id === 'j-q') { J.q = e.target.value; J.picked = null; $('#j-picked').innerHTML = ''; resultsFor('#j-results', J.q, 'data-jpick'); }
    if (id === 'j-favq') { J.favQ = e.target.value; resultsFor('#j-favresults', J.favQ, 'data-jfavadd', 8); }
    if (id === 'j-paste') J.paste = e.target.value;
    if (id === 'j-eft') J.eft = e.target.value;
    if (id === 'j-faveft') J.favEft = e.target.value;
    if (id === 'j-savename') J.saveName = e.target.value;
  });
  scr.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'j-cap') {
      const v = readNum(t.value);
      if (Number.isFinite(v) && v >= 0) LS.set(KEY.cap, String(v)); else toast('Enter the cargo size in m³');
      renderList();
      return;
    }
    if (t.id === 'j-loc') { prefs.stockLoc = t.value; MB.savePrefs(); MB.rebuildStock(); renderList(); return; }
    if (t.dataset.jnum) {
      const v = readNum(t.value);
      if (Number.isFinite(v)) setNum(t.dataset.jnum, v); else t.value = numOf(t.dataset.jnum);
    }
  });
  scr.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'j-cap' || e.target.dataset.jnum) e.target.blur();
    if (e.target.id === 'j-savename') { e.preventDefault(); scr.querySelector('[data-jact="savelist"]').click(); }
  });
  scr.addEventListener('click', async e => {
    const t = e.target;
    let el;
    if ((el = t.closest('#t-jl, #t-ja, #t-jf'))) { setTab({ 't-jl': 'list', 't-ja': 'add', 't-jf': 'fav' }[el.id]); return; }
    if ((el = t.closest('[data-step^="j:"]'))) { stepClick(el, scr); return; }
    if ((el = t.closest('[data-jmode]'))) { prefs.jita.mode = el.dataset.jmode; J.modes = {}; MB.savePrefs(); renderList(); return; }
    if ((el = t.closest('[data-jpull]'))) {
      const id = el.dataset.jpull;
      if (pulled[id]) delete pulled[id]; else pulled[id] = true;
      savePulled();
      renderList();
      const again = scr.querySelector(`[data-jpull="${id}"]`);
      if (again) again.focus();
      return;
    }
    if ((el = t.closest('[data-jpick]'))) {
      const id = Number(el.dataset.jpick);
      J.picked = { id, name: MB.nameOf(id) };
      J.addQty = 1;
      $('#j-picked').innerHTML = pickedHTML();
      const inp = $('#j-picked [data-jnum]');
      if (inp) inp.focus();
      return;
    }
    if ((el = t.closest('[data-jfavadd]'))) {
      const id = Number(el.dataset.jfavadd);
      const name = MB.nameOf(id);
      if (favIndex(id) === -1) { favs.unshift({ kind: 'item', typeId: id, name }); saveFavs(); toast(`${name} added to favorites`); } else toast(`${name} is already a favorite`);
      J.favQ = '';
      renderFav();
      return;
    }
    if ((el = t.closest('[data-jqf]'))) { const k = el.dataset.jqf; J.qfilter = /^\d+$/.test(k) ? Number(k) : k; renderFav(); return; }
    if ((el = t.closest('[data-jfav]'))) {
      const i = Number(el.dataset.jfav);
      const f = favs[i];
      if (!f) return;
      if (J.favEdit) {
        favs.splice(i, 1);
        saveFavs();
        renderFav();
        toast(`Removed ${f.name} from favorites`, { label: 'Undo', run: () => { favs.splice(i, 0, f); saveFavs(); renderFav(); } });
      } else { J.qtyFor = { source: 'fav', i }; J.qtyN = 1; MB.openSheet('jqty', el); }
      return;
    }
    if ((el = t.closest('[data-favact]'))) {
      const i = Number(el.dataset.i);
      const f = favs[i];
      if (!f) return;
      const act = el.dataset.favact;
      if (act === 'use') useFavorite(i);
      if (act === 'replace') replaceWithFavorite(i);
      if (act === 'view') { J.view = { source: 'fav', i }; MB.openSheet('jview', el); }
      if (act === 'rm') { favs.splice(i, 1); saveFavs(); renderFav(); toast(`Removed ${f.name}`, { label: 'Undo', run: () => { favs.splice(i, 0, f); saveFavs(); renderFav(); } }); }
      return;
    }
    if ((el = t.closest('[data-wishact]'))) {
      const i = Number(el.dataset.i);
      const w = wish[i];
      if (!w) return;
      const act = el.dataset.wishact;
      if (act === 'add') { J.qtyFor = { source: 'wish', i }; J.qtyN = (w.kind === 'item' ? w.qty : w.copies) || 1; MB.openSheet('jqty', el); }
      if (act === 'view') { J.view = { source: 'wish', i }; MB.openSheet('jview', el); }
      if (act === 'rm') { wish.splice(i, 1); saveWish(); renderFav(); toast(`Removed ${w.fitName || w.name} from the wishlist`, { label: 'Undo', run: () => { wish.splice(i, 0, w); saveWish(); renderFav(); } }); }
      return;
    }
    if (!(el = t.closest('[data-jact]'))) return;
    if (el.disabled) return;
    const act = el.dataset.jact;
    const fit = el.dataset.fid ? S.fits.find(f => f.fitId === Number(el.dataset.fid)) : null;
    if (act === 'login') { MB.openSheet('account', el); return; }
    if (act === 'deduct') { prefs.deduct = !prefs.deduct; MB.savePrefs(); MB.syncShim(); renderList(); return; }
    if (act === 'personal' || act === 'corp') { const k = act === 'personal' ? 'stockPersonal' : 'stockCorp'; prefs[k] = !prefs[k]; MB.savePrefs(); MB.rebuildStock(); renderList(); return; }
    if (act === 'resetpull') { pulled = {}; savePulled(); renderList(); return; }
    if (act === 'togglefit' && fit) { fit.collapsed = !fit.collapsed; saveSession(); renderList(); const again = scr.querySelector(`[data-jact="togglefit"][data-fid="${fit.fitId}"]`); if (again) again.focus(); return; }
    if (act === 'fav') {
      const id = Number(el.dataset.id);
      const i = favIndex(id);
      const name = MB.nameOf(id);
      if (i === -1) { favs.unshift({ kind: 'item', typeId: id, name }); toast(`${name} added to favorites`); } else { favs.splice(i, 1); toast(`${name} removed from favorites`); }
      saveFavs();
      renderList();
      return;
    }
    if (act === 'rmitem') {
      const i = S.items.findIndex(x => x.typeId === Number(el.dataset.id));
      if (i === -1) return;
      const [it] = S.items.splice(i, 1);
      saveSession();
      renderList();
      toast(`Removed ${it.name}`, { label: 'Undo', run: () => { S.items.splice(i, 0, it); saveSession(); renderList(); } });
      return;
    }
    if (act === 'rmfititem' && fit) {
      const i = fit.baseItems.findIndex(x => x.typeId === Number(el.dataset.id));
      if (i === -1) return;
      if (fit.baseItems.length === 1) { removeFit(fit); return; } // its last item: the fit goes, as on the desktop
      const [it] = fit.baseItems.splice(i, 1);
      saveSession();
      renderList();
      toast(`Removed ${it.name} from ${fit.name}`, { label: 'Undo', run: () => { fit.baseItems.splice(i, 0, it); saveSession(); renderList(); } });
      return;
    }
    if (act === 'rmfit' && fit) { removeFit(fit); return; }
    if (act === 'copyeft' && fit) { const ok = await MB.copyText(fitEFT(fit)); toast(ok ? `Copied the EFT fit for ${fit.name}` : 'Copy was blocked by the browser'); return; }
    if (act === 'fitmb' || act === 'mball') {
      const rows = allocate();
      let list;
      if (act === 'mball') list = needs(rows);
      else list = fit.baseItems.map(it => ({ name: it.name, net: rowOf(rows, fit, it).net }));
      const lines = multibuy(list);
      if (!lines.length) { toast('Nothing left to buy, your stock covers it'); return; }
      const ok = await MB.copyText(lines.join('\n'));
      toast(ok ? `Copied ${lines.length} item${lines.length === 1 ? '' : 's'} for EVE's Multibuy` : 'Copy was blocked by the browser');
      return;
    }
    if (act === 'spread') {
      const ids = listIds();
      if (!ids.length) { toast('Nothing to optimize yet'); return; }
      await fetchPrices(ids);
      let orders = 0;
      ids.forEach(id => {
        const p = window.priceCache[id] || { sell: 0, buy: 0 };
        J.modes[id] = p.sell > 0 && p.buy > 0 && p.sell > p.buy && ((p.sell - p.buy) / p.sell) * 100 >= prefs.jita.spread ? 'buy' : 'sell';
        if (J.modes[id] === 'buy') orders++;
      });
      renderList();
      toast(`${orders} of ${ids.length} item${ids.length === 1 ? ' is' : 's are'} worth a buy order at a ${prefs.jita.spread}% spread or more`);
      return;
    }
    if (act === 'refresh') {
      const ids = listIds();
      ids.forEach(id => { delete window.priceCache[id]; });
      el.disabled = true;
      await fetchPrices(ids);
      toast('Prices refreshed');
      return;
    }
    if (act === 'savelist') {
      const name = J.saveName.trim();
      if (!name) { toast('Give the list a name first'); $('#j-savename').focus(); return; }
      favs.unshift({ kind: 'list', name, ts: Date.now(), items: S.items.map(i => ({ ...i })), fits: S.fits.map(f => ({ ...f, baseItems: f.baseItems.map(i => ({ ...i })) })) });
      saveFavs();
      J.saveName = '';
      renderList();
      toast(`Saved “${name}” to favorites`, { label: 'View', run: () => setTab('fav') });
      return;
    }
    if (act === 'clear') {
      const snap = { items: S.items, fits: S.fits };
      S.items = [];
      S.fits = [];
      J.modes = {};
      saveSession();
      renderList();
      toast('List cleared', { label: 'Undo', run: () => { S.items = snap.items; S.fits = snap.fits; saveSession(); renderList(); } });
      return;
    }
    if (act === 'additem') {
      const c = J.picked;
      if (!c) return;
      addItem(c.id, c.name, J.addQty);
      afterAdd([c.id]);
      toast(`Added ${qty(J.addQty)} × ${c.name}`, viewList);
      J.picked = null;
      J.q = '';
      renderAdd();
      return;
    }
    if (act === 'paste') {
      let added = 0, missed = 0;
      const ids = [];
      for (const line of J.paste.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))) {
        let name = line, n = 1;
        const m = line.match(/^(.+?)\s+x\s*(\d[\d,]*)\s*$/i);
        if (m) { name = m[1].trim(); n = parseInt(m[2].replace(/,/g, ''), 10); }
        const hit = lookup(name);
        if (!hit) { missed++; continue; }
        addItem(hit.id, hit.name, n);
        ids.push(hit.id);
        added++;
      }
      if (!added && !missed) { toast('Paste some items first'); return; }
      if (added) { J.paste = ''; afterAdd(ids); }
      renderAdd();
      toast(added ? `Added ${added} item${added === 1 ? '' : 's'}${missed ? ` (${missed} not recognized)` : ''}` : 'Nothing recognized. Names must match EVE exactly', added ? viewList : undefined);
      return;
    }
    if (act === 'import') {
      if (!J.eft.trim()) { toast('Paste a fit first'); return; }
      const f = buildFit(J.eft.trim(), J.copies);
      if (!f) { toast('No items in that fit matched. Paste it exactly as EVE copies it'); return; }
      pushFit(f);
      afterAdd(f.baseItems.map(i => i.typeId));
      J.eft = '';
      J.copies = 1;
      renderAdd();
      toast(`Imported “${f.name}”, ${f.baseItems.length} items${f.skipped ? ` (${f.skipped} skipped)` : ''}`, viewList);
      return;
    }
    if (act === 'favfit' || act === 'wishfit') {
      const text = J.favEft.trim();
      if (!text) { toast('Paste a fit first'); return; }
      const f = buildFit(text, 1);
      if (!f) { toast('No items in that fit matched. Paste it exactly as EVE copies it'); return; }
      if (act === 'favfit') { favs.unshift({ kind: 'fit', name: f.name, shipName: f.shipName, shipTypeId: f.shipTypeId, fitText: text }); saveFavs(); }
      else { wish.push({ kind: 'fit', fitName: f.name, shipName: f.shipName, shipTypeId: f.shipTypeId, copies: 1, fitText: text }); saveWish(); }
      J.favEft = '';
      renderFav();
      toast(`${f.name} added to ${act === 'favfit' ? 'favorites' : 'the wishlist'}`);
      return;
    }
    if (act === 'wishall') {
      let n = 0;
      const ids = [];
      wish.forEach(w => {
        if (w.kind === 'item') { addItem(w.typeId, w.name, w.qty || 1); ids.push(w.typeId); n++; return; }
        const f = buildFit(w.fitText, w.copies || 1);
        if (f) { f.name = w.fitName; pushFit(f); ids.push(...f.baseItems.map(x => x.typeId)); n++; }
      });
      afterAdd(ids);
      toast(`Added ${n} wishlist entr${n === 1 ? 'y' : 'ies'} to your list`, viewList);
      return;
    }
    if (act === 'favedit') { J.favEdit = !J.favEdit; renderFav(); return; }
    if (act === 'export' || act === 'exportfile') {
      if (!favs.length && !wish.length) { toast('Nothing to back up yet'); return; }
      const text = JSON.stringify({ formatVersion: 1, favorites: favs, wishlist: wish, exportedAt: Date.now() }, null, 2);
      if (act === 'exportfile') {
        const a = document.createElement('a');
        a.href = 'data:application/json,' + encodeURIComponent(text);
        a.download = 'eve-shopping-favorites-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        return;
      }
      const ok = await MB.copyText(text);
      toast(ok ? `Copied ${favs.length} favorite${favs.length === 1 ? '' : 's'} and ${wish.length} wishlist entr${wish.length === 1 ? 'y' : 'ies'}` : 'Copy was blocked by the browser. Try Save file');
      return;
    }
    if (act === 'import-favs') { J.importText = ''; MB.openSheet('jimport', el); }
  });

  /* =====================  Sheets  ===================== */
  const qtyRec = () => (J.qtyFor ? (J.qtyFor.source === 'wish' ? wish[J.qtyFor.i] : favs[J.qtyFor.i]) : null);
  MB.SHEETS.jqty = {
    title: () => { const r = qtyRec(); return r ? (r.kind === 'fit' ? r.fitName || r.name : r.name) : 'Add to list'; },
    html() {
      const r = qtyRec();
      if (!r) return '<p class="note">That entry is gone.</p>';
      const isFit = r.kind === 'fit';
      const id = isFit ? r.shipTypeId : r.typeId;
      const label = isFit ? 'copies' : 'quantity';
      return `<div class="picked">${iconHTML(id)}<b>${isFit ? esc(r.shipName || 'Fit') : eachText(id)}</b>${numField('j:qtyN', J.qtyN, 1, label)}</div>
        <button class="btn primary" type="button" data-jsheet="addqty">Add ${qty(J.qtyN)}${isFit ? ` cop${J.qtyN === 1 ? 'y' : 'ies'}` : ''} to the list</button>`;
    },
    click(e) {
      let el;
      if ((el = e.target.closest('[data-step="j:qtyN"]'))) { stepClick(el, $('#sheet-body')); return; }
      if (!e.target.closest('[data-jsheet="addqty"]')) return;
      const r = qtyRec();
      if (!r) { MB.closeSheet(); return; }
      if (J.qtyFor.source === 'fav') {
        addItem(r.typeId, r.name, J.qtyN);
        afterAdd([r.typeId]);
        toast(`Added ${qty(J.qtyN)} × ${r.name}`, viewList);
      } else {
        if (r.kind === 'item') r.qty = J.qtyN; else r.copies = J.qtyN;
        saveWish();
        addWish(J.qtyFor.i);
      }
      MB.closeSheet();
      refreshShown();
    },
    change(e) {
      const t = e.target;
      if (!t.dataset.jnum) return;
      const v = readNum(t.value);
      if (Number.isFinite(v)) setNum(t.dataset.jnum, v); else t.value = J.qtyN;
    }
  };
  $('#sheet').addEventListener('keydown', e => {
    if (e.key === 'Enter' && MB.sheetKind() === 'jqty' && e.target.dataset && e.target.dataset.jnum) {
      e.preventDefault();
      const v = readNum(e.target.value);
      if (Number.isFinite(v)) J.qtyN = Math.min(1e9, Math.max(1, Math.round(v)));
      const b = $('#sheet-body [data-jsheet="addqty"]');
      if (b) b.click();
    }
  });
  const viewRec = () => (J.view ? (J.view.source === 'wish' ? wish[J.view.i] : favs[J.view.i]) : null);
  MB.SHEETS.jview = {
    title: () => { const r = viewRec(); return r ? r.fitName || r.name : 'Saved'; },
    html() {
      const r = viewRec();
      if (!r) return '<p class="note">That entry is gone.</p>';
      let rows;
      if (r.kind === 'list') {
        rows = [...(r.fits || []).map(ft => ({ id: ft.shipTypeId, name: ft.name, q: ft.copies || 1, sub: `${ft.shipName || 'Fit'} · fit` })), ...(r.items || []).map(it => ({ id: it.typeId, name: it.name, q: it.qty, sub: eachText(it.typeId) }))];
      } else {
        const f = buildFit(r.fitText, 1);
        rows = f ? f.baseItems.map(it => ({ id: it.typeId, name: it.name, q: it.qty, sub: eachText(it.typeId) })) : [];
      }
      const isList = r.kind === 'list';
      return `${r.kind !== 'list' && r.shipName ? `<p class="sheet-lead">${esc(r.shipName)}</p>` : ''}
        <div class="card">${rows.length ? rows.map(x => `<div class="irow">${iconHTML(x.id)}<div class="main"><span class="nm">${esc(x.name)}</span><span class="sub">${x.sub}</span></div><div class="right"><span class="cost">×${qty(x.q)}</span></div></div>`).join('') : '<p class="note" style="padding:10px 0">No items in this matched.</p>'}</div>
        <button class="btn primary" type="button" data-jsheet="use">Add to list</button>
        ${isList ? '<button class="btn" type="button" data-jsheet="replace" style="margin-top:8px">Replace my list with this</button>' : ''}
        ${r.fitText ? `<button class="btn" type="button" data-jsheet="copyfit" style="margin-top:8px">${ICON.copy}Copy EFT</button>` : ''}`;
    },
    open() { const r = viewRec(); if (r) fetchPrices(r.kind === 'list' ? (r.items || []).map(i => i.typeId) : ((buildFit(r.fitText, 1) || { baseItems: [] }).baseItems.map(i => i.typeId))); },
    async click(e) {
      const b = e.target.closest('[data-jsheet]');
      if (!b) return;
      const r = viewRec();
      if (!r) { MB.closeSheet(); return; }
      if (b.dataset.jsheet === 'copyfit') { const ok = await MB.copyText(r.fitText); toast(ok ? 'Copied the EFT fit' : 'Copy was blocked by the browser'); return; }
      MB.closeSheet();
      if (b.dataset.jsheet === 'replace') replaceWithFavorite(J.view.i);
      else if (J.view.source === 'wish') addWish(J.view.i);
      else useFavorite(J.view.i);
      refreshShown();
    }
  };
  MB.SHEETS.jimport = {
    title: () => 'Import favorites',
    html: () => `<textarea class="big" id="j-import" placeholder="Paste the text you copied with Copy" aria-label="Exported favorites">${esc(J.importText)}</textarea>
      <button class="btn primary" type="button" data-jsheet="doimport">Import</button>
      <label class="btn" style="margin-top:8px">Choose a saved file<input type="file" id="j-importfile" accept=".json,application/json,text/plain" hidden></label>
      <p class="note">Adds to what you already have. Nothing is replaced. Files saved from the desktop page work too.</p>`,
    input(e) { if (e.target.id === 'j-import') J.importText = e.target.value; },
    change(e) {
      if (e.target.id !== 'j-importfile' || !e.target.files[0]) return;
      const reader = new FileReader();
      reader.onload = () => { J.importText = String(reader.result || ''); importFavs(); };
      reader.readAsText(e.target.files[0]);
    },
    click(e) { if (e.target.closest('[data-jsheet="doimport"]')) importFavs(); }
  };
  // Same file shape as the desktop's export ({favorites: [...]}, or a bare array); a wishlist, if
  // the phone saved one, is added too.
  function importFavs() {
    let data;
    try { data = JSON.parse(J.importText); } catch (err) { toast('That isn’t a favorites backup from this site'); return; }
    const incoming = Array.isArray(data) ? data : Array.isArray(data && data.favorites) ? data.favorites : null;
    const wl = data && Array.isArray(data.wishlist) ? data.wishlist : [];
    if (!incoming && !wl.length) { toast('That isn’t a favorites backup from this site'); return; }
    const okFav = f => f && (f.kind === 'item' ? f.typeId : f.kind === 'fit' ? f.fitText : f.kind === 'list' ? Array.isArray(f.items) || Array.isArray(f.fits) : false);
    const newFavs = (incoming || []).filter(okFav).filter(f => !(f.kind === 'item' && favIndex(f.typeId) !== -1));
    const newWish = wl.filter(w => w && ((w.kind === 'item' && w.typeId) || w.fitText));
    favs = newFavs.concat(favs);
    wish = wish.concat(newWish);
    saveFavs();
    saveWish();
    MB.closeSheet();
    J.tab = 'fav';
    rerender();
    const n = newFavs.length + newWish.length;
    toast(`Imported ${n} entr${n === 1 ? 'y' : 'ies'}`);
  }

  // The desktop page (another tab) changed the list.
  window.addEventListener('storage', e => {
    if (!e.key || !e.key.startsWith('eve_sl_')) return;
    load();
    rerender();
  });

  load();
  MB.screens.jita = {
    title: 'Jita Shopping',
    render,
    enter() {
      load();
      render();
      const ids = listIds();
      fetchPrices(ids);
      refreshShipVolumes(ids);
    }
  };
})();
