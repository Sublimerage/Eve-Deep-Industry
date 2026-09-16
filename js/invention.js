// --- Invention Calculator ---
// Formula and decryptor stats confirmed against EVE University's Invention page (verified current
// as of this writing): success chance = base × (1 + (sci1+sci2)/30 + encryption/40) × (1 + decryptor
// probability modifier/100). Base T2 BPC outcome (before decryptor modifiers) is always +2% ME, +4%
// TE, and 10 runs for most items or 1 run for ships/rigs.
const DECRYPTORS = [
  { name: 'No Decryptor', probMod: 0, runsMod: 0, meMod: 0, teMod: 0 },
  { name: 'Accelerant Decryptor', probMod: 20, runsMod: 1, meMod: 2, teMod: 10 },
  { name: 'Attainment Decryptor', probMod: 80, runsMod: 4, meMod: -1, teMod: 4 },
  { name: 'Augmentation Decryptor', probMod: -40, runsMod: 9, meMod: -2, teMod: 2 },
  { name: 'Optimized Attainment Decryptor', probMod: 90, runsMod: 2, meMod: 1, teMod: -2 },
  { name: 'Optimized Augmentation Decryptor', probMod: -10, runsMod: 7, meMod: 2, teMod: 0 },
  { name: 'Parity Decryptor', probMod: 50, runsMod: 3, meMod: 1, teMod: -2 },
  { name: 'Process Decryptor', probMod: 10, runsMod: 0, meMod: 3, teMod: 6 },
  { name: 'Symmetry Decryptor', probMod: 0, runsMod: 2, meMod: 1, teMod: 8 }
];

let _inventionCurrentBlueprint = null; // the T1 blueprint recipe object
let _inventionCurrentProduct = null;   // the T2 product being searched/selected

// --- Reverse index: T2 product -> T1 source recipe ---
// Built once, lazily, from the same recipeMap data already loaded. Only items with BOTH invention
// materials and a confirmed T2 product get indexed, so anything found via this map is guaranteed to
// have complete data - no more "found it, but missing product data" dead ends.
let _inventionT2ToT1Map = null;
function getInventionT2ToT1Map() {
  if (_inventionT2ToT1Map) return _inventionT2ToT1Map;
  const map = {};
  const seenBlueprintIds = new Set();
  for (const recipe of Object.values(window.recipeMap || {})) {
    if (!recipe || seenBlueprintIds.has(recipe.blueprintTypeID)) continue;
    seenBlueprintIds.add(recipe.blueprintTypeID);
    if (recipe.inventionMaterials && recipe.inventionMaterials.length > 0 && recipe.inventionProducts && recipe.inventionProducts.length > 0) {
      recipe.inventionProducts.forEach(p => {
        if (p && p.typeId) map[p.typeId] = recipe;
      });
    }
  }
  _inventionT2ToT1Map = map;
  console.info(`[Invention] Built T2->T1 reverse index: ${Object.keys(map).length} inventable T2 products found.`);
  return map;
}

// --- Search (searches the T2 product you want, not the T1 BPC you'd use) ---
let _inventionSearchToken = 0;
let _inventionLastSearchHits = [];

function searchInventionItem(query) {
  const resultsEl = document.getElementById('invention-search-results');
  if (!resultsEl) return;
  const token = ++_inventionSearchToken;
  const q = (query || '').toLowerCase().trim();
  if (q.length < 2) {
    resultsEl.classList.add('hidden');
    return;
  }
  const t2Map = getInventionT2ToT1Map();
  const hits = [];
  for (const t2IdStr of Object.keys(t2Map)) {
    const t2Id = parseInt(t2IdStr);
    const name = (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[t2Id]) || (window.EVE_ITEMS && window.EVE_ITEMS[t2Id]);
    if (name && name.toLowerCase().includes(q)) {
      hits.push({ id: t2Id, name: name });
    }
    if (hits.length >= 15) break;
  }
  if (token !== _inventionSearchToken) return;
  _inventionLastSearchHits = hits;
  if (hits.length === 0) {
    resultsEl.innerHTML = `<div class="p-3 text-slate-400 text-xs italic">No inventable Tech II items found matching "${window.esc(q)}". Search the T2 item you want to produce (e.g. "Wolf"), not the T1 item it's invented from.</div>`;
    resultsEl.classList.remove('hidden');
    return;
  }
  renderInventionSearchResults(hits);
}
window.searchInventionItem = searchInventionItem;

function renderInventionSearchResults(hits, profitById) {
  const resultsEl = document.getElementById('invention-search-results');
  if (!resultsEl) return;
  const sortBtn = hits.length > 1 ? `
    <div class="lp-list-item" style="justify-content:space-between;">
      <span class="text-xs" style="color:var(--text-mute);">${hits.length} match${hits.length > 1 ? 'es' : ''}</span>
      <button onmousedown="sortInventionSearchResultsByProfit()" class="lp-chip-btn"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="4" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="20" y1="20" x2="20" y2="14"/></svg>Sort by Profit</button>
    </div>
  ` : '';
  resultsEl.innerHTML = sortBtn + hits.map(h => {
    const profit = profitById && profitById[h.id] !== undefined ? profitById[h.id] : null;
    const profitBadge = profit !== null
      ? `<span class="ml-auto text-xs font-bold flex-shrink-0" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};">${Math.round(profit).toLocaleString()} ISK</span>`
      : '';
    return `
    <div class="lp-list-item" onmousedown="selectInventionItem(${h.id}, '${window.esc(h.name)}')">
      <img src="https://images.evetech.net/types/${h.id}/icon?size=32" alt="${window.esc(h.name)}" class="w-6 h-6 rounded flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${h.id}/render?size=32';">
      <span class="font-semibold truncate" style="color:var(--text);">${window.esc(h.name)}</span>
      ${profitBadge}
    </div>
  `; }).join('');
  resultsEl.classList.remove('hidden');
}

// Computes each current search result's best-decryptor Total Potential Profit on demand (bounded to
// whatever's currently shown, not a scan of the whole database - see the earlier "margin finder"
// discussion for why scanning everything isn't practical) and re-sorts the list by it.
async function sortInventionSearchResultsByProfit() {
  const resultsEl = document.getElementById('invention-search-results');
  if (!resultsEl || _inventionLastSearchHits.length === 0) return;
  resultsEl.innerHTML = `<div class="p-3 text-slate-400 text-xs italic">Computing profit for ${_inventionLastSearchHits.length} item(s)...</div>`;

  const profitById = {};
  for (const hit of _inventionLastSearchHits) {
    try {
      const profit = await computeQuickBestInventionProfit(hit.id);
      profitById[hit.id] = profit;
    } catch (e) {
      console.warn(`[Invention] Quick profit calc failed for ${hit.name}:`, e);
      profitById[hit.id] = null;
    }
  }

  const sortedHits = [..._inventionLastSearchHits].sort((a, b) => {
    const pa = profitById[a.id] === null || profitById[a.id] === undefined ? -Infinity : profitById[a.id];
    const pb = profitById[b.id] === null || profitById[b.id] === undefined ? -Infinity : profitById[b.id];
    return pb - pa;
  });
  renderInventionSearchResults(sortedHits, profitById);
}
window.sortInventionSearchResultsByProfit = sortInventionSearchResultsByProfit;

