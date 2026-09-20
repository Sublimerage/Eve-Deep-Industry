// ═══════════════════════════════════════════════════════════════════════════════
// Shopping List - a standalone EFT-fit/item shopping list tool, integrated into Eve
// Deep Industry rather than kept as its own separate page with its own copy of
// everything. Deliberately reuses the app's EXISTING infrastructure instead of the
// original tool's own parallel copies of each:
//   - Item search/names: eve_db.js's IDX/TYPE_ID_TO_NAME (js/config.js), not a
//     separately-downloaded Hoboleaks/ESI index cached in IndexedDB. Every real EVE
//     item name pastes/resolves instantly, no network round-trip needed at all.
//   - Volumes: window.EVE_VOLUMES (eve_db.js), not a live per-item ESI fetch.
//   - Prices: window.fetchMarketPrices/window.priceCache (js/esi.js) - the same
//     Fuzzwork aggregates call already used by the Calculator, honoring whatever
//     home station is configured there instead of a hardcoded Jita assumption.
//   - "What do I have" stock checking: the app's own live ESI asset system
//     (userStockMap, applyStockLocationFilter, container/location picking) instead
//     of manually pasting container contents - reported directly as the reason to
//     build this integration in the first place.
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

// ── STATE ──────────────────────────────────────────────────────────────────────
let slItems = [];   // [{typeId, name, qty, volume}]
let slFits = [];    // [{fitId, name, shipName, shipTypeId, copies, collapsed, baseItems, fitText}]
let slFitCounter = 0;
let slWishlist = []; // [{kind:'item',typeId,name,qty} | {kind:'fit',fitName,shipName,shipTypeId,copies,fitText}]
let slFavorites = []; // [{kind:'item',typeId,name} | {kind:'fit',name,shipName,shipTypeId,fitText} | {kind:'list',name,ts,items,fits}]
let slPriceMode = 'sell'; // 'sell' or 'buy' - which side of window.priceCache totals/rows read from
let slSessionReady = false; // guards against saving a blank session before loadSlSession has run

// Per-search-box "the user actually clicked a specific result" state - three independent search
// boxes (Add Single Item, Wishlist, Favorites) each need their own, so picking a result in one
// doesn't clobber what was picked in another.
const slPicked = { item: null, wish: null, fav: null };
const slSearchState = { item: { res: [], idx: -1 }, wish: { res: [], idx: -1 }, fav: { res: [], idx: -1 } };

const SL_ITEMS_KEY = 'eve_sl_session_v1';
const SL_WISHLIST_KEY = 'eve_sl_wishlist_v1';
const SL_FAVORITES_KEY = 'eve_sl_favorites_v1';
const SL_NOTES_KEY = 'eve_sl_notes_v1';

// ── ITEM LOOKUP (local index, no network) ───────────────────────────────────────
// EVE's own in-game copy/paste (fitting window, cargo/container select-all) always uses the exact
// canonical item name, and IDX (js/config.js's buildPrepackedIndexes, from eve_db.js's EVE_ITEMS)
// already covers every item in the game - so a plain lowercase lookup resolves instantly, no live
// ESI name-resolution call needed at all for anything actually copied out of the client.
function slLookupByName(name) {
  const hit = window.IDX && window.IDX[String(name).toLowerCase().trim()];
  return hit ? { id: hit.id, name: hit.name } : null;
}
function slVolumeFor(typeId) {
  return (window.EVE_VOLUMES && window.EVE_VOLUMES[typeId]) || 0;
}
// Category 6 = Ship (confirmed against eve_db.js's own EVE_CATEGORIES, itself EVE's real
// categoryID). Ships are the one case where EVE_VOLUMES' plain "volume" (the hull's actual flying
// size - can be millions of m3 for a capital) is drastically wrong for a shopping list, which
// always deals in the much smaller PACKAGED volume a hauler actually has to move. Every other
// category (modules, ammo, minerals, ...) has no packaged variant at all, so EVE_VOLUMES is
// already correct for them - gating on ship-only avoids a live ESI call for every ordinary item.
function slIsShipType(typeId) {
  return !!(window.EVE_CATEGORIES && window.EVE_CATEGORIES[typeId] === 6);
}
// Fixes up any ship hull already sitting in the list (standalone or inside a fit) with its real
// packaged volume, once fetchPackagedVolume resolves - fired after every add path below. Cached
// permanently in js/esi.js, so this is a one-time network hit per distinct hull ever added, and a
// no-op on every later add of the same ship. Also self-heals any list/fit/favorite saved before
// this fix existed, which would have the old, wrong (unpackaged) volume baked in.
function slRefreshShipVolumes(typeIds) {
  const ships = [...new Set(typeIds)].filter(slIsShipType);
  if (!ships.length) return;
  Promise.all(ships.map(id => window.fetchPackagedVolume(id).then(vol => {
    if (!vol) return false;
    let changed = false;
    slItems.forEach(it => { if (it.typeId === id && it.volume !== vol) { it.volume = vol; changed = true; } });
    slFits.forEach(f => f.baseItems.forEach(it => { if (it.typeId === id && it.volume !== vol) { it.volume = vol; changed = true; } }));
    return changed;
  }))).then(results => { if (results.some(Boolean)) slRenderAll(); });
}
function slSearch(query, limit) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2 || !window.IDX) return [];
  const exact = [], starts = [], contains = [];
  for (const [k, v] of Object.entries(window.IDX)) {
    if (k === q) exact.push(v);
    else if (k.startsWith(q)) starts.push(v);
    else if (k.includes(q)) contains.push(v);
  }
  starts.sort((a, b) => a.name.localeCompare(b.name));
  contains.sort((a, b) => a.name.localeCompare(b.name));
  return [...exact, ...starts, ...contains].slice(0, limit || 12);
}

// ── EFT PARSER ──────────────────────────────────────────────────────────────────
// Parses an EVE fitting export (EFT format): a "[Ship, Fit Name]" header line, followed by one
// module/charge name per line (blank lines separate slot groups, "[Empty ... slot]" placeholders
// are skipped). Multiple stacked charges on one line use a trailing "x123".
function slParseEFT(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const raw = []; let fitName = '', shipName = '';
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
    let name = line, qty = 1;
    const m = line.match(/^(.+?)\s+x\s*(\d[\d,]*)\s*$/i);
    if (m) { name = m[1].trim(); qty = parseInt(m[2].replace(/,/g, '')); }
    const parts = name.split(', ').map(s => s.trim()).filter(Boolean);
    raw.push({ name: parts[0], qty });
    for (let i = 1; i < parts.length; i++) raw.push({ name: parts[i], qty: 1 });
  }
  const map = {};
  for (const { name, qty } of raw) {
    const k = name.toLowerCase();
    map[k] = map[k] ? { ...map[k], qty: map[k].qty + qty } : { name, qty };
  }
  return { fitName: fitName || 'Imported Fit', shipName, items: Object.values(map) };
}

