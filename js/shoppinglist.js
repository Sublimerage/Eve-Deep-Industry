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
let slPullChecked = {}; // { [typeId]: true } - "Already Have" panel's own checkmarks, keyed by typeId

// Per-search-box "the user actually clicked a specific result" state - two independent search
// boxes (Add Single Item on the Shopping List tab, and the Quick Favorites rail) each need their
// own, so picking a result in one doesn't clobber what was picked in the other. Wishlist and
// Favorites only accept pasted fits now, so they have no search box of their own.
const slPicked = { item: null, qfav: null };
const slSearchState = { item: { res: [], idx: -1 }, qfav: { res: [], idx: -1 } };

const SL_ITEMS_KEY = 'eve_sl_session_v1';
const SL_WISHLIST_KEY = 'eve_sl_wishlist_v1';
const SL_FAVORITES_KEY = 'eve_sl_favorites_v1';
const SL_PULL_CHECKED_KEY = 'eve_sl_pull_checked_v1';
const SL_COLLAPSED_PANELS_KEY = 'eve_sl_collapsed_panels_v1';

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
// window.IDX (js/config.js) is the whole SDE name index - every real item, but also every
// blueprint/reaction formula (e.g. "Damage Control II" AND "Damage Control II Blueprint" both
// match "damage") and a fair amount of non-tradeable junk: NPC/deployable scenery ("Amarr Sentry
// Gun", "Prison Facility" - category 11 "Entity"), stations/celestials (categories 3/2), holiday
// event fluff like melted snowballs (category 63), and - confirmed directly by inspecting
// EVE_CATEGORIES live - CCP's own internal QA test data that leaked into the SDE dump ("QA ES
// below starting skills Afterburner II", category IDs 2100+/350001, nowhere near any real EVE
// category ID range). None of that belongs in a shopping list's own item search. Blueprints are
// filtered by name (js/config.js's isBlueprintName, the same check the Calculator's own blueprint
// search uses in the opposite direction); the rest is filtered by category, denylist rather than
// allowlist so an uncommon-but-legitimate category (Structures, Fighters, ...) never silently
// disappears just because it wasn't anticipated.
const SL_EXCLUDED_CATEGORIES = new Set([2, 3, 11, 63]);
// Category alone isn't fine-grained enough - reported directly: "Limited Synth Exile Booster Mk V"
// (category 20, "Implant/Booster") was still showing up, sitting in the exact same category as a
// real, tradeable booster like "Synth Blue Pill Booster". The category-vs-category comparison came
// back identical for both (both group into EVE's own "Booster" group too - checked directly, that
// doesn't separate them either), because this app's local item index has no signal at all for
// "does this actually have a market listing" (CCP's own marketGroupID, which the current eve_db.js
// generation pipeline doesn't capture - a real fix needs a data regen, not just a JS filter change).
// "Limited " is CCP's own naming prefix for non-tradeable reward/new-player-experience/alpha-clone
// item variants - never listed on the market, regardless of category - so filtering on that name
// pattern catches this whole class of item without needing that data regen.
function slIsRealShoppableItem(typeId, name) {
  if (name && /^Limited\s/i.test(name)) return false;
  const cat = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[typeId] : undefined;
  if (cat === undefined) return true; // no category data at all - don't punish it for that
  return cat < 1000 && !SL_EXCLUDED_CATEGORIES.has(cat);
}
function slSearch(query, limit) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2 || !window.IDX) return [];
  const exact = [], starts = [], contains = [];
  for (const [k, v] of Object.entries(window.IDX)) {
    if (window.isBlueprintName(k) || !slIsRealShoppableItem(v.id, v.name)) continue;
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
    <div class="acr sl-ac-row" data-kind="${kind}" data-idx="${i}">
      <img src="${window.getItemIconUrl(it.id, it.name, 32)}" loading="lazy" onerror="this.style.opacity=.15">
      <span class="acn">${window.esc(it.name)}</span>
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
  const inputIds = { item: 'sl-item-search', qfav: 'sl-quickfav-search' };
  const resultIds = { item: 'sl-search-results', qfav: 'sl-quickfav-search-results' };
  document.getElementById(inputIds[kind]).value = it.name;
  document.getElementById(resultIds[kind]).classList.add('hidden');
});

