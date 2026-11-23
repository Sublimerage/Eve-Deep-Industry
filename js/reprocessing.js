// --- Reprocessing Calculator ---
// window.EVE_REPROCESSING[typeId] = [{typeId, qty}, ...] material yield per FULL BATCH of
// window.EVE_PORTION_SIZE[typeId] units (portionSize defaults to 1 when absent - true for nearly
// everything except ore/ice, where batches of 100 are standard). Yield at 100% efficiency is exactly
// that qty; real yield scales down by the player's actual Reprocessing Efficiency %.

let _reprocessingSelectedTypeId = null;
let _reprocessingSelectedName = null;

// --- Search ---
let _reprocessingSearchToken = 0;

function searchReprocessingItem(query) {
  const resultsEl = document.getElementById('reprocessing-search-results');
  if (!resultsEl) return;
  const token = ++_reprocessingSearchToken;
  const q = (query || '').toLowerCase().trim();
  if (q.length < 2) {
    resultsEl.classList.add('hidden');
    return;
  }
  const reproDb = window.EVE_REPROCESSING || {};
  const startsWith = [];
  const includes = [];
  for (const idStr of Object.keys(reproDb)) {
    const id = parseInt(idStr);
    const name = (window.EVE_ITEMS && window.EVE_ITEMS[id]) || (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[id]);
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) startsWith.push({ id, name });
    else if (lower.includes(q)) includes.push({ id, name });
    if (startsWith.length >= 15) break;
  }
  if (token !== _reprocessingSearchToken) return;
  const hits = startsWith.concat(includes).slice(0, 15);
  if (hits.length === 0) {
    resultsEl.innerHTML = `<div class="p-3 text-slate-400 text-xs italic">No reprocessable items found matching "${window.esc(q)}".</div>`;
    resultsEl.classList.remove('hidden');
    return;
  }
  resultsEl.innerHTML = hits.map(h => `
    <div class="lp-list-item" onmousedown="selectReprocessingItem(${h.id}, '${window.esc(h.name)}')">
      <img src="${window.getItemIconUrl(h.id, h.name, 32)}" class="w-6 h-6 rounded flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${h.id}/render?size=32';">
      <span class="font-semibold truncate" style="color:var(--text);">${window.esc(h.name)}</span>
    </div>
  `).join('');
  resultsEl.classList.remove('hidden');
}
window.searchReprocessingItem = searchReprocessingItem;

async function selectReprocessingItem(typeId, name, skipSave) {
  document.getElementById('reprocessing-item-search').value = name;
  document.getElementById('reprocessing-search-results').classList.add('hidden');

  const materials = (window.EVE_REPROCESSING || {})[typeId];
  if (!materials || materials.length === 0) {
    if (typeof window.showToast === 'function') window.showToast('No reprocessing data found for this item.', 'info');
    return;
  }

  _reprocessingSelectedTypeId = typeId;
  _reprocessingSelectedName = name;

  document.getElementById('reprocessing-config-panel').classList.remove('hidden');
  document.getElementById('reprocessing-item-icon').src = window.getItemIconUrl(typeId, name, 64);
  document.getElementById('reprocessing-item-name').textContent = name;
  const portionSize = (window.EVE_PORTION_SIZE && window.EVE_PORTION_SIZE[typeId]) || 1;
  document.getElementById('reprocessing-item-meta').textContent = `Reprocesses in batches of ${portionSize.toLocaleString()}`;

  const qtyEl = document.getElementById('reprocessing-quantity');
  if (qtyEl && !skipSave) qtyEl.value = portionSize;

  if (!skipSave) saveReprocessingState();
  recalculateReprocessingImpl();
}
window.selectReprocessingItem = selectReprocessingItem;