// ── ADD: SEARCH / SINGLE ITEM ───────────────────────────────────────────────────
function slRenderSearchDropdown(kind, inputEl, resultsEl, hits) {
  slSearchState[kind].res = hits;
  slSearchState[kind].idx = -1;
  if (!hits.length) { resultsEl.classList.add('hidden'); return; }
  const r = inputEl.getBoundingClientRect();
  resultsEl.style.left = r.left + 'px';
  resultsEl.style.top = (r.bottom + 4) + 'px';
  resultsEl.style.width = r.width + 'px';
  resultsEl.innerHTML = hits.map((it, i) => `
    <div class="lp-list-item sl-ac-row" data-kind="${kind}" data-idx="${i}" style="cursor:pointer;">
      <img src="${window.getItemIconUrl(it.id, it.name, 32)}" style="width:24px;height:24px;border-radius:4px;flex-shrink:0;" onerror="this.style.opacity=.15" loading="lazy">
      <span class="truncate" style="color:var(--text);">${window.esc(it.name)}</span>
    </div>
  `).join('');
  resultsEl.classList.remove('hidden');
}
document.addEventListener('mousedown', (e) => {
  const row = e.target.closest('.sl-ac-row');
  if (!row) return;
  const kind = row.dataset.kind, idx = +row.dataset.idx;
  const it = slSearchState[kind].res[idx];
  if (!it) return;
  slPicked[kind] = it;
  const inputIds = { item: 'sl-item-search', wish: 'sl-wish-search', fav: 'sl-fav-search' };
  const resultIds = { item: 'sl-search-results', wish: 'sl-wish-search-results', fav: 'sl-fav-search-results' };
  document.getElementById(inputIds[kind]).value = it.name;
  document.getElementById(resultIds[kind]).classList.add('hidden');
});

function slSearchItem(q) {
  slPicked.item = null;
  slRenderSearchDropdown('item', document.getElementById('sl-item-search'), document.getElementById('sl-search-results'), slSearch(q));
}
function slWishSearchItem(q) {
  slPicked.wish = null;
  slRenderSearchDropdown('wish', document.getElementById('sl-wish-search'), document.getElementById('sl-wish-search-results'), slSearch(q));
}
function slFavSearchItem(q) {
  slPicked.fav = null;
  slRenderSearchDropdown('fav', document.getElementById('sl-fav-search'), document.getElementById('sl-fav-search-results'), slSearch(q));
}
function slSearchKeydown(e) {
  if (e.key === 'Enter') slAddSearchedItem();
}
// Generic −/+ nudge for a plain number input that isn't tied to any app state until its owning
// button (Import Fitting, Add to List) actually reads it - the sidebar's own qty/copies fields.
function slStepInput(inputId, delta, min) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.value = Math.max(min === undefined ? 1 : min, (parseInt(el.value) || 0) + delta);
}

function slAddItemToList(typeId, name, qty) {
  const ex = slItems.find(i => i.typeId === typeId);
  if (ex) ex.qty += qty;
  else slItems.push({ typeId, name, qty, volume: slVolumeFor(typeId) });
  window.fetchMarketPrices([typeId]).then(slRenderAll);
  slRefreshShipVolumes([typeId]);
}

function slAddSearchedItem() {
  let it = slPicked.item;
  if (!it) {
    const q = document.getElementById('sl-item-search').value.trim();
    if (!q) { window.showToast('Type an item name first.', 'info'); return; }
    const hits = slSearch(q, 1);
    it = hits[0] || slLookupByName(q);
    if (!it) { window.showToast(`Not found: ${q}`, 'error'); return; }
  }
  const qty = Math.max(1, parseInt(document.getElementById('sl-item-qty').value) || 1);
  slAddItemToList(it.id, it.name, qty);
  document.getElementById('sl-item-search').value = '';
  document.getElementById('sl-item-qty').value = 1;
  slPicked.item = null;
  window.showToast(`Added ${qty} × ${it.name}.`, 'success');
  slRenderAll();
}

function slPasteItems() {
  const text = document.getElementById('sl-paste-input').value.trim();
  if (!text) { window.showToast('Paste some items first.', 'info'); return; }
  let added = 0, missed = 0;
  const ids = [];
  for (const line of text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))) {
    let name = line, qty = 1;
    const m = line.match(/^(.+?)\s+x\s*(\d[\d,]*)\s*$/i);
    if (m) { name = m[1].trim(); qty = parseInt(m[2].replace(/,/g, '')); }
    const hit = slLookupByName(name);
    if (!hit) { missed++; continue; }
    slAddItemToListSilent(hit.id, hit.name, qty);
    ids.push(hit.id);
    added++;
  }
  document.getElementById('sl-paste-input').value = '';
  if (ids.length) window.fetchMarketPrices(ids).then(slRenderAll);
  window.showToast(`Added ${added} item${added !== 1 ? 's' : ''}${missed ? ` (${missed} not recognized)` : ''}.`, added ? 'success' : 'error');
  slRenderAll();
  slRefreshShipVolumes(ids);
}
// Same as slAddItemToList but doesn't kick off its own price fetch - used when adding many items
// in one pass (paste/EFT import), so the caller can fetch prices for the whole batch in one call
// instead of firing a separate fetchMarketPrices per line.
function slAddItemToListSilent(typeId, name, qty) {
  const ex = slItems.find(i => i.typeId === typeId);
  if (ex) ex.qty += qty;
  else slItems.push({ typeId, name, qty, volume: slVolumeFor(typeId) });
}

// ── IMPORT FIT ───────────────────────────────────────────────────────────────────
function slBuildFitFromEFT(text, copies) {
  const { fitName, shipName, items: parsed } = slParseEFT(text);
  const rItems = [];
  for (const { name, qty } of parsed) {
    const r = slLookupByName(name);
    if (r) rItems.push({ typeId: r.id, name: r.name, qty, volume: slVolumeFor(r.id) });
  }
  let shipTypeId = 0, shipNameResolved = shipName;
  if (shipName) {
    const sr = slLookupByName(shipName);
    if (sr) { shipTypeId = sr.id; shipNameResolved = sr.name; }
  }
  const map = {};
  for (const it of rItems) { if (map[it.typeId]) map[it.typeId].qty += it.qty; else map[it.typeId] = { ...it }; }
  if (shipTypeId && shipNameResolved && !map[shipTypeId]) {
    map[shipTypeId] = { typeId: shipTypeId, name: shipNameResolved, qty: 1, volume: slVolumeFor(shipTypeId) };
  }
  const baseItems = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  if (!baseItems.length) return null;
  return { fitId: ++slFitCounter, name: fitName, shipName: shipNameResolved, shipTypeId, copies: copies || 1, collapsed: false, baseItems, fitText: text, skipped: parsed.length - rItems.length };
}

