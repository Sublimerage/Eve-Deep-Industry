'use strict';

// A fresh node with no explicit customMEOverrides/customTEOverrides entry used to always default
// to 0%/0% (an unresearched blueprint) - now it defaults to the best BPO you actually own for that
// blueprint (js/esi.js refreshOwnedBpoIndex), since that's what you'd really build it at. Manually
// editing a card's ME/TE still overrides this, same as it always has. Falls back to {me:0, te:0}
// (identical to the old hardcoded default) when nothing's owned or you're not logged in.
function getDefaultMeTeForBlueprint(blueprintTypeId) {
  const owned = typeof window.getBestOwnedBpoMeTe === 'function' ? window.getBestOwnedBpoMeTe(blueprintTypeId) : null;
  return owned || { me: 0, te: 0 };
}

// Robust SDE Suffix Strip-and-Match Helper to resolve Product ID from any Blueprint Name
function resolveProductIdFromBlueprintName(blueprintName) {
  if (!blueprintName) return null;
  let pName = blueprintName.replace(/ Blueprint$/i, '')
                           .replace(/ Reaction Formula$/i, '')
                           .replace(/ Formula$/i, '')
                           .trim()
                           .toLowerCase();

  if (window.IDX[pName]) return window.IDX[pName].id;
  for (const [k, v] of Object.entries(window.IDX)) {
    if (k === pName || k.replace(/ /g, '') === pName.replace(/ /g, '')) {
      return v.id;
    }
  }
  for (const [id, name] of Object.entries(window.TYPE_ID_TO_NAME)) {
    const n = name.toLowerCase();
    if (n === pName || n.replace(/ /g, '') === pName.replace(/ /g, '')) {
      return parseInt(id);
    }
  }
  return null;
}

// Reverse SDE Match Helper to resolve Blueprint ID from any Product Name
function resolveBlueprintIdFromProductName(productName) {
  if (!productName) return null;
  const q = productName.toLowerCase().trim();
  const candidates = [q + " blueprint", q + " reaction formula", q + " formula"];
  for (const c of candidates) {
    if (window.IDX[c]) return window.IDX[c].id;
  }
  return null;
}

// Strict SDE Batch Yield Extractor (Uses exact SDE database quantities, avoiding deep-search collisions)
function getBatchYield(recipe, isReaction) {
  if (!recipe) return 1;

  if (typeof window.extractRecipeYield === 'function') {
    const explicit = window.extractRecipeYield(recipe);
    if (explicit > 0) return explicit;
  }

  // Direct root-level output qty properties
  const rootCandidates = [
    recipe.productQtyPerRun,
    recipe.mfgQtyPerRun,
    recipe.reactionQtyPerRun,
    recipe.outputQty,
    recipe.portionSize,
    recipe.qty,
    recipe.productQty,
    recipe.pQty,
    recipe.yield,
    recipe.batchYield,
    recipe.amount,
    recipe.qtyPerRun
  ];
  for (const c of rootCandidates) {
    const val = parseInt(c);
    if (!isNaN(val) && val > 0) return val;
  }

  // Standard EVE SDE fallback rules based on item name matching
  const name = ((recipe.productName || '') + ' ' + (recipe.blueprintTypeName || '')).toLowerCase();
  if (name.includes('carbide')) return 10000;
  if (name.includes('fuel block')) return 40;
  if (name.includes('nanite repair paste')) return 500;
  if (name.includes('auto-integrity preservation seal') || name.includes('life support backup unit')) return 3;
  if (name.includes('cap booster') || name.includes('interdiction probe') || name.includes('scanner probe')) return 10;
  if (name.includes('charge') || name.includes('frequency crystal') || name.includes('missile') || name.includes('torpedo') || name.includes('rocket') || name.includes('ammo')) return 100;
  if (isReaction || name.includes('reaction') || name.includes('polymer') || name.includes('ferrogel')) return 200;

  return 1;
}

function collectAllTypeIds(node, typeIds = new Set()) {
  if (!node) return typeIds;
  if (node.typeId) typeIds.add(node.typeId);
  if (node.displayTypeId) typeIds.add(node.displayTypeId);
  if (node.productTypeId) typeIds.add(node.productTypeId);
  if (node.children) {
    node.children.forEach(child => collectAllTypeIds(child, typeIds));
  }
  return typeIds;
}