// A lighter-weight version of the full comparison: just finds the best decryptor's Total Potential
// Profit for one item, using default skill levels (0, or your real ones if logged in via ESI) and 1
// BPC run, for ranking search results. Does NOT touch the currently-selected item's own state.
async function computeQuickBestInventionProfit(t2ProductTypeId) {
  const t2Map = getInventionT2ToT1Map();
  const recipe = t2Map[t2ProductTypeId]; // the T1 source recipe for this T2 product
  if (!recipe) return null;

  const t2Recipe = window.recipeMap && window.recipeMap[t2ProductTypeId];
  const t2BlueprintTypeId = t2Recipe ? t2Recipe.blueprintTypeID : null;
  if (!t2BlueprintTypeId) return null;

  const baseChance = getInventionBaseChance(t2ProductTypeId);
  const charSkills = window.safeParseJSON(localStorage.getItem('eve_char_skills'), { allSkills: {} });
  let encryptionLevel = 0;
  let scienceLevelSum = 0;
  (recipe.inventionSkills || []).forEach(sk => {
    const level = (charSkills.allSkills && charSkills.allSkills[sk.skillId] !== undefined) ? charSkills.allSkills[sk.skillId] : 0;
    if ((sk.name || '').toLowerCase().includes('encryption')) encryptionLevel = level;
    else scienceLevelSum += level;
  });

  const datacores = recipe.inventionMaterials || [];
  if (typeof window.fetchMarketPrices === 'function') {
    await window.fetchMarketPrices(datacores.map(m => m.typeId));
  }
  const datacoreCost = datacores.reduce((sum, m) => sum + (getInventionInputPrice(m.typeId) * m.qty), 0);

  const productGroupName = ((window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[t2ProductTypeId]) || '').toLowerCase();
  const categoryId = window.EVE_CATEGORIES && window.EVE_CATEGORIES[t2ProductTypeId];
  const isShipOrRig = categoryId === 6 || productGroupName.includes('rig');
  const baseRuns = isShipOrRig ? 1 : 10;

  const decryptorTypeIds = DECRYPTORS.map(d => window.IDX && window.IDX[d.name.toLowerCase()] && window.IDX[d.name.toLowerCase()].id).filter(id => id);
  if (typeof window.fetchMarketPrices === 'function') await window.fetchMarketPrices(decryptorTypeIds);

  let bestProfit = -Infinity;
  for (const dec of DECRYPTORS) {
    const successChance = Math.min(100, baseChance * (1 + (scienceLevelSum / 30) + (encryptionLevel / 40)) * (1 + dec.probMod / 100));
    const resultRuns = Math.max(1, baseRuns + dec.runsMod);
    const resultME = 2 + dec.meMod;
    const resultTE = 4 + dec.teMod;
    const decEntry = window.IDX && window.IDX[dec.name.toLowerCase()];
    const decCost = (dec.name !== 'No Decryptor' && decEntry) ? getInventionInputPrice(decEntry.id) : 0;
    const costPerAttempt = datacoreCost + decCost;

    let bpcValue = 0;
    try {
      window.customMEOverrides = window.customMEOverrides || {};
      window.customTEOverrides = window.customTEOverrides || {};
      window.customMEOverrides[t2BlueprintTypeId] = resultME;
      window.customTEOverrides[t2BlueprintTypeId] = resultTE;
      window.recipeTreeRootProductTypeId = t2ProductTypeId;
      const root = await window.buildRecursiveRecipeTree(parseInt(t2BlueprintTypeId), t2Recipe.productName + ' Blueprint', resultRuns, 0, 6, new Set(), null);
      window.recipeTreeRootProductTypeId = null;
      if (root) {
        root.runsNeeded = resultRuns;
        root.qtyNeeded = resultRuns * (root.batchYield || 1);
        const facility = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
        if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(root, facility);
        const allTypeIds = new Set();
        if (typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, allTypeIds);
        if (typeof window.fetchMarketPrices === 'function') await window.fetchMarketPrices(Array.from(allTypeIds));
        const materialCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(root) : 0;
        const outputPrices = window.priceCache[t2ProductTypeId] || { sell: 0 };
        bpcValue = (outputPrices.sell * root.qtyNeeded) - materialCost;
      }
    } catch (e) { /* skip this decryptor for this item */ }

    const perAttemptProfit = (successChance / 100) * bpcValue - costPerAttempt;
    if (perAttemptProfit > bestProfit) bestProfit = perAttemptProfit;
  }
  return bestProfit === -Infinity ? null : bestProfit;
}

// --- Base chance classification ---
// Confirmed categories: modules/rigs/ammo/drones=34%, frigates/destroyers=30%,
// cruisers/battlecruisers/mining barges/haulers=26%, battleships=22%, freighters=18%.
// This is auto-classified from the item's group name; the UI lets the user override it directly
// since group-name matching can't perfectly cover every edge case, and the in-game invention window
// always shows the true value.
function getInventionBaseChance(productTypeId) {
  const groupName = ((window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[productTypeId]) || '').toLowerCase();
  const categoryId = window.EVE_CATEGORIES && window.EVE_CATEGORIES[productTypeId];
  if (groupName.includes('freighter')) return 18;
  if (groupName.includes('battleship')) return 22;
  if (groupName.includes('cruiser') || groupName.includes('battlecruiser') || groupName.includes('mining barge') || groupName.includes('hauler') || groupName.includes('industrial')) return 26;
  if (groupName.includes('frigate') || groupName.includes('destroyer')) return 30;
  if (categoryId === 6) return 26; // an unclassified ship - fall back to a mid-tier default, flagged for manual check via the editable input
  return 34; // modules, rigs, ammo, drones, and everything else
}

let _inventionSelectedTypeId = null;
let _inventionSelectedName = null;

async function selectInventionItem(typeId, name, skipSave) {
  document.getElementById('invention-item-search').value = name;
  document.getElementById('invention-search-results').classList.add('hidden');

  const t2Map = getInventionT2ToT1Map();
  const t1Recipe = t2Map[typeId];
  if (!t1Recipe) {
    if (typeof window.showToast === 'function') window.showToast('No invention data found for this item.', 'info');
    return;
  }
  _inventionCurrentBlueprint = t1Recipe;
  _inventionSelectedTypeId = typeId;
  _inventionSelectedName = name;
  // typeId/name here are exactly what was searched (the T2 product) - no guessing or override needed,
  // since anything found via the reverse index is guaranteed to have this relationship confirmed.
  _inventionCurrentProduct = { typeId: typeId, name: name, probability: 1 };

  console.info(`[Invention] Selected T2 product "${name}" (typeId=${typeId}), invented from T1 "${t1Recipe.productName}" (blueprint typeId=${t1Recipe.blueprintTypeID}).`);

  document.getElementById('invention-config-panel').classList.remove('hidden');
  const itemIconEl = document.getElementById('invention-item-icon');
  itemIconEl.src = `https://images.evetech.net/types/${typeId}/icon?size=64`;
  itemIconEl.alt = name;
  document.getElementById('invention-item-name').textContent = name;

  // The T1 BLUEPRINT is what invention actually consumes - always a copy (a BPO never gets used up
  // for invention, so /bpc is the correct icon variant here regardless of what you actually own),
  // shown by its own name so it reads as "go get this item," not just "made from this ship."
  const t1BlueprintName = window.EVE_ITEMS[t1Recipe.blueprintTypeID] || `${t1Recipe.productName || 'T1 item'} Blueprint`;
  const t1IconEl = document.getElementById('invention-t1-icon');
  t1IconEl.src = `https://images.evetech.net/types/${t1Recipe.blueprintTypeID}/bpc?size=64`;
  t1IconEl.alt = t1BlueprintName;
  document.getElementById('invention-t1-name').textContent = t1BlueprintName;

  const baseChance = getInventionBaseChance(typeId);
  document.getElementById('invention-base-chance').value = baseChance;

  renderInventionSkillInputs(t1Recipe.inventionSkills || []);
  await renderInventionDatacoreList(t1Recipe.inventionMaterials || []);

  if (!skipSave) saveInventionState();
  recalculateInventionImpl();
  // A fresh pick (not a page-load restore - see skipSave's own comment on the two call sites) always
  // takes you to Compare, since you just asked to see this item's numbers. A restore instead leaves
  // view-mode entirely to restoreInventionViewModeOnLoad() (js/invention-queue.js), which respects
  // whichever view you had open last session.
  if (!skipSave && typeof window.setInventionViewMode === 'function') window.setInventionViewMode('compare');
}
window.selectInventionItem = selectInventionItem;

function renderInventionSkillInputs(skills) {
  const container = document.getElementById('invention-skill-inputs');
  if (!container) return;
  const charSkills = window.safeParseJSON(localStorage.getItem('eve_char_skills'), { allSkills: {} });

  if (skills.length === 0) {
    container.innerHTML = `<div class="text-slate-500 italic text-sm">No skill data found for this blueprint's invention activity - try regenerating the database.</div>`;
    return;
  }

  container.innerHTML = skills.map(sk => {
    const isEncryption = (sk.name || '').toLowerCase().includes('encryption');
    const trainedLevel = (charSkills.allSkills && charSkills.allSkills[sk.skillId] !== undefined) ? charSkills.allSkills[sk.skillId] : 0;
    return `
      <div class="flex items-center gap-1.5 px-2 py-1 rounded-md" style="background:rgba(255,255,255,0.035);">
        <span class="text-xs ${isEncryption ? 'text-amber-300' : 'text-cyan-300'} font-semibold" title="${isEncryption ? 'Encryption skill (affects chance /40)' : 'Science skill (affects chance /30, combined with the other science skill)'}">${window.esc(sk.name || `Skill ${sk.skillId}`)}</span>
        <input type="number" min="0" max="5" value="${trainedLevel}" data-skill-id="${sk.skillId}" data-is-encryption="${isEncryption}"
          oninput="recalculateInvention()" class="invention-skill-input field-line field-editable num-no-spin mono w-14 text-center font-bold text-xs" style="color:var(--text);">
      </div>
    `;
  }).join('');
}