function slImportFit() {
  const text = document.getElementById('sl-eft-input').value.trim();
  if (!text) { window.showToast('Paste a fitting first.', 'info'); return; }
  const copies = Math.max(1, parseInt(document.getElementById('sl-fit-copies').value) || 1);
  const fit = slBuildFitFromEFT(text, copies);
  if (!fit) { window.showToast('Could not resolve any items in that fitting.', 'error'); return; }
  slFits.push(fit);
  document.getElementById('sl-eft-input').value = '';
  document.getElementById('sl-fit-copies').value = 1;
  window.showToast(`Imported "${fit.name}" — ${fit.baseItems.length} item${fit.baseItems.length !== 1 ? 's' : ''}${fit.skipped ? ` (${fit.skipped} skipped)` : ''}.`, 'success');
  window.fetchMarketPrices(fit.baseItems.map(i => i.typeId)).then(slRenderAll);
  slRenderAll();
  slRefreshShipVolumes(fit.baseItems.map(i => i.typeId));
}

// ── STOCK CHECK (reuses the app's own live ESI asset system) ───────────────────
// slOnStockFilterChanged wraps applyStockLocationFilter (js/esi.js) - that function's own tail end
// only knows how to call recalculate() (Calculator) or applyJournalStockFilter (Ledger), neither of
// which exists on this page, so it would otherwise silently do nothing extra once the filter itself
// changed. This is the page-specific "and now re-render with the new stock" step, kept entirely in
// this file rather than teaching the shared esi.js function about a third page.
function slOnStockFilterChanged() {
  if (typeof applyStockLocationFilter === 'function') applyStockLocationFilter();
  slRenderAll();
}
function slStockFor(typeId) {
  return (window.userStockMap && window.userStockMap[typeId]) || 0;
}
function slIsDeductingStock() {
  const btn = document.getElementById('deduct-stock-mode');
  return btn ? btn.value === 'true' : true;
}