function slSearchItem(q) {
  slPicked.item = null;
  slRenderSearchDropdown('item', document.getElementById('sl-item-search'), document.getElementById('sl-search-results'), slSearch(q));
}
function slQuickFavSearchItem(q) {
  slPicked.qfav = null;
  slRenderSearchDropdown('qfav', document.getElementById('sl-quickfav-search'), document.getElementById('sl-quickfav-search-results'), slSearch(q));
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
// Reported directly: the stock-dependent parts of this page (the table's Have/Buy Qty columns,
// the new Already Have panel) only ever updated after manually touching the location filter or
// Personal/Corp checkboxes - clicking "Refresh Assets" itself, or just having the page auto-sync
// an already-logged-in character on load, silently updated window.userStockMap without this page
// ever finding out, since js/esi.js only knows how to re-render the Calculator/Invention pages
// directly. 'eve:assets-refreshed' (js/esi.js) is the fix: it fires once userStockMap is actually
// current, from every path that can update it, so this page hears about all of them the same way.
window.addEventListener('eve:assets-refreshed', () => { slRenderAll(); });
function slStockFor(typeId) {
  return (window.userStockMap && window.userStockMap[typeId]) || 0;
}
function slIsDeductingStock() {
  const btn = document.getElementById('deduct-stock-mode');
  return btn ? btn.value === 'true' : true;
}

// ── PULL LIST ("Already Have") ──────────────────────────────────────────────────
// Requested directly: a checklist of what's already owned (at whatever location/can is currently
// selected above) that still has to physically go into the hauler - separate from "Buy Qty",
// which is about what to purchase. Consolidated by typeId across every fit and standalone item
// (unlike the table's own per-row Have display, which lets two different fits needing the same
// item each separately "claim" the full stock amount) - physically you only pull a given item
// off the shelf once, not once per fit that happens to need it.
function slConsolidatedNeeds() {
  const map = {};
  slItems.forEach(i => { if (!map[i.typeId]) map[i.typeId] = { name: i.name, qty: 0 }; map[i.typeId].qty += i.qty; });
  slFits.forEach(f => f.baseItems.forEach(i => {
    if (!map[i.typeId]) map[i.typeId] = { name: i.name, qty: 0 };
    map[i.typeId].qty += i.qty * f.copies;
  }));
  return map;
}
function slTogglePullChecked(typeId) {
  if (slPullChecked[typeId]) delete slPullChecked[typeId]; else slPullChecked[typeId] = true;
  saveSlPullChecked();
  slRenderPullList();
}
function slClearPullChecks() {
  slPullChecked = {};
  saveSlPullChecked();
  slRenderPullList();
}
function saveSlPullChecked() { try { localStorage.setItem(SL_PULL_CHECKED_KEY, JSON.stringify(slPullChecked)); } catch (e) {} }
function loadSlPullChecked() { slPullChecked = window.safeParseJSON(localStorage.getItem(SL_PULL_CHECKED_KEY), {}); }
// Reported directly: this was reflecting whatever the Check Against My Stock filter happened to
// be set to - which defaults to "All Locations (Combined Assets)", meaning it was really showing
// "everything you own anywhere that's also on your list," not "what's in the can." That's not the
// same thing at all once you own the same common items (minerals, ammo, T2 modules) scattered
// across several hangars/ships/other cans too - it stopped meaning "go empty this one can" and
// just became a second, redundant view of the shopping list. Now requires the filter to actually
// be scoped to one specific container (js/esi.js's own `container_<id>` filter value) before
// showing real rows at all - a bare station/system/"all locations" selection gets a prompt instead
// of silently substituting broader stock for what was asked for.
function slRenderPullList() {
  const wrap = document.getElementById('sl-pulllist-wrap');
  const body = document.getElementById('sl-pulllist-body');
  const badge = document.getElementById('sl-pulllist-badge');
  if (!wrap || !body) return;
  const hasAnyAssetData = !!(window.rawAssetItems && window.rawAssetItems.length);
  const hasListItems = !!(slItems.length || slFits.length);
  if (!hasAnyAssetData || !hasListItems) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const filterVal = document.getElementById('stock-location-filter')?.value || 'all';
  if (!filterVal.startsWith('container_')) {
    if (badge) badge.textContent = '—';
    body.innerHTML = `<div class="empty" style="padding:14px 18px;">Select a specific container above, under Check Against My Stock, to see what to pull from it.</div>`;
    return;
  }
  const rows = Object.entries(slConsolidatedNeeds())
    .map(([typeId, d]) => ({ typeId: +typeId, name: d.name, pullQty: Math.min(d.qty, slStockFor(+typeId)) }))
    .filter(r => r.pullQty > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const doneCount = rows.filter(r => slPullChecked[r.typeId]).length;
  if (badge) badge.textContent = `${doneCount}/${rows.length} Grabbed`;
  if (!rows.length) { body.innerHTML = `<div class="empty" style="padding:14px 18px;">Nothing in this container matches your current list.</div>`; return; }
  body.innerHTML = rows.map(r => {
    const checked = !!slPullChecked[r.typeId];
    return `
      <div class="pull-row${checked ? ' pull-row-done' : ''}" onclick="slTogglePullChecked(${r.typeId})">
        <span class="pull-check">${checked ? '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</span>
        <img src="${window.getItemIconUrl(r.typeId, r.name, 64)}" onerror="this.style.opacity=.15" loading="lazy">
        <span class="tn" style="flex:1;">${window.esc(r.name)}</span>
        <span class="pull-qty">${r.pullQty.toLocaleString()}</span>
      </div>
    `;
  }).join('');
}

// ── PRICE / VOLUME HELPERS ──────────────────────────────────────────────────────
// Per-item buy-strategy override set by the Market Spread optimizer below - same idea as the
// Calculator's own window.customBuyModes, just scoped to this page's own item set. Empty until
// Optimize is actually run; slSetPriceMode (the plain SELL/BUY toggle) clears it, since picking a
// single global mode by hand should mean exactly that - not leave stale per-item overrides mixed
// in from an earlier optimizer run.
let slBuyModes = {};
function slPrice(typeId) {
  const p = window.priceCache && window.priceCache[typeId];
  if (!p) return 0;
  const mode = slBuyModes[typeId] || slPriceMode;
  return (mode === 'buy' ? p.buy : p.sell) || 0;
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
  slRenderPullList();
  slSaveSession();
}

// Standalone shopping-list items are directly qty-editable (a stepper) - there's nothing else
// they're derived from. A fit's own module rows are NOT: their quantity comes from the actual
// fitting (1 gyro, 4 turrets, ...) multiplied by the fit's copies, so the only meaningful edits are
// "change copies" (the fit header's own stepper) or "remove this module" - matching the original
// standalone tool exactly, which never made a fit's own item rows qty-editable either.
// Star/favorite button shared by both row types - lets you favorite something straight from the
// list you're already looking at, instead of only via the separate favorite-item search box.
function slFavoriteRowBtnHTML(typeId, name) {
  return `<button onclick="event.stopPropagation(); slFavoriteItemFromList(${typeId}, '${window.esc(name).replace(/'/g, "\\'")}')" class="lp-chip-btn" title="Add to favorites"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`;
}
// Unit volume/price folded into the name's own subtitle line instead of two more dedicated table
// columns - reported directly (repeatedly) that the row was overflowing/getting clipped on the
// right at normal window widths. Fewer, wider-breathing columns fixes that at the source instead
// of relying on horizontal scroll to see the rest of a row.
// Small badge showing what the Market Spread optimizer decided for this item, if it's been run -
// silent (empty string) until then, since an unset item is just following the plain global
// SELL/BUY toggle and doesn't need its own label.
function slSpreadBadgeHTML(typeId) {
  const mode = slBuyModes[typeId];
  if (!mode) return '';
  return mode === 'buy'
    ? `<span class="ship-badge" style="color:var(--cost);" title="Spread wide enough that a Buy Order is worth waiting for">BUY ORDER</span>`
    : `<span class="ship-badge" style="color:var(--green);" title="Spread too narrow to bother with a Buy Order - buy instantly">INSTANT</span>`;
}
function slStandaloneItemRowHTML(it, idx) {
  const stockQty = slStockFor(it.typeId);
  const deduct = slIsDeductingStock();
  const netQty = deduct ? Math.max(0, it.qty - stockQty) : it.qty;
  const hasStockData = !!(window.userStockMap && Object.keys(window.userStockMap).length);
  const unitPrice = slPrice(it.typeId);
  const totalPrice = unitPrice * netQty;
  return `
    <tr>
      <td><img src="${window.getItemIconUrl(it.typeId, it.name, 64)}" style="width:36px;height:36px;border-radius:5px;" onerror="this.style.opacity=.15" loading="lazy"></td>
      <td><div class="tn" title="${window.esc(it.name)}">${window.esc(it.name)}${slSpreadBadgeHTML(it.typeId)}</div><div class="tm">${slFmtVol(it.volume)} m&sup3;/unit &middot; ${unitPrice > 0 ? window.formatISKCompact(unitPrice) : 'N/A'}/unit</div></td>
      <td style="text-align:center;">
        <div class="qty qty-sm" style="display:inline-flex;">
          <button onclick="slItemQtyStep(${idx}, -1)" type="button">&minus;</button>
          <input type="number" min="0" value="${it.qty}" onchange="slSetItemQty(${idx}, this.value)">
          <button onclick="slItemQtyStep(${idx}, 1)" type="button">+</button>
        </div>
      </td>
      ${hasStockData ? `<td class="tv"><div style="color:${netQty > 0 ? 'var(--jsl-red)' : 'var(--green)'};">${netQty.toLocaleString()}</div><div class="tm" style="text-align:right;">own: ${stockQty.toLocaleString()}</div></td>` : ''}
      <td class="tp">${unitPrice > 0 ? window.formatISKCompact(totalPrice) : '—'}</td>
      <td style="text-align:right; white-space:nowrap;">${slFavoriteRowBtnHTML(it.typeId, it.name)}<button onclick="slRemoveItem(${idx})" class="lp-chip-btn" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
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
    <tr${isShip ? ' class="ship-row"' : ''}>
      <td><img src="${window.getItemIconUrl(it.typeId, it.name, 64)}" style="width:36px;height:36px;border-radius:5px;" onerror="this.style.opacity=.15" loading="lazy"></td>
      <td><div class="tn" title="${window.esc(it.name)}">${window.esc(it.name)}${isShip ? '<span class="ship-badge">SHIP</span>' : ''}${slSpreadBadgeHTML(it.typeId)}</div><div class="tm">${it.qty}&times;/fit &middot; ${slFmtVol(it.volume)} m&sup3;/unit &middot; ${unitPrice > 0 ? window.formatISKCompact(unitPrice) : 'N/A'}/unit</div></td>
      <td style="text-align:center; font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--jsl-bright);">${tq.toLocaleString()}</td>
      ${hasStockData ? `<td class="tv"><div style="color:${netQty > 0 ? 'var(--jsl-red)' : 'var(--green)'};">${netQty.toLocaleString()}</div><div class="tm" style="text-align:right;">own: ${stockQty.toLocaleString()}</div></td>` : ''}
      <td class="tp">${unitPrice > 0 ? window.formatISKCompact(totalPrice) : '—'}</td>
      <td style="text-align:right; white-space:nowrap;">${slFavoriteRowBtnHTML(it.typeId, it.name)}<button onclick="slRemoveFitItem(${fit.fitId}, ${it.typeId})" class="lp-chip-btn" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    </tr>
  `;
}
function slFavoriteItemFromList(typeId, name) {
  if (slFavorites.find(f => f.kind === 'item' && f.typeId === typeId)) { window.showToast('Already in favorites.', 'info'); return; }
  slFavorites.unshift({ kind: 'item', typeId, name });
  saveSlFavorites();
  slRenderFavorites();
  window.showToast(`Added to favorites: ${name}`, 'success');
}

function slRenderList() {
  const body = document.getElementById('sl-list-body');
  const foot = document.getElementById('sl-list-foot');
  if (!body) return;
  if (!slFits.length && !slItems.length) {
    body.innerHTML = `<div class="empty"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1.6"/><circle cx="18.5" cy="21" r="1.6"/><path d="M2 3h3l2.4 12.2a1.8 1.8 0 0 0 1.77 1.45h9a1.8 1.8 0 0 0 1.77-1.45L23 7H6"/></svg></div><div>No items &mdash; import a fit or search above</div></div>`;
    if (foot) foot.style.display = 'none';
    return;
  }
  const hasStockData = !!(window.userStockMap && Object.keys(window.userStockMap).length);
  // Column widths have to leave real room for what's actually inside them under table-layout:fixed
  // (which clips anything wider than its declared column rather than letting it push neighbors
  // over) - the icon column needs to fit a 36px icon plus the table's own cell padding, and the
  // Qty column needs to fit the full −/input/+ stepper (86px on its own), not just a bare number.
  // Reported directly: both were too narrow, silently clipping the right edge of the icon and the
  // stepper's own + button.
  // Fewer, wider-breathing columns than before - unit volume/price now live in each row's own
  // name subtitle instead of two dedicated columns, and Have+Buy Qty collapsed into one column
  // (Buy Qty as the primary number, "own: N" as a small subtitle) - the previous 8-column layout
  // was what kept overflowing/clipping its right edge at normal window widths.
  const isOptimized = Object.keys(slBuyModes).length > 0;
  const totalHeaderLabel = isOptimized ? 'Total (Optimized)' : `Total (${slPriceMode === 'buy' ? 'Buy' : 'Sell'})`;
  const headCols = `
    <th style="width:60px;"></th><th>Item</th><th style="text-align:center;width:118px;">Qty</th>
    ${hasStockData ? `<th style="text-align:right;width:100px;" title="What you still need to buy after subtracting what you already own (shown below it)">Buy Qty</th>` : ''}
    <th style="text-align:right;width:100px;" title="${isOptimized ? 'Each item priced by its own Market Spread recommendation - see the badge next to its name' : (slPriceMode === 'buy' ? 'Buy' : 'Sell') + ' price × quantity'}">${totalHeaderLabel}</th><th style="width:82px;"></th>
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
      <div class="fb${fit.collapsed ? ' collapsed' : ''}">
        <div class="fh" onclick="slToggleFit(${fit.fitId})">
          <span class="collapse-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
          <span class="fn">${window.esc(fit.name)}</span>
          ${fit.shipName ? `<span class="fs">[${window.esc(fit.shipName)}]</span>` : ''}
          <span class="fs">${slFmtVol(fv)} m&sup3; &middot; ${fp > 0 ? window.formatISKCompact(fp) : '—'} &middot; ${moduleCount} module${moduleCount !== 1 ? 's' : ''}</span>
          <div style="margin-left:auto; display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation()">
            <span class="fs">COPIES</span>
            <div class="qty qty-sm">
              <button onclick="slFitCopiesStep(${fit.fitId}, -1)" type="button">&minus;</button>
              <input type="number" min="1" value="${fit.copies}" onchange="slSetFitCopies(${fit.fitId}, this.value)">
              <button onclick="slFitCopiesStep(${fit.fitId}, 1)" type="button">+</button>
            </div>
            <button class="lp-chip-btn" onclick="slCopyFitMultibuy(${fit.fitId})" title="Copy as EFT fitting">EFT</button>
            <button class="lp-chip-btn" style="color:var(--jsl-red);" onclick="slRemoveFit(${fit.fitId})">Remove</button>
          </div>
        </div>
        <div class="fb-body">
          <table class="jtable">
            <thead><tr>${headCols}</tr></thead>
            <tbody>${orderedItems.map(it => slFitItemRowHTML(it, fit, it.typeId === fit.shipTypeId)).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  });
  if (slItems.length) {
    if (slFits.length) html += `<div class="divider-label">Individual Items</div>`;
    html += `
      <div class="sl-table-wrap">
        <table class="jtable">
          <thead><tr>${headCols}</tr></thead>
          <tbody>${slItems.map((it, idx) => slStandaloneItemRowHTML(it, idx)).join('')}</tbody>
        </table>
      </div>
    `;
  }
  body.innerHTML = html;
  if (foot) foot.style.display = 'block';
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
  const wrap = document.getElementById('sl-totals-wrap');
  const typeCountEl = document.getElementById('sl-type-count');
  if (!wrap) return;
  if (!slItems.length && !slFits.length) {
    wrap.style.display = 'none';
    if (typeCountEl) typeCountEl.textContent = '0 Types';
    return;
  }
  // Reported directly: with Deducting Stock on, each row's own Total column already nets out
  // owned stock - but "Total Price"/"Total Quantity" didn't, disagreeing with the table underneath.
  // Fixed to match - but Volume deliberately stays on the FULL raw amount regardless of deducting,
  // reported directly right after: deducting stock only means you don't have to BUY those units,
  // not that you don't have to HAUL them - they still take up cargo space on the trip, so cutting
  // them from Total Volume (and the hauler-capacity warning bar it drives) would be wrong.
  let vol = 0, price = 0, qty = 0;
  const deduct = slIsDeductingStock();
  slFits.forEach(f => f.baseItems.forEach(i => {
    const tq = i.qty * f.copies;
    const netQty = deduct ? Math.max(0, tq - slStockFor(i.typeId)) : tq;
    vol += i.volume * tq; price += slPrice(i.typeId) * netQty; qty += netQty;
  }));
  slItems.forEach(i => {
    const netQty = deduct ? Math.max(0, i.qty - slStockFor(i.typeId)) : i.qty;
    vol += i.volume * i.qty; price += slPrice(i.typeId) * netQty; qty += netQty;
  });
  const typeCount = slFits.reduce((s, f) => s + f.baseItems.length, 0) + slItems.length;
  wrap.style.display = 'block';
  if (typeCountEl) typeCountEl.textContent = `${typeCount} Type${typeCount !== 1 ? 's' : ''}`;
  const tv = document.getElementById('sl-tv'); if (tv) tv.textContent = slFmtVol(vol);
  const tp = document.getElementById('sl-tp'); if (tp) tp.textContent = price > 0 ? window.formatISKCompact(price) : '—';
  const tpMode = document.getElementById('sl-tp-mode'); if (tpMode) tpMode.textContent = Object.keys(slBuyModes).length > 0 ? 'OPTIMIZED (MIXED)' : slPriceMode.toUpperCase();
  const tq = document.getElementById('sl-tq'); if (tq) tq.textContent = qty.toLocaleString();
  const tu = document.getElementById('sl-tu'); if (tu) tu.textContent = `${typeCount} unique type${typeCount !== 1 ? 's' : ''}`;
  const cap = parseFloat(document.getElementById('sl-hauler-capacity')?.value) || 0;
  const hf = document.getElementById('sl-hf'), tvs = document.getElementById('sl-tvs');
  if (cap > 0) {
    const pct = Math.min(vol / cap * 100, 100);
    if (hf) { hf.style.width = pct + '%'; hf.className = 'hf' + (vol > cap ? ' over' : pct > 70 ? ' warn' : ''); }
    if (tvs) tvs.textContent = `${vol.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${cap.toLocaleString()} m³`;
  } else {
    if (hf) hf.style.width = '0%';
    if (tvs) tvs.textContent = 'm³';
  }
}
function slSetPriceMode(mode) {
  slPriceMode = mode;
  slBuyModes = {};
  const sellBtn = document.getElementById('sl-btn-sell'), buyBtn = document.getElementById('sl-btn-buy');
  if (sellBtn) sellBtn.classList.toggle('on', mode === 'sell');
  if (buyBtn) buyBtn.classList.toggle('on', mode === 'buy');
  slRenderAll();
}
function slRefreshAllPrices() {
  const ids = [...new Set([...slItems.map(i => i.typeId), ...slFits.flatMap(f => f.baseItems.map(i => i.typeId))])];
  if (!ids.length) { window.showToast('Nothing to refresh.', 'info'); return; }
  ids.forEach(id => { delete window.priceCache[id]; });
  window.fetchMarketPrices(ids).then(() => { slRenderAll(); window.showToast('Prices refreshed.', 'success'); });
}
// Same formula as the Calculator's own Market Spread optimizer (js/optimizers.js's
// applyComponentSpreadOptimizer): spreadPct = (sell - buy) / sell * 100. Above the threshold, an
// item is cheap enough as a Buy Order (place it and wait) to be worth it over paying the full ask
// price on existing Sell Orders; below it, or if either side of the book is missing, instant-buy
// stays the better call. Per item, not a global switch - overrides the plain SELL/BUY toggle for
// exactly the items it touches, same "smart per-leaf strategy" idea as the Calculator's version,
// just applied to a flat shopping list instead of a recipe tree.
function slApplySpreadOptimizer() {
  const threshold = parseFloat(document.getElementById('sl-spread-threshold').value) || 0;
  const typeIds = [...new Set([...slItems.map(i => i.typeId), ...slFits.flatMap(f => f.baseItems.map(i => i.typeId))])];
  if (!typeIds.length) { window.showToast('Nothing to optimize yet.', 'info'); return; }
  let buyCount = 0;
  typeIds.forEach(typeId => {
    const p = (window.priceCache && window.priceCache[typeId]) || { sell: 0, buy: 0 };
    if (p.sell > 0 && p.buy > 0 && p.sell > p.buy) {
      const spreadPct = ((p.sell - p.buy) / p.sell) * 100;
      slBuyModes[typeId] = spreadPct >= threshold ? 'buy' : 'sell';
    } else {
      slBuyModes[typeId] = 'sell';
    }
    if (slBuyModes[typeId] === 'buy') buyCount++;
  });
  slRenderAll();
  window.showToast(`Optimized ${typeIds.length} item${typeIds.length !== 1 ? 's' : ''}: ${buyCount} recommended as Buy Order${buyCount !== 1 ? 's' : ''}, ${typeIds.length - buyCount} as instant-buy.`, 'success');
}

// Multibuy is a "what do I still need to buy" list, so it has to honor the same deduct-stock
// toggle and per-item Have amount the table itself already shows in its Buy Qty column - reported
// directly: with deducting on, this was still copying the full raw quantity because it summed
// i.qty straight from state without ever consulting slStockFor/slIsDeductingStock at all.
function slCopyMultibuy() {
  const deduct = slIsDeductingStock();
  const combined = {}; // typeId -> {name, qty}
  const add = (typeId, name, qty) => {
    const netQty = deduct ? Math.max(0, qty - slStockFor(typeId)) : qty;
    if (!combined[typeId]) combined[typeId] = { name, qty: 0 };
    combined[typeId].qty += netQty;
  };
  slFits.forEach(f => f.baseItems.forEach(i => add(i.typeId, i.name, i.qty * f.copies)));
  slItems.forEach(i => add(i.typeId, i.name, i.qty));
  const lines = Object.values(combined).filter(e => e.qty > 0).map(({ name, qty }) => qty > 1 ? `${name} x${qty}` : name);
  if (!lines.length) { window.showToast(deduct ? 'Nothing left to buy - stock already covers everything.' : 'Nothing to copy.', 'info'); return; }
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
  document.querySelectorAll('.jtab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('sl-tab-' + name).classList.add('active');
}

// ── PANEL MINIMIZE ────────────────────────────────────────────────────────────────
// Requested directly for Favorite Items and Already Have - generic by panel id rather than two
// one-off toggles, so any other panel that wants this later just needs the same button/id pair.
// Persisted so a panel you've minimized stays that way across a reload, same idea as the build
// tree's own collapse state persistence on the Calculator.
function slTogglePanelCollapse(panelId) {
  const panel = document.getElementById(panelId); if (!panel) return;
  const collapsed = panel.classList.toggle('collapsed');
  const saved = new Set(window.safeParseJSON(localStorage.getItem(SL_COLLAPSED_PANELS_KEY), []));
  if (collapsed) saved.add(panelId); else saved.delete(panelId);
  try { localStorage.setItem(SL_COLLAPSED_PANELS_KEY, JSON.stringify([...saved])); } catch (e) {}
}
function slRestoreCollapsedPanels() {
  const saved = window.safeParseJSON(localStorage.getItem(SL_COLLAPSED_PANELS_KEY), []);
  saved.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('collapsed'); });
}

// ── WISHLIST ─────────────────────────────────────────────────────────────────────
function slAddWishFit() {
  const text = document.getElementById('sl-favwish-eft').value.trim();
  if (!text) { window.showToast('Paste a fitting first.', 'info'); return; }
  const { fitName, shipName } = slParseEFT(text);
  let shipTypeId = 0;
  if (shipName) { const hit = slLookupByName(shipName); if (hit) shipTypeId = hit.id; }
  slWishlist.push({ kind: 'fit', fitName, shipName, shipTypeId, copies: 1, fitText: text });
  document.getElementById('sl-favwish-eft').value = '';
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
// Reported directly: this needs to actually LOOK like the Favorites grid next to it, not just use
// the same class names - a permanent qty stepper on every card was wider than Favorites' cards
// ever needed to be, which squeezed the name column down to nothing (a real, separately-reported
// bug) and left the two grids visibly mismatched even after that was patched. The stepper is gone;
// clicking "+" now asks how many via the same popup the Favorite Items rail already uses
// (slOpenQtyPopup) instead of keeping a permanent control on the card face, which is exactly the
// same tradeoff that popup was originally built for. The stored copies/qty still shows as a small
// "×N" badge on the icon when it's more than 1, so it's not lost, just not a standing widget.
function slRenderWishlist() {
  const el = document.getElementById('sl-wishlist-body'); if (!el) return;
  const badge = document.getElementById('sl-wishlist-badge');
  if (badge) badge.textContent = `${slWishlist.length} Fit${slWishlist.length !== 1 ? 's' : ''}`;
  if (!slWishlist.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div>No wishlist fits yet.</div></div>`; return; }
  el.innerHTML = slWishlist.map((w, idx) => {
    const isFit = w.kind === 'fit';
    const borderColor = isFit ? 'var(--jsl-gold)' : 'rgba(255,255,255,0.14)';
    const count = isFit ? (w.copies || 1) : (w.qty || 1);
    const countBadge = count > 1 ? `<span class="fav-count-badge">&times;${count}</span>` : '';
    const icon = isFit
      ? (w.shipTypeId ? `<img src="${window.getItemIconUrl(w.shipTypeId, w.shipName, 128)}" style="width:80px;height:80px;border-radius:6px;flex-shrink:0;" onerror="this.style.opacity=.15">`
        : `<div style="width:80px;height:80px;border-radius:6px;background:rgba(var(--jsl-gold-rgb),0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--jsl-gold);font-size:28px;">&#9658;</div>`)
      : `<img src="${window.getItemIconUrl(w.typeId, w.name, 128)}" style="width:80px;height:80px;border-radius:6px;flex-shrink:0;" onerror="this.style.opacity=.15">`;
    const label = isFit ? w.fitName : w.name;
    const sub = isFit ? (w.shipName || 'fit') : 'item';
    const viewFn = `slOpenFitPopup('wish', ${idx})`;
    return `
      <div class="fav-card" style="border-left:3px solid ${borderColor};">
        <div style="cursor:${isFit ? 'pointer' : 'default'}; display:contents;" ${isFit ? `onclick="${viewFn}"` : ''}>
          <div style="position:relative; flex-shrink:0;">${icon}${countBadge}</div>
          <div style="flex:1; min-width:0;">
            <div class="fav-label">${window.esc(label)}</div>
            <div class="fav-sub">${window.esc(sub)}</div>
          </div>
        </div>
        ${isFit ? `<button onclick="${viewFn}" class="lp-chip-btn" title="View Fit"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg></button>` : ''}
        <div class="fav-plus" onclick="slOpenQtyPopup('wish', ${idx})" title="Add to shopping list">+</div>
        <button onclick="slRemoveWishEntry(${idx})" class="lp-chip-btn" style="color:var(--jsl-red); position:relative; z-index:2;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    `;
  }).join('');
}
function slSaveWishlist() { try { localStorage.setItem(SL_WISHLIST_KEY, JSON.stringify(slWishlist)); } catch (e) {} }
function slLoadWishlist() { slWishlist = window.safeParseJSON(localStorage.getItem(SL_WISHLIST_KEY), []); }

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
// Single items are favorited from the Shopping List tab itself (this search box, or the star
// button on any list row) - the Favorites tab only accepts pasted fits (slAddFavFit below), so
// its own grid stays focused on fits/saved lists rather than mixing in individual items too.
function slAddQuickFavItem() {
  if (!slPicked.qfav) { window.showToast('Search for and select an item first.', 'info'); return; }
  const it = slPicked.qfav;
  if (slFavorites.find(f => f.kind === 'item' && f.typeId === it.id)) { window.showToast('Already in favorites.', 'info'); return; }
  slFavorites.unshift({ kind: 'item', typeId: it.id, name: it.name });
  saveSlFavorites(); document.getElementById('sl-quickfav-search').value = ''; slPicked.qfav = null; slRenderFavorites();
  window.showToast(`Added to favorites: ${it.name}`, 'success');
}
function slAddFavFit() {
  const text = document.getElementById('sl-favwish-eft').value.trim();
  if (!text) { window.showToast('Paste a fitting first.', 'info'); return; }
  const { fitName, shipName } = slParseEFT(text);
  let shipTypeId = 0;
  if (shipName) { const hit = slLookupByName(shipName); if (hit) shipTypeId = hit.id; }
  slFavorites.unshift({ kind: 'fit', name: fitName, shipName, shipTypeId, fitText: text });
  saveSlFavorites(); document.getElementById('sl-favwish-eft').value = ''; slRenderFavorites();
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
// This tab is fits-and-saved-lists only (reported directly: single items belong to the Shopping
// List tab's own favoriting flow, not here) - filtered down but keeping each entry's REAL index
// into slFavorites (not the filtered position), same pattern slRenderQuickFavorites uses, since
// slUseFavorite/slRemoveFavorite/etc. all need the real index.
function slRenderFavorites() {
  slRenderQuickFavorites();
  const grid = document.getElementById('sl-favorites-grid'); if (!grid) return;
  const entries = slFavorites.map((f, idx) => ({ ...f, idx })).filter(f => f.kind !== 'item');
  const badge = document.getElementById('sl-favorites-badge');
  if (badge) badge.textContent = `${entries.length} Saved`;
  if (!entries.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div>No favorite fits or saved lists yet.</div></div>`; return; }
  grid.innerHTML = entries.map((f) => {
    const idx = f.idx, isFit = f.kind === 'fit', isList = f.kind === 'list';
    const borderColor = isFit ? 'var(--jsl-gold)' : 'var(--accent)';
    const icon = isFit && f.shipTypeId ? `<img src="${window.getItemIconUrl(f.shipTypeId, f.shipName, 128)}" style="width:80px;height:80px;border-radius:6px;flex-shrink:0;" onerror="this.style.opacity=.15">`
      : `<div style="width:80px;height:80px;border-radius:6px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent);font-size:28px;">${isList ? '&#9776;' : '&#9658;'}</div>`;
    const sub = isFit ? (f.shipName ? window.esc(f.shipName) : 'fit')
      : `${(f.fits || []).length} fit${(f.fits || []).length !== 1 ? 's' : ''}, ${(f.items || []).length} item${(f.items || []).length !== 1 ? 's' : ''}`;
    const viewFn = isFit ? `slOpenFitPopup('fav', ${idx})` : `slViewFavoriteList(${idx})`;
    return `
      <div class="fav-card" style="border-left:3px solid ${borderColor};">
        <div style="cursor:pointer; display:contents;" onclick="${viewFn}">
          ${icon}
          <div style="flex:1; min-width:0;">
            <div class="fav-label">${window.esc(f.name)}</div>
            <div class="fav-sub">${sub}</div>
          </div>
        </div>
        <button onclick="${viewFn}" class="lp-chip-btn" title="${isFit ? 'View Fit' : 'View List'}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <div class="fav-plus" onclick="slUseFavorite(${idx})" title="Add to current list">+</div>
        ${isList ? `<button onclick="slReplaceWithFavorite(${idx})" class="lp-chip-btn" title="Replace current list with this">&#8644;</button>` : ''}
        <button onclick="slRemoveFavorite(${idx})" class="lp-chip-btn" style="color:var(--jsl-red); position:relative; z-index:2;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    `;
  }).join('');
}
// Quick-add strip on the Shopping List tab itself (right column) - just the item-kind favorites
// (modules/consumables you reach for often), so adding one of those doesn't need a tab switch to
// the full Favorites tab (which also has to deal with fits and whole saved lists). Filters slFavorites
// down but keeps each entry's REAL index into that array (not the filtered position), since
// slUseFavorite needs the real index to find the right entry.
// Category filter for the quick-favorites panel - once there are many favorites, a flat grid gets
// hard to scan (reported directly). Grouped by real EVE category IDs (window.EVE_CATEGORIES,
// eve_db.js), confirmed live rather than guessed: 7=Module, 8=Charge (this bucket genuinely covers
// ammo AND consumables like nanite paste/cap boosters - EVE's own SDE doesn't split those further),
// 18=Drone, 20=Implant (boosters/"drugs" share this exact category with cybernetic implants in the
// real SDE - there's no reliable way to split "drugs" out from a plain category check, so this
// stays one honestly-labeled bucket rather than a fabricated distinction), 4=Material, 16=Skill.
// Anything outside those falls into "Other" rather than disappearing.
const SL_QFAV_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 7, label: 'Modules' },
  { key: 8, label: 'Charges & Consumables' },
  { key: 18, label: 'Drones' },
  { key: 20, label: 'Implants & Boosters' },
  { key: 4, label: 'Materials' },
  { key: 16, label: 'Skills' },
  { key: 'other', label: 'Other' },
];
let slQuickFavFilter = 'all';
function slQuickFavCategoryOf(typeId) {
  const cat = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[typeId] : undefined;
  return SL_QFAV_CATEGORIES.some(c => c.key === cat) ? cat : 'other';
}
function slSetQuickFavFilter(key) {
  slQuickFavFilter = key;
  slRenderQuickFavorites();
}
function slRenderQuickFavorites() {
  const el = document.getElementById('sl-quickfav-grid');
  const filtersEl = document.getElementById('sl-quickfav-filters');
  if (!el) return;
  const allItemFavs = slFavorites.map((f, idx) => ({ ...f, idx })).filter(f => f.kind === 'item');
  if (filtersEl) {
    filtersEl.classList.toggle('hidden', allItemFavs.length < 6);
    filtersEl.innerHTML = SL_QFAV_CATEGORIES.map(c => `<button class="qfav-filter${slQuickFavFilter === c.key ? ' active' : ''}" onclick="slSetQuickFavFilter(${typeof c.key === 'string' ? `'${c.key}'` : c.key})">${c.label}</button>`).join('');
  }
  const itemFavs = slQuickFavFilter === 'all' ? allItemFavs : allItemFavs.filter(f => slQuickFavCategoryOf(f.typeId) === slQuickFavFilter);
  if (!allItemFavs.length) {
    el.innerHTML = `<div class="empty" style="padding:16px 0; grid-column:1/-1;">No favorite items yet - search above to add some.</div>`;
    return;
  }
  if (!itemFavs.length) {
    el.innerHTML = `<div class="empty" style="padding:16px 0; grid-column:1/-1;">No favorites in this category.</div>`;
    return;
  }
  el.innerHTML = itemFavs.map(f => `
    <div class="qfav-card" onclick="slOpenQtyPopup('qfav', ${f.idx})">
      <img src="${window.getItemIconUrl(f.typeId, f.name, 32)}" onerror="this.style.opacity=.15" loading="lazy">
      <span class="tn" title="${window.esc(f.name)}">${window.esc(f.name)}</span>
      <button class="lp-chip-btn qfav-remove" style="color:var(--jsl-red);" onclick="event.stopPropagation(); slRemoveFavorite(${f.idx})" title="Remove from favorites"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `).join('');
}