// Prices something you need to ACQUIRE (datacores, decryptor) using the same buy/sell strategy
// toggle the manufacturing cost engine reads - "sell" means buying instantly off sell orders, "buy"
// means placing your own buy order (cheaper, but not instant, and a broker fee applies).
function getInventionInputPrice(typeId) {
  const strategy = document.getElementById('input-price-mode')?.value || 'sell';
  const prices = (window.priceCache && window.priceCache[typeId]) || { sell: 0, buy: 0 };
  let price = strategy === 'sell' ? prices.sell : prices.buy;
  if (strategy === 'buy') {
    const brokerFeeInput = document.getElementById('broker-fee');
    const brokerFee = brokerFeeInput ? (parseFloat(brokerFeeInput.value) || 0) / 100 : 0.01;
    price = price * (1 + brokerFee);
  }
  return price || 0;
}

// Despite the name, this doubles as the datacore price pre-fetch that recalculateInventionImpl()
// depends on (getInventionInputPrice() reads window.priceCache synchronously) - the visible list
// itself was removed from the sidebar (redundant with the exact numbers Copy Buy List already
// gives), but the fetch it triggers is still load-bearing for cost math, so it must NOT be skipped
// just because #invention-datacore-list no longer exists in the page.
async function renderInventionDatacoreList(materials) {
  const container = document.getElementById('invention-datacore-list');
  if (materials.length === 0) {
    if (container) container.innerHTML = `<div class="text-slate-500 italic">No datacore data found.</div>`;
    return;
  }
  const typeIds = materials.map(m => m.typeId);
  if (typeof window.fetchMarketPrices === 'function') {
    await window.fetchMarketPrices(typeIds);
  }
  if (!container) return;
  container.innerHTML = materials.map(m => {
    const price = getInventionInputPrice(m.typeId);
    return `
      <div class="lp-list-item" style="justify-content:space-between; padding-left:0; padding-right:0;">
        <span style="color:var(--text-soft);">${window.esc(m.name)} x${m.qty}</span>
        <span class="font-bold" style="color:var(--cost);">${Math.round(price * m.qty).toLocaleString()} ISK</span>
      </div>
    `;
  }).join('');
}