// ── PRICE / VOLUME HELPERS ──────────────────────────────────────────────────────
function slPrice(typeId) {
  const p = window.priceCache && window.priceCache[typeId];
  if (!p) return 0;
  return (slPriceMode === 'buy' ? p.buy : p.sell) || 0;
}
function slFmtVol(v) {
  if (!v) return '0';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── RENDER: SHOPPING LIST ────────────────────────────────────────────────────────
function slRenderAll() {
  slRenderList();
  slUpdateTotals();
  slSaveSession();
}

// Standalone shopping-list items are directly qty-editable (a stepper) - there's nothing else
// they're derived from. A fit's own module rows are NOT: their quantity comes from the actual
// fitting (1 gyro, 4 turrets, ...) multiplied by the fit's copies, so the only meaningful edits are
// "change copies" (the fit header's own stepper) or "remove this module" - matching the original
// standalone tool exactly, which never made a fit's own item rows qty-editable either.
function slStandaloneItemRowHTML(it, idx) {
  const stockQty = slStockFor(it.typeId);
  const deduct = slIsDeductingStock();
  const netQty = deduct ? Math.max(0, it.qty - stockQty) : it.qty;
  const hasStockData = !!(window.userStockMap && Object.keys(window.userStockMap).length);
  const unitPrice = slPrice(it.typeId);
  const totalPrice = unitPrice * netQty;
  return `
    <tr>
      <td style="width:30px;"><img src="${window.getItemIconUrl(it.typeId, it.name, 32)}" style="width:24px;height:24px;border-radius:4px;" onerror="this.style.opacity=.15" loading="lazy"></td>
      <td class="truncate" style="color:var(--text);" title="${window.esc(it.name)}">${window.esc(it.name)}<div class="text-xs mono" style="color:var(--text-mute);">${slFmtVol(it.volume * it.qty)} m&sup3; total</div></td>
      <td style="width:104px;">
        <div class="sl-qty">
          <button onclick="slItemQtyStep(${idx}, -1)">&minus;</button>
          <input type="number" min="0" value="${it.qty}" class="mono num-no-spin" onchange="slSetItemQty(${idx}, this.value)">
          <button onclick="slItemQtyStep(${idx}, 1)">+</button>
        </div>
      </td>
      ${hasStockData ? `<td class="text-right mono text-xs" style="width:70px; color:${stockQty > 0 ? 'var(--green)' : 'var(--text-mute)'};">${stockQty.toLocaleString()}</td>
      <td class="text-right mono text-xs" style="width:80px; color:${netQty > 0 ? 'var(--red)' : 'var(--green)'};">${netQty.toLocaleString()}</td>` : ''}
      <td class="text-right mono text-xs" style="width:70px; color:var(--text-mute);">${slFmtVol(it.volume)} m&sup3;</td>
      <td class="text-right mono text-xs" style="width:90px; color:var(--cost);">${unitPrice > 0 ? window.formatISKCompact(totalPrice) : '—'}</td>
      <td style="width:28px;"><button onclick="slRemoveItem(${idx})" class="lp-chip-btn" style="padding:2px 6px;" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>
  `;
}
function slFitItemRowHTML(it, fit, isShip) {
  const tq = it.qty * fit.copies;
  const stockQty = slStockFor(it.typeId);
  const deduct = slIsDeductingStock();
  const netQty = deduct ? Math.max(0, tq - stockQty) : tq;
  const hasStockData = !!(window.userStockMap && Object.keys(window.userStockMap).length);
  const unitPrice = slPrice(it.typeId);
  const totalPrice = unitPrice * netQty;
  return `
    <tr${isShip ? ' class="sl-fit-card-ship-row"' : ''}>
      <td style="width:30px;"><img src="${window.getItemIconUrl(it.typeId, it.name, 32)}" style="width:24px;height:24px;border-radius:4px;" onerror="this.style.opacity=.15" loading="lazy"></td>
      <td class="truncate" style="color:${isShip ? 'var(--cost)' : 'var(--text)'};" title="${window.esc(it.name)}">
        ${window.esc(it.name)}${isShip ? ' <span class="text-[8px] mono" style="color:var(--cost); letter-spacing:0.08em;">SHIP</span>' : ''}
        <div class="text-xs mono" style="color:var(--text-mute);">${it.qty}&times; per fit &middot; ${slFmtVol(it.volume * tq)} m&sup3;</div>
      </td>
      <td class="text-right mono text-xs" style="width:60px; color:var(--text);">${tq.toLocaleString()}</td>
      ${hasStockData ? `<td class="text-right mono text-xs" style="width:70px; color:${stockQty > 0 ? 'var(--green)' : 'var(--text-mute)'};">${stockQty.toLocaleString()}</td>
      <td class="text-right mono text-xs" style="width:80px; color:${netQty > 0 ? 'var(--red)' : 'var(--green)'};">${netQty.toLocaleString()}</td>` : ''}
      <td class="text-right mono text-xs" style="width:70px; color:var(--text-mute);">${slFmtVol(it.volume)} m&sup3;</td>
      <td class="text-right mono text-xs" style="width:90px; color:var(--cost);">${unitPrice > 0 ? window.formatISKCompact(totalPrice) : '—'}</td>
      <td style="width:28px;"><button onclick="slRemoveFitItem(${fit.fitId}, ${it.typeId})" class="lp-chip-btn" style="padding:2px 6px;" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>
  `;
}

function slRenderList() {
  const body = document.getElementById('sl-list-body');
  if (!body) return;
  if (!slFits.length && !slItems.length) {
    body.innerHTML = `<div class="fo-card-note text-center" style="padding:24px 0;">No items yet — import a fit or search for an item in the sidebar.</div>`;
    return;
  }
  const hasStockData = !!(window.userStockMap && Object.keys(window.userStockMap).length);
  const headCols = `
    <th style="width:30px;"></th><th>Item</th><th class="text-right" style="width:60px;">Qty</th>
    ${hasStockData ? '<th class="text-right" style="width:70px;">Have</th><th class="text-right" style="width:80px;">Buy Qty</th>' : ''}
    <th class="text-right" style="width:70px;">Volume</th><th class="text-right" style="width:90px;">${slPriceMode === 'buy' ? 'Buy' : 'Sell'} Total</th><th style="width:28px;"></th>
  `;
  let html = '';
  slFits.forEach(fit => {
    const fv = fit.baseItems.reduce((s, i) => s + i.volume * i.qty, 0) * fit.copies;
    const fp = fit.baseItems.reduce((s, i) => s + slPrice(i.typeId) * i.qty, 0) * fit.copies;
    const moduleCount = fit.baseItems.filter(i => i.typeId !== fit.shipTypeId).length;
    const shipItem = fit.shipTypeId ? fit.baseItems.find(i => i.typeId === fit.shipTypeId) : null;
    const moduleItems = fit.baseItems.filter(i => i.typeId !== fit.shipTypeId);
    const orderedItems = shipItem ? [shipItem, ...moduleItems] : moduleItems;
    html += `
      <div class="sl-fit-card">
        <div class="sl-fit-card-head flex items-center gap-2 px-3 py-2.5" onclick="slToggleFit(${fit.fitId})">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px; transform:rotate(${fit.collapsed ? '-90' : '0'}deg); transition:transform .15s; flex-shrink:0; color:var(--cost);"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="font-bold text-sm truncate rajdhani tracking-wide" style="color:var(--cost);">${window.esc(fit.name)}</span>
          ${fit.shipName ? `<span class="text-xs truncate" style="color:var(--text-mute);">[${window.esc(fit.shipName)}]</span>` : ''}
          <span class="text-xs mono flex-shrink-0 hidden sm:inline" style="color:var(--text-mute); margin-left:auto;">${slFmtVol(fv)} m&sup3; &middot; ${fp > 0 ? window.formatISKCompact(fp) : '—'} &middot; ${moduleCount} module${moduleCount !== 1 ? 's' : ''}</span>
          <div class="flex items-center gap-1.5 flex-shrink-0" style="margin-left:${fit.shipName ? 'auto' : '0'};" onclick="event.stopPropagation()">
            <span class="text-[9px] mono" style="color:var(--text-mute);">COPIES</span>
            <div class="sl-qty sl-qty-sm">
              <button onclick="slFitCopiesStep(${fit.fitId}, -1)">&minus;</button>
              <input type="number" min="1" value="${fit.copies}" class="mono num-no-spin" onchange="slSetFitCopies(${fit.fitId}, this.value)">
              <button onclick="slFitCopiesStep(${fit.fitId}, 1)">+</button>
            </div>
            <button onclick="slCopyFitMultibuy(${fit.fitId})" class="lp-chip-btn" style="font-size:10px;">EFT</button>
            <button onclick="slRemoveFit(${fit.fitId})" class="lp-chip-btn" style="font-size:10px; color:var(--red);">Remove</button>
          </div>
        </div>
        ${!fit.collapsed ? `
        <table class="sl-item-table">
          <thead><tr>${headCols}</tr></thead>
          <tbody>${orderedItems.map(it => slFitItemRowHTML(it, fit, it.typeId === fit.shipTypeId)).join('')}</tbody>
        </table>` : ''}
      </div>
    `;
  });
  if (slItems.length) {
    if (slFits.length) html += `<div class="sl-divider-label">Individual Items</div>`;
    html += `
      <table class="sl-item-table sl-list-items-table">
        <thead><tr>${headCols}</tr></thead>
        <tbody>${slItems.map((it, idx) => slStandaloneItemRowHTML(it, idx)).join('')}</tbody>
      </table>
    `;
  }
  body.innerHTML = html;
}

function slToggleFit(fid) { const f = slFits.find(f => f.fitId === fid); if (f) { f.collapsed = !f.collapsed; slRenderList(); } }
function slSetFitCopies(fid, val) { const v = Math.max(1, parseInt(val) || 1); const f = slFits.find(f => f.fitId === fid); if (f) { f.copies = v; slRenderAll(); } }
function slFitCopiesStep(fid, delta) { const f = slFits.find(f => f.fitId === fid); if (f) { f.copies = Math.max(1, f.copies + delta); slRenderAll(); } }
function slItemQtyStep(idx, delta) { if (!slItems[idx]) return; slItems[idx].qty = Math.max(0, slItems[idx].qty + delta); slRenderAll(); }
function slSetItemQty(idx, val) {
  const v = Math.max(0, parseInt(val) || 0);
  if (!slItems[idx]) return;
  slItems[idx].qty = v;
  slRenderAll();
}

// Removal always shows an Undo toast (matching how the rest of this app handles undoable removals -
// Reset Smart Buy Modes, deleted presets, etc.) instead of a separate "Stash" panel/tab whose whole
// job was just "let me get this back if I remove it by mistake."
function slRemoveItem(idx) {
  const removed = slItems[idx]; if (!removed) return;
  slItems.splice(idx, 1);
  slRenderAll();
  window.showToast(`Removed ${removed.name}.`, 'info', { action: { label: 'Undo', onClick: () => { slItems.splice(idx, 0, removed); slRenderAll(); } } });
}
function slRemoveFit(fid) {
  const idx = slFits.findIndex(f => f.fitId === fid);
  if (idx === -1) return;
  const removed = slFits[idx];
  slFits.splice(idx, 1);
  slRenderAll();
  window.showToast(`Removed "${removed.name}".`, 'info', { action: { label: 'Undo', onClick: () => { slFits.splice(idx, 0, removed); slRenderAll(); } } });
}
function slRemoveFitItem(fid, typeId) {
  const f = slFits.find(f => f.fitId === fid); if (!f) return;
  const idx = f.baseItems.findIndex(i => i.typeId === typeId);
  const removed = f.baseItems[idx];
  f.baseItems = f.baseItems.filter(i => i.typeId !== typeId);
  if (!f.baseItems.length) { slRemoveFit(fid); return; }
  slRenderAll();
  window.showToast(`Removed ${removed.name} from "${f.name}".`, 'info', { action: { label: 'Undo', onClick: () => { f.baseItems.splice(idx, 0, removed); slRenderAll(); } } });
}

function slClearAll() {
  if (!slItems.length && !slFits.length) return;
  if (!confirm('Clear the entire shopping list?')) return;
  slItems = []; slFits = [];
  slRenderAll();
  window.showToast('Shopping list cleared.', 'info');
}

function slUpdateTotals() {
  const bar = document.getElementById('sl-totals-bar');
  if (!bar) return;
  if (!slItems.length && !slFits.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  let vol = 0, price = 0, qty = 0;
  slFits.forEach(f => f.baseItems.forEach(i => { vol += i.volume * i.qty * f.copies; price += slPrice(i.typeId) * i.qty * f.copies; qty += i.qty * f.copies; }));
  slItems.forEach(i => { vol += i.volume * i.qty; price += slPrice(i.typeId) * i.qty; qty += i.qty; });
  const cap = parseFloat(document.getElementById('sl-hauler-capacity')?.value) || 0;
  const pct = cap > 0 ? Math.min(100, (vol / cap) * 100) : 0;
  const barColor = pct > 100 ? 'var(--red)' : pct > 70 ? 'var(--gold, #c8a84b)' : 'var(--accent)';
  const typeCount = slFits.reduce((s, f) => s + f.baseItems.length, 0) + slItems.length;
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="grid grid-cols-3 gap-px lp-card p-0 overflow-hidden">
      <div class="p-3">
        <div class="text-[9px] uppercase tracking-wide" style="color:var(--text-mute);">Total Volume</div>
        <div class="font-bold text-lg mono" style="color:var(--accent);">${slFmtVol(vol)} m&sup3;</div>
        ${cap > 0 ? `<div style="height:3px;background:rgba(255,255,255,.08);margin-top:6px;border-radius:2px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${barColor};"></div></div><div class="text-[9px] mono mt-1" style="color:var(--text-mute);">of ${cap.toLocaleString()} m&sup3; hauler</div>` : ''}
      </div>
      <div class="p-3">
        <div class="text-[9px] uppercase tracking-wide" style="color:var(--text-mute);">Total Price (${slPriceMode})</div>
        <div class="font-bold text-lg mono" style="color:var(--gold, var(--cost));">${price > 0 ? window.formatISKCompact(price) : '—'}</div>
        <button onclick="slTogglePriceMode()" class="lp-chip-btn mt-1.5" style="font-size:9px;">Switch to ${slPriceMode === 'sell' ? 'Buy' : 'Sell'}</button>
      </div>
      <div class="p-3">
        <div class="text-[9px] uppercase tracking-wide" style="color:var(--text-mute);">Total Quantity</div>
        <div class="font-bold text-lg mono" style="color:var(--text);">${qty.toLocaleString()}</div>
        <div class="text-[9px] mono mt-1" style="color:var(--text-mute);">${typeCount} unique type${typeCount !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `;
}
function slTogglePriceMode() { slPriceMode = slPriceMode === 'sell' ? 'buy' : 'sell'; slRenderAll(); }

function slCopyMultibuy() {
  const combined = {};
  slFits.forEach(f => f.baseItems.forEach(i => { combined[i.name] = (combined[i.name] || 0) + i.qty * f.copies; }));
  slItems.forEach(i => { combined[i.name] = (combined[i.name] || 0) + i.qty; });
  const lines = Object.entries(combined).map(([name, qty]) => qty > 1 ? `${name} x${qty}` : name);
  if (!lines.length) { window.showToast('Nothing to copy.', 'info'); return; }
  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => window.showToast(`Copied ${lines.length} item${lines.length !== 1 ? 's' : ''} for the in-game Multibuy window.`, 'success'))
    .catch(() => window.showToast('Copy failed.', 'error'));
}

function slCopyFitMultibuy(fid) {
  const fit = slFits.find(f => f.fitId === fid); if (!fit) return;
  let txt;
  if (fit.fitText) {
    const lines = fit.fitText.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('['); });
    txt = `[${fit.shipName || 'Unknown Ship'}, ${fit.name}]\n` + (fit.copies > 1
      ? lines.map(line => { const m = line.match(/^(.+?)\s+x(\d+)\s*$/i); return m ? `${m[1].trim()} x${parseInt(m[2]) * fit.copies}` : `${line.trim()} x${fit.copies}`; }).join('\n')
      : lines.join('\n'));
  } else {
    const moduleLines = fit.baseItems.filter(it => it.typeId !== fit.shipTypeId).map(it => { const q = it.qty * fit.copies; return q > 1 ? `${it.name} x${q}` : it.name; });
    txt = [`[${fit.shipName || 'Unknown Ship'}, ${fit.name}]`, ...moduleLines].join('\n');
  }
  navigator.clipboard.writeText(txt).then(() => window.showToast(`Copied EFT: ${fit.name}`, 'success')).catch(() => window.showToast('Copy failed.', 'error'));
}

// ── TABS ────────────────────────────────────────────────────────────────────────
function slSwitchTab(name) {
  document.querySelectorAll('#sl-tabs [data-sl-tab]').forEach(btn => btn.classList.toggle('nav-tab-active-violet', btn.dataset.slTab === name));
  document.querySelectorAll('.sl-tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById('sl-tab-' + name).classList.remove('hidden');
}

// ── WISHLIST ─────────────────────────────────────────────────────────────────────
function slAddWishItem() {
  let it = slPicked.wish;
  if (!it) {
    const q = document.getElementById('sl-wish-search').value.trim();
    if (!q) { window.showToast('Type an item name first.', 'info'); return; }
    it = slSearch(q, 1)[0] || slLookupByName(q);
    if (!it) { window.showToast(`Not found: ${q}`, 'error'); return; }
  }
  const qty = Math.max(1, parseInt(document.getElementById('sl-wish-qty').value) || 1);
  const ex = slWishlist.find(w => w.kind === 'item' && w.typeId === it.id);
  if (ex) ex.qty += qty; else slWishlist.push({ kind: 'item', typeId: it.id, name: it.name, qty });
  document.getElementById('sl-wish-search').value = ''; document.getElementById('sl-wish-qty').value = 1;
  slPicked.wish = null;
  slSaveWishlist(); slRenderWishlist();
  window.showToast(`Added to wishlist: ${it.name}`, 'success');
}
function slAddWishFit() {
  const text = document.getElementById('sl-wish-eft').value.trim();
  if (!text) { window.showToast('Paste a fitting first.', 'info'); return; }
  const { fitName, shipName } = slParseEFT(text);
  let shipTypeId = 0;
  if (shipName) { const hit = slLookupByName(shipName); if (hit) shipTypeId = hit.id; }
  slWishlist.push({ kind: 'fit', fitName, shipName, shipTypeId, copies: 1, fitText: text });
  document.getElementById('sl-wish-eft').value = '';
  slSaveWishlist(); slRenderWishlist();
  window.showToast(`Added fit to wishlist: ${fitName}`, 'success');
}
function slWishlistToShopping() {
  if (!slWishlist.length) { window.showToast('Wishlist is empty.', 'info'); return; }
  let added = 0;
  slWishlist.forEach(w => {
    if (w.kind === 'item') { slAddItemToListSilent(w.typeId, w.name, w.qty || 1); added++; }
    else { const fit = slBuildFitFromEFT(w.fitText, w.copies || 1); if (fit) { fit.name = w.fitName; slFits.push(fit); added++; } }
  });
  const ids = [...slItems.map(i => i.typeId), ...slFits.flatMap(f => f.baseItems.map(i => i.typeId))];
  window.fetchMarketPrices(ids).then(slRenderAll);
  slRenderAll(); slSwitchTab('list');
  window.showToast(`Added ${added} wishlist entr${added !== 1 ? 'ies' : 'y'} to the shopping list.`, 'success');
  slRefreshShipVolumes(ids);
}
function slWishAddOne(idx) {
  const w = slWishlist[idx]; if (!w) return;
  if (w.kind === 'item') slAddItemToList(w.typeId, w.name, w.qty || 1);
  else { const fit = slBuildFitFromEFT(w.fitText, w.copies || 1); if (fit) { fit.name = w.fitName; slFits.push(fit); window.fetchMarketPrices(fit.baseItems.map(i => i.typeId)).then(slRenderAll); slRefreshShipVolumes(fit.baseItems.map(i => i.typeId)); } }
  slRenderAll(); slSwitchTab('list');
  window.showToast(`Added: ${w.kind === 'item' ? w.name : w.fitName}`, 'success');
}
function slRemoveWishEntry(idx) { slWishlist.splice(idx, 1); slSaveWishlist(); slRenderWishlist(); }
function slWishQtyAdjust(idx, delta) {
  const w = slWishlist[idx]; if (!w) return;
  if (w.kind === 'item') w.qty = Math.max(1, (w.qty || 1) + delta); else w.copies = Math.max(1, (w.copies || 1) + delta);
  slSaveWishlist(); slRenderWishlist();
}
function slWishQtySet(idx, val) {
  const v = Math.max(1, parseInt(val) || 1); const w = slWishlist[idx]; if (!w) return;
  if (w.kind === 'item') w.qty = v; else w.copies = v;
  slSaveWishlist();
}
function slRenderWishlist() {
  const el = document.getElementById('sl-wishlist-body'); if (!el) return;
  const badge = document.getElementById('sl-wishlist-badge');
  if (badge) { badge.textContent = slWishlist.length; badge.classList.toggle('hidden', !slWishlist.length); }
  if (!slWishlist.length) { el.innerHTML = `<div class="fo-card-note text-center" style="padding:20px 0;">No wishlist entries yet.</div>`; return; }
  el.innerHTML = slWishlist.map((w, idx) => `
    <div class="flex items-center gap-2 py-2" style="border-bottom:1px solid rgba(255,255,255,0.06);">
      ${w.kind === 'fit'
        ? `<div style="cursor:pointer;flex-shrink:0;" onclick="slOpenFitPopup('wish', ${idx})">${w.shipTypeId ? `<img src="${window.getItemIconUrl(w.shipTypeId, w.shipName, 40)}" style="width:32px;height:32px;border-radius:4px;" onerror="this.style.opacity=.15">` : `<div style="width:32px;height:32px;border-radius:4px;background:rgba(200,168,75,.15);display:flex;align-items:center;justify-content:center;color:var(--gold,#c8a84b);">▶</div>`}</div>
        <div class="flex-1 min-w-0"><div class="font-bold text-sm truncate" style="color:var(--gold, var(--accent));">${window.esc(w.fitName)}</div><div class="text-xs truncate" style="color:var(--text-mute);">${w.shipName ? window.esc(w.shipName) + ' · ' : ''}<span style="cursor:pointer;text-decoration:underline;" onclick="slOpenFitPopup('wish', ${idx})">view fit</span></div></div>`
        : `<img src="${window.getItemIconUrl(w.typeId, w.name, 32)}" style="width:26px;height:26px;border-radius:4px;flex-shrink:0;" onerror="this.style.opacity=.15">
        <span class="flex-1 truncate text-sm" style="color:var(--text);">${window.esc(w.name)}</span>`}
      <div class="sl-qty sl-qty-sm flex-shrink-0">
        <button onclick="slWishQtyAdjust(${idx}, -1)">&minus;</button>
        <input type="number" min="1" value="${w.kind === 'item' ? (w.qty || 1) : (w.copies || 1)}" class="mono num-no-spin" onchange="slWishQtySet(${idx}, this.value)">
        <button onclick="slWishQtyAdjust(${idx}, 1)">+</button>
      </div>
      <button onclick="slWishAddOne(${idx})" class="lp-chip-btn flex-shrink-0" style="font-size:10px;">+ Add</button>
      <button onclick="slRemoveWishEntry(${idx})" class="lp-chip-btn flex-shrink-0" style="font-size:10px; color:var(--red);">✕</button>
    </div>
  `).join('');
}
function slSaveWishlist() { try { localStorage.setItem(SL_WISHLIST_KEY, JSON.stringify(slWishlist)); } catch (e) {} }
function slLoadWishlist() { slWishlist = window.safeParseJSON(localStorage.getItem(SL_WISHLIST_KEY), []); }

function slSaveNotes() { try { localStorage.setItem(SL_NOTES_KEY, document.getElementById('sl-wish-notes').value); } catch (e) {} }
function slClearNotes() { if (!confirm('Clear all notes?')) return; document.getElementById('sl-wish-notes').value = ''; try { localStorage.removeItem(SL_NOTES_KEY); } catch (e) {} }

// ── FAVORITES / SAVED LISTS ──────────────────────────────────────────────────────
// "list" kind covers what used to be two separate features (Favorites' own full-list save, and a
// fully separate Save/Load modal) - both stored the exact same shape (items+fits, named, timestamped)
// under two different UIs with different behavior (one only ever added to your current list, the
// other only ever replaced it, and you had to remember which panel to check). Merged into one
// always-visible grid here, with BOTH actions on every "list" card - see slAddFavorite/
// slReplaceWithFavorite below.
function slSaveCurrentAsFavorite() {
  const nameEl = document.getElementById('sl-fav-name');
  const name = (nameEl.value || '').trim();
  if (!name) { window.showToast('Enter a name first.', 'info'); nameEl.focus(); return; }
  if (!slItems.length && !slFits.length) { window.showToast('Shopping list is empty.', 'info'); return; }
  slFavorites.unshift({ kind: 'list', name, ts: Date.now(), items: slItems.map(i => ({ ...i })), fits: slFits.map(f => ({ ...f, baseItems: f.baseItems.map(i => ({ ...i })) })) });
  saveSlFavorites(); nameEl.value = ''; slRenderFavorites();
  window.showToast(`Saved list: ${name}`, 'success');
}
function slAddFavItem() {
  if (!slPicked.fav) { window.showToast('Search for and select an item first.', 'info'); return; }
  const it = slPicked.fav;
  if (slFavorites.find(f => f.kind === 'item' && f.typeId === it.id)) { window.showToast('Already in favorites.', 'info'); return; }
  slFavorites.unshift({ kind: 'item', typeId: it.id, name: it.name });
  saveSlFavorites(); document.getElementById('sl-fav-search').value = ''; slPicked.fav = null; slRenderFavorites();
  window.showToast(`Added to favorites: ${it.name}`, 'success');
}
function slAddFavFit() {
  const text = document.getElementById('sl-fav-eft').value.trim();
  if (!text) { window.showToast('Paste a fitting first.', 'info'); return; }
  const { fitName, shipName } = slParseEFT(text);
  let shipTypeId = 0;
  if (shipName) { const hit = slLookupByName(shipName); if (hit) shipTypeId = hit.id; }
  slFavorites.unshift({ kind: 'fit', name: fitName, shipName, shipTypeId, fitText: text });
  saveSlFavorites(); document.getElementById('sl-fav-eft').value = ''; slRenderFavorites();
  window.showToast(`Favorited fit: ${fitName}`, 'success');
}
function slRemoveFavorite(idx) {
  if (!confirm('Remove from favorites?')) return;
  slFavorites.splice(idx, 1); saveSlFavorites(); slRenderFavorites();
}
// "+ Add" - merges into the current list without disturbing anything already there. The right
// action for "I always want this on top of whatever I'm doing" (a permanent quick-reference item/
// fit) and also valid for a saved list you want to layer on top of the current one.
function slUseFavorite(idx) {
  const f = slFavorites[idx]; if (!f) return;
  if (f.kind === 'item') { slAddItemToList(f.typeId, f.name, 1); slRenderAll(); slSwitchTab('list'); window.showToast(`Added: ${f.name}`, 'success'); return; }
  if (f.kind === 'fit') { const fit = slBuildFitFromEFT(f.fitText, 1); if (fit) { fit.name = f.name; slFits.push(fit); window.fetchMarketPrices(fit.baseItems.map(i => i.typeId)).then(slRenderAll); slRefreshShipVolumes(fit.baseItems.map(i => i.typeId)); } slRenderAll(); slSwitchTab('list'); window.showToast(`Added fit: ${f.name}`, 'success'); return; }
  // list kind: add every item/fit on top of the current list
  (f.items || []).forEach(it => slAddItemToListSilent(it.typeId, it.name, it.qty));
  (f.fits || []).forEach(fit => slFits.push({ ...fit, fitId: ++slFitCounter, baseItems: fit.baseItems.map(i => ({ ...i })) }));
  const ids = [...slItems.map(i => i.typeId), ...slFits.flatMap(ft => ft.baseItems.map(i => i.typeId))];
  window.fetchMarketPrices(ids).then(slRenderAll);
  slRenderAll(); slSwitchTab('list');
  window.showToast(`Added list "${f.name}" to your current list.`, 'success');
  slRefreshShipVolumes(ids);
}
// "⇄ Replace" - list kind only. The right action for "pause what I'm doing and swap to this other
// draft/recurring list instead" - clears the current list first, matching what the old standalone
// Save/Load modal's own Load button did.
function slReplaceWithFavorite(idx) {
  const f = slFavorites[idx]; if (!f || f.kind !== 'list') return;
  if ((slItems.length || slFits.length) && !confirm(`Replace your current shopping list with "${f.name}"?`)) return;
  slItems = (f.items || []).map(i => ({ ...i }));
  slFits = (f.fits || []).map(fit => ({ ...fit, fitId: ++slFitCounter, baseItems: fit.baseItems.map(i => ({ ...i })) }));
  const ids = [...slItems.map(i => i.typeId), ...slFits.flatMap(ft => ft.baseItems.map(i => i.typeId))];
  window.fetchMarketPrices(ids).then(slRenderAll);
  slRenderAll(); slSwitchTab('list');
  window.showToast(`Replaced current list with "${f.name}".`, 'success');
  slRefreshShipVolumes(ids);
}
function slRenderFavorites() {
  const grid = document.getElementById('sl-favorites-grid'); if (!grid) return;
  const badge = document.getElementById('sl-favorites-badge');
  if (badge) { badge.textContent = slFavorites.length; badge.classList.toggle('hidden', !slFavorites.length); }
  if (!slFavorites.length) { grid.innerHTML = `<div class="fo-card-note text-center" style="grid-column:1/-1;padding:24px 0;">No favorites or saved lists yet.</div>`; return; }
  grid.innerHTML = slFavorites.map((f, idx) => {
    const isItem = f.kind === 'item', isFit = f.kind === 'fit', isList = f.kind === 'list';
    const borderColor = isFit ? 'var(--gold, #c8a84b)' : isList ? 'var(--accent)' : 'rgba(255,255,255,0.12)';
    const icon = isItem ? `<img src="${window.getItemIconUrl(f.typeId, f.name, 32)}" style="width:32px;height:32px;border-radius:6px;flex-shrink:0;" onerror="this.style.opacity=.15">`
      : isFit && f.shipTypeId ? `<img src="${window.getItemIconUrl(f.shipTypeId, f.shipName, 64)}" style="width:32px;height:32px;border-radius:6px;flex-shrink:0;" onerror="this.style.opacity=.15">`
      : `<div style="width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent);">${isList ? '☰' : '▶'}</div>`;
    const sub = isFit ? `${f.shipName ? window.esc(f.shipName) + ' · ' : ''}fit <span style="cursor:pointer;text-decoration:underline;color:var(--accent);" onclick="slOpenFitPopup('fav', ${idx})">view</span>`
      : isList ? `${(f.fits || []).length} fit${(f.fits || []).length !== 1 ? 's' : ''}, ${(f.items || []).length} item${(f.items || []).length !== 1 ? 's' : ''} <span style="cursor:pointer;text-decoration:underline;color:var(--accent);" onclick="slViewFavoriteList(${idx})">view</span>` : '';
    return `
      <div class="fo-card" style="border-left:3px solid ${borderColor}; display:flex; align-items:center; gap:8px; padding:10px 12px;">
        ${icon}
        <div class="flex-1 min-w-0">
          <div class="text-sm truncate" style="color:var(--text);">${window.esc(f.name)}</div>
          ${sub ? `<div class="text-xs truncate" style="color:var(--text-mute);">${sub}</div>` : ''}
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button onclick="slUseFavorite(${idx})" class="lp-chip-btn" title="Add to current list" style="font-size:14px; padding:3px 8px;">+</button>
          ${isList ? `<button onclick="slReplaceWithFavorite(${idx})" class="lp-chip-btn" title="Replace current list with this" style="font-size:10px;">⇄</button>` : ''}
          <button onclick="slRemoveFavorite(${idx})" class="lp-chip-btn" style="font-size:10px; color:var(--red);">✕</button>
        </div>
      </div>
    `;
  }).join('');
}
function slViewFavoriteList(idx) {
  const f = slFavorites[idx]; if (!f || f.kind !== 'list') return;
  const lines = [...(f.fits || []).map(ft => `▶ ${ft.name}${ft.copies > 1 ? ' ×' + ft.copies : ''}`), ...(f.items || []).map(it => `  ${it.name}${it.qty > 1 ? ' x' + it.qty : ''}`)];
  document.getElementById('sl-fp-icon').src = '';
  document.getElementById('sl-fp-fitname').textContent = f.name;
  document.getElementById('sl-fp-shipname').textContent = `${(f.fits || []).length} fits, ${(f.items || []).length} items`;
  document.getElementById('sl-fp-body').textContent = lines.join('\n');
  document.getElementById('sl-fp-add-btn').onclick = () => { slUseFavorite(idx); slCloseFitPopup(); };
  document.getElementById('sl-fit-popup-bg').classList.remove('hidden');
}
function saveSlFavorites() { try { localStorage.setItem(SL_FAVORITES_KEY, JSON.stringify(slFavorites)); } catch (e) {} }
function slLoadFavorites() { slFavorites = window.safeParseJSON(localStorage.getItem(SL_FAVORITES_KEY), []); }

function slExportFavorites() {
  const data = JSON.stringify({ formatVersion: 1, favorites: slFavorites, exportedAt: Date.now() }, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json,' + encodeURIComponent(data);
  a.download = 'eve-shopping-favorites-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
}
function slImportFavorites(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const incoming = Array.isArray(data.favorites) ? data.favorites : (Array.isArray(data) ? data : null);
      if (!incoming) throw new Error('no favorites array found');
      slFavorites = incoming.concat(slFavorites);
      saveSlFavorites(); slRenderFavorites();
      window.showToast(`Imported ${incoming.length} favorite${incoming.length !== 1 ? 's' : ''}.`, 'success');
    } catch (err) { window.showToast('Invalid file.', 'error'); }
    input.value = '';
  };
  reader.readAsText(file);
}

// ── FIT POPUP ────────────────────────────────────────────────────────────────────
function slOpenFitPopup(source, idx) {
  const w = source === 'wish' ? slWishlist[idx] : slFavorites[idx];
  if (!w) return;
  const fitName = w.fitName || w.name, fitText = w.fitText || '';
  document.getElementById('sl-fp-icon').src = w.shipTypeId ? window.getItemIconUrl(w.shipTypeId, w.shipName, 64) : '';
  document.getElementById('sl-fp-fitname').textContent = fitName;
  document.getElementById('sl-fp-shipname').textContent = w.shipName || '';
  document.getElementById('sl-fp-body').textContent = fitText;
  document.getElementById('sl-fp-add-btn').onclick = () => {
    if (source === 'wish') slWishAddOne(idx); else slUseFavorite(idx);
    slCloseFitPopup();
  };
  document.getElementById('sl-fit-popup-bg').classList.remove('hidden');
}
function slCloseFitPopup() { document.getElementById('sl-fit-popup-bg').classList.add('hidden'); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') slCloseFitPopup(); });

// ── QTY STEPPER LEFTOVERS (kept as harmless no-ops - not wired to any element after the sidebar
// switched to plain number inputs, but referenced defensively in case an older cached HTML page
// still points at them) ─────────────────────────────────────────────────────────
function slAdjustQty() {}
function slSetQty() {}

// ── SESSION PERSISTENCE ──────────────────────────────────────────────────────────
function slSaveSession() {
  if (!slSessionReady) return;
  try { localStorage.setItem(SL_ITEMS_KEY, JSON.stringify({ formatVersion: 1, items: slItems, fits: slFits, fitCounter: slFitCounter })); } catch (e) {}
}
function slLoadSession() {
  const d = window.safeParseJSON(localStorage.getItem(SL_ITEMS_KEY), null);
  if (d && typeof d === 'object') {
    slItems = Array.isArray(d.items) ? d.items : [];
    slFits = Array.isArray(d.fits) ? d.fits : [];
    slFitCounter = d.fitCounter || 0;
  }
  slSessionReady = true;
}

// ── BOOT ──────────────────────────────────────────────────────────────────────────
window.onload = function () {
  if (typeof buildPrepackedIndexes === 'function') buildPrepackedIndexes();
  try { const hc = localStorage.getItem('eve_sl_hauler_m3'); if (hc) document.getElementById('sl-hauler-capacity').value = hc; } catch (e) {}
  slLoadSession();
  slLoadWishlist(); slRenderWishlist();
  slLoadFavorites(); slRenderFavorites();
  try { const notes = localStorage.getItem(SL_NOTES_KEY); if (notes) document.getElementById('sl-wish-notes').value = notes; } catch (e) {}
  slRenderAll();
  if (slItems.length || slFits.length) {
    const ids = [...slItems.map(i => i.typeId), ...slFits.flatMap(f => f.baseItems.map(i => i.typeId))];
    window.fetchMarketPrices(ids).then(slRenderAll);
    slRefreshShipVolumes(ids);
  }
  if (typeof handleEsiSSOCallback === 'function') handleEsiSSOCallback();
};