// O(1) Fast SDE Reverse Lookup to find a Blueprint Type ID for a given manufactured item Product ID
function findBlueprintTypeIdForProduct(productTypeId) {
  const pId = parseInt(productTypeId);
  if (isNaN(pId)) return null;

  if (window.recipeMap && window.recipeMap[pId]) {
    const recipe = window.recipeMap[pId];
    const bpId = recipe.blueprintTypeID || recipe.bp || recipe.bpId;
    if (bpId && parseInt(bpId) !== pId) return parseInt(bpId);
  }

  if (window.EVE_RECIPES && window.EVE_RECIPES[pId]) {
    const recipe = window.EVE_RECIPES[pId];
    const bpId = recipe.blueprintTypeID || recipe.bp || recipe.bpId;
    if (bpId && parseInt(bpId) !== pId) return parseInt(bpId);
  }

  if (window.recipeMap) {
    for (const [key, r] of Object.entries(window.recipeMap)) {
      if (r) {
        const currentPId = r.productTypeID || r.product || r.p || r.pId;
        if (parseInt(currentPId) === pId) {
          const bpId = r.blueprintTypeID || r.bp || r.bpId || key;
          if (bpId && parseInt(bpId) !== pId) return parseInt(bpId);
        }
      }
    }
  }

  return null;
}

async function fetchBlueprintData(typeId) {
  if (blueprintCache[typeId] !== undefined) {
    return blueprintCache[typeId];
  }

  if (RAW_BASE_MATERIALS && RAW_BASE_MATERIALS.has(typeId)) {
    blueprintCache[typeId] = null;
    return null;
  }

  if (recipeMap && recipeMap[typeId]) {
    blueprintCache[typeId] = recipeMap[typeId];
    return recipeMap[typeId];
  }

  if (window.EVE_RECIPES && window.EVE_RECIPES[typeId]) {
    const recipe = window.EVE_RECIPES[typeId];
    blueprintCache[typeId] = recipe;
    return recipe;
  }

  if (BUILTIN_RECIPES && BUILTIN_RECIPES[typeId]) {
    blueprintCache[typeId] = BUILTIN_RECIPES[typeId];
    return BUILTIN_RECIPES[typeId];
  }

  if (window.recipeMap) {
    for (const r of Object.values(window.recipeMap)) {
      if (r && (r.blueprintTypeID === typeId || r.productTypeID === typeId || r.bp === typeId || r.product === typeId || r.p === typeId || r.result === typeId || r.output === typeId)) {
        blueprintCache[typeId] = r;
        return r;
      }
    }
  }

  if (window.EVE_RECIPES) {
    for (const r of Object.values(window.EVE_RECIPES)) {
      if (r && (r.blueprintTypeID === typeId || r.productTypeID === typeId || r.bp === typeId || r.product === typeId || r.p === typeId || r.result === typeId || r.output === typeId)) {
        blueprintCache[typeId] = r;
        return r;
      }
    }
  }

  const tryTypeIds = [typeId];
  for (const targetId of tryTypeIds) {
    const fuzzworkUrl = `https://www.fuzzwork.co.uk/blueprint/api/blueprint.php?typeid=${targetId}`;
    const tryUrls = [
      fuzzworkUrl,
      `https://corsproxy.io/?${encodeURIComponent(fuzzworkUrl)}`
    ];

    for (const url of tryUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); 

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.activityMaterials && typeof data.activityMaterials === 'object') {
            const mfgMat = data.activityMaterials['1'] ? data.activityMaterials['1'].map(m => ({
              typeId: parseInt(m.typeid),
              name: m.name,
              baseQty: parseInt(m.quantity)
            })) : null;

            const reactionMat = data.activityMaterials['11'] ? data.activityMaterials['11'].map(m => ({
              typeId: parseInt(m.typeid),
              name: m.name,
              baseQty: parseInt(m.quantity)
            })) : null;

            // Safe parsing of nested Fuzzwork Data Contracts. Confirmed real schema (via live debugging):
            // blueprintDetails = { productTypeID, productTypeName, productQuantity, times: {"1": mfgSeconds, "11": reactionSeconds, ...}, ... }
            let resolvedProductTypeId = parseInt(data.productTypeID) || (data.blueprintDetails ? parseInt(data.blueprintDetails.productTypeID) : null) || window.BLUEPRINT_TO_PRODUCT_MAP[typeId] || typeId;
            let resolvedProductName = data.productTypeName || (data.blueprintDetails ? data.blueprintDetails.productTypeName : '') || '';

            let outputBatchYield = parseInt(data.productQtyPerRun) || (data.blueprintDetails ? parseInt(data.blueprintDetails.productQuantity ?? data.blueprintDetails.productQtyPerRun) : null) || parseInt(data.portionSize) || 1;
            if (data.activityProducts && typeof data.activityProducts === 'object') {
              const act1 = data.activityProducts['1'] || data.activityProducts[1];
              const act11 = data.activityProducts['11'] || data.activityProducts[11];
              if (act1 && act1[0] && act1[0].quantity) {
                outputBatchYield = parseInt(act1[0].quantity);
              } else if (act11 && act11[0] && act11[0].quantity) {
                outputBatchYield = parseInt(act11[0].quantity);
              }
            }

            const bpTimes = (data.blueprintDetails && data.blueprintDetails.times) || {};
            const resolvedTime = parseInt(data.time) || parseInt(bpTimes['1'] ?? bpTimes[1]) || parseInt(bpTimes['11'] ?? bpTimes[11]) || 0;

            if (mfgMat || reactionMat) {
              // Required skills each grant their own 1%/level manufacturing time bonus for items
              // requiring them (e.g. Triglavian Quantum Engineering). blueprintSkills is keyed by
              // ACTIVITY id (1=manufacturing, 8=invention, 11=reaction) - only manufacturing/reaction
              // skills actually affect build time here; invention-only skills (needed to invent a T2
              // BPC, not to run a job with one you already have) must be excluded, and so must
              // Industry/Advanced Industry (skill ids 3380/3388), which already get their own
              // dedicated, larger bonus elsewhere.
              const blueprintSkillsRaw = data.blueprintSkills || {};
              const mfgSkillsRaw = (blueprintSkillsRaw && typeof blueprintSkillsRaw === 'object')
                ? (blueprintSkillsRaw['1'] || blueprintSkillsRaw['11'] || [])
                : [];
              const requiredSkills = [];
              (Array.isArray(mfgSkillsRaw) ? mfgSkillsRaw : []).forEach(sk => {
                if (!sk || typeof sk !== 'object') return;
                const skillId = sk.typeid || sk.typeID || sk.skillID || sk.skill_id;
                const skillLevel = sk.level || sk.skillLevel || sk.requiredLevel;
                if (skillId === undefined || skillLevel === undefined) return;
                const skillIdInt = parseInt(skillId);
                if (skillIdInt === 3380 || skillIdInt === 3388) return; // Industry, Advanced Industry
                requiredSkills.push({ skillId: skillIdInt, level: parseInt(skillLevel) });
              });

              const parsed = {
                blueprintTypeID: data.blueprintTypeID,
                blueprintTypeName: data.blueprintTypeName || '',
                productTypeID: resolvedProductTypeId,
                productName: resolvedProductName,
                activityProducts: data.activityProducts || null,
                productQtyPerRun: outputBatchYield,
                mfgQtyPerRun: outputBatchYield,
                portionSize: outputBatchYield,
                batchYield: outputBatchYield,
                time: resolvedTime,
                requiredSkills: requiredSkills,
                mfgMaterials: mfgMat,
                reactionMaterials: reactionMat
              };

              blueprintCache[typeId] = parsed;
              if (parsed.productTypeID) blueprintCache[parsed.productTypeID] = parsed;
              if (parsed.blueprintTypeID) blueprintCache[parsed.blueprintTypeID] = parsed;
              return parsed;
            }
          }
        }
      } catch (e) {
        // Try next
      }
    }
  }

  blueprintCache[typeId] = null;
  return null;
}