// --- Shared tax settings (sales tax + broker fee only - reprocessing has no facility/SCC job fees,
// so unlike invention.js/app.js's versions this ONLY ever touches the two keys it actually has
// fields for, never clobbering facilityTax/sccSurcharge stored by the other two pages). ---
function loadSharedReprocessingTaxSettings() {
  try {
    const saved = localStorage.getItem('eve_tax_settings');
    if (!saved) return;
    const settings = window.safeParseJSON(saved, {});
    if (settings.salesTax !== undefined && document.getElementById('sales-tax')) document.getElementById('sales-tax').value = settings.salesTax;
    if (settings.brokerFee !== undefined && document.getElementById('broker-fee')) document.getElementById('broker-fee').value = settings.brokerFee;
  } catch (e) {}
}
window.loadSharedReprocessingTaxSettings = loadSharedReprocessingTaxSettings;

function saveSharedReprocessingTaxSettings() {
  try {
    const existingRaw = localStorage.getItem('eve_tax_settings');
    const existing = existingRaw ? window.safeParseJSON(existingRaw, {}) : {};
    const salesTaxEl = document.getElementById('sales-tax');
    const brokerFeeEl = document.getElementById('broker-fee');
    if (salesTaxEl) existing.salesTax = salesTaxEl.value;
    if (brokerFeeEl) existing.brokerFee = brokerFeeEl.value;
    localStorage.setItem('eve_tax_settings', JSON.stringify(existing));
  } catch (e) {}
}
window.saveSharedReprocessingTaxSettings = saveSharedReprocessingTaxSettings;

// --- State persistence ---
function saveReprocessingState() {
  if (!_reprocessingSelectedTypeId) return;
  const state = {
    typeId: _reprocessingSelectedTypeId,
    name: _reprocessingSelectedName,
    quantity: document.getElementById('reprocessing-quantity')?.value,
    efficiency: document.getElementById('reprocessing-efficiency')?.value
  };
  localStorage.setItem('eve_reprocessing_state', JSON.stringify(state));
}
window.saveReprocessingState = saveReprocessingState;

async function restoreReprocessingState() {
  const state = window.safeParseJSON(localStorage.getItem('eve_reprocessing_state'), null);
  if (!state || !state.typeId) return;
  await selectReprocessingItem(state.typeId, state.name, true);
  if (state.quantity !== undefined) document.getElementById('reprocessing-quantity').value = state.quantity;
  if (state.efficiency !== undefined) document.getElementById('reprocessing-efficiency').value = state.efficiency;
  recalculateReprocessingImpl();
}
window.restoreReprocessingState = restoreReprocessingState;

// --- Calculation ---
let _reprocessingDebounceTimer = null;
function recalculateReprocessing() {
  saveReprocessingState();
  clearTimeout(_reprocessingDebounceTimer);
  _reprocessingDebounceTimer = setTimeout(() => {
    _reprocessingDebounceTimer = null;
    recalculateReprocessingImpl();
  }, 300);
}
window.recalculateReprocessing = recalculateReprocessing;