// --- Core calculation + Profit Comparer ---
async function recalculateInventionImpl() {
  if (!_inventionCurrentBlueprint || !_inventionCurrentProduct) return;
  saveInventionState();

  const baseChance = parseFloat(document.getElementById('invention-base-chance').value) || 0;
  const targetBPCs = Math.max(1, parseInt(document.getElementById('invention-target-bpcs').value) || 1);

  let encryptionLevel = 0;
  let scienceLevelSum = 0;
  document.querySelectorAll('.invention-skill-input').forEach(input => {
    const level = parseInt(input.value) || 0;
    if (input.dataset.isEncryption === 'true') {
      encryptionLevel = level;
    } else {
      scienceLevelSum += level;
    }
  });
  console.info(`[Invention] Success chance inputs: baseChance=${baseChance}, encryptionLevel=${encryptionLevel}, scienceLevelSum=${scienceLevelSum}, skill inputs found: ${document.querySelectorAll('.invention-skill-input').length}`);
  document.querySelectorAll('.invention-skill-input').forEach(input => {
    console.info(`[Invention]   skill-id=${input.dataset.skillId}, isEncryption=${input.dataset.isEncryption}, value=${input.value}`);
  });

  const datacores = _inventionCurrentBlueprint.inventionMaterials || [];
  // #invention-deduct-stock is now the same big value="true"/"false" toggle button the other two
  // pages use (toggleDeductStockButton in config.js), not a checkbox.
  const deductStock = (document.getElementById('invention-deduct-stock')?.value ?? 'true') === 'true';

  const t2ProductTypeId = _inventionCurrentProduct.typeId;
  // recipeMap stores the blueprint's own ID directly on the recipe object - far more reliable than
  // reverse-searching BLUEPRINT_TO_PRODUCT_MAP for a matching entry, which was silently failing and
  // leaving bpcValue at 0 for every row (recipeMap is indexed by product ID too, so this always works
  // as long as the T2 item's recipe was captured during database generation).
  const t2Recipe = window.recipeMap && window.recipeMap[t2ProductTypeId];
  const t2BlueprintTypeId = t2Recipe ? t2Recipe.blueprintTypeID : null;
  console.info(`[Invention] T2 product typeId=${t2ProductTypeId}, resolved blueprint typeId=${t2BlueprintTypeId || 'NOT FOUND'}`);
  if (!t2ProductTypeId) {
    console.warn('[Invention] No T2 product typeId set at all - profit calculation cannot run.');
  } else if (!t2BlueprintTypeId) {
    console.warn(`[Invention] recipeMap has no entry for product ${t2ProductTypeId}, or it's missing blueprintTypeID - manufacturing profit cannot be calculated.`);
  }

  const productGroupName = ((window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[t2ProductTypeId]) || '').toLowerCase();
  const categoryId = window.EVE_CATEGORIES && window.EVE_CATEGORIES[t2ProductTypeId];
  const isShipOrRig = categoryId === 6 || productGroupName.includes('rig');
  const baseRuns = isShipOrRig ? 1 : 10;

  const decryptorNames = DECRYPTORS.map(d => d.name);
  if (typeof window.fetchMarketPrices === 'function') {
    const decryptorTypeIds = decryptorNames
      .map(n => window.IDX && window.IDX[n.toLowerCase()] && window.IDX[n.toLowerCase()].id)
      .filter(id => id);
    await window.fetchMarketPrices(decryptorTypeIds);
  }

  // Invention job duration doesn't depend on which decryptor is used (decryptors change the
  // OUTCOME - success chance/ME/TE/runs - not the job's own length), so this is computed once here
  // rather than per-decryptor below. isReaction=true deliberately skips the TE-research factor
  // (calculateAdjustedJobSeconds' TE handling) - a T1 blueprint's own TE research doesn't reduce
  // invention time, that's a manufacturing-only mechanic - and requiredSkills is omitted for the
  // same reason: the per-item manufacturing time-reduction skills (e.g. Caldari Starship
  // Engineering) don't apply to invention either. Only Industry/Advanced Industry + facility/rig TE
  // bonuses (already baked into calculateAdjustedJobSeconds unconditionally) actually reduce it.
  // isInvention=true (the final argument) is what actually picks the CORRECT rig bonus source for
  // that last part - a real "Standup ...Invention Accelerator" rig, not whatever manufacturing
  // Efficiency rig happens to match the T2 product's own category (see calculateAdjustedJobSeconds'
  // own comment on this - before isInvention existed, this call silently used the wrong rig family
  // entirely, and the right one wasn't even searchable).
  const baseInventionTime = _inventionCurrentBlueprint.inventionTime;
  const perAttemptInventionSeconds = (baseInventionTime && typeof window.calculateAdjustedJobSeconds === 'function')
    ? window.calculateAdjustedJobSeconds(baseInventionTime, 0, 1, true, _inventionCurrentBlueprint.productTypeID, [], true)
    : 0;

  // Read once, outside the per-decryptor loop below - none of these 4 values depend on which
  // decryptor is being evaluated, so re-reading them from the DOM 9 times (once per DECRYPTORS
  // entry) was pure waste, on top of being yet another copy of the same duplicated expressions app.js
  // and optimizers.js also used to carry (see getActiveFeeInputs' own comment, config.js).
  const { facilityTax, sccSurcharge, salesTax, brokerFee } = window.getActiveFeeInputs();

  const rows = await Promise.all(DECRYPTORS.map(async (dec) => {
    const successChance = Math.min(100, baseChance * (1 + (scienceLevelSum / 30) + (encryptionLevel / 40)) * (1 + dec.probMod / 100));
    const resultRuns = Math.max(1, baseRuns + dec.runsMod);
    const resultME = 2 + dec.meMod;
    const resultTE = 4 + dec.teMod;

    const decEntry = window.IDX && window.IDX[dec.name.toLowerCase()];

    // How many attempts this decryptor needs to reach the target, computed here (before the cost
    // block) since stock deduction has to happen against the TOTAL quantity needed across all
    // attempts, not per-attempt - owning 5 datacores covers part of attempt 1 AND part of attempt 2,
    // it doesn't reset each time.
    const successProbability = successChance / 100;
    const requiredRuns = successProbability > 0 ? Math.ceil(targetBPCs / successProbability) : Infinity;

    // Build the multibuy line items with stock deducted from the TOTAL need, not per-attempt.
    const multibuyItems = [];
    let totalInventionCost = 0;
    if (isFinite(requiredRuns)) {
      // Cost/profit below always reflects the FULL amount of datacores/decryptor needed, regardless
      // of what's already in stock - same rule js/optimizers.js's calculateTreeNodeCost already
      // applies to this page's own manufacturing-side cost (see that function's own comment).
      // "Deduct Stock" only ever changes multibuyItems (the shopping list / Copy Multibuy below) -
      // what you still need to go acquire - never the profit math itself.
      datacores.forEach(m => {
        const totalNeeded = m.qty * requiredRuns;
        const unitPrice = getInventionInputPrice(m.typeId);
        totalInventionCost += totalNeeded * unitPrice;
        const owned = deductStock ? (window.userStockMap[m.typeId] || 0) : 0;
        const netToBuy = Math.max(0, totalNeeded - owned);
        if (netToBuy > 0) multibuyItems.push({ name: m.name, qty: netToBuy });
      });
      if (dec.name !== 'No Decryptor' && decEntry) {
        const totalNeeded = requiredRuns;
        const unitPrice = getInventionInputPrice(decEntry.id);
        totalInventionCost += totalNeeded * unitPrice;
        const owned = deductStock ? (window.userStockMap[decEntry.id] || 0) : 0;
        const netToBuy = Math.max(0, totalNeeded - owned);
        if (netToBuy > 0) multibuyItems.push({ name: dec.name, qty: netToBuy });
      }

      // The invention job's own installation fee - same EIV-based formula as manufacturing jobs
      // (facility tax + SCC surcharge + system cost index), but using invention's own SCI and EIV
      // based on the datacores actually consumed per attempt (invention has no ME to reduce this).
      // A real Invention Cost Optimization/Optimization/Laboratory Optimization rig reduces this
      // SAME system-cost-index component further, same multiplicative pattern as the structure's
      // own costBonus right next to it (see getEffectiveInventionRigBonus's own comment, config.js).
      const structureTypeForInv = window.getActiveStructureType ? window.getActiveStructureType() : { costBonus: 5.0 };
      const structureRoleBonusForInv = structureTypeForInv.costBonus / 100;
      const inventionRigCostBonus = window.getEffectiveInventionRigBonus ? window.getEffectiveInventionRigBonus('cost') : 0;
      const inventionSCI = window.activeInventionSCI !== undefined ? window.activeInventionSCI : 0.02;
      const attemptEIV = datacores.reduce((sum, m) => sum + (window.eivCache && window.eivCache[m.typeId] ? window.eivCache[m.typeId] * m.qty : 0), 0);
      const inventionJobFeePerAttempt = attemptEIV * (inventionSCI * (1 - structureRoleBonusForInv) * (1 - inventionRigCostBonus / 100) + facilityTax + sccSurcharge);
      totalInventionCost += inventionJobFeePerAttempt * requiredRuns;
    } else {
      totalInventionCost = Infinity;
    }

    let unitCost = 0;   // material cost to manufacture ONE BPC's full production
    let unitSell = 0;   // gross revenue from selling ONE BPC's full production
    let unitBuildSeconds = 0; // build time for ONE BPC's full production
    let profitDetail = 'No product data';
    if (t2BlueprintTypeId && t2ProductTypeId) {
      try {
        window.customMEOverrides = window.customMEOverrides || {};
        window.customTEOverrides = window.customTEOverrides || {};
        window.customMEOverrides[t2BlueprintTypeId] = resultME;
        window.customTEOverrides[t2BlueprintTypeId] = resultTE;
        window.recipeTreeRootProductTypeId = t2ProductTypeId;
        const root = await window.buildRecursiveRecipeTree(parseInt(t2BlueprintTypeId), _inventionCurrentProduct.name + ' Blueprint', resultRuns, 0, 6, new Set(), null);
        window.recipeTreeRootProductTypeId = null;
        if (!root) {
          console.warn(`[Invention] buildRecursiveRecipeTree returned nothing for blueprint ${t2BlueprintTypeId} (decryptor: ${dec.name}) - this item's manufacturing recipe may be missing or malformed.`);
        }
        if (root) {
          root.runsNeeded = resultRuns;
          root.qtyNeeded = resultRuns * (root.batchYield || 1);
          const facility = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
          if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(root, facility);
          const allTypeIds = new Set();
          if (typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, allTypeIds);
          if (typeof window.fetchMarketPrices === 'function') await window.fetchMarketPrices(Array.from(allTypeIds));
          const materialCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(root) : 0;

          // Manufacturing job installation fee (facility tax + SCC surcharge + system cost index on
          // the job's EIV) - reuses the exact same calculation the main calculator uses, not a
          // separate approximation, so this stays consistent if that formula is ever revisited.
          const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { costBonus: 5.0 };
          const structureRoleBonus = structureType.costBonus / 100;
          let mfgJobFee = 0;
          if (typeof window.calculateNodeEIV === 'function' && typeof window.calculateNodeJobFee === 'function') {
            window.calculateNodeEIV(root);
            mfgJobFee = window.calculateNodeJobFee(root, facilityTax, sccSurcharge, structureRoleBonus);
          }
          unitCost = materialCost + mfgJobFee;

          const outputPrices = window.priceCache[t2ProductTypeId] || { sell: 0 };
          const grossSell = outputPrices.sell * root.qtyNeeded;
          unitSell = grossSell * (1 - salesTax - brokerFee);

          unitBuildSeconds = typeof window.calculateTotalBuildSeconds === 'function' ? window.calculateTotalBuildSeconds(root) : 0;
          profitDetail = `${root.qtyNeeded} units @ ${Math.round(outputPrices.sell).toLocaleString()} ISK sell (net of tax/broker: ${Math.round(unitSell).toLocaleString()}), ${Math.round(materialCost).toLocaleString()} ISK mats + ${Math.round(mfgJobFee).toLocaleString()} ISK job fee per BPC, ${unitBuildSeconds > 0 ? window.formatDuration(unitBuildSeconds) : 'no time data'} to manufacture per BPC`;
          if (dec.name === 'No Decryptor') {
            console.info(`[Invention] "No Decryptor" per-BPC breakdown: resultRuns=${resultRuns}, qtyProduced=${root.qtyNeeded}, sellPrice=${outputPrices.sell}, grossSell=${grossSell}, unitSell(net)=${unitSell}, materialCost=${materialCost}, mfgJobFee=${mfgJobFee}, unitCost=${unitCost}, unitBuildSeconds=${unitBuildSeconds}`);
          }
        }
      } catch (e) {
        console.warn('[Invention] Profit calc threw an error for', dec.name, e);
      }
    }

    const totalManufacturingCost = targetBPCs * unitCost;
    const totalRevenue = targetBPCs * unitSell;
    const totalProfit = isFinite(totalInventionCost) ? (totalRevenue - totalManufacturingCost - totalInventionCost) : -Infinity;
    const totalBuildSeconds = targetBPCs * unitBuildSeconds;
    // Every attempt takes the full job duration whether it succeeds or fails - the risk that's
    // already visible in "Attempts Needed" (more attempts for a low-chance decryptor) shows up here
    // as more TIME too, not just more cost. null (not 0) when the database has no inventionTime for
    // this blueprint, so "unknown" never silently displays as "instant" - regenerate the database to
    // pick up this field for older data.
    const totalInventionSeconds = !baseInventionTime ? null : (isFinite(requiredRuns) ? requiredRuns * perAttemptInventionSeconds : Infinity);
    const totalTimeSeconds = totalInventionSeconds === null ? null : (isFinite(totalInventionSeconds) ? totalInventionSeconds + totalBuildSeconds : Infinity);
    const iskPerHour = totalBuildSeconds > 0 && isFinite(totalProfit) ? totalProfit / (totalBuildSeconds / 3600) : null;
    // Normalizes to a single manufacturing run (not a single attempt) so decryptors producing
    // different run counts per BPC (e.g. Augmentation's many runs vs Process's none) compare fairly.
    const totalRunsProduced = targetBPCs * resultRuns;
    const profitPerRun = (isFinite(totalProfit) && totalRunsProduced > 0) ? totalProfit / totalRunsProduced : (isFinite(totalProfit) ? totalProfit : -Infinity);

    return { dec, successChance, resultRuns, resultME, resultTE, requiredRuns, totalInventionCost, totalManufacturingCost, totalRevenue, totalProfit, totalBuildSeconds, totalInventionSeconds, totalTimeSeconds, iskPerHour, profitPerRun, multibuyItems, profitDetail, t2BlueprintTypeId, t2ProductName: _inventionCurrentProduct.name };
  }));

  renderInventionComparisonTable(rows);
  renderInventionSummaryTiles(rows);
  renderInventionActiveStationLabel();

  // This function reruns on EVERY settings tweak (Deduct Stock, tax edits, target BPCs, a loaded
  // preset, ...), not just a fresh item pick - it must never force which view (Compare/Queue) is
  // showing, or toggling Deduct Stock while looking at the Queue view would silently yank you back
  // to Compare every time. Only unhide the switch bar / hide the initial empty-state, both safe
  // regardless of which view is active; setInventionViewMode itself is only ever called from a real
  // "show me this view" moment - selectInventionItem's own fresh-pick branch, a manual tab click, or
  // restoreInventionViewModeOnLoad() on page load.
  document.getElementById('invention-mode-switch').classList.remove('hidden');
  document.getElementById('invention-empty-state').classList.add('hidden');

  // The Job Queue's aggregate BOM (js/invention-queue.js) prices off the SAME settings this function
  // just used (Deduct Stock, Material Pricing, tax) - without this it only ever refreshed when you
  // switched INTO the Queue view, so toggling Deduct Stock while already looking at it appeared to do
  // nothing at all. Cheap no-op when the Queue view has nothing to show (bomCard stays hidden).
  if (typeof window.renderInventionQueueBom === 'function') window.renderInventionQueueBom();
}
let _recalculateInventionDebounceTimer = null;
// The public name every HTML oninput handler calls. Debouncing serializes rapid repeated triggers
// (typing multiple digits fires this several times in quick succession) into a single delayed call,
// which both avoids redundant work (9 full recipe tree builds with market fetches per call) and
// fixes a real race condition: without this, an older/slower calculation could finish after a newer
// one and silently overwrite the UI with stale results, since there was no protection against
// overlapping async calls.
function recalculateInvention() {
  if (_recalculateInventionDebounceTimer) clearTimeout(_recalculateInventionDebounceTimer);
  _recalculateInventionDebounceTimer = setTimeout(() => {
    _recalculateInventionDebounceTimer = null;
    recalculateInventionImpl();
  }, 400);
}
window.recalculateInvention = recalculateInvention;

