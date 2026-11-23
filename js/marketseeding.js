// =================================================================================================
// Market Seeding - finds EVE systems with heavy player traffic (mission hubs or PvP hubs, INFERRED
// from public jump/kill activity, never a certain label - see classifySystem below) where current
// market supply looks thin relative to how much actually trades there. Direct request: "I want the
// tool to scan for what items are listed there and what sells in bigger numbers" - no hand-picked
// item list, no tie-in to this site's own Ledger/build history. The item shortlist for every region
// is discovered organically from that region's own real order book (see analyzeRegionListings) and
// real trade history (see computeGapScoresForRegion), nothing pre-selected by category or by what
// this tool's own user happens to build.
// =================================================================================================

// The 5 deep-liquidity trade-hub regions (same ones backing DEFAULT_TRADE_HUB_NAMES in js/config.js) -
// excluded from scanning by default. Their order books run into the hundreds of thousands of orders,
// and being deep-liquidity by construction, they're close to the opposite of a seeding opportunity.
// Toggleable, not a hard removal - someone might specifically want a hidden gap inside an otherwise-
// liquid region.
const MAJOR_TRADE_HUB_REGION_IDS = new Set([
  10000002, // The Forge (Jita)
  10000043, // Domain (Amarr)
  10000032, // Sinq Laison (Dodixie)
  10000030, // Heimatar (Rens)
  10000042  // Metropolis (Hek)
]);

const SYSTEM_REGION_CACHE_KEY = 'eve_system_region_cache_v1'; // permanent - a system's region/security never changes
const SCAN_RESULT_KEY = 'eve_market_seeding_results_v1'; // bump to _v2 only if the gap-score formula itself changes, same convention BLUEPRINT_PROFIT_CACHE_KEY (js/app.js) already uses

let _seedScanResult = null; // { scannedAt, candidates: [...], regions: { [regionId]: { topItems, gapsBySystem } } }
let _seedSelectedSystemId = null;
let _seedSystemSortKey = 'activity';
let _seedSystemSortDir = -1;
let _seedItemSortKey = 'gapScore';
let _seedItemSortDir = -1;
let _seedRegionNames = {}; // regionId -> name, populated via window.fetchRegionName (esi.js keeps its own cache privately, not on window) so rendering can read names synchronously