const blueprintTimeCache = {}; // stores {time, batchYield} per blueprintTypeId - name kept for minimal diff
// Local/offline recipe data (recipeMap, EVE_RECIPES, BUILTIN_RECIPES) apparently never carries a
// build-time field - only recipes resolved through the online Fuzzwork fallback ever populated one.
// Since almost everything resolves locally first, this made "Est. Build Time" silently show nothing
// almost everywhere. Fetch just the time field from Fuzzwork (cached per blueprint) whenever the
// local recipe is missing it, so build time is available regardless of which path resolved the recipe.
// Also resolves batch yield (units produced per run) the same way - blueprintDetails.productQuantity
// has been observed to be unreliable for batch items (e.g. ammo/charges producing thousands of units
// per run), so activityProducts (the blueprint's own product listing) is checked first when present.
async function fetchBlueprintSupplementalData(blueprintTypeId) {
  if (blueprintTimeCache[blueprintTypeId] !== undefined) return blueprintTimeCache[blueprintTypeId];
  const fuzzworkUrl = `https://www.fuzzwork.co.uk/blueprint/api/blueprint.php?typeid=${blueprintTypeId}`;
  const tryUrls = [fuzzworkUrl, `https://corsproxy.io/?${encodeURIComponent(fuzzworkUrl)}`];
  for (const url of tryUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const bpDetails = data.blueprintDetails || {};
        const times = bpDetails.times || {};
        // 1 = manufacturing, 11 = reaction. Prefer manufacturing, fall back to reaction.
        const t = parseInt(times['1'] ?? times[1]) || parseInt(times['11'] ?? times[11]) || 0;

        let batchYield = 0;
        const actProducts = data.activityProducts || {};
        const act1 = actProducts['1'] || actProducts[1];
        const act11 = actProducts['11'] || actProducts[11];
        if (act1 && act1[0] && act1[0].quantity) batchYield = parseInt(act1[0].quantity);
        else if (act11 && act11[0] && act11[0].quantity) batchYield = parseInt(act11[0].quantity);
        if (!batchYield) batchYield = parseInt(bpDetails.productQuantity) || 0;

        if (t > 0 || batchYield > 0) {
          const result = { time: t, batchYield };
          blueprintTimeCache[blueprintTypeId] = result;
          if (t <= 0) console.warn(`[BuildTime] Fuzzwork responded for blueprint ${blueprintTypeId} but blueprintDetails.times had no manufacturing/reaction entry. times: ${JSON.stringify(times)}`);
          if (batchYield <= 0) console.warn(`[BatchYield] Fuzzwork responded for blueprint ${blueprintTypeId} but no usable per-run quantity was found. blueprintDetails: ${JSON.stringify(bpDetails)}, activityProducts keys: ${Object.keys(actProducts).join(', ')}`);
          return result;
        }
        console.warn(`[BuildTime/BatchYield] Fuzzwork responded for blueprint ${blueprintTypeId} but had neither a usable time nor batch yield. blueprintDetails: ${JSON.stringify(bpDetails)}`);
      } else {
        console.warn(`[BuildTime/BatchYield] Fuzzwork request for blueprint ${blueprintTypeId} via ${url.startsWith('https://corsproxy') ? 'corsproxy.io' : 'direct'} returned HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn(`[BuildTime/BatchYield] Fuzzwork request for blueprint ${blueprintTypeId} via ${url.startsWith('https://corsproxy') ? 'corsproxy.io' : 'direct'} failed (likely CORS/network block):`, e.message || e);
    }
  }
  const empty = { time: 0, batchYield: 0 };
  blueprintTimeCache[blueprintTypeId] = empty;
  return empty;
}
window.fetchBlueprintSupplementalData = fetchBlueprintSupplementalData;

// Checks only the direct, explicit per-run-quantity fields on a recipe - no name-based guessing.
// Used to decide whether a live Fuzzwork lookup is warranted (local data has nothing concrete to
// go on), as opposed to trusting a value that's already present but happens to be wrong.
function hasExplicitBatchYield(recipe) {
  if (!recipe) return false;
  if (typeof window.extractRecipeYield === 'function' && window.extractRecipeYield(recipe) > 0) return true;
  const rootCandidates = [
    recipe.productQtyPerRun, recipe.mfgQtyPerRun, recipe.reactionQtyPerRun, recipe.outputQty,
    recipe.portionSize, recipe.qty, recipe.productQty, recipe.pQty, recipe.yield,
    recipe.batchYield, recipe.amount, recipe.qtyPerRun
  ];
  return rootCandidates.some(c => { const v = parseInt(c); return !isNaN(v) && v > 0; });
}
window.hasExplicitBatchYield = hasExplicitBatchYield;

// Walks the STATIC recipe structure only - no full node construction, no quantity/ME/TE math, no
// supplemental time/batch-yield network lookups, none of what buildRecursiveRecipeTree itself does
// - purely to find every blueprint reachable from blueprintTypeId down to maxDepth and mark each one
// buildSelfOverrides[id] = true. Exists because buildRecursiveRecipeTree only ever recurses into a
// node's own children when THAT node is already marked to build (see its own isBuildingSelf check
// below) - so revealing a genuinely deep tree with everything set to Build used to need one full
// tree rebuild PER LEVEL (buildAllComponents' own now-removed guard loop, up to 25 rebuilds for one
// click - see its own comment in js/optimizers.js). Calling this once, first, to populate every
// override the eventual real build will need, means that real build can recurse to full depth in a
// single pass instead. Safe to do eagerly and relatively cheaply: eve_db.js/recipeMap are bundled
// with the page, not fetched over the network, so resolving "what materials does this blueprint
// need, and which of THOSE are themselves buildable" is local, synchronous-cost work all the way
// down - unlike prices or supplemental build-time data, which stay exactly where they always were,
// fetched lazily by the real build/recalculate that follows this, not touched here.
async function markBuildableDescendantsRecursive(blueprintTypeId, currentDepth, maxDepth, visited) {
  if (currentDepth >= maxDepth || visited.has(blueprintTypeId)) return;
  const recipe = await fetchBlueprintData(blueprintTypeId);
  if (!recipe) return;

  const allowReactions = document.getElementById('include-reactions')?.value !== 'false';
  let rawMaterials = recipe.mfgMaterials || recipe.materials || recipe.mats || recipe.m;
  if ((!rawMaterials || rawMaterials.length === 0) && allowReactions && recipe.reactionMaterials && recipe.reactionMaterials.length > 0) {
    rawMaterials = recipe.reactionMaterials;
  }
  if (!rawMaterials || rawMaterials.length === 0) return;

  const nextVisited = new Set(visited);
  nextVisited.add(blueprintTypeId);
  await Promise.all(rawMaterials.map(async (m) => {
    const matTypeId = parseInt(m.typeId || m.typeid || m.id || m.materialTypeID);
    const matName = m.name || (window.TYPE_ID_TO_NAME ? window.TYPE_ID_TO_NAME[matTypeId] : '');
    const childBlueprintTypeId = findBlueprintTypeIdForProduct(matTypeId) || resolveBlueprintIdFromProductName(matName);
    if (!childBlueprintTypeId) return;
    window.buildSelfOverrides[childBlueprintTypeId] = true;
    await markBuildableDescendantsRecursive(childBlueprintTypeId, currentDepth + 1, maxDepth, nextVisited);
  }));
}
window.markBuildableDescendantsRecursive = markBuildableDescendantsRecursive;

// Same walk as markBuildableDescendantsRecursive just above, collecting type IDs into `out` instead
// of setting build overrides - every blueprint AND its manufactured product, reachable from
// blueprintTypeId down to maxDepth, regardless of current build/buy state (unlike collectAllTypeIds
// in this same file, which only walks the tree object that's already been built - this walks the
// recipe DATA, so it finds materials that haven't been revealed as real nodes yet at all).
async function collectAllReachableTypeIds(blueprintTypeId, currentDepth, maxDepth, visited, out) {
  if (currentDepth >= maxDepth || visited.has(blueprintTypeId)) return;
  visited.add(blueprintTypeId);
  const recipe = await fetchBlueprintData(blueprintTypeId);
  if (!recipe) { out.add(blueprintTypeId); return; }

  const productTypeId = (window.BLUEPRINT_TO_PRODUCT_MAP && window.BLUEPRINT_TO_PRODUCT_MAP[blueprintTypeId]) || blueprintTypeId;
  out.add(productTypeId);

  const allowReactions = document.getElementById('include-reactions')?.value !== 'false';
  let rawMaterials = recipe.mfgMaterials || recipe.materials || recipe.mats || recipe.m;
  if ((!rawMaterials || rawMaterials.length === 0) && allowReactions && recipe.reactionMaterials && recipe.reactionMaterials.length > 0) {
    rawMaterials = recipe.reactionMaterials;
  }
  if (!rawMaterials || rawMaterials.length === 0) return;

  await Promise.all(rawMaterials.map(async (m) => {
    const matTypeId = parseInt(m.typeId || m.typeid || m.id || m.materialTypeID);
    if (!isNaN(matTypeId)) out.add(matTypeId);
    const matName = m.name || (window.TYPE_ID_TO_NAME ? window.TYPE_ID_TO_NAME[matTypeId] : '');
    const childBlueprintTypeId = findBlueprintTypeIdForProduct(matTypeId) || resolveBlueprintIdFromProductName(matName);
    if (childBlueprintTypeId) {
      await collectAllReachableTypeIds(childBlueprintTypeId, currentDepth + 1, maxDepth, visited, out);
    }
  }));
}

// Quietly prefetches prices for the WHOLE potential tree beneath blueprintTypeId, not just whatever
// happens to be currently expanded - called from selectItem() itself (js/app.js), fire-and-forget,
// never awaited, so it can't slow down or block the initial render at all. Reported directly: Build
// All / +1 Layer visibly lag on a big tree - part of that is the rebuild itself
// (markBuildableDescendantsRecursive's own comment covers that piece), but every newly-revealed
// material that's never been priced this session still needs its own real network-backed fetch the
// first time it's seen, same as any other item, regardless of how fast the rebuild itself gets.
// Since the full recipe structure is already known the instant an item is selected (bundled data,
// not fetched - see collectAllReachableTypeIds above), there's no reason to wait for the user to
// actually press Build All before finding out what it would need priced. Safe specifically because
// this app's price cache (window.priceCache, js/esi.js fetchMarketPrices) has no expiry within a
// session to begin with - a price fetched once is reused for the rest of the session regardless of
// how old it gets, so prefetching it earlier doesn't make anything more stale than fetching it
// later in that same session already would; it only changes WHEN the one-time fetch happens, not
// how fresh its result is treated afterward.
async function preloadPricesForFullTree(blueprintTypeId) {
  try {
    if (!blueprintTypeId || typeof window.fetchMarketPrices !== 'function') return;
    const typeIds = new Set();
    await collectAllReachableTypeIds(blueprintTypeId, 0, 10, new Set(), typeIds);
    if (typeIds.size > 0) await window.fetchMarketPrices(Array.from(typeIds));
  } catch (e) {}
}
window.preloadPricesForFullTree = preloadPricesForFullTree;

// Parallel Multi-Layer SDE Blueprint-Centric Tree Generator
async function buildRecursiveRecipeTree(blueprintTypeId, name, qtyNeeded, currentDepth, maxDepth, visitedPath = new Set(), parentNode = null, jobCount = 1) {
  // NOTE: window.recipeTreeRootProductTypeId is only valid for the ROOT node (depth 0) - it is
  // set once per selectItem() call for the item the user searched for. It must never be consulted
  // on recursive sub-component calls, or a child material would silently inherit the ROOT's
  // product ID whenever its own recipe/name resolution came up empty.
  let productTypeId = (currentDepth === 0 && window.recipeTreeRootProductTypeId) || window.BLUEPRINT_TO_PRODUCT_MAP[blueprintTypeId] || resolveProductIdFromBlueprintName(name) || blueprintTypeId;
  let productName = name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();

  const defaultBuildState = (currentDepth === 0) ? true : false;
  const isBuildingSelf = (buildSelfOverrides[blueprintTypeId] !== undefined) ? buildSelfOverrides[blueprintTypeId] : defaultBuildState;

  const node = {
    instanceId: ++instanceCounter,
    // A stable identity for "this position in the tree" that survives a full rebuild (instanceId
    // does not - it's a monotonically-increasing counter, so a preserveView selectItem() rebuild
    // like toggleBuildSelf's or buildAllComponents' hands every node a brand new one). A single
    // recipe's materials list can never contain the same typeId twice (tree.js's own matMap dedup
    // right below sees to that), so the chain of typeIds from root to here is always unique per
    // position - letting collapsedInstanceIds/expandedOverrideIds key off pathKey instead of
    // instanceId so a card's expand/collapse state survives a rebuild instead of silently
    // reverting to whatever the auto-compact threshold says.
    pathKey: (parentNode && parentNode.pathKey ? parentNode.pathKey + '>' : '') + blueprintTypeId,
    parentInstanceId: parentNode ? parentNode.instanceId : null,
    typeId: blueprintTypeId,
    displayTypeId: blueprintTypeId,
    productTypeId: productTypeId,
    name: name,
    productName: productName,
    qtyNeeded: qtyNeeded,
    depth: currentDepth,
    recipe: null,
    children: [],
    isManufacturable: false,
    isReaction: false,
    batchYield: 1,
    runsNeeded: 1,
    isBuildingSelf: isBuildingSelf,
    customME: customMEOverrides[blueprintTypeId] !== undefined ? customMEOverrides[blueprintTypeId] : getDefaultMeTeForBlueprint(blueprintTypeId).me,
    customTE: customTEOverrides[blueprintTypeId] !== undefined ? customTEOverrides[blueprintTypeId] : getDefaultMeTeForBlueprint(blueprintTypeId).te,
    unitEIV: 0,
    jobEIV: 0,
    jobFee: 0,
    // How many separate real jobs the actual root (currentDepth 0) represents - default 1, meaning
    // "one job, all these runs", today's ordinary behavior with zero change. Above 1 means this
    // node's OWN direct materials get costed as that many separate jobs of (runsNeeded / jobCount)
    // runs each, rather than one combined runsNeeded-run job - each real job rounds its own material
    // need up independently in EVE, which can need MORE material than one bigger combined job would.
    // Two real cases: an LP Store BPC redemption (every copy an offer grants is its own separate
    // single-run blueprint copy, a real EVE mechanic - see isolateOffer/evaluateBpcOffer/
    // ensureLPRedemptionNodesPresent, all of which set this), and a normal Calculator plan for several
    // physical BPC copies with a per-copy run cap (the "Jobs" field on the root card, recalculate()).
    // Read by this node's own material-quantity math right below AND by scaleTreeQuantities (on every
    // later recalculate) - never propagated to children, so it only ever affects a root's own direct
    // materials, never how those materials' own sub-components get sourced (which have no such
    // constraint and are still costed as one combined batch, same as everywhere else in the app).
    jobCount: currentDepth === 0 ? Math.max(1, jobCount || 1) : 1
  };

  try {
    const recipe = await fetchBlueprintData(blueprintTypeId);
    if (recipe) {
      // Safe resolution: a recipe's product-id field is only trustworthy if it actually points to a
      // DIFFERENT item than the blueprint itself. Some SDE/Fuzzwork entries (seen on Marauder- and
      // Triglavian-tier hulls like the Vargur/Leshak) leave this field empty or self-referential, which
      // previously caused node.productTypeId to silently fall back to the blueprint's own type ID -
      // breaking icons (blueprints aren't `/icon` items), prices (blueprints aren't market-traded), and
      // build costs (buying "the blueprint" instead of the ship). When that happens, trust the
      // independently name/BLUEPRINT_TO_PRODUCT_MAP-resolved productTypeId computed above instead.
      const recipeProductId = parseInt(recipe.productTypeID || recipe.product || recipe.p);
      node.productTypeId = (!isNaN(recipeProductId) && recipeProductId > 0 && recipeProductId !== blueprintTypeId)
        ? recipeProductId
        : productTypeId;
      // Prefer the authoritative name registered for the resolved productTypeId. Fall back to a
      // cleaned copy of the recipe's own productName - some SDE/Fuzzwork entries store the raw
      // blueprint name there (e.g. "Item Blueprint") instead of the manufactured item's name, which
      // was leaking the word "Blueprint" onto cards even after productTypeId itself was corrected.
      const cleanRecipeProductName = recipe.productName
        ? recipe.productName.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim()
        : '';
      node.productName = window.TYPE_ID_TO_NAME[node.productTypeId] || cleanRecipeProductName || productName;
      node.isManufacturable = true;
      
      const allowReactions = document.getElementById('include-reactions')?.value !== 'false';

      let rawMaterials = recipe.mfgMaterials || recipe.materials || recipe.mats || recipe.m;
      let isReaction = false;

      if ((!rawMaterials || rawMaterials.length === 0) && allowReactions && recipe.reactionMaterials && recipe.reactionMaterials.length > 0) {
        rawMaterials = recipe.reactionMaterials;
        isReaction = true;
      }

      if (rawMaterials && rawMaterials.length > 0) {
        const activeMaterials = [];
        const matMap = {};

        rawMaterials.forEach(m => {
          const tId = parseInt(m.typeId || m.typeid || m.id || m.materialTypeID);
          const qty = parseInt(m.baseQty || m.quantity || m.qty || 1);
          const matName = m.name || (window.TYPE_ID_TO_NAME ? window.TYPE_ID_TO_NAME[tId] : '') || 'Material';

          if (matMap[tId]) {
            matMap[tId].baseQty = Math.max(matMap[tId].baseQty, qty);
          } else {
            matMap[tId] = {
              typeId: tId,
              name: matName,
              baseQty: qty
            };
            activeMaterials.push(matMap[tId]);
          }
        });

        let batchYield = getBatchYield(recipe, isReaction);
        const batchYieldIsExplicit = hasExplicitBatchYield(recipe);

        node.recipe = { ...recipe, materials: activeMaterials, productQtyPerRun: batchYield, portionSize: batchYield, batchYield: batchYield };
        node.isReaction = isReaction;
        node.batchYield = batchYield;

        const existingTime = typeof window.extractBuildTime === 'function'
          ? window.extractBuildTime(node.recipe)
          : parseInt(node.recipe.time || node.recipe.t || node.recipe.timeSeconds || node.recipe.duration || node.recipe.mfgTime || node.recipe.productionTime || 0);

        if (!(existingTime > 0) || !batchYieldIsExplicit) {
          try {
            const supplemental = await fetchBlueprintSupplementalData(blueprintTypeId);

            if (supplemental.time > 0) {
              node.recipe.time = supplemental.time;
            } else if (!(existingTime > 0)) {
              console.warn(`[BuildTime] No time data for "${node.productName || name}" (blueprint ${blueprintTypeId}). Local recipe had no usable time field, and the live Fuzzwork lookup also returned nothing (network/CORS block, or Fuzzwork has no data for this blueprint). Local recipe keys: ${Object.keys(node.recipe).join(', ')}`);
            }

            if (!batchYieldIsExplicit) {
              if (supplemental.batchYield > 0) {
                // Local data had nothing concrete (only a name-based guess or the bare default of 1) -
                // the live per-run quantity from Fuzzwork's own product listing is authoritative here.
                batchYield = supplemental.batchYield;
                node.batchYield = batchYield;
                node.recipe.batchYield = batchYield;
                node.recipe.productQtyPerRun = batchYield;
                node.recipe.portionSize = batchYield;
              } else {
                console.warn(`[BatchYield] No real per-run quantity found locally or via live Fuzzwork lookup for "${node.productName || name}" (blueprint ${blueprintTypeId}). Falling back to a heuristic/default guess of ${batchYield} units per run - this is likely wrong. Regenerating your local database (generate_db.py) may fix this once its own data is available.`);
              }
            }
          } catch (e) {
            console.warn(`[BuildTime/BatchYield] Fuzzwork lookup threw an error for blueprint ${blueprintTypeId}:`, e);
          }
        }

        const me = isReaction ? 0 : node.customME;
        const facility = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
        // Rig ME bonus matches the category of what THIS node is manufacturing (its own product),
        // not the raw materials being consumed - an Ammunition rig reduces materials needed to BUILD
        // ammo, regardless of which specific minerals/components go into it.
        const rigMEBonus = window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(node.productTypeId, 'ME') : 0;

        const runsNeeded = Math.ceil(qtyNeeded / batchYield);
        node.runsNeeded = runsNeeded;

        const nextVisited = new Set(visitedPath);
        nextVisited.add(blueprintTypeId);
        if (node.productTypeId) {
          nextVisited.add(node.productTypeId);
        }

        const isCircular = visitedPath.has(blueprintTypeId) || (node.productTypeId && visitedPath.has(node.productTypeId));

        if (currentDepth < maxDepth && !isCircular && isBuildingSelf) {
          const childPromises = activeMaterials.map(async mat => {
            try {
              // See node.jobCount's own comment above: jobCount separate jobs each round their own
              // material need up independently, which can need MORE than one combined runsNeeded-run
              // job would (ceil(a)+ceil(b)+... >= ceil(a+b+...)) - so for jobCount > 1, round per job
              // and multiply, rather than rounding once on the combined runsNeeded total. jobCount is
              // always 1 by default, where this is exactly the original single computation.
              const childQty = node.jobCount > 1
                ? node.jobCount * calculateInputQuantity(mat.baseQty, runsNeeded / node.jobCount, me, facility, isReaction, rigMEBonus)
                : calculateInputQuantity(mat.baseQty, runsNeeded, me, facility, isReaction, rigMEBonus);
              // findBlueprintTypeIdForProduct relies on the recipe map already being reverse-indexed by
              // product id - which fails for materials whose SDE/Fuzzwork entry never populated a usable
              // productTypeID/product/p field (the same data gap that broke Vargur/Leshak). Fall back to
              // a name-based lookup ("X" -> "X Blueprint"/"X Formula") so genuinely buildable materials
              // still get recognized and get their Build/Buy button instead of being silently treated
              // as raw, non-manufacturable items.
              const childBlueprintTypeId = findBlueprintTypeIdForProduct(mat.typeId) || resolveBlueprintIdFromProductName(mat.name);

              if (childBlueprintTypeId) {
                return await buildRecursiveRecipeTree(childBlueprintTypeId, mat.name + ' Blueprint', childQty, currentDepth + 1, maxDepth, nextVisited, node);
              } else {
                return {
                  instanceId: ++instanceCounter,
                  // See the root node constructor's own comment on pathKey above - raw materials
                  // (no blueprint of their own, hence this branch) are the bulk of every tree and
                  // the most common same-tier merge/compact target, so a missing pathKey here is
                  // what silently broke the Compact button and collapse/expand persistence for
                  // almost every material in a real build.
                  pathKey: (node.pathKey ? node.pathKey + '>' : '') + mat.typeId,
                  parentInstanceId: node.instanceId,
                  typeId: mat.typeId,
                  displayTypeId: mat.typeId,
                  productTypeId: mat.typeId,
                  name: mat.name,
                  qtyNeeded: childQty,
                  depth: currentDepth + 1,
                  children: [],
                  isManufacturable: false,
                  isBuildingSelf: false
                };
              }
            } catch (err) {
              return {
                instanceId: ++instanceCounter,
                pathKey: (node.pathKey ? node.pathKey + '>' : '') + mat.typeId,
                parentInstanceId: node.instanceId,
                typeId: mat.typeId,
                displayTypeId: mat.typeId,
                productTypeId: mat.typeId,
                name: mat.name,
                qtyNeeded: mat.baseQty,
                depth: currentDepth + 1,
                children: [],
                isManufacturable: false,
                isBuildingSelf: false
              };
            }
          });

          node.children = await Promise.all(childPromises);
        }
      }
    }
  } catch (err) {
    console.error('Tree error on node:', name, err);
  }

  return node;
}

function calculateInputQuantity(baseQty, runs, me, facilityBonus, isReaction = false, rigMEBonus = 0) {
  const meFactor = isReaction ? 1.0 : (1 - me / 100);
  const facFactor = (1 - parseFloat(facilityBonus || 0));
  const rigFactor = 1 - (parseFloat(rigMEBonus) || 0) / 100;
  const minQty = isReaction ? 1 : runs;
  return Math.max(minQty, Math.ceil(runs * baseQty * meFactor * facFactor * rigFactor));
}

function scaleTreeQuantities(node, facility) {
  if (!node.recipe || !node.children) return;

  const batchYield = node.batchYield || getBatchYield(node.recipe, node.isReaction) || 1;
  node.batchYield = batchYield;
  const runsNeeded = Math.ceil(node.qtyNeeded / batchYield);
  node.runsNeeded = runsNeeded;

  const effectiveME = node.isReaction ? 0 : (node.customME || 0);
  const rigMEBonus = window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(node.productTypeId, 'ME') : 0;

  node.children.forEach(child => {
    const childProductTypeId = child.productTypeId || child.typeId;
    const mat = Array.isArray(node.recipe.materials) ? node.recipe.materials.find(m => m.typeId === childProductTypeId) : null;
    if (mat) {
      // See node.jobCount in buildRecursiveRecipeTree for why this branches - this is what actually
      // runs on every later recalculate() (the root card's Jobs/Runs inputs changing, or the LP
      // Store's "Times Redeemed" input), not just the initial tree build, so it needs the same
      // split-vs-combined logic.
      child.qtyNeeded = node.jobCount > 1
        ? node.jobCount * calculateInputQuantity(mat.baseQty, runsNeeded / node.jobCount, effectiveME, facility, node.isReaction, rigMEBonus)
        : calculateInputQuantity(mat.baseQty, runsNeeded, effectiveME, facility, node.isReaction, rigMEBonus);
    }
    scaleTreeQuantities(child, facility);
  });
}

// Explicit window bindings
window.resolveProductIdFromBlueprintName = resolveProductIdFromBlueprintName;
window.resolveBlueprintIdFromProductName = resolveBlueprintIdFromProductName;
window.getBatchYield = getBatchYield;
window.collectAllTypeIds = collectAllTypeIds;
window.findBlueprintTypeIdForProduct = findBlueprintTypeIdForProduct;
window.fetchBlueprintData = fetchBlueprintData;
window.buildRecursiveRecipeTree = buildRecursiveRecipeTree;
window.calculateInputQuantity = calculateInputQuantity;
window.scaleTreeQuantities = scaleTreeQuantities;