function renderInventionSummaryTiles(rows) {
  const container = document.getElementById('invention-summary-tiles');
  if (!container || rows.length === 0) return;
  // Ranked by profit per manufacturing run, not total profit - total profit rewards whichever
  // decryptor happens to need the most runs to hit your target BPC count, which isn't actually
  // "better", just bigger. Per-run profit is what's comparable across decryptors regardless of
  // target size (and normalizes for decryptors like Augmentation that produce extra runs/BPC -
  // see profitPerRun's own definition above).
  const best = rows.reduce((a, b) => (b.profitPerRun > a.profitPerRun ? b : a), rows[0]);
  const targetBPCs = Math.max(1, parseInt(document.getElementById('invention-target-bpcs').value) || 1);

  container.innerHTML = `
    <div class="lp-tile">
      <div class="lp-label truncate">Best Option</div>
      <div class="text-base font-bold mono leading-tight truncate" style="color:var(--accent);">${window.esc(best.dec.name)}</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${isFinite(best.profitPerRun) ? Math.round(best.profitPerRun).toLocaleString() + ' ISK/run' : '—'} &middot; ${best.successChance.toFixed(1)}% success</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Runs Needed</div>
      <div class="text-lg font-bold mono leading-tight" style="color:var(--text);">${isFinite(best.requiredRuns) ? best.requiredRuns.toLocaleString() : '—'}</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">to get ${targetBPCs} successful BPC${targetBPCs > 1 ? 's' : ''}</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Total Time (Invention + Mfg)</div>
      <div class="text-lg font-bold mono leading-tight" style="color:var(--text);">${best.totalTimeSeconds !== null && isFinite(best.totalTimeSeconds) ? window.formatDuration(best.totalTimeSeconds) : 'No time data'}</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${best.totalInventionSeconds !== null && isFinite(best.totalInventionSeconds) ? window.formatDuration(best.totalInventionSeconds) + ' inventing + ' + window.formatDuration(best.totalBuildSeconds) + ' mfg' : 'no invention time data for this blueprint'}</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Total Cost (Invention + Mfg)</div>
      <div class="text-lg font-bold mono leading-tight" style="color:var(--cost);">${isFinite(best.totalInventionCost) ? Math.round(best.totalInventionCost + best.totalManufacturingCost).toLocaleString() : '—'} ISK</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${isFinite(best.totalInventionCost) ? Math.round(best.totalInventionCost).toLocaleString() + ' invention + ' + Math.round(best.totalManufacturingCost).toLocaleString() + ' mfg' : ''}</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">Total Profit</div>
      <div class="text-lg font-bold mono leading-tight" style="color:${isFinite(best.totalProfit) && best.totalProfit >= 0 ? 'var(--green)' : 'var(--red)'};">${isFinite(best.totalProfit) ? Math.round(best.totalProfit).toLocaleString() + ' ISK' : '—'}</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">for ${targetBPCs} successful BPC${targetBPCs > 1 ? 's' : ''}</div>
    </div>
    <div class="lp-tile">
      <div class="lp-label truncate">ISK/Hour</div>
      <div class="text-lg font-bold mono leading-tight" style="color:${best.iskPerHour !== null ? (best.iskPerHour >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-mute)'};">${best.iskPerHour !== null ? Math.round(best.iskPerHour).toLocaleString() + ' ISK' : 'No time data'}</div>
      <div class="text-xs mt-0.5" style="color:var(--text-mute);">${best.totalBuildSeconds > 0 ? window.formatDuration(best.totalBuildSeconds) + ' total manufacturing' : 'build time unavailable'}</div>
    </div>
  `;
}

let _inventionLastComparisonRows = [];
let _inventionSortColumn = 'profitPerRun';
let _inventionSortDescending = true;

function sortInventionComparisonBy(column) {
  if (_inventionSortColumn === column) {
    _inventionSortDescending = !_inventionSortDescending;
  } else {
    _inventionSortColumn = column;
    _inventionSortDescending = true;
  }
  renderInventionComparisonTable(_inventionLastComparisonRows);
}
window.sortInventionComparisonBy = sortInventionComparisonBy;

function copyInventionMultibuy(rowIndex) {
  const row = _inventionLastComparisonRows[rowIndex];
  if (!row) return;
  if (row.multibuyItems.length === 0) {
    if (typeof window.showToast === 'function') window.showToast('Nothing to buy - you already have enough stock for this decryptor\'s requirement.', 'info');
    return;
  }
  const text = row.multibuyItems.map(i => `${i.name} x${i.qty}`).join('\n');
  const btn = document.getElementById(`invention-multibuy-btn-${rowIndex}`);
  // This button has an SVG icon alongside its "Copy" text - the default textContent-based swap
  // (like ledger.js's plain-text "Copy Multibuy" button uses) would wipe the icon out permanently
  // on the first click, since .textContent replaces ALL child nodes, SVG included, and the restore
  // step then has no way to bring it back. useInnerHTML keeps the icon markup intact through the
  // swap (see ledger.js's copyIndividualJobMultibuy for the same fix on the same kind of button).
  window.copyToClipboardWithFeedback(text, btn, { useInnerHTML: true });
}
window.copyInventionMultibuy = copyInventionMultibuy;