// Same shape/behavior as js/app.js's own formatScanAge - duplicated locally rather than depending on
// app.js, since this page deliberately doesn't load it (no recipe-tree/BOM dependency at all).
function formatScanAge(scannedAt) {
  if (!scannedAt) return 'never';
  const seconds = Math.max(0, (Date.now() - scannedAt) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function loadSystemRegionCache() {
  return window.safeParseJSON(localStorage.getItem(SYSTEM_REGION_CACHE_KEY), {});
}
function saveSystemRegionCache(cache) {
  try { localStorage.setItem(SYSTEM_REGION_CACHE_KEY, JSON.stringify(cache)); }
  catch (e) { console.warn('[MarketSeeding] Failed to persist system-region cache:', e); }
}

// --- Phase 1: candidate system selection ------------------------------------------------------

// A system is eligible if EITHER signal clears its own floor - OR'd, not blended into one score, so
// neither archetype gets wrongly excluded: jumps alone catches busy transit/mission systems even with
// modest kill counts, the kill floor alone catches concentrated PvP camps or farmed mission pockets
// that may not show huge transit numbers.
const ELIGIBLE_JUMPS_FLOOR = 200;
const ELIGIBLE_KILLS_FLOOR = 10;
const CANDIDATE_LIST_SIZE = 15; // top-N per archetype, before dedup

function classifySystem(c) {
  const pvpKills = c.shipKills + c.podKills;
  if (c.npcKills >= 3 * pvpKills) return 'Mission Hub';
  if (pvpKills >= 2 * c.npcKills && pvpKills > 0) return 'PvP Hub';
  return 'Mixed / Uncertain';
}

async function selectCandidateSystems() {
  const [jumpsRaw, killsRaw] = await Promise.all([window.fetchSystemJumps(), window.fetchSystemKills()]);
  if (!jumpsRaw && !killsRaw) return [];

  const jumpsBySystem = {};
  (jumpsRaw || []).forEach(row => { jumpsBySystem[row.system_id] = row.ship_jumps || 0; });
  const killsBySystem = {};
  (killsRaw || []).forEach(row => { killsBySystem[row.system_id] = row; });

  const allSystemIds = new Set([...Object.keys(jumpsBySystem), ...Object.keys(killsBySystem)].map(Number));
  const activity = [];
  allSystemIds.forEach(systemId => {
    const jumps = jumpsBySystem[systemId] || 0;
    const k = killsBySystem[systemId] || {};
    const shipKills = k.ship_kills || 0;
    const podKills = k.pod_kills || 0;
    const npcKills = k.npc_kills || 0;
    if (jumps < ELIGIBLE_JUMPS_FLOOR && (shipKills + podKills + npcKills) < ELIGIBLE_KILLS_FLOOR) return;
    activity.push({ systemId, jumps, shipKills, podKills, npcKills });
  });

  const byMissionSignal = [...activity].sort((a, b) => b.npcKills - a.npcKills).slice(0, CANDIDATE_LIST_SIZE);
  const byPvpSignal = [...activity].sort((a, b) => (b.shipKills + b.podKills) - (a.shipKills + a.podKills)).slice(0, CANDIDATE_LIST_SIZE);

  const dedup = new Map();
  [...byMissionSignal, ...byPvpSignal].forEach(c => { if (!dedup.has(c.systemId)) dedup.set(c.systemId, c); });

  return Array.from(dedup.values()).map(c => ({
    ...c,
    systemName: (window.systemNameCache && window.systemNameCache[c.systemId]) || `System ${c.systemId}`,
    classification: classifySystem(c)
  }));
}

// --- Phase 2: region resolution + dedup + capping ----------------------------------------------

const REGION_CAP = 12;

async function resolveCandidateRegions(candidates) {
  const cache = loadSystemRegionCache();
  await Promise.all(candidates.map(async (c) => {
    let info = cache[c.systemId];
    if (info === undefined) {
      info = await window.resolveSystemRegionAndSecurity(c.systemId);
      cache[c.systemId] = info;
    }
    c.regionId = info ? info.regionId : null;
    c.securityStatus = info ? info.securityStatus : null;
  }));
  saveSystemRegionCache(cache);
  return candidates.filter(c => c.regionId !== null);
}

function groupCandidatesByRegion(candidates, includeMajorHubs) {
  const byRegion = new Map();
  candidates.forEach(c => {
    if (!includeMajorHubs && MAJOR_TRADE_HUB_REGION_IDS.has(c.regionId)) return;
    if (!byRegion.has(c.regionId)) byRegion.set(c.regionId, []);
    byRegion.get(c.regionId).push(c);
  });

  // Cap to the busiest REGION_CAP regions (by summed activity of their own candidate systems) - a
  // coarse prioritization, not meant to be a precise score, just a way to bound the expensive Stage
  // A/B work below when candidates happen to spread across more regions than that.
  const regionScore = (systems) => systems.reduce((s, c) => s + c.jumps + c.npcKills + c.shipKills + c.podKills, 0);
  const rankedRegionIds = Array.from(byRegion.keys()).sort((a, b) => regionScore(byRegion.get(b)) - regionScore(byRegion.get(a)));
  const cappedRegionIds = rankedRegionIds.slice(0, REGION_CAP);

  const result = new Map();
  cappedRegionIds.forEach(id => result.set(id, byRegion.get(id)));
  return result;
}

// --- Phase 3: Stage A - organic item discovery from each region's real order book ---------------

// EVE's market has zero validation on listed price - confirmed live during testing that a handful of
// junk/troll orders (an "Avalanche Blueprint" listed 12 times at a uniform, clearly-fake 2 BILLION ISK
// each, in bulk quantity) can otherwise dominate an ISK-value ranking despite having zero real trading
// interest, crowding every genuinely-traded item in a region out of the top-N entirely - which is also
// why NOTHING was surviving Stage B's liquidity floor: the "top" items Stage A picked were never
// actually traded by anyone. Cross-checked against Fuzzwork's real aggregate price (the same source
// fetchMarketPrices already uses elsewhere in this app) - an order priced wildly outside a sane band
// around that reference isn't real supply, so it's excluded from BOTH the ranking metric and the final
// per-item totals, not just hidden from display. No independent reference available (fetch failed, or
// only an EIV estimate) means there's nothing reliable to second-guess the order against, so it's left
// alone rather than risk excluding something genuine.
const SANE_PRICE_BAND_LOW = 0.05;
const SANE_PRICE_BAND_HIGH = 20;
function isSanePrice(typeId, price) {
  const ref = window.priceCache && window.priceCache[typeId];
  if (!ref || ref.isEstimated || (!ref.sell && !ref.buy)) return true;
  const refPrice = ref.sell || ref.buy;
  return price >= refPrice * SANE_PRICE_BAND_LOW && price <= refPrice * SANE_PRICE_BAND_HIGH;
}

// Ranking by listed ISK value/quantity is a first PASS, not the final word - even with the price
// sanity check above, a handful of DIFFERENT bulk-listed items (several distinct "Blueprint" types,
// each individually passing the price check since their own Fuzzwork reference happened to agree with
// the listing) can still fill every slot of a narrow top-N before Stage B ever gets to check whether
// anyone actually trades them. So Stage A keeps a much WIDER candidate set than what's ever displayed -
// Stage B's liquidity floor (real trade history, not listed price) is what actually decides which of
// these survive; only the survivors get trimmed down to itemsPerRegion for final display, in
// computeGapScoresForRegion below. 4x the display count, floored at 40, so a small itemsPerRegion
// setting doesn't shrink the candidate pool Stage B checks below a sane minimum.
function candidatePoolSize(itemsPerRegion) {
  return Math.max(itemsPerRegion * 4, 40);
}

async function analyzeRegionListings(regionId, itemsPerRegion, rankBy) {
  const { orders, truncated } = await window.fetchRegionOrders(regionId, 20);
  const sellOrders = orders.filter(o => o && !o.is_buy_order);

  const distinctTypeIds = Array.from(new Set(sellOrders.map(o => o.type_id)));
  if (typeof window.fetchMarketPrices === 'function' && distinctTypeIds.length) {
    await window.fetchMarketPrices(distinctTypeIds);
  }

  const byType = new Map();
  sellOrders.forEach(o => {
    if (!isSanePrice(o.type_id, o.price)) return;
    if (!byType.has(o.type_id)) byType.set(o.type_id, { typeId: o.type_id, totalQty: 0, totalIskValue: 0, orders: [] });
    const entry = byType.get(o.type_id);
    entry.totalQty += o.volume_remain;
    entry.totalIskValue += o.volume_remain * o.price;
    entry.orders.push(o);
  });

  const ranked = Array.from(byType.values()).sort((a, b) =>
    rankBy === 'qty' ? b.totalQty - a.totalQty : b.totalIskValue - a.totalIskValue
  );
  // See candidatePoolSize's own comment - deliberately wider than itemsPerRegion; computeGapScoresForRegion
  // applies the real liquidity filter and trims to itemsPerRegion afterward, not here.
  return { regionId, topItems: ranked.slice(0, candidatePoolSize(itemsPerRegion)), truncated };
}

// --- Phase 4: Stage B - demand (region history) vs. supply (this system's current listings) -----

const LIQUIDITY_FLOOR = 5; // discard items nobody actually trades region-wide - a "gap" there is noise, not opportunity

async function computeGapScoresForRegion(regionAnalysis, candidateSystemsInRegion, itemsPerRegion) {
  const gapsBySystem = {};
  candidateSystemsInRegion.forEach(c => { gapsBySystem[c.systemId] = []; });

  await Promise.all(regionAnalysis.topItems.map(async (item) => {
    const historyRows = await window.fetchMarketHistoryRaw(regionAnalysis.regionId, item.typeId);
    const recent = Array.isArray(historyRows) ? historyRows.slice(-7) : [];
    if (!recent.length) return;
    const avg7dVolume = recent.reduce((s, d) => s + (d.volume || 0), 0) / recent.length;
    if (avg7dVolume < LIQUIDITY_FLOOR) return;

    candidateSystemsInRegion.forEach(c => {
      const localQty = item.orders.filter(o => o.system_id === c.systemId).reduce((s, o) => s + o.volume_remain, 0);
      // Higher = thinner local supply relative to real regional trade pace = better opportunity. +1
      // avoids divide-by-zero and correctly maximizes the score for "actively traded, nothing
      // currently listed here" - the clearest possible seeding signal.
      const gapScore = avg7dVolume / (localQty + 1);
      const presenceRatio = item.totalQty > 0 ? localQty / item.totalQty : 0;
      gapsBySystem[c.systemId].push({
        typeId: item.typeId,
        name: (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[item.typeId]) || `Type ${item.typeId}`,
        localQty, avg7dVolume, gapScore, iskValue: item.totalIskValue, presenceRatio
      });
    });
  }));

  // NOW trim to the display count, per system, by gap score - this is the real cut, applied after the
  // liquidity floor has already thrown out anything nobody actually trades (see candidatePoolSize's
  // own comment for why Stage A deliberately over-fetched candidates for this to filter down from).
  Object.keys(gapsBySystem).forEach(systemId => {
    gapsBySystem[systemId] = gapsBySystem[systemId]
      .sort((a, b) => b.gapScore - a.gapScore)
      .slice(0, itemsPerRegion);
  });

  return gapsBySystem;
}

// --- Orchestration --------------------------------------------------------------------------------

async function runMarketSeedingScan() {
  const btn = document.getElementById('seed-scan-btn');
  const setLabel = (text) => { if (btn) btn.innerHTML = window.svgIcon('hourglass') + ' ' + text; };
  if (btn) btn.disabled = true;

  try {
    setLabel('Fetching system activity...');
    const rawCandidates = await selectCandidateSystems();
    if (!rawCandidates.length) {
      if (typeof window.showToast === 'function') window.showToast('No systems cleared the activity threshold right now - try again later, ESI activity data updates hourly.', 'info');
      return;
    }

    setLabel(`Resolving regions (0/${rawCandidates.length})...`);
    const candidates = await resolveCandidateRegions(rawCandidates);

    const includeMajorHubs = document.getElementById('seed-include-hubs')?.checked || false;
    const itemsPerRegion = Math.max(10, Math.min(30, parseInt(document.getElementById('seed-items-per-region')?.value, 10) || 15));
    const rankBy = document.getElementById('seed-rank-by-qty')?.checked ? 'qty' : 'iskValue';

    const regionGroups = groupCandidatesByRegion(candidates, includeMajorHubs);
    const regionIds = Array.from(regionGroups.keys());

    await Promise.all(regionIds.map(async (regionId) => {
      if (_seedRegionNames[regionId] !== undefined) return;
      _seedRegionNames[regionId] = await window.fetchRegionName(regionId);
    }));

    const regions = {};
    let done = 0;
    for (const regionId of regionIds) {
      setLabel(`Fetching region order books (${done}/${regionIds.length})...`);
      const analysis = await analyzeRegionListings(regionId, itemsPerRegion, rankBy);
      setLabel(`Analyzing items (${done + 1}/${regionIds.length})...`);
      const gapsBySystem = await computeGapScoresForRegion(analysis, regionGroups.get(regionId), itemsPerRegion);
      regions[regionId] = { topItems: analysis.topItems, truncated: analysis.truncated, gapsBySystem };
      done++;
    }

    const scannedRegionSystemIds = new Set();
    regionIds.forEach(id => regionGroups.get(id).forEach(c => scannedRegionSystemIds.add(c.systemId)));

    _seedScanResult = {
      scannedAt: Date.now(),
      candidates: candidates.filter(c => scannedRegionSystemIds.has(c.systemId)),
      regions,
      regionNames: _seedRegionNames,
      itemsPerRegion,
      rankBy
    };
    saveSeedScanResult();
    _seedSelectedSystemId = _seedScanResult.candidates[0]?.systemId || null;
    renderMarketSeedingResults();

    if (typeof window.showToast === 'function') {
      window.showToast(`Scanned ${regionIds.length} region${regionIds.length === 1 ? '' : 's'} across ${_seedScanResult.candidates.length} candidate system${_seedScanResult.candidates.length === 1 ? '' : 's'}.`, 'success');
    }
  } catch (e) {
    console.error('[MarketSeeding] Scan failed:', e);
    if (typeof window.showToast === 'function') window.showToast('Market Seeding scan failed - check the console for details.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = window.svgIcon('chart') + ' Run Scan'; }
  }
}
window.runMarketSeedingScan = window.runMarketSeedingScan || runMarketSeedingScan;

function saveSeedScanResult() {
  try { localStorage.setItem(SCAN_RESULT_KEY, JSON.stringify(_seedScanResult)); }
  catch (e) { console.warn('[MarketSeeding] Failed to persist scan result (localStorage may be full):', e); }
}
function loadSeedScanResult() {
  return window.safeParseJSON(localStorage.getItem(SCAN_RESULT_KEY), null);
}

// --- Rendering --------------------------------------------------------------------------------

function setSeedSystemSort(key) {
  if (_seedSystemSortKey === key) _seedSystemSortDir *= -1;
  else { _seedSystemSortKey = key; _seedSystemSortDir = -1; }
  renderMarketSeedingResults();
}
window.setSeedSystemSort = setSeedSystemSort;

function setSeedItemSort(key) {
  if (_seedItemSortKey === key) _seedItemSortDir *= -1;
  else { _seedItemSortKey = key; _seedItemSortDir = -1; }
  renderMarketSeedingResults();
}
window.setSeedItemSort = setSeedItemSort;

function selectSeedSystem(systemId) {
  _seedSelectedSystemId = systemId;
  renderMarketSeedingResults();
  const panel = document.getElementById('seed-item-panel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window.selectSeedSystem = selectSeedSystem;

function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * ((bv || 0) - (av || 0));
  });
}

function securityBadgeHTML(sec) {
  if (sec === null || sec === undefined) return '<span style="color:var(--text-mute);">?</span>';
  const rounded = Math.round(sec * 10) / 10;
  const color = sec >= 0.5 ? 'var(--green)' : sec > 0.0 ? 'var(--accent)' : '#e85555';
  return `<span class="mono font-bold" style="color:${color};">${rounded.toFixed(1)}</span>`;
}

function classificationBadgeHTML(cls) {
  const styles = {
    'Mission Hub': { icon: 'award', color: 'var(--accent)' },
    'PvP Hub': { icon: 'zap', color: '#e85555' },
    'Mixed / Uncertain': { icon: 'eye', color: 'var(--text-mute)' }
  };
  const s = styles[cls] || styles['Mixed / Uncertain'];
  return `<span class="lp-badge" style="color:${s.color};" title="Inferred from public jump/kill activity - not a confirmed label.">${window.svgIcon(s.icon)} ${cls}</span>`;
}

function securityFilterPasses(sec, band) {
  if (band === 'all') return true;
  if (sec === null || sec === undefined) return band === 'null';
  if (band === 'high') return sec >= 0.5;
  if (band === 'low') return sec > 0.0 && sec < 0.5;
  if (band === 'null') return sec <= 0.0;
  return true;
}

function renderMarketSeedingResults() {
  const lastScannedEl = document.getElementById('seed-last-scanned');
  const emptyEl = document.getElementById('seed-empty-state');
  const resultsEl = document.getElementById('seed-results-area');
  if (!_seedScanResult) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (resultsEl) resultsEl.classList.add('hidden');
    if (lastScannedEl) lastScannedEl.textContent = 'Never scanned';
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');
  if (resultsEl) resultsEl.classList.remove('hidden');
  if (lastScannedEl) lastScannedEl.textContent = `Last scanned ${formatScanAge(_seedScanResult.scannedAt)}`;

  const activeBand = document.querySelector('#seed-security-chips .lp-pill.active')?.dataset.band || 'all';
  const filtered = _seedScanResult.candidates.filter(c => securityFilterPasses(c.securityStatus, activeBand));
  const rowsWithScore = filtered.map(c => ({ ...c, activity: c.jumps + c.npcKills * 5 + (c.shipKills + c.podKills) * 5 }));
  const sortedSystems = sortRows(rowsWithScore, _seedSystemSortKey, _seedSystemSortDir);

  const systemsTableEl = document.getElementById('seed-systems-table');
  if (systemsTableEl) {
    const sortHeader = (key, label) => `<th class="sortable" onclick="setSeedSystemSort('${key}')">${window.esc(label)}${_seedSystemSortKey === key ? (' ' + window.svgIcon(_seedSystemSortDir === 1 ? 'chevron-up' : 'chevron-down')) : ''}</th>`;
    systemsTableEl.innerHTML = `
      <table class="lp-table">
        <thead><tr>
          <th>System</th><th>Security</th><th>Classification</th><th>Region</th>
          ${sortHeader('npcKills', 'NPC Kills/h')}${sortHeader('shipKills', 'PvP Kills/h')}${sortHeader('jumps', 'Jumps/h (context)')}
        </tr></thead>
        <tbody>
          ${sortedSystems.length ? sortedSystems.map(c => `
            <tr onclick="selectSeedSystem(${c.systemId})" style="cursor:pointer;${c.systemId === _seedSelectedSystemId ? ' background:rgba(var(--accent-rgb),0.08);' : ''}">
              <td class="font-bold">${window.esc(c.systemName)}</td>
              <td>${securityBadgeHTML(c.securityStatus)}</td>
              <td>${classificationBadgeHTML(c.classification)}</td>
              <td class="mono text-xs" style="color:var(--text-mute);">${window.esc(_seedRegionNames[c.regionId] || String(c.regionId))}</td>
              <td class="mono">${c.npcKills.toLocaleString()}</td>
              <td class="mono">${(c.shipKills + c.podKills).toLocaleString()}</td>
              <td class="mono" style="color:var(--text-mute);">${c.jumps.toLocaleString()}</td>
            </tr>
          `).join('') : `<tr><td colspan="7" class="text-center italic" style="color:var(--text-mute);">No candidate systems match the current security filter.</td></tr>`}
        </tbody>
      </table>
    `;
  }

  renderSeedItemPanel();
}

function renderSeedItemPanel() {
  const panel = document.getElementById('seed-item-panel');
  if (!panel || !_seedScanResult) return;
  const system = _seedScanResult.candidates.find(c => c.systemId === _seedSelectedSystemId);
  if (!system) { panel.innerHTML = `<div class="italic" style="color:var(--text-mute);">Select a system above to see its item gaps.</div>`; return; }

  const region = _seedScanResult.regions[system.regionId];
  const gaps = (region && region.gapsBySystem[system.systemId]) || [];
  const sorted = sortRows(gaps, _seedItemSortKey, _seedItemSortDir);
  const sortHeader = (key, label) => `<th class="sortable" onclick="setSeedItemSort('${key}')">${window.esc(label)}${_seedItemSortKey === key ? (' ' + window.svgIcon(_seedItemSortDir === 1 ? 'chevron-up' : 'chevron-down')) : ''}</th>`;

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-bold text-sm" style="color:var(--text);">${window.esc(system.systemName)} - item gaps</h3>
      <span class="text-xs" style="color:var(--text-mute);">Ranked by ${_seedScanResult.rankBy === 'qty' ? 'listed quantity' : 'listed ISK value'} within the region, top ${_seedScanResult.itemsPerRegion}${region && region.truncated ? ' (region order book was larger than this scan\'s page cap - results may miss some listings)' : ''}</span>
    </div>
    <table class="lp-table">
      <thead><tr>
        <th>Item</th>
        ${sortHeader('localQty', 'Listed Here')}
        ${sortHeader('avg7dVolume', '7d Avg Regional Volume')}
        ${sortHeader('gapScore', 'Gap Score')}
        ${sortHeader('iskValue', 'Listed ISK Value')}
        ${sortHeader('presenceRatio', '% of Region Here')}
      </tr></thead>
      <tbody>
        ${sorted.length ? sorted.map(g => `
          <tr>
            <td class="flex items-center gap-1.5">
              <img src="https://images.evetech.net/types/${g.typeId}/icon?size=32" alt="" class="w-5 h-5 rounded flex-shrink-0" loading="lazy" onerror="this.style.visibility='hidden';">
              <span class="copy-name" data-copy-name="${window.esc(g.name)}" onclick="copyNameToClipboard && copyNameToClipboard(event)" title="${window.esc(g.name)}">${window.esc(g.name)}</span>
            </td>
            <td class="mono">${g.localQty.toLocaleString()}</td>
            <td class="mono">${Math.round(g.avg7dVolume).toLocaleString()}</td>
            <td class="mono font-bold" style="color:var(--accent);">${g.gapScore.toFixed(1)}</td>
            <td class="mono">${window.formatISKCompact ? window.formatISKCompact(g.iskValue) : Math.round(g.iskValue).toLocaleString() + ' ISK'}</td>
            <td class="mono" style="color:var(--text-mute);">${Math.round(g.presenceRatio * 100)}%</td>
          </tr>
        `).join('') : `<tr><td colspan="6" class="text-center italic" style="color:var(--text-mute);">No items cleared the liquidity floor for this region.</td></tr>`}
      </tbody>
    </table>
  `;
}

function setSeedSecurityBand(el, band) {
  document.querySelectorAll('#seed-security-chips .lp-pill').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderMarketSeedingResults();
}
window.setSeedSecurityBand = setSeedSecurityBand;

// --- Init -----------------------------------------------------------------------------------------

window.addEventListener('load', () => {
  if (typeof window.buildPrepackedIndexes === 'function') window.buildPrepackedIndexes();
  _seedScanResult = loadSeedScanResult();
  if (_seedScanResult) {
    _seedRegionNames = _seedScanResult.regionNames || {};
    _seedSelectedSystemId = _seedScanResult.candidates[0]?.systemId || null;
  }
  renderMarketSeedingResults();
  if (typeof window.handleEsiSSOCallback === 'function') window.handleEsiSSOCallback();
});