async function recalculateReprocessingImpl() {
  const typeId = _reprocessingSelectedTypeId;
  if (!typeId) return;
  const materials = (window.EVE_REPROCESSING || {})[typeId] || [];
  if (materials.length === 0) return;

  const portionSize = (window.EVE_PORTION_SIZE && window.EVE_PORTION_SIZE[typeId]) || 1;
  const qty = Math.max(0, parseInt(document.getElementById('reprocessing-quantity')?.value) || 0);
  const batches = Math.floor(qty / portionSize);
  const leftover = qty - (batches * portionSize);
  const consumedQty = batches * portionSize;
  const efficiency = Math.min(100, Math.max(0, parseFloat(document.getElementById('reprocessing-efficiency')?.value) || 0)) / 100;
  const salesTax = (parseFloat(document.getElementById('sales-tax')?.value) || 0) / 100;
  const brokerFee = (parseFloat(document.getElementById('broker-fee')?.value) || 0) / 100;

  const batchNoteEl = document.getElementById('reprocessing-batch-note');
  if (batchNoteEl) {
    batchNoteEl.textContent = leftover > 0
      ? `${batches.toLocaleString()} full batch${batches === 1 ? '' : 'es'} of ${portionSize.toLocaleString()} - ${leftover.toLocaleString()} leftover unit${leftover === 1 ? '' : 's'} won't reprocess`
      : `${batches.toLocaleString()} full batch${batches === 1 ? '' : 'es'} of ${portionSize.toLocaleString()}`;
  }

  const resultsArea = document.getElementById('reprocessing-results-area');
  const emptyState = document.getElementById('reprocessing-empty-state');
  if (batches <= 0) {
    if (resultsArea) resultsArea.classList.add('hidden');
    if (emptyState) {
      emptyState.classList.remove('hidden');
      emptyState.textContent = `Enter at least ${portionSize.toLocaleString()} units (one full batch) to see a yield.`;
    }
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');
  if (resultsArea) resultsArea.classList.remove('hidden');

  const allTypeIds = materials.map(m => m.typeId);
  allTypeIds.push(typeId);
  if (typeof window.fetchMarketPrices === 'function') {
    await window.fetchMarketPrices(allTypeIds);
  }
  // A second recalculation may have been queued while the price fetch above was in flight (e.g. the
  // user kept typing) - if so, bail and let that newer call render the final result instead of this
  // now-stale one overwriting it.
  if (typeId !== _reprocessingSelectedTypeId) return;

  const rows = materials.map(m => {
    const yieldQty = Math.floor(m.qty * batches * efficiency);
    const prices = window.priceCache[m.typeId] || { sell: 0, buy: 0 };
    const name = (window.EVE_ITEMS && window.EVE_ITEMS[m.typeId]) || (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[m.typeId]) || `Item ${m.typeId}`;
    return {
      typeId: m.typeId,
      name,
      yieldQty,
      sell: prices.sell || 0,
      buy: prices.buy || 0,
      totalSell: yieldQty * (prices.sell || 0),
      totalBuy: yieldQty * (prices.buy || 0)
    };
  }).sort((a, b) => b.totalSell - a.totalSell);

  const grossSell = rows.reduce((sum, r) => sum + r.totalSell, 0);
  const grossBuy = rows.reduce((sum, r) => sum + r.totalBuy, 0);
  const reprocessedSellOrders = grossSell * (1 - salesTax - brokerFee);
  const reprocessedInstant = grossBuy * (1 - salesTax);
  const reprocessedBest = Math.max(reprocessedSellOrders, reprocessedInstant);

  const itemPrices = window.priceCache[typeId] || { sell: 0, buy: 0 };
  const directSellOrders = consumedQty * itemPrices.sell * (1 - salesTax - brokerFee);
  const directInstant = consumedQty * itemPrices.buy * (1 - salesTax);
  const directBest = Math.max(directSellOrders, directInstant);

  renderReprocessingVerdictBanner(reprocessedBest, directBest);
  renderReprocessingSummaryTiles({ batches, portionSize, consumedQty, reprocessedSellOrders, reprocessedInstant, directSellOrders, directInstant });
  renderReprocessingYieldTable(rows);
}

function renderReprocessingVerdictBanner(reprocessedBest, directBest) {
  const el = document.getElementById('reprocessing-verdict-banner');
  if (!el) return;
  const diff = reprocessedBest - directBest;
  const base = Math.max(reprocessedBest, directBest, 1);
  const pct = Math.abs(diff) / base * 100;
  let icon, label, color;
  if (pct < 1) {
    icon = window.svgIcon('scale'); label = 'Reprocessing and selling directly are worth about the same.'; color = 'var(--text-soft)';
  } else if (diff > 0) {
    icon = window.svgIcon('check-circle'); label = `Reprocessing is worth ${Math.round(diff).toLocaleString()} ISK more (+${pct.toFixed(1)}%) than selling directly.`; color = 'var(--green)';
  } else {
    icon = window.svgIcon('warning'); label = `Selling directly is worth ${Math.round(-diff).toLocaleString()} ISK more (+${pct.toFixed(1)}%) than reprocessing.`; color = 'var(--red)';
  }
  el.innerHTML = `
    <div class="lp-card p-3 flex items-center gap-2.5" style="border-color:${color};">
      <span style="font-size:18px;flex-shrink:0;color:${color};display:inline-flex;">${icon}</span>
      <span class="text-sm font-semibold" style="color:${color};">${window.esc(label)}</span>
    </div>
  `;
}

function renderReprocessingSummaryTiles(d) {
  const container = document.getElementById('reprocessing-summary-tiles');
  if (!container) return;
  container.innerHTML = `
    <div class="lp-tile">
      <div class="lp-label truncate">Batches Reprocessed</div>
      <div class="text-lg font-bold mono leading-tight" style="color:var(--text);">${d.batches.toLocaleString()} × ${d.portionSize.toLocaleString()}</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${d.consumedQty.toLocaleString()} units consumed</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Reprocessed Value</div>
      <div class="text-lg font-bold mono leading-tight" style="color:var(--accent);">${Math.round(Math.max(d.reprocessedSellOrders, d.reprocessedInstant)).toLocaleString()} ISK</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${Math.round(d.reprocessedSellOrders).toLocaleString()} sell orders / ${Math.round(d.reprocessedInstant).toLocaleString()} instant</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Direct Sell Value</div>
      <div class="text-lg font-bold mono leading-tight" style="color:var(--text);">${Math.round(Math.max(d.directSellOrders, d.directInstant)).toLocaleString()} ISK</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${Math.round(d.directSellOrders).toLocaleString()} sell orders / ${Math.round(d.directInstant).toLocaleString()} instant</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Net Advantage</div>
      <div class="text-lg font-bold mono leading-tight" style="color:${Math.max(d.reprocessedSellOrders, d.reprocessedInstant) - Math.max(d.directSellOrders, d.directInstant) >= 0 ? 'var(--green)' : 'var(--red)'};">${Math.round(Math.max(d.reprocessedSellOrders, d.reprocessedInstant) - Math.max(d.directSellOrders, d.directInstant)).toLocaleString()} ISK</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">reprocessing vs. direct sell</div>
    </div>
  `;
}

function renderReprocessingYieldTable(rows) {
  const container = document.getElementById('reprocessing-yield-table');
  if (!container) return;
  container.innerHTML = `
    <table class="lp-table text-xs mono">
      <thead>
        <tr>
          <th>Material</th>
          <th class="text-right">Yield Qty</th>
          <th class="text-right">Sell (ea)</th>
          <th class="text-right">Buy (ea)</th>
          <th class="text-right">Total (Sell Order)</th>
          <th class="text-right">Total (Instant)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="flex items-center gap-2">
              <img src="${window.getItemIconUrl(r.typeId, r.name, 24)}" class="w-4 h-4 rounded flex-shrink-0" loading="lazy">
              <span style="color:var(--text);">${window.esc(r.name)}</span>${window.estimatedPriceMarker(r.typeId)}
            </td>
            <td class="text-right" style="color:var(--text);">${r.yieldQty.toLocaleString()}</td>
            <td class="text-right" style="color:var(--text-soft);">${Math.round(r.sell).toLocaleString()}</td>
            <td class="text-right" style="color:var(--text-soft);">${Math.round(r.buy).toLocaleString()}</td>
            <td class="text-right font-bold" style="color:var(--accent);">${Math.round(r.totalSell).toLocaleString()}</td>
            <td class="text-right font-bold" style="color:var(--text);">${Math.round(r.totalBuy).toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.onload = async () => {
  if (typeof window.buildPrepackedIndexes === 'function') {
    window.buildPrepackedIndexes();
  }
  loadSharedReprocessingTaxSettings();
  try {
    await restoreReprocessingState();
  } catch (e) {
    console.warn('[Reprocessing] Failed to restore previous session state:', e);
  }
  if (typeof window.handleEsiSSOCallback === 'function') {
    try { await window.handleEsiSSOCallback(); } catch (e) { console.error('SSO callback error:', e); }
  }
  if (typeof window.fetchAdjustedPrices === 'function') {
    try { await window.fetchAdjustedPrices(); } catch (e) { console.warn('[Reprocessing] Adjusted prices fetch error:', e); }
  }
  if (_reprocessingSelectedTypeId) {
    recalculateReprocessingImpl();
  }
};