// Sends this decryptor's resulting T2 BPC to the Calculator, navigating there in the same tab.
// Reuses the Calculator's own shareCurrentBuild/applySharedBuildFromUrl link format (app.js) rather
// than inventing a second one - runs/me/te ride along in the same ?build= param so the Calculator
// opens already set to the run count THIS decryptor actually produces (never just 1) and the ME/TE
// this decryptor actually grants, not a plain unresearched copy of the blueprint.
function sendInventionRowToCalculator(rowIndex) {
  const row = _inventionLastComparisonRows[rowIndex];
  if (!row) return;
  if (!row.t2BlueprintTypeId) {
    if (typeof window.showToast === 'function') window.showToast('No manufacturing recipe found for this item - cannot send it to the Calculator.', 'error');
    return;
  }
  const state = { id: row.t2BlueprintTypeId, name: row.t2ProductName, runs: row.resultRuns, me: row.resultME, te: row.resultTE };
  const encoded = btoa(encodeURIComponent(JSON.stringify(state)));
  window.location.href = `index.html?build=${encoded}`;
}
window.sendInventionRowToCalculator = sendInventionRowToCalculator;

// Queues this decryptor's plan into the Invention Job Queue (js/invention-queue.js) - separate
// storage from the manufacturing Ledger, since an invention "job" is a batch of probabilistic
// attempts (0+ successes out of N tries), not a single deterministic build. Reads _inventionCurrentBlueprint
// (module-scope, only accessible from this file) for the T1 blueprint's own type id, which
// js/invention-queue.js needs to match this batch against real in-game invention jobs later (ESI's
// job object carries blueprint_type_id for the T1 BPC being invented from, and product_type_id for
// the T2 BLUEPRINT COPY it produces - NOT the ship itself, since that's what an invention job
// actually creates).
function queueInventionRow(rowIndex) {
  const row = _inventionLastComparisonRows[rowIndex];
  if (!row || !_inventionCurrentBlueprint) return;
  if (typeof window.addInventionQueueBatch !== 'function') return;
  const t1Recipe = _inventionCurrentBlueprint;
  const t1BlueprintName = window.EVE_ITEMS[t1Recipe.blueprintTypeID] || `${t1Recipe.productName || 'T1 item'} Blueprint`;
  // Datacores needed are a property of the T1 blueprint's OWN invention recipe, not the decryptor
  // (decryptors change success chance/output ME-TE-runs, never which materials are consumed) - safe
  // to snapshot once here regardless of which decryptor this particular row is for, and reused by
  // js/invention-queue.js's aggregate shopping list for however many attempts are still needed.
  const invMaterials = (t1Recipe.inventionMaterials || []).map(m => ({ typeId: m.typeId, name: m.name, qty: m.qty }));
  const decEntry = window.IDX && window.IDX[row.dec.name.toLowerCase()];
  window.addInventionQueueBatch({
    t2BlueprintTypeId: row.t2BlueprintTypeId,
    t2ProductTypeId: _inventionCurrentProduct ? _inventionCurrentProduct.typeId : null,
    t2ProductName: row.t2ProductName,
    t1BlueprintTypeId: t1Recipe.blueprintTypeID,
    t1BlueprintName: t1BlueprintName,
    decryptorName: row.dec.name,
    decryptorTypeId: decEntry ? decEntry.id : null,
    resultME: row.resultME,
    resultTE: row.resultTE,
    resultRuns: row.resultRuns,
    targetBPCs: Math.max(1, parseInt(document.getElementById('invention-target-bpcs')?.value) || 1),
    successChance: row.successChance,
    plannedRuns: isFinite(row.requiredRuns) ? row.requiredRuns : null,
    estimatedCost: isFinite(row.totalInventionCost) ? row.totalInventionCost : null,
    invMaterials: invMaterials
  });
}
window.queueInventionRow = queueInventionRow;

// For an auto-imported batch (a real invention job ESI reported that wasn't queued ahead of time) -
// js/invention-queue.js knows the T1 blueprint's type id from the job itself, but needs this reverse
// lookup to find its invention materials for the aggregate shopping list. Built off the same
// T2->T1 map searchInventionItem already builds (recipe.blueprintTypeID is on every entry there),
// just re-keyed by blueprint id and cached the same lazy way.
let _inventionT1BlueprintIdToRecipe = null;
function getInventionMaterialsForT1Blueprint(t1BlueprintTypeId) {
  if (!_inventionT1BlueprintIdToRecipe) {
    _inventionT1BlueprintIdToRecipe = {};
    Object.values(getInventionT2ToT1Map()).forEach(recipe => {
      if (recipe && recipe.blueprintTypeID !== undefined) _inventionT1BlueprintIdToRecipe[recipe.blueprintTypeID] = recipe;
    });
  }
  const recipe = _inventionT1BlueprintIdToRecipe[t1BlueprintTypeId];
  return recipe ? (recipe.inventionMaterials || []).map(m => ({ typeId: m.typeId, name: m.name, qty: m.qty })) : [];
}
window.getInventionMaterialsForT1Blueprint = getInventionMaterialsForT1Blueprint;