// Click a favorite item, or a wishlist fit's own "+" -> ask how many, rather than silently
// adding exactly 1 with no way to say otherwise, or cluttering every card with its own permanent
// stepper (reported directly for both: the Favorite Items rail originally, and the Wishlist grid
// once its cards needed to actually look like the Favorites grid next to them - a stepper on every
// card was the one thing standing in the way of that). One shared popup, keyed by the same
// source-string pattern slOpenFitPopup already uses ('qfav' | 'wish') rather than one popup per
// feature, since "click it, ask how many, add it" is identical either way - only which array (and
// whether it's a fit or a plain item) the confirmed index resolves to differs.
let _slQtyPopup = null; // { source: 'qfav' | 'wish', idx } | null
function slOpenQtyPopup(source, idx) {
  const rec = source === 'wish' ? slWishlist[idx] : slFavorites[idx];
  if (!rec) return;
  if (source === 'qfav' && rec.kind !== 'item') return;
  _slQtyPopup = { source, idx };
  const isFit = rec.kind === 'fit';
  const typeId = isFit ? rec.shipTypeId : rec.typeId;
  const name = isFit ? rec.fitName : rec.name;
  document.getElementById('sl-qty-popup-icon').src = typeId ? window.getItemIconUrl(typeId, name, 64) : '';
  document.getElementById('sl-qty-popup-name').textContent = name;
  const qtyInput = document.getElementById('sl-qty-popup-qty');
  qtyInput.value = source === 'wish' ? (isFit ? (rec.copies || 1) : (rec.qty || 1)) : 1;
  document.getElementById('sl-qty-popup-bg').classList.remove('hidden');
  qtyInput.focus();
  qtyInput.select();
}
function slCloseQtyPopup() {
  document.getElementById('sl-qty-popup-bg').classList.add('hidden');
  _slQtyPopup = null;
}
function slQtyPopupStep(delta) {
  const input = document.getElementById('sl-qty-popup-qty');
  input.value = Math.max(1, (parseInt(input.value) || 1) + delta);
}
function slConfirmQtyPopup() {
  if (!_slQtyPopup) return;
  const { source, idx } = _slQtyPopup;
  const qty = Math.max(1, parseInt(document.getElementById('sl-qty-popup-qty').value) || 1);
  if (source === 'qfav') {
    const f = slFavorites[idx]; if (!f || f.kind !== 'item') { slCloseQtyPopup(); return; }
    slAddItemToList(f.typeId, f.name, qty);
    slRenderAll();
    window.showToast(`Added ${qty} × ${f.name}`, 'success');
  } else {
    const w = slWishlist[idx]; if (!w) { slCloseQtyPopup(); return; }
    if (w.kind === 'item') w.qty = qty; else w.copies = qty;
    slSaveWishlist();
    slWishAddOne(idx);
  }
  slCloseQtyPopup();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') slCloseQtyPopup(); });
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
  slRestoreCollapsedPanels();
  slLoadSession();
  slLoadWishlist(); slRenderWishlist();
  slLoadFavorites(); slRenderFavorites();
  loadSlPullChecked();
  slRenderAll();
  if (slItems.length || slFits.length) {
    const ids = [...slItems.map(i => i.typeId), ...slFits.flatMap(f => f.baseItems.map(i => i.typeId))];
    window.fetchMarketPrices(ids).then(slRenderAll);
    slRefreshShipVolumes(ids);
  }
  if (typeof handleEsiSSOCallback === 'function') handleEsiSSOCallback();
};