function renderInventionComparisonTable(rows) {
  const container = document.getElementById('invention-comparison-table');
  if (!container) return;
  _inventionLastComparisonRows = rows;
  // Same profit-PER-RUN ranking the summary tiles' own "Best Option" uses (see
  // renderInventionSummaryTiles) - keeps the table's award icon pointing at the same decryptor,
  // not a different one picked by total profit.
  const bestProfit = rows.length > 0 ? Math.max(...rows.map(r => r.profitPerRun)) : 0;
  const targetBPCs = Math.max(1, parseInt(document.getElementById('invention-target-bpcs').value) || 1);

  const sortedRows = [...rows].sort((a, b) => {
    const av = a[_inventionSortColumn] === null || !isFinite(a[_inventionSortColumn]) ? -Infinity : a[_inventionSortColumn];
    const bv = b[_inventionSortColumn] === null || !isFinite(b[_inventionSortColumn]) ? -Infinity : b[_inventionSortColumn];
    return _inventionSortDescending ? bv - av : av - bv;
  });

  const sortHeader = (column, label, align) => {
    const isActive = _inventionSortColumn === column;
    const arrow = isActive ? ' ' + window.svgIcon(_inventionSortDescending ? 'chevron-down' : 'chevron-up') : '';
    return `<th class="sortable${align === 'right' ? ' text-right' : ''}" onclick="sortInventionComparisonBy('${column}')">${label}${arrow}</th>`;
  };

  container.innerHTML = `
    <table class="lp-table text-xs mono">
      <thead>
        <tr>
          <th>Decryptor</th>
          ${sortHeader('successChance', 'Success %', 'right')}
          <th class="text-right">Result BPC</th>
          ${sortHeader('requiredRuns', `Runs Needed (for ${targetBPCs})`, 'right')}
          ${sortHeader('totalTimeSeconds', 'Total Time', 'right')}
          ${sortHeader('totalInventionCost', 'Total Invention Cost', 'right')}
          ${sortHeader('totalManufacturingCost', 'Total Mfg Cost', 'right')}
          ${sortHeader('totalProfit', 'Total Profit', 'right')}
          ${sortHeader('iskPerHour', 'ISK/Hour', 'right')}
          ${sortHeader('profitPerRun', 'Profit / 1 Run', 'right')}
          <th class="text-right">Buy List</th>
          <th class="text-right">Calculator</th>
          <th class="text-right">Queue</th>
        </tr>
      </thead>
      <tbody>
        ${sortedRows.map(r => {
          const isBest = r.profitPerRun === bestProfit && bestProfit > -Infinity;
          const rowIndex = rows.indexOf(r);
          const perAttemptSeconds = r.requiredRuns > 0 ? r.totalInventionSeconds / r.requiredRuns : 0;
          const timeTitle = (r.totalTimeSeconds !== null && isFinite(r.totalTimeSeconds))
            ? `${window.formatDuration(r.totalInventionSeconds)} inventing (${r.requiredRuns} run${r.requiredRuns > 1 ? 's' : ''} x ${window.formatDuration(perAttemptSeconds)} each) + ${window.formatDuration(r.totalBuildSeconds)} manufacturing`
            : 'No invention time data for this blueprint - regenerate the database to pick it up';
          return `
          <tr class="${isBest ? 'lp-table-best' : ''}" title="${window.esc(r.profitDetail)}">
            <td class="font-bold" style="color:${isBest ? 'var(--accent)' : 'var(--text)'};">${isBest ? window.svgIcon('award') + ' ' : ''}${window.esc(r.dec.name)}</td>
            <td class="text-right font-bold" style="color:var(--text);">${r.successChance.toFixed(1)}%</td>
            <td class="text-right" style="color:var(--text-mute);">${r.resultRuns} run${r.resultRuns > 1 ? 's' : ''}, ME${r.resultME >= 0 ? '+' : ''}${r.resultME}, TE${r.resultTE >= 0 ? '+' : ''}${r.resultTE}</td>
            <td class="text-right font-bold" style="color:var(--accent);">${isFinite(r.requiredRuns) ? r.requiredRuns.toLocaleString() : '—'}</td>
            <td class="text-right font-bold" style="color:var(--text);" title="${window.esc(timeTitle)}">${r.totalTimeSeconds !== null && isFinite(r.totalTimeSeconds) ? window.formatDuration(r.totalTimeSeconds) : '—'}</td>
            <td class="text-right" style="color:var(--cost);">${isFinite(r.totalInventionCost) ? Math.round(r.totalInventionCost).toLocaleString() + ' ISK' : '—'}</td>
            <td class="text-right" style="color:var(--cost);">${Math.round(r.totalManufacturingCost).toLocaleString()} ISK</td>
            <td class="text-right font-bold" style="color:${isFinite(r.totalProfit) && r.totalProfit >= 0 ? 'var(--green)' : 'var(--red)'};">${isFinite(r.totalProfit) ? Math.round(r.totalProfit).toLocaleString() + ' ISK' : '—'}</td>
            <td class="text-right font-bold" style="color:${r.iskPerHour !== null ? (r.iskPerHour >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-mute)'};">${r.iskPerHour !== null ? Math.round(r.iskPerHour).toLocaleString() + ' ISK' : '—'}</td>
            <td class="text-right font-bold" style="color:${isFinite(r.profitPerRun) && r.profitPerRun >= 0 ? 'var(--green)' : 'var(--red)'};">${isFinite(r.profitPerRun) ? Math.round(r.profitPerRun).toLocaleString() + ' ISK' : '—'}</td>
            <td class="text-right">
              <button id="invention-multibuy-btn-${rowIndex}" onclick="copyInventionMultibuy(${rowIndex})" class="lp-chip-btn" title="Copy datacores + decryptor needed for this decryptor's Runs Needed, minus whatever stock you already own"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>
            </td>
            <td class="text-right">
              <button onclick="sendInventionRowToCalculator(${rowIndex})" class="lp-chip-btn" style="padding:5px 7px;" ${r.t2BlueprintTypeId ? '' : 'disabled'} title="Open this decryptor's resulting BPC in the Calculator, already set to its ${r.resultRuns} max run${r.resultRuns > 1 ? 's' : ''} and ME${r.resultME >= 0 ? '+' : ''}${r.resultME}/TE${r.resultTE >= 0 ? '+' : ''}${r.resultTE}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg></button>
            </td>
            <td class="text-right">
              <button onclick="queueInventionRow(${rowIndex})" class="lp-chip-btn" style="padding:5px 7px;" title="Add this decryptor + target to the Invention Job Queue - tracks your real in-game invention runs against it via EVE SSO once you start them"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M12 5v14M5 12h14"/></svg></button>
            </td>
          </tr>
        `; }).join('')}
      </tbody>
    </table>
    <p class="text-xs mt-2 leading-relaxed" style="color:var(--text-mute);">
      Click any column header to sort by it (click again to reverse).
      <b>Runs Needed</b> = the average number of invention runs (successes AND failures) to reach your target of ${targetBPCs} successful BPC${targetBPCs > 1 ? 's' : ''}, given this decryptor's success chance - this is where the success rate actually shows up: a worse chance means more runs, more failed datacores/decryptors spent, and a higher Total Invention Cost for the same goal.
      <b>Buy List</b> copies the datacores + decryptors needed for that many runs in EVE multibuy format, with your owned stock (from the location filter on the left) already deducted.
      <b>Total Invention Cost</b> = Runs Needed × (datacores + decryptor cost per run), the FULL amount regardless of stock on hand - you pay this on every run, win or lose. Deduct Stock (left) only affects the Buy List above, never this figure.
      <b>Total Mfg Cost / Total Profit</b> = manufacturing your ${targetBPCs} target BPC${targetBPCs > 1 ? 's' : ''} worth of production, at your chosen Jita buy/sell pricing, minus Total Invention Cost.
      <b>Profit / 1 Run</b> normalizes Total Profit to a single manufacturing run, so decryptors with different run counts per BPC compare fairly.
      Total Invention Cost already includes the invention job's own installation fee, and Total Mfg Cost already includes the manufacturing job's installation fee (facility tax + SCC + system cost index) - not just raw material cost. Materials/decryptors/datacores are priced by the Material Pricing setting on the left (Jita Sell = instant buy price, Jita Buy Order = cheaper but not guaranteed to fill); the resulting BPC's output is always valued at Jita Sell, as if you list it yourself (net of sales tax + broker fee) - real fills can be lower if you have to undercut competition. Not included: the T1 BPC's own acquisition cost (its price if bought fresh, or nothing if you already own the BPO and use it repeatedly).
    </p>
  `;
}

// --- Production station preset (system + structure + rigs + facility tax) ---
// This page has no system/structure/rig controls of its own - it silently reads whatever the
// Calculator last set (getActiveStructureType/getEffectiveRigBonusForTypeId both read shared
// localStorage directly, see config.js), so there was no way to see OR change what's actually
// driving the invention/manufacturing job fees and ME/TE bonuses without leaving this page. This
// preset picker (same saved presets the Calculator/Ledger already use) closes that gap, plus a small
// always-visible readout of whatever's currently active so it's never a guess.
// app.js isn't loaded here (same reasoning as ledger.js's own copy of this) - own tiny parse helper
// rather than a cross-file dependency for reading one localStorage key.
function getSavedProductionPresetsLocal() {
  return window.safeParseJSON(localStorage.getItem('eve_production_presets'), {});
}

function renderInventionPresetDropdown() {
  const select = document.getElementById('invention-preset-select');
  if (!select) return;
  const presets = getSavedProductionPresetsLocal();
  select.innerHTML = `<option value="">— Load a saved production station —</option>` +
    Object.keys(presets).sort().map(name => `<option value="${window.esc(name)}">${window.esc(name)} (${window.esc(presets[name].systemName)}, ${window.esc(presets[name].facilityLabel)})</option>`).join('');
}
window.renderInventionPresetDropdown = renderInventionPresetDropdown;

async function applyInventionProductionPreset(presetName) {
  if (!presetName) return;
  const presets = getSavedProductionPresetsLocal();
  const preset = presets[presetName];
  if (!preset) return;

  localStorage.setItem('eve_active_facility_key', preset.facilityKey || 'sotiyo');
  localStorage.setItem('eve_rig_slot_1', preset.rig1 || '');
  localStorage.setItem('eve_rig_slot_2', preset.rig2 || '');
  localStorage.setItem('eve_rig_slot_3', preset.rig3 || '');
  if (preset.facilityTax !== undefined) {
    const facilityTaxInput = document.getElementById('facility-tax');
    if (facilityTaxInput) facilityTaxInput.value = preset.facilityTax;
    if (typeof saveSharedTaxSettings === 'function') saveSharedTaxSettings();
  }
  localStorage.setItem('eve_selected_system', JSON.stringify({ id: preset.systemId, name: preset.systemName }));
  if (preset.systemId && typeof window.fetchSystemSCIById === 'function') {
    try { await window.fetchSystemSCIById(preset.systemId, preset.systemName); }
    catch (e) { console.warn('[Invention] Failed to fetch system cost index for preset:', e); }
  }

  const select = document.getElementById('invention-preset-select');
  if (select) select.value = '';
  if (_inventionCurrentBlueprint) recalculateInventionImpl();
  renderInventionActiveStationLabel();
  if (typeof window.showToast === 'function') window.showToast(`Now using the "${window.esc(presetName)}" production preset.`, 'success');
}
window.applyInventionProductionPreset = applyInventionProductionPreset;

// Resolves the CURRENTLY active system/structure/rigs into a readable label - the name of a saved
// preset if all fields still match exactly (same matching logic as the Ledger's own per-job preset
// label), otherwise a synthesized "Structure @ System, N rigs" description. Shown regardless of
// whether a preset was ever explicitly picked here, so what's driving the numbers is never a guess.
function renderInventionActiveStationLabel() {
  const el = document.getElementById('invention-active-station-label');
  if (!el) return;
  const sel = window.safeParseJSON(localStorage.getItem('eve_selected_system'), {});
  const facilityKey = localStorage.getItem('eve_active_facility_key') || 'sotiyo';
  const rig1 = localStorage.getItem('eve_rig_slot_1') || '';
  const rig2 = localStorage.getItem('eve_rig_slot_2') || '';
  const rig3 = localStorage.getItem('eve_rig_slot_3') || '';

  const presets = getSavedProductionPresetsLocal();
  const matchName = Object.keys(presets).find(name => {
    const p = presets[name];
    return p && p.systemId === sel.id && p.facilityKey === facilityKey &&
      (p.rig1 || '') === rig1 && (p.rig2 || '') === rig2 && (p.rig3 || '') === rig3;
  });

  let label;
  if (matchName) {
    label = matchName;
  } else {
    const structureLabel = (window.STRUCTURE_TYPES && window.STRUCTURE_TYPES[facilityKey] && window.STRUCTURE_TYPES[facilityKey].shortLabel) || facilityKey;
    const rigCount = [rig1, rig2, rig3].filter(Boolean).length;
    const rigLabel = rigCount > 0 ? `, ${rigCount} rig${rigCount > 1 ? 's' : ''}` : ', no rigs';
    label = sel.name ? `${structureLabel} @ ${sel.name}${rigLabel}` : `${structureLabel}${rigLabel}`;
  }
  el.textContent = label;
}
window.renderInventionActiveStationLabel = renderInventionActiveStationLabel;

// --- State persistence (survives reload and navigating away/back) ---
function saveInventionState() {
  if (!_inventionSelectedTypeId) return;
  const state = {
    typeId: _inventionSelectedTypeId,
    name: _inventionSelectedName,
    baseChance: document.getElementById('invention-base-chance')?.value,
    targetBPCs: document.getElementById('invention-target-bpcs')?.value,
    priceMode: document.getElementById('input-price-mode')?.value,
    skillLevels: Array.from(document.querySelectorAll('.invention-skill-input')).map(el => ({ skillId: el.dataset.skillId, value: el.value }))
  };
  localStorage.setItem('eve_invention_state', JSON.stringify(state));
}
window.saveInventionState = saveInventionState;

async function restoreInventionState() {
  const state = window.safeParseJSON(localStorage.getItem('eve_invention_state'), null);
  if (!state || !state.typeId) return;

  await selectInventionItem(state.typeId, state.name, true); // skipSave - don't overwrite what we're restoring

  if (state.baseChance !== undefined) document.getElementById('invention-base-chance').value = state.baseChance;
  const targetBPCsToRestore = state.targetBPCs !== undefined ? state.targetBPCs : state.bpcRuns; // bpcRuns: back-compat with state saved before this rename
  if (targetBPCsToRestore !== undefined) {
    const targetEl = document.getElementById('invention-target-bpcs');
    if (targetEl) targetEl.value = targetBPCsToRestore;
  }
  if (state.priceMode !== undefined) {
    const priceEl = document.getElementById('input-price-mode');
    // input-price-mode is a toggle <button> (see toggleMaterialPricingButton, config.js), not a
    // <select> - setting .value alone doesn't update its visible text/style, so that has to be
    // refreshed explicitly here too, or a restored "buy" state would still visually show "Sell".
    if (priceEl) { priceEl.value = state.priceMode; if (typeof window.updateMaterialPricingButtonVisual === 'function') window.updateMaterialPricingButtonVisual(priceEl); }
  }
  if (Array.isArray(state.skillLevels)) {
    state.skillLevels.forEach(sl => {
      const input = document.querySelector(`.invention-skill-input[data-skill-id="${sl.skillId}"]`);
      if (input) input.value = sl.value;
    });
  }

  recalculateInventionImpl();
}
window.restoreInventionState = restoreInventionState;

// Shared with the main calculator via the same localStorage key - reads/writes only the tax/fee
// fields relevant here, merging with (not overwriting) calculator-specific fields like facility
// select or rig slots, so editing from either page keeps both in sync without clobbering settings
// this page doesn't touch.
function loadSharedTaxSettings() {
  try {
    const saved = localStorage.getItem('eve_tax_settings');
    if (!saved) return;
    const settings = window.safeParseJSON(saved, {});
    if (settings.facilityTax !== undefined && document.getElementById('facility-tax')) document.getElementById('facility-tax').value = settings.facilityTax;
    if (settings.sccSurcharge !== undefined && document.getElementById('scc-surcharge')) document.getElementById('scc-surcharge').value = settings.sccSurcharge;
    if (settings.salesTax !== undefined && document.getElementById('sales-tax')) document.getElementById('sales-tax').value = settings.salesTax;
    if (settings.brokerFee !== undefined && document.getElementById('broker-fee')) document.getElementById('broker-fee').value = settings.brokerFee;
  } catch (e) { console.warn('[Invention] Failed to load saved tax/fee settings - falling back to defaults:', e); }
}
window.loadSharedTaxSettings = loadSharedTaxSettings;

function saveSharedTaxSettings() {
  try {
    const existingRaw = localStorage.getItem('eve_tax_settings');
    const existing = existingRaw ? window.safeParseJSON(existingRaw, {}) : {};
    existing.facilityTax = document.getElementById('facility-tax')?.value;
    existing.sccSurcharge = document.getElementById('scc-surcharge')?.value;
    existing.salesTax = document.getElementById('sales-tax')?.value;
    existing.brokerFee = document.getElementById('broker-fee')?.value;
    localStorage.setItem('eve_tax_settings', JSON.stringify(existing));
  } catch (e) { console.warn('[Invention] Failed to save tax/fee settings - they will reset on next reload:', e); }
}
window.saveSharedTaxSettings = saveSharedTaxSettings;

window.onload = async () => {
  if (typeof window.buildPrepackedIndexes === 'function') {
    window.buildPrepackedIndexes();
  }
  loadSharedTaxSettings();
  if (typeof window.restoreManufacturingImplantSetting === 'function') window.restoreManufacturingImplantSetting('mfg-implant-select');
  renderInventionPresetDropdown();
  renderInventionActiveStationLabel();
  // Instant repaint of whatever the queue looked like last session, before any network call -
  // same "show the cached answer immediately, then refresh in the background" pattern the rest of
  // this app already uses.
  if (typeof window.renderInventionQueue === 'function') window.renderInventionQueue();
  // Restore the last-viewed item's search box/icon/name/skill inputs FIRST, before any network
  // calls - these all come from local data (recipeMap, localStorage), so there's no reason to make
  // the user stare at a blank page for a second or two while SSO callback handling, system cost
  // index load, and adjusted-price fetch resolve below. This first pass may compute job fees as zero
  // if EIV/SCI data isn't cached yet - the forced recalculation after those loads (below) corrects
  // that, so the final numbers shown are still always accurate; only the empty-state wait goes away.
  try {
    await restoreInventionState();
  } catch (e) {
    console.warn('[Invention] Failed to restore previous session state:', e);
  }
  // Now that both the restored item (if any) and the cached queue have rendered, settle on whichever
  // view you actually had open last session instead of always defaulting to Compare.
  if (typeof window.restoreInventionViewModeOnLoad === 'function') window.restoreInventionViewModeOnLoad();

  if (typeof window.handleEsiSSOCallback === 'function') {
    try { await window.handleEsiSSOCallback(); } catch (e) { console.error('SSO callback error:', e); }
  }
  // Silent (no button-disable, no toast) - same convention js/ledger.js's own on-load sync uses.
  // Also kicks off the periodic background re-check (js/invention-queue.js) so a job that finishes
  // while this tab stays open still gets picked up without a manual refresh.
  if (typeof window.syncInventionQueueWithEve === 'function') {
    window.syncInventionQueueWithEve(true).catch(e => console.warn('[Invention] Queue sync error:', e));
  }
  if (typeof window.scheduleInventionQueueBackgroundSync === 'function') window.scheduleInventionQueueBackgroundSync();
  // System cost index (needed for job fees) and adjusted prices (needed for EIV) - the calculator
  // and ledger both fetch these on load already; this page needs them too now that job fees are
  // calculated here.
  if (typeof window.loadSavedSystem === 'function') {
    try { await window.loadSavedSystem(); } catch (e) { console.warn('[Invention] SCI load failed:', e); }
  }
  if (typeof window.fetchAdjustedPrices === 'function') {
    try { await window.fetchAdjustedPrices(); } catch (e) { console.warn('[Invention] Adjusted prices fetch error:', e); }
  }
  // Force one more recalculation now that EIV/SCI data is actually ready, rather than leaving the
  // first pass's possibly-zero-fee numbers on screen.
  if (_inventionCurrentBlueprint) {
    recalculateInventionImpl();
  }
};
