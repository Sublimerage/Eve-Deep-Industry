'use strict';

// =============================================================================================
// LP Store Calculator
// =============================================================================================
// Ranks every offer in a Faction Warfare loyalty point store by ISK profit per LP spent, so the
// player can see what's actually worth their LP without weighing standing/access requirements
// themselves (those are ignored entirely here - see the corp list note below).
//
// Two offer shapes exist in the ESI response, and this file treats them very differently:
//   - "direct" offers hand over a finished, market-sellable item (ammo, implants, skillbooks, ...).
//     Their value is pure market arithmetic: what the item sells for, minus what the ISK cost and
//     required_items cost to acquire.
//   - "bpc" offers hand over a Blueprint Copy instead of a finished item (recognizable because the
//     offer's own type_id IS a blueprint, not a product - see isBlueprintOffer()). Their value is
//     what building that BPC out actually nets, which means running the same recursive recipe tree
//     pipeline (js/tree.js) the main Calculator and Invention pages already use, under whatever
//     production preset (system/structure/rigs) is currently active - this page has no station
//     picker of its own, exactly like js/invention.js.
//
// Every ESI offer field (isk_cost, lp_cost, required_items) is a flat, static number with no
// tier/standing/participation component anywhere in the schema - confirmed by pulling real offer
// data during development, not assumed. That's why standing is never factored in here: it doesn't
// change the price, only whether you're currently allowed to buy it, which is the player's own
// problem to solve in-game.
//
// A BPC offer's "Isolate" button hands off to the Calculator's OWN tree canvas and Bill of
// Materials sidebar (js/app.js, also loaded on this page) rather than a lookalike rebuild - see
// isolateOffer() below and the plan this was built from for why. The one new capability that adds
// - acquiring a component via this store's own LP offer instead of building or buying it - is a
// small guarded addition to js/app.js's createNodeCard and js/optimizers.js's
// calculateTreeNodeCost, inert everywhere except when window.__lpOfferByOutputTypeId has a match.
// =============================================================================================

// Every NPC corporation in the game with a real, non-empty LP store - not just the 4 Faction
// Warfare warzone corps this used to be limited to. Generated (not hand-typed - the
// project_builtin_recipes_overwrite_risk memory is exactly why: a hand-typed/wiki-sourced recipe
// entry was wrong and had to be fully audited out) by scripts/fetch_lp_corps.js, in two verified
// steps: (1) every one of ESI's 283 NPC corporation ids is checked live against
// /loyalty/stores/{id}/offers/ and kept only if it actually returns a non-empty store (181 do -
// most NPC corps don't have one at all); (2) each surviving corp's faction comes from CCP's own
// static data export (Fuzzwork's crpNPCCorporations.csv mirror), not ESI's /corporations/{id}/
// endpoint, which leaves faction_id empty for the overwhelming majority of these (confirmed - only
// live-ESI-and-ID-lookup coincidentally worked for the original 9-entry list because those specific
// corps happen to be the ones CCP's live endpoint does populate). `color` is a decorative UI choice
// for the picker/ranked-list, same as it always was here - not itself sourced from ESI/SDE.
// Re-run scripts/fetch_lp_corps.js + scripts/format_lp_corps.js if CCP ever adds/removes a store.
const LP_STORE_CORPS = [
  { corpId: 1000179, corpName: '24th Imperial Crusade', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000073, corpName: 'Amarr Certified News', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000079, corpName: 'Amarr Civil Service', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000063, corpName: 'Amarr Constructions', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000084, corpName: 'Amarr Navy', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000083, corpName: 'Amarr Trade Registry', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000090, corpName: 'Ardishapur Family', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000064, corpName: 'Carthum Conglomerate', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000092, corpName: 'Civic Court', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000085, corpName: 'Court Chamberlain', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000069, corpName: 'Ducia Foundry', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000086, corpName: 'Emperor Family', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000076, corpName: 'Further Foodstuffs', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000165, corpName: 'Hedion University', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000070, corpName: 'HZO Refinery', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000166, corpName: 'Imperial Academy', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000065, corpName: 'Imperial Armaments', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000078, corpName: 'Imperial Chancellor', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000072, corpName: 'Imperial Shipment', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000283, corpName: 'Imperial War Reserves', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000071, corpName: 'Inherent Implants', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000074, corpName: 'Joint Harvesting', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000087, corpName: 'Kador Family', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000089, corpName: 'Kor-Azor Family', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000081, corpName: 'Ministry of Assessment', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000082, corpName: 'Ministry of Internal Order', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000080, corpName: 'Ministry of War', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000068, corpName: 'Noble Appliances', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000075, corpName: 'Nurtura', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000077, corpName: 'Royal Amarr Institute', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000088, corpName: 'Sarum Family', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000091, corpName: 'Tash-Murkon Family', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000093, corpName: 'Theology Council', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000066, corpName: 'Viziam', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000067, corpName: 'Zoar and Sons', faction: 'Amarr Empire', factionId: 500003, color: '#e0c168' },
  { corpId: 1000126, corpName: 'Ammatar Consulate', faction: 'Ammatar Mandate', factionId: 500007, color: '#d4a05c' },
  { corpId: 1000123, corpName: 'Ammatar Fleet', faction: 'Ammatar Mandate', factionId: 500007, color: '#d4a05c' },
  { corpId: 1000154, corpName: 'Nefantar Miner Association', faction: 'Ammatar Mandate', factionId: 500007, color: '#d4a05c' },
  { corpId: 1000124, corpName: 'Archangels', faction: 'Angel Cartel', factionId: 500011, color: '#e05a5a' },
  { corpId: 1000138, corpName: 'Dominations', faction: 'Angel Cartel', factionId: 500011, color: '#e05a5a' },
  { corpId: 1000136, corpName: 'Guardian Angels', faction: 'Angel Cartel', factionId: 500011, color: '#e05a5a' },
  { corpId: 1000436, corpName: 'Malakim Zealots', faction: 'Angel Cartel', factionId: 500011, color: '#e05a5a' },
  { corpId: 1000133, corpName: 'Salvation Angels', faction: 'Angel Cartel', factionId: 500011, color: '#e05a5a' },
  { corpId: 1000134, corpName: 'Blood Raiders', faction: 'Blood Raider Covenant', factionId: 500012, color: '#a03030' },
  { corpId: 1000033, corpName: 'Caldari Business Tribunal', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000026, corpName: 'Caldari Constructions', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000028, corpName: 'Caldari Funds Unlimited', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000035, corpName: 'Caldari Navy', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000009, corpName: 'Caldari Provisions', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000015, corpName: 'Caldari Steel', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000002, corpName: 'CBD Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000024, corpName: 'CBD Sell Division', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000031, corpName: 'Chief Executive Panel', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000043, corpName: 'Corporate Police Force', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000006, corpName: 'Deep Core Mining Inc.', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000018, corpName: 'Echelon Entertainment', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000023, corpName: 'Expert Distribution', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000027, corpName: 'Expert Housing', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000039, corpName: 'Home Guard', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000034, corpName: 'House of Records', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000005, corpName: 'Hyasyoda Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000036, corpName: 'Internal Security', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000019, corpName: 'Ishukone Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000038, corpName: 'Ishukone Watch', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000010, corpName: 'Kaalakiota Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000020, corpName: 'Lai Dai Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000037, corpName: 'Lai Dai Protection Service', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000032, corpName: 'Mercantile Club', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000008, corpName: 'Minedrill', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000030, corpName: 'Modern Finances', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000017, corpName: 'Nugoeihuvi Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000040, corpName: 'Peace and Order Unit', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000014, corpName: 'Perkone', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000007, corpName: 'Poksu Mineral Group', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000003, corpName: 'Prompt Delivery', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000022, corpName: 'Propel Dynamics', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000013, corpName: 'Rapid Assembly', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000044, corpName: 'School of Applied Knowledge', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000045, corpName: 'Science and Trade Institute', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000041, corpName: 'Spacelane Patrol', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000029, corpName: 'State and Region Bank', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000284, corpName: 'State Military Stockpile', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000180, corpName: 'State Protectorate', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000167, corpName: 'State War Academy', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000025, corpName: 'Sukuuvestaa Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000012, corpName: 'Top Down', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000011, corpName: 'Wiyrkomi Corporation', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000042, corpName: 'Wiyrkomi Peace Corps', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000004, corpName: 'Ytiri', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000016, corpName: 'Zainou', faction: 'Caldari State', factionId: 500001, color: '#5b9bd5' },
  { corpId: 1000125, corpName: 'CONCORD', faction: 'CONCORD Assembly', factionId: 500006, color: '#8fa3b3' },
  { corpId: 1000137, corpName: 'DED', faction: 'CONCORD Assembly', factionId: 500006, color: '#8fa3b3' },
  { corpId: 1000096, corpName: 'Inner Zone Shipping', faction: 'EverMore', factionId: 500013, color: '#b8c4cc' },
  { corpId: 1000419, corpName: 'Paragon', faction: 'EverMore', factionId: 500013, color: '#b8c4cc' },
  { corpId: 1000021, corpName: 'Zero-G Research Firm', faction: 'EverMore', factionId: 500013, color: '#b8c4cc' },
  { corpId: 1000111, corpName: 'Aliastra', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000103, corpName: 'Allotek Industries', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000098, corpName: 'Astral Mining Inc.', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000112, corpName: 'Bank of Luminaire', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000169, corpName: 'Center for Advanced Studies', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000108, corpName: 'Chemal Tech', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000099, corpName: 'Combined Harvest', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000101, corpName: 'CreoDron', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000109, corpName: 'Duvolle Laboratories', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000106, corpName: 'Egonics Inc.', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000119, corpName: 'Federal Administration', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000181, corpName: 'Federal Defense Union', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000095, corpName: 'Federal Freight', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000121, corpName: 'Federal Intelligence Office', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000168, corpName: 'Federal Navy Academy', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000285, corpName: 'Federal Strategic Materiel', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000122, corpName: 'Federation Customs', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000120, corpName: 'Federation Navy', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000110, corpName: 'FedMart', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000114, corpName: 'Garoun Investment Bank', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000105, corpName: 'Impetus', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000097, corpName: 'Material Acquisition', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000113, corpName: 'Pend Insurance', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000104, corpName: 'Poteque Pharmaceuticals', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000116, corpName: 'President', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000100, corpName: 'Quafe Company', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000102, corpName: 'Roden Shipyards', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000117, corpName: 'Senate', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000118, corpName: 'Supreme Court', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000107, corpName: 'The Scope', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000094, corpName: 'TransStellar Shipping', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000115, corpName: 'University of Caille', faction: 'Gallente Federation', factionId: 500004, color: '#6fbf73' },
  { corpId: 1000437, corpName: 'Commando Guri', faction: 'Guristas Pirates', factionId: 500010, color: '#e8c14a' },
  { corpId: 1000127, corpName: 'Guristas', faction: 'Guristas Pirates', factionId: 500010, color: '#e8c14a' },
  { corpId: 1000141, corpName: 'Guristas Production', faction: 'Guristas Pirates', factionId: 500010, color: '#e8c14a' },
  { corpId: 1000151, corpName: 'Khanid Innovation', faction: 'Khanid Kingdom', factionId: 500008, color: '#8a5a9e' },
  { corpId: 1000152, corpName: 'Khanid Transport', faction: 'Khanid Kingdom', factionId: 500008, color: '#8a5a9e' },
  { corpId: 1000153, corpName: 'Khanid Works', faction: 'Khanid Kingdom', factionId: 500008, color: '#8a5a9e' },
  { corpId: 1000156, corpName: 'Royal Khanid Navy', faction: 'Khanid Kingdom', factionId: 500008, color: '#8a5a9e' },
  { corpId: 1000057, corpName: 'Boundless Creation', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000049, corpName: 'Brutor Tribe', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000056, corpName: 'Core Complexion Inc.', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000058, corpName: 'Eifyr and Co.', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000061, corpName: 'Freedom Extension', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000047, corpName: 'Krusual Tribe', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000055, corpName: 'Minmatar Mining Corporation', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000060, corpName: 'Native Freshfood', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000172, corpName: 'Pator Tech School', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000051, corpName: 'Republic Fleet', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000286, corpName: 'Republic Fleet Ordnance', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000052, corpName: 'Republic Justice Department', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000170, corpName: 'Republic Military School', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000050, corpName: 'Republic Parliament', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000054, corpName: 'Republic Security Services', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000171, corpName: 'Republic University', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000046, corpName: 'Sebiestor Tribe', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000059, corpName: 'Six Kin Development', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000062, corpName: 'The Leisure Group', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000182, corpName: 'Tribal Liberation Force', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000053, corpName: 'Urban Management', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000048, corpName: 'Vherokior Tribe', faction: 'Minmatar Republic', factionId: 500002, color: '#c85a4a' },
  { corpId: 1000128, corpName: "Mordu's Legion", faction: "Mordu's Legion Command", factionId: 500018, color: '#5a7a8a' },
  { corpId: 1000277, corpName: 'Frostline Laboratories', faction: 'ORE', factionId: 500014, color: '#d98c3a' },
  { corpId: 1000276, corpName: 'ORE Technologies', faction: 'ORE', factionId: 500014, color: '#d98c3a' },
  { corpId: 1000270, corpName: 'Outer Ring Development', faction: 'ORE', factionId: 500014, color: '#d98c3a' },
  { corpId: 1000129, corpName: 'Outer Ring Excavations', faction: 'ORE', factionId: 500014, color: '#d98c3a' },
  { corpId: 1000271, corpName: 'Outer Ring Prospecting', faction: 'ORE', factionId: 500014, color: '#d98c3a' },
  { corpId: 1000161, corpName: "True Creations", faction: "Sansha's Nation", factionId: 500019, color: '#c04ac0' },
  { corpId: 1000162, corpName: 'True Power', faction: "Sansha's Nation", factionId: 500019, color: '#c04ac0' },
  { corpId: 1000135, corpName: 'Serpentis Corporation', faction: 'Serpentis', factionId: 500020, color: '#4ac084' },
  { corpId: 1000157, corpName: 'Serpentis Inquest', faction: 'Serpentis', factionId: 500020, color: '#4ac084' },
  { corpId: 1000139, corpName: 'Food Relief', faction: 'Servant Sisters of EVE', factionId: 500016, color: '#3ac8b8' },
  { corpId: 1000130, corpName: 'Sisters of EVE', faction: 'Servant Sisters of EVE', factionId: 500016, color: '#3ac8b8' },
  { corpId: 1000159, corpName: 'The Sanctuary', faction: 'Servant Sisters of EVE', factionId: 500016, color: '#3ac8b8' },
  { corpId: 1000140, corpName: 'Genolution', faction: 'The Society of Conscious Thought', factionId: 500017, color: '#4ac8e0' },
  { corpId: 1000131, corpName: 'Society of Conscious Thought', faction: 'The Society of Conscious Thought', factionId: 500017, color: '#4ac8e0' },
  { corpId: 1000144, corpName: 'Intaki Bank', faction: 'The Syndicate', factionId: 500009, color: '#7a6a8a' },
  { corpId: 1000145, corpName: 'Intaki Commerce', faction: 'The Syndicate', factionId: 500009, color: '#7a6a8a' },
  { corpId: 1000146, corpName: 'Intaki Space Police', faction: 'The Syndicate', factionId: 500009, color: '#7a6a8a' },
  { corpId: 1000147, corpName: 'Intaki Syndicate', faction: 'The Syndicate', factionId: 500009, color: '#7a6a8a' },
  { corpId: 1000160, corpName: 'Thukker Mix', faction: 'Thukker Tribe', factionId: 500015, color: '#a06a3a' },
  { corpId: 1000163, corpName: 'Trust Partners', faction: 'Thukker Tribe', factionId: 500015, color: '#a06a3a' },
  { corpId: 1000293, corpName: 'Perun Clade', faction: 'Triglavian Collective', factionId: 500026, color: '#3ec87a' },
  { corpId: 1000294, corpName: 'Svarog Clade', faction: 'Triglavian Collective', factionId: 500026, color: '#3ec87a' },
  { corpId: 1000298, corpName: 'The Convocation of Triglav', faction: 'Triglavian Collective', factionId: 500026, color: '#3ec87a' },
  { corpId: 1000292, corpName: 'Veles Clade', faction: 'Triglavian Collective', factionId: 500026, color: '#3ec87a' }
];
window.LP_STORE_CORPS = LP_STORE_CORPS;

let _lpOffersCache = {};      // corpId -> raw ESI offers array
let _lpRankedResults = [];    // last computed, sorted evaluation results
let _lpActiveCorpId = null;
let _lpIsLoading = false;
let _lpTypeFilter = 'all';    // 'all' | 'direct' | 'bpc'
let _lpCategoryFilter = 'all'; // 'all' | 'favorites' | a numeric SDE category id (string) | 'other'
let _lpSearchQuery = '';      // free-text filter against the offer's own output item name

// Favorited offers - keyed by "corpId:offer_id", NOT bare offer_id. offer_id turned out not to be
// globally unique across corporations - confirmed live: offer_id 4102 is a real, different offer in
// BOTH Guristas' Commando Guri store (a "Security Connections" ISK/LP offer) AND Amarr's 24th
// Imperial Crusade store, and ESI has no way to disambiguate them beyond which store you asked. A
// favorite keyed by bare offer_id therefore didn't just mis-report a count for another store (the
// bug as originally reported) - filtering to Favorites in one corp could silently show a
// completely unrelated offer from a DIFFERENT corp that happened to reuse the same id. corpId
// disambiguates that; offer_id alone still separates distinct offers for the same item WITHIN one
// corp's own store (CCP can and does offer the same item through several distinct offer_id combos
// in a single store - see the ranked-list row's own comment on requiredItemsSummary), so this key
// keeps both properties. Loaded eagerly (not inside the load listener) since it's a synchronous
// localStorage read with no page dependency, same as any other simple persisted preference.
//
// Existing saved values from before this fix are bare offer_ids with no corp attached at all -
// there's no way to know which corp they belonged to, and keeping them risks exactly the
// cross-corp collision above, so they're discarded rather than guessed-migrated. Anything already
// in the new "corpId:offerId" shape (contains ':') is kept.
let _lpFavoriteOfferIds = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('eve_lpstore_favorites') || '[]');
  _lpFavoriteOfferIds = new Set(saved.filter(v => typeof v === 'string' && v.includes(':')));
} catch (e) { /* corrupt/old value - start fresh rather than fail the whole page */ }

function lpFavoriteKey(offerId) {
  return `${_lpActiveCorpId}:${offerId}`;
}

function saveLPFavorites() {
  localStorage.setItem('eve_lpstore_favorites', JSON.stringify([..._lpFavoriteOfferIds]));
}

function toggleLPFavorite(offerId) {
  const key = lpFavoriteKey(offerId);
  if (_lpFavoriteOfferIds.has(key)) _lpFavoriteOfferIds.delete(key);
  else _lpFavoriteOfferIds.add(key);
  saveLPFavorites();
  renderLPCategoryBar(); // favorites count badge
  renderLPStoreTable();  // star fill + (if currently viewing the Favorites filter) list membership
}
window.toggleLPFavorite = toggleLPFavorite;

// Icon + label config for the category filter bar (js/lpstore.js renderLPCategoryBar) - one source
// of truth for id/label/icon, walked to both render the buttons and (via LP_CATEGORY_LABELS below,
// kept as the id->label lookup other code already uses) resolve a typeId's own category.
//
// 'blueprints' is a sentinel, not a real SDE category id, same idea as 'favorites'/'other' below.
// A BPC offer is classified by what it BUILDS (evaluateBpcOffer sets outputTypeId to the product,
// not the blueprint item itself - see its own comment), so a ship BPC already lives under Ships,
// an implant BPC under Implants, etc. - real SDE category 9 ("Blueprint") essentially never gets
// hit that way, which is why this pill showed nothing before. Fixed by making it a cross-cutting
// filter instead: every offer that grants a BPC, regardless of what it builds - see the
// 'blueprints' branch in renderLPStoreTable's filter chain below.
const LP_CATEGORY_FILTERS = [
  { id: 'all', label: 'All', icon: 'grid' },
  { id: 'favorites', label: 'Favorites', icon: 'star' },
  { id: 'blueprints', label: 'Blueprints', icon: 'file-text' },
  { id: '6', label: 'Ships', icon: 'rocket' },
  { id: '7', label: 'Modules', icon: 'gear' },
  { id: '8', label: 'Ammo', icon: 'ammo' },
  { id: '18', label: 'Drones', icon: 'drone' },
  { id: '20', label: 'Implants', icon: 'cpu' },
  { id: '16', label: 'Skillbooks', icon: 'book' },
  { id: '91', label: 'SKINs', icon: 'skin' },
  { id: 'other', label: 'Other', icon: 'package' }
];

// Renders into #lpstore-category-bar (top of the ranked-offers card, lpstore.html) - called on
// initial load, on every setLPStoreCategoryFilter, and on toggleLPFavorite (for the count badge).
// Deliberately separate from renderLPStoreTable: switching the active pill doesn't need the whole
// (potentially large) table to re-render, only itself and the table's own filter pass.
function renderLPCategoryBar() {
  const el = document.getElementById('lpstore-category-bar');
  if (!el) return;
  // Favorites are keyed by offer_id, which is only meaningful within the store it came from - a
  // favorite saved in one corp's store has no counterpart offer_id in a different corp's own list
  // (see the note above _lpFavoriteOfferIds). The badge used to show _lpFavoriteOfferIds.size, the
  // GLOBAL count across every corp ever favorited from, which kept showing a nonzero number here
  // even when none of those favorites exist in the currently-loaded corp's own offers - a count
  // for favorites you couldn't actually see or filter to from this screen. Scoped to just the
  // current corp's own ranked offers instead, matching what clicking the pill actually filters to.
  const favoritesInThisStore = _lpRankedResults.filter(r => _lpFavoriteOfferIds.has(lpFavoriteKey(r.offer.offer_id))).length;
  el.innerHTML = LP_CATEGORY_FILTERS.map(f => {
    const active = _lpCategoryFilter === f.id;
    const badge = f.id === 'favorites' && favoritesInThisStore
      ? `<span class="mono" style="margin-left:5px; opacity:0.75;">${favoritesInThisStore}</span>`
      : '';
    return `<button onclick="setLPStoreCategoryFilter('${f.id}')" class="lp-pill${active ? ' active' : ''}" title="${window.esc(f.label)}">${window.svgIcon(f.icon)}${window.esc(f.label)}${badge}</button>`;
  }).join('');
}
window.renderLPCategoryBar = renderLPCategoryBar;
let _lpItemCategoryCache = {}; // typeId -> category id, resolved live (see resolveLPItemCategories)
let _lpSortKey = 'iskPerLp';
let _lpSortDir = -1;          // -1 desc, 1 asc

// How the item you get is valued (Ranked Offers, Find Item estimates, the isolated card's LP-aware
// profit): 'sell' = list it yourself at the Jita sell price, net of sales tax AND broker fee (the
// original behavior, and the default); 'instant' = sell straight into the highest Jita buy order -
// usually less ISK per item, but no waiting and no broker fee (sales tax still applies). Same rule
// the Calculator already uses for its own instant-sell figure (netBuyRevenue in js/app.js). The
// cost side (required items, materials) is always what you'd pay to acquire them, unaffected.
// Shared with the phone layout (js/mobile-lp.js) through the same localStorage key.
const LP_SELL_MODE_KEY = 'eve_lp_sell_mode';
let _lpSellMode = 'sell';
try { if (localStorage.getItem(LP_SELL_MODE_KEY) === 'instant') _lpSellMode = 'instant'; } catch (e) { /* storage blocked - stays on 'sell' */ }
function lpOutputUnitPrice(typeId) {
  const p = (window.priceCache && window.priceCache[typeId]) || {};
  return (_lpSellMode === 'instant' ? p.buy : p.sell) || 0;
}
function lpSellNetFactor() {
  const { salesTax, brokerFee } = window.getActiveFeeInputs ? window.getActiveFeeInputs() : { salesTax: 0.036, brokerFee: 0.01 };
  return _lpSellMode === 'instant' ? (1 - salesTax) : (1 - salesTax - brokerFee);
}
let _lpExpandedOfferIds = new Set();
let _lpResolvedNames = {};    // typeId -> name, for anything eve_db.js's EVE_ITEMS doesn't have
let _lpOfferByOutputTypeId = {}; // typeId -> [offers], built per corp load - also mirrored onto
                                  // window.__lpOfferByOutputTypeId so js/app.js and js/optimizers.js
                                  // (loaded before this file, no direct access to this module's own
                                  // variables) can see it too.
let _lpIsolatedResult = null; // the ranked-result currently isolated in the canvas view, or null
let _lpSavedCalculatorState = null; // snapshot of the Calculator's own last-saved state - see the
                                     // isolate-state-bleed note below.

// The "Times Redeemed" multiplier for whatever's currently isolated - the ONE stable source of truth
// for "how many copies does the player want", set only by isolateOffer (reset to 1) and
// onLPRedemptionCountChange (the input itself). Never derived FROM window.globalRuns/the tree - it's
// the other way around (see ensureLPRedemptionNodesPresent, which forces globalRuns from this on
// every recalculate). This exists because window.globalRuns and the tree itself get silently reset
// by code this page doesn't control: toggleBuildSelf (js/optimizers.js) rebuilds the whole tree via
// selectItem() whenever Build/Buy is toggled on ANY component, and selectHomeMarket (js/app.js) does
// the same when the market station changes - both unconditionally reset globalRuns to 1 and produce a
// fresh root with no memory of what redemption count or split-run-material behavior applied before.
// Keeping the real "how many copies" number OUTSIDE that disposable tree, and re-deriving everything
// from it after every recalculate, is what survives those resets instead of silently reverting to
// "treated as 1 run" (or whatever stale value was left behind) the way a single previous attempt at
// tracking this via window.globalRuns and a node-property copy of it both failed to.
let _lpRedemptionCount = 1;

// --- Don't let isolating an offer here overwrite what the Calculator restores on ITS OWN next
//     load ---------------------------------------------------------------------------------------
// js/app.js's recalculate() unconditionally calls its own saveActiveState() at the end, which
// persists window.currentProduct/globalRuns/buildSelfOverrides/etc. to a handful of localStorage
// keys - that's exactly right on index.html (the Calculator IS supposed to remember what you were
// last building), but recalculate() is the same shared function this page calls too, so isolating
// an LP offer here was silently overwriting the Calculator's own saved session with this page's own
// temporary one. saveActiveState isn't window-bound (a bare in-module call inside recalculate()),
// so it can't be intercepted directly - instead, the Calculator's real values are snapshotted once
// on load (before this page ever isolates anything) and re-written back immediately after every
// recalculate() this page triggers, undoing that particular side effect without touching app.js at
// all. The live, in-memory session (window.recipeTreeRoot etc.) is completely unaffected - only
// what a FUTURE fresh load of index.html would read back.
const CALCULATOR_STATE_KEYS = ['eve_active_product', 'eve_build_self_overrides', 'eve_custom_buy_modes', 'eve_custom_me_overrides', 'eve_custom_te_overrides', 'eve_global_runs', 'eve_global_jobs', 'eve_root_sell_strategy', 'eve_root_custom_price'];

function snapshotCalculatorState() {
  const snap = {};
  CALCULATOR_STATE_KEYS.forEach(k => { snap[k] = localStorage.getItem(k); });
  return snap;
}

function restoreCalculatorState(snap) {
  if (!snap) return;
  CALCULATOR_STATE_KEYS.forEach(k => {
    if (snap[k] === null) localStorage.removeItem(k);
    else localStorage.setItem(k, snap[k]);
  });
}

// --- Item names -----------------------------------------------------------------------------
// eve_db.js's local EVE_ITEMS snapshot doesn't cover every type in the game (SOE/vanity clothing,
// some deadspace variants, etc.) - real LP store offers can and do reference those. Rather than
// showing "Item 4158" forever, anything missing gets resolved live via ESI's /universe/names/
// (works for any category, not just items - one POST per store, id -> name only, no icon/market
// data) and cached here for the rest of the session.

function getLPItemName(typeId) {
  return (window.EVE_ITEMS && window.EVE_ITEMS[typeId]) || _lpResolvedNames[typeId] || `Item ${typeId}`;
}
window.getLPItemName = getLPItemName;

async function resolveMissingItemNames(typeIds) {
  const missing = [...new Set(typeIds)].filter(id => !(window.EVE_ITEMS && window.EVE_ITEMS[id]) && !_lpResolvedNames[id]);
  if (!missing.length) return;
  const chunks = [];
  for (let i = 0; i < missing.length; i += 500) chunks.push(missing.slice(i, i + 500));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk)
      });
      if (!res.ok) return;
      const data = await res.json();
      (data || []).forEach(entry => { _lpResolvedNames[entry.id] = entry.name; });
    } catch (e) { console.warn('[LP Store] Failed to resolve names for', chunk, e); }
  }));
}

// --- Item categories (Ships / Modules / Ammo / Implants / Skillbooks / SKINs / Drones / ...) ----
// generate_db.py already walks every /universe/groups/{id}/ once at DB-generation time and bakes
// the result into eve_db.js as window.EVE_CATEGORIES (typeId -> category_id) and
// window.EVE_GROUP_IDS/EVE_GROUP_NAME_TABLE - real, correct classification data, verified directly
// against known items (Tritanium -> Material, Rifter -> Ship/Frigate) including the exact case an
// older version of this comment claimed didn't work: 11,845 SKIN type_ids are present and correctly
// categorized (91 = SKIN), despite SKIN NAMES being deliberately excluded from EVE_ITEMS elsewhere
// (generate_db.py's own `fluff` filter) - that's a separate table built its own way, not filtered
// the same way, so it isn't affected by that exclusion. So this reads the local table first, for
// free, and only falls back to a live ESI walk (/universe/types/{id}/ for group_id, then
// /universe/groups/{id}/ for category_id - no bulk endpoint exists for either) for whatever's
// genuinely missing from it - a brand new item added to the game after the DB was last regenerated,
// in practice. That fallback is what previously ran for EVERY item, every single load: a real HAR
// capture from a live session showed 374 of these individual lookups firing at once on one page.
const LP_CATEGORY_LABELS = { 6: 'Ships', 7: 'Modules', 8: 'Ammo & Charges', 16: 'Skillbooks', 18: 'Drones', 20: 'Implants', 91: 'SKINs' };
let _lpGroupCategoryCache = {}; // groupId -> categoryId

function getLPItemCategory(typeId) {
  return _lpItemCategoryCache[typeId]; // undefined until resolved - callers treat that as "unknown yet", not "other"
}

// Runs `worker` over every item in `items`, at most `limit` in flight at once, instead of firing
// them all in one Promise.all - a corp store easily needs category lookups for several hundred
// distinct items (see resolveLPItemCategories below, the only caller), and a real HAR capture from
// a live session showed exactly that: 374 simultaneous /universe/types/ requests to the same host,
// with individual requests stuck "blocked" (queued for a free connection) for 200ms+ before even
// starting - the browser's own per-host connection limit turning a "run it all in parallel" call
// into self-inflicted congestion, worse on some browsers than others (reported as a real lag
// difference between Chrome and Firefox on the same page). Capping concurrency keeps enough
// requests in flight to still be fast while staying well under that ceiling.
async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(workers);
}

// Deliberately NOT awaited by callers on the critical path - kicked off in the background after the
// ranked list already has something to show, since a few hundred individual ESI calls (however
// parallel) shouldn't hold up the numbers players actually came for. Re-renders the table once done
// so the category filter (and any category-dependent display) picks up the real values.
async function resolveLPItemCategories(typeIds) {
  const missingTypes = [...new Set(typeIds)].filter(id => _lpItemCategoryCache[id] === undefined);
  if (!missingTypes.length) return;

  // Free, no network: eve_db.js already has this for almost everything (see the comment above) -
  // only whatever's genuinely absent from it needs the live ESI fallback below at all.
  const stillMissing = [];
  missingTypes.forEach(id => {
    const localCat = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[id] : undefined;
    if (localCat !== undefined) {
      _lpItemCategoryCache[id] = localCat;
    } else {
      stillMissing.push(id);
    }
  });
  if (!stillMissing.length) { renderLPStoreState(); return; }

  const groupIdByType = {};
  await mapWithConcurrency(stillMissing, 20, async (id) => {
    try {
      const res = await fetch(`https://esi.evetech.net/latest/universe/types/${id}/?datasource=tranquility`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.group_id !== undefined) groupIdByType[id] = data.group_id;
    } catch (e) { /* leave uncategorized rather than fail the whole batch */ }
  });

  const missingGroups = [...new Set(Object.values(groupIdByType))].filter(gid => _lpGroupCategoryCache[gid] === undefined);
  await mapWithConcurrency(missingGroups, 20, async (gid) => {
    try {
      const res = await fetch(`https://esi.evetech.net/latest/universe/groups/${gid}/?datasource=tranquility`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      _lpGroupCategoryCache[gid] = (data && data.category_id !== undefined) ? data.category_id : null;
    } catch (e) { _lpGroupCategoryCache[gid] = null; }
  });

  stillMissing.forEach(id => {
    const gid = groupIdByType[id];
    _lpItemCategoryCache[id] = (gid !== undefined && _lpGroupCategoryCache[gid] != null) ? _lpGroupCategoryCache[gid] : null;
  });

  renderLPStoreState();
}

// --- Offer fetch --------------------------------------------------------------------------

async function fetchLPStoreOffers(corpId) {
  if (_lpOffersCache[corpId]) return _lpOffersCache[corpId];
  const res = await fetch(`https://esi.evetech.net/latest/loyalty/stores/${corpId}/offers/?datasource=tranquility`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESI returned HTTP ${res.status} for corp ${corpId}`);
  const offers = await res.json();
  _lpOffersCache[corpId] = offers;
  return offers;
}
window.fetchLPStoreOffers = fetchLPStoreOffers;

// Sum of an offer's required_items priced at Jita sell (cost to acquire them right now) - shared
// by the ranked-list evaluation below AND the isolated-canvas LP stat strip, so there's one place
// this convention lives.
function requiredItemsMarketCost(offer) {
  let total = 0;
  (offer.required_items || []).forEach(r => {
    total += ((window.priceCache[r.type_id] || {}).sell || 0) * r.quantity;
  });
  return total;
}
window.requiredItemsMarketCost = requiredItemsMarketCost;

// An offer is a BPC offer when its own type_id resolves to a recipe AND that recipe's
// blueprintTypeID is the offer's type_id itself (recipeMap is keyed by BOTH blueprint and product
// ids - see js/config.js buildPrepackedIndexes - so this check is what tells the two apart).
function isBlueprintOffer(offer) {
  const recipe = window.recipeMap && window.recipeMap[offer.type_id];
  return !!(recipe && parseInt(recipe.blueprintTypeID) === parseInt(offer.type_id));
}

// --- Per-offer evaluation (drives the ranked list) ------------------------------------------

async function evaluateDirectSellOffer(offer) {
  const ids = [offer.type_id, ...offer.required_items.map(r => r.type_id)];
  await window.fetchMarketPrices(ids);

  // Cost side: what it takes to ACQUIRE the required items right now - the Jita sell/instant-buy
  // price, same convention the rest of the app uses for "cost to get a material in hand".
  // Revenue side: Jita sell price too (this app's existing convention for "what an output is
  // worth" - see js/invention.js's bpcValue calc, matched here rather than diverging), net of
  // sales tax and broker fee so it's an apples-to-apples number with the BPC path below, which
  // already deducts both. Both sides assume you're buying/selling at Jita specifically (same
  // station fetchMarketPrices always uses) - not wherever you'd actually be standing in the
  // warzone.
  const outputPrice = lpOutputUnitPrice(offer.type_id); // sell price, or the highest buy order in 'instant' mode
  const grossRevenue = outputPrice * offer.quantity;
  const revenue = grossRevenue * lpSellNetFactor();

  const requiredItemsCost = requiredItemsMarketCost(offer);
  const cost = offer.isk_cost + requiredItemsCost;
  const profit = revenue - cost;

  return {
    offer, offerType: 'direct',
    outputTypeId: offer.type_id, outputName: getLPItemName(offer.type_id),
    outputQty: offer.quantity,
    revenue, cost, requiredItemsCost, profit,
    lpCost: offer.lp_cost, iskCost: offer.isk_cost,
    iskPerLp: offer.lp_cost > 0 ? profit / offer.lp_cost : null,
    buildSeconds: 0, bpcRuns: 0
  };
}

async function evaluateBpcOffer(offer) {
  const recipe = window.recipeMap[offer.type_id];
  const productTypeId = parseInt(recipe.productTypeID);
  const batchYield = recipe.productQtyPerRun || 1;
  // offer.quantity IS the run count on the ONE blueprint copy this offer grants - NOT a count of
  // several separate single-run copies (an earlier version of this code assumed the opposite,
  // reported as wrong: the in-game redemption preview shows e.g. "1 x Caldari Navy Large Graviton
  // Smartbomb Blueprint (5 runs, copy)" for an offer, and cross-checking that exact offer live
  // against ESI's own /loyalty/stores/{corp}/offers/ confirms quantity=5 for it - one item, 5 runs,
  // not 5 items of 1 run each). Confirmed for several offers of different corps/products, not just
  // one.
  const runs = offer.quantity;

  const priorRootProduct = window.recipeTreeRootProductTypeId;
  window.recipeTreeRootProductTypeId = productTypeId;
  let root;
  try {
    // jobCount: 1 - this offer grants ONE physical blueprint copy with `runs` runs on it (see this
    // function's own comment on `runs` above), so it's one combined `runs`-run job, not `runs`
    // separate 1-run jobs - buildRecursiveRecipeTree's own comment on node.jobCount explains why
    // getting this wrong matters: jobCount > 1 rounds material need up per job independently, which
    // overstates both material cost and (since job fee is a percentage of material EIV) job fee for
    // any offer with quantity > 1.
    root = await window.buildRecursiveRecipeTree(parseInt(offer.type_id), getLPItemName(offer.type_id), runs, 0, 6, new Set(), null, 1);
  } finally {
    window.recipeTreeRootProductTypeId = priorRootProduct;
  }
  if (!root) return null;

  root.runsNeeded = runs;
  root.qtyNeeded = runs * batchYield;

  const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { meBonus: 1.0, costBonus: 5.0 };
  const facility = structureType.meBonus / 100;
  if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(root, facility);

  const allTypeIds = new Set();
  if (typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, allTypeIds);
  offer.required_items.forEach(r => allTypeIds.add(r.type_id));
  allTypeIds.add(productTypeId);
  await window.fetchMarketPrices(Array.from(allTypeIds));

  const materialCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(root) : 0;

  const { facilityTax, sccSurcharge } = window.getActiveFeeInputs ? window.getActiveFeeInputs() : { facilityTax: 0.01, sccSurcharge: 0.04 };
  const structureRoleBonus = structureType.costBonus / 100;
  let jobFee = 0;
  if (typeof window.calculateNodeEIV === 'function' && typeof window.calculateNodeJobFee === 'function') {
    window.calculateNodeEIV(root);
    jobFee = window.calculateNodeJobFee(root, facilityTax, sccSurcharge, structureRoleBonus);
  }

  const requiredItemsCost = requiredItemsMarketCost(offer);

  const outputPrice = lpOutputUnitPrice(productTypeId);
  const grossRevenue = outputPrice * root.qtyNeeded;
  const revenue = grossRevenue * lpSellNetFactor();

  const cost = offer.isk_cost + requiredItemsCost + materialCost + jobFee;
  const profit = revenue - cost;
  const buildSeconds = typeof window.calculateTotalBuildSeconds === 'function' ? window.calculateTotalBuildSeconds(root) : 0;

  return {
    offer, offerType: 'bpc',
    outputTypeId: productTypeId, outputName: getLPItemName(productTypeId),
    outputQty: root.qtyNeeded,
    revenue, cost, requiredItemsCost, materialCost, jobFee, profit,
    lpCost: offer.lp_cost, iskCost: offer.isk_cost,
    iskPerLp: offer.lp_cost > 0 ? profit / offer.lp_cost : null,
    buildSeconds, bpcRuns: offer.quantity, blueprintTypeId: offer.type_id
  };
}

// --- Orchestration -------------------------------------------------------------------------

async function loadAndRankLPStore(corpId) {
  corpId = parseInt(corpId);
  _lpActiveCorpId = corpId;
  localStorage.setItem('eve_lpstore_last_corp', String(corpId));
  _lpIsLoading = true;
  _lpExpandedOfferIds = new Set();
  renderLPStoreState();

  try {
    const offers = await fetchLPStoreOffers(corpId);

    // Index every offer by what it grants - drives the isolated canvas's "Acquire via LP" option
    // (js/app.js createNodeCard / js/optimizers.js calculateTreeNodeCost read this via
    // window.__lpOfferByOutputTypeId, since they're loaded before this file and can't see its
    // module-local variables directly). A component is offerable that way only if it matches
    // something THIS store actually sells - cross-corp matching is a possible future enhancement,
    // not done here.
    _lpOfferByOutputTypeId = {};
    offers.forEach(o => {
      if (!_lpOfferByOutputTypeId[o.type_id]) _lpOfferByOutputTypeId[o.type_id] = [];
      _lpOfferByOutputTypeId[o.type_id].push(o);
    });
    window.__lpOfferByOutputTypeId = _lpOfferByOutputTypeId;

    // Cheap upfront pre-warm: every flat (non-recursive) type_id every offer touches, in one
    // batched call, before any per-offer work starts. fetchMarketPrices no-ops on already-cached
    // ids, so the per-offer eval calls below effectively become free for anything covered here -
    // this just avoids one round trip per offer for prices every offer needs anyway. Name
    // resolution rides along the same collected id set, so anything eve_db.js doesn't know (see
    // resolveMissingItemNames above) gets a real name before a single row renders.
    const flatIds = new Set();
    offers.forEach(o => { flatIds.add(o.type_id); (o.required_items || []).forEach(r => flatIds.add(r.type_id)); });
    await Promise.all([
      window.fetchMarketPrices(Array.from(flatIds)),
      resolveMissingItemNames(Array.from(flatIds))
    ]);

    // Second-stage pre-warm: a BPC offer's own BUILD materials aren't known until its recipe tree
    // is actually built - the pass above only covers what's directly on the offer itself
    // (required_items), not what building the blueprint out actually needs. Without this, every
    // BPC offer below ends up discovering its own small set of new material ids only once
    // evaluateBpcOffer builds ITS tree, and since every offer evaluates in parallel (the
    // Promise.all right below), that meant dozens of individual fetchMarketPrices round trips
    // firing back to back instead of a couple of batched ones - confirmed live: a single corp's
    // store was measured firing 70+ separate market requests on one page load, almost entirely
    // offer-sized (~3-8 ids) chunks rather than the 30-id batches fetchMarketPrices is built for.
    // Building every tree here too is redundant CPU work (evaluateBpcOffer below builds its own
    // copy right after, discarding this pass's copy) - but that's the exact same "fully local, safe
    // and fast in parallel" operation this codebase already trusts (see the comment on the
    // Promise.all below), just run once earlier. Fully best-effort: any offer that fails to
    // pre-warm here simply falls back to today's per-offer fetch inside evaluateBpcOffer, same as
    // if this pass didn't exist.
    const bpcOffers = offers.filter(isBlueprintOffer);
    if (bpcOffers.length) {
      const preWarmIds = new Set();
      await Promise.all(bpcOffers.map(async (offer) => {
        try {
          const recipe = window.recipeMap[offer.type_id];
          if (!recipe) return;
          const priorRootProduct = window.recipeTreeRootProductTypeId;
          window.recipeTreeRootProductTypeId = parseInt(recipe.productTypeID);
          let root;
          try {
            root = await window.buildRecursiveRecipeTree(parseInt(offer.type_id), getLPItemName(offer.type_id), offer.quantity, 0, 6, new Set(), null, 1);
          } finally {
            window.recipeTreeRootProductTypeId = priorRootProduct;
          }
          if (root && typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, preWarmIds);
        } catch (e) { /* best-effort - evaluateBpcOffer's own pass below picks up anything missed */ }
      }));
      if (preWarmIds.size) await window.fetchMarketPrices(Array.from(preWarmIds));
    }

    // buildRecursiveRecipeTree is fully local (recipeMap/EVE_RECIPES, already loaded from
    // eve_db.js - see js/tree.js fetchBlueprintData) - no network happens inside it, so building
    // every BPC offer's tree in parallel here is safe and fast.
    const evaluations = await Promise.all(offers.map(offer => {
      const evalFn = isBlueprintOffer(offer) ? evaluateBpcOffer : evaluateDirectSellOffer;
      return evalFn(offer).catch(e => {
        console.warn('[LP Store] Failed to evaluate offer', offer.offer_id, offer.type_id, e);
        return null;
      });
    }));

    _lpRankedResults = evaluations.filter(Boolean);
  } catch (e) {
    console.error('[LP Store] Failed to load store:', e);
    _lpRankedResults = [];
    _lpIsLoading = false;
    renderLPStoreState(e);
    return;
  }

  _lpIsLoading = false;
  renderLPStoreState();

  // Fire-and-forget - see resolveLPItemCategories's own note on why this doesn't block the render
  // above. Classifies by outputTypeId, which for a BPC offer is already the PRODUCT it builds (a
  // ship BPC resolves to "Ships" the same as a direct-sell ship would, not a separate "Blueprints"
  // bucket), so one Category filter covers both offer types uniformly.
  resolveLPItemCategories(_lpRankedResults.map(r => r.outputTypeId));
}
window.loadAndRankLPStore = loadAndRankLPStore;

function selectLPStoreCorp(corpIdStr) {
  if (!corpIdStr) return;
  if (typeof renderLPStoreCorpActiveLabel === 'function') renderLPStoreCorpActiveLabel(corpIdStr);
  loadAndRankLPStore(corpIdStr);
}
window.selectLPStoreCorp = selectLPStoreCorp;

// Re-values every already-ranked offer (and the Find Item estimates) for the current sell mode from
// prices already in memory - no refetch and no tree rebuild, since only the revenue side changes.
function lpRepriceForSellMode() {
  const f = lpSellNetFactor();
  _lpRankedResults.forEach(r => {
    r.revenue = lpOutputUnitPrice(r.outputTypeId) * r.outputQty * f;
    r.profit = r.revenue - r.cost;
    r.iskPerLp = r.lpCost > 0 ? r.profit / r.lpCost : null;
  });
  if (_lpItemSearchIndex) _lpItemSearchIndex.forEach(lpApplyEstimate);
}
function updateLPSellModeButtons() {
  ['sell', 'instant'].forEach(m => {
    const btn = document.getElementById(`btn-lpstore-sell-${m}`);
    if (btn) { btn.classList.toggle('active', m === _lpSellMode); btn.setAttribute('aria-pressed', String(m === _lpSellMode)); }
  });
}
function setLPSellMode(mode) {
  mode = mode === 'instant' ? 'instant' : 'sell';
  if (mode === _lpSellMode) return;
  _lpSellMode = mode;
  try { localStorage.setItem(LP_SELL_MODE_KEY, mode); } catch (e) { /* not saved, still applies now */ }
  updateLPSellModeButtons();
  lpRepriceForSellMode();
  renderLPStoreTable();
  renderLPExtraStats();
  if (typeof renderLPItemSearchResultsArea === 'function') renderLPItemSearchResultsArea();
  const q = document.getElementById('lpstore-item-search-input');
  if (q && q.value && typeof filterLPItemSearchResults === 'function') filterLPItemSearchResults(q.value);
}
window.setLPSellMode = setLPSellMode;

function setLPStoreTypeFilter(filter) {
  _lpTypeFilter = filter;
  ['all', 'direct', 'bpc'].forEach(f => {
    const btn = document.getElementById(`btn-lpstore-type-${f}`);
    if (btn) btn.className = `lp-pill${f === filter ? ' active' : ''} flex-1 text-center`;
  });
  renderLPStoreState();
}
window.setLPStoreTypeFilter = setLPStoreTypeFilter;

function setLPStoreCategoryFilter(catId) {
  _lpCategoryFilter = catId;
  renderLPCategoryBar();
  renderLPStoreTable(); // filtering only - no need to re-render the summary tiles above it
}
window.setLPStoreCategoryFilter = setLPStoreCategoryFilter;

function setLPStoreSearch(query) {
  _lpSearchQuery = (query || '').trim();
  renderLPStoreTable(); // filtering only - no need to re-render the summary tiles above it
}
window.setLPStoreSearch = setLPStoreSearch;

function setLPStoreSort(key) {
  if (_lpSortKey === key) {
    _lpSortDir *= -1;
  } else {
    _lpSortKey = key;
    _lpSortDir = -1;
  }
  renderLPStoreState();
}
window.setLPStoreSort = setLPStoreSort;

function toggleLPOfferExpanded(offerId) {
  if (_lpExpandedOfferIds.has(offerId)) _lpExpandedOfferIds.delete(offerId);
  else _lpExpandedOfferIds.add(offerId);
  renderLPStoreState();
}
window.toggleLPOfferExpanded = toggleLPOfferExpanded;

// =================================================================================================
// Isolate: hand off to the Calculator's own tree canvas + Bill of Materials sidebar (js/app.js,
// also loaded on this page) rather than a separate lookalike UI - the exact same floating cards
// connected by lines, the exact same BOM panel, that the Calculator already has. Works for BOTH
// offer types now: a BPC offer isolates via the Calculator's own selectItem() (a real recipe tree);
// a direct-sell offer gets a synthetic root built the same shape selectItem() would produce, since
// there's no blueprint to hand it - "as if we're building it" per the request this was built from.
//
// Either way, the offer's own required_items (what you turn in to REDEEM it - a separate thing from
// a BPC's own build materials) are injected as extra root-level children, so they show up as real
// cards connected by lines instead of only a lump sum in the stat strip. They're visually distinct
// (isRedemptionRequirement flag - purple card accent + purple line, js/app.js createNodeCard /
// drawConnectingLinesForTree) so it's obvious at a glance which cards are "build this" vs "turn
// this in".
// =================================================================================================

async function isolateOffer(offerId) {
  const result = _lpRankedResults.find(r => r.offer.offer_id === offerId);
  if (!result) return;
  if (typeof window.selectItem !== 'function') {
    console.error('[LP Store] window.selectItem is unavailable - is js/app.js loaded on this page?');
    return;
  }

  _lpIsolatedResult = result;
  _lpRedemptionCount = 1; // don't carry the previous offer's redemption count into this one
  resetMarketDrawer(); // don't carry the previous offer's drawer data/open-state into this one
  window.__lpRequiredItemBuildOverrides = {}; // don't carry the previous offer's "build this required item" choices into this one
  localStorage.setItem('eve_lpstore_last_isolated_offer', String(offerId)); // restored on next page load - see the load listener below

  // #lpstore-main-area is hidden as a whole (not just its inner results div) - it's a flex sibling
  // of #viewport in .content-row, and leaving it visible-but-empty would still claim flex-1 space
  // alongside the canvas.
  document.getElementById('lpstore-main-area')?.classList.add('hidden');
  ['viewport', 'bom-sidebar', 'lpstore-calc-stat-strip'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));

  const nameEl = document.getElementById('lpstore-inspector-name');
  if (nameEl) nameEl.textContent = result.outputName;

  if (result.offerType === 'bpc') {
    // selectItem (js/app.js) is the Calculator's own "load this blueprint" entry point - it resets
    // every build/buy/ME/TE override, builds the real recipe tree, fetches prices, and calls
    // recalculate() itself (which runs ensureLPRedemptionNodesPresent below via the recalculate
    // hook). Runs start at exactly 1 redemption's worth (offer.quantity blueprint runs), same
    // pattern js/app.js's own loadBlueprintIntoCalculator uses for a real owned BPC - awaited here
    // (this whole function is async specifically so it can be) rather than the old fire-and-forget
    // .then(), because every await below depends on selectItem's own tree/DOM actually being
    // finished, not just started.
    //
    // window.globalRuns/window.globalJobs (one redemption = one blueprint copy with offer.quantity
    // runs on it, several redemptions = several separate copies - see ensureLPRedemptionNodesPresent's
    // own comment, and evaluateBpcOffer's, for the full story and how this was confirmed) are NOT set
    // here - ensureLPRedemptionNodesPresent (run by the recalculate hook below) derives both fresh from
    // _lpRedemptionCount on every single recalculate, not just this first one. Setting them only here
    // was a previous version of this code, and it broke the moment anything rebuilt the tree
    // afterward (toggling Build/Buy on any component, or changing the home market station both call
    // selectItem() again and silently drop it) - see _lpRedemptionCount's own comment for the full
    // story.
    await window.selectItem(result.blueprintTypeId, getLPItemName(result.blueprintTypeId), false);
    await window.fetchMarketPrices((result.offer.required_items || []).map(r => r.type_id));
  } else {
    await isolateDirectSellOffer(result);
  }

  // One recalculate() here, AWAITED, gets the tree to its true final shape - redemption-requirement
  // nodes injected, correct redemption count applied - which selectItem's OWN internal recalculate
  // (mid-build, still at the default 1 run, no redemption nodes yet) never sees. Centering BEFORE
  // this point (the previous version of this code did, inside selectItem itself, via its own
  // non-preserveView resetPanZoom() call) centers on a tree that's about to change shape and size,
  // which is what was actually behind "isolating doesn't center the card" - not a missing center
  // call, a mistimed one. window.recalculate is async on this page specifically (see
  // installLPRecalculateHook) - every other bare, un-awaited call to it elsewhere in this file
  // relies on nothing needing to happen right after it returns, which isn't true here.
  if (typeof window.recalculate === 'function') await window.recalculate();
  if (typeof window.resetPanZoom === 'function') window.resetPanZoom();
}
window.isolateOffer = isolateOffer;

// No blueprint exists for a direct-sell offer, so selectItem() doesn't apply - this builds a
// synthetic root in the exact shape selectItem() would have produced (same fields recalculate()/
// createNodeCard() read), with isBuildingSelf:true so its children (the required_items, injected by
// the recalculate hook below) actually render and get summed into the cost - "as if we're building
// it", per the request this was built from, even though there's no manufacturing job behind it
// (recipe stays null, so calculateNodeJobFee/calculateTotalBuildSeconds both naturally contribute 0
// - no special-casing needed there). batchYield is this offer's own quantity-per-redemption and
// globalRuns starts at 1 redemption, so the existing qtyNeeded = batchYield * runs math
// (recalculate(), unmodified) falls out correctly with no new formula.
async function isolateDirectSellOffer(result) {
  const offer = result.offer;
  window.buildSelfOverrides = {};
  window.customBuyModes = {};
  window.customMEOverrides = {};
  window.customTEOverrides = {};
  window.selectedInstanceId = null;
  window.isolatedInstanceId = null;
  window.collapsedInstanceIds = new Set();
  window.expandedOverrideIds = new Set();
  window.rootSellStrategy = 'market-sell';
  window.rootCustomPrice = 0;
  window.currentProduct = { id: offer.type_id, name: result.outputName };
  window.globalRuns = 1;

  window.recipeTreeRoot = {
    instanceId: ++window.instanceCounter, parentInstanceId: null,
    typeId: offer.type_id, displayTypeId: offer.type_id, productTypeId: offer.type_id,
    name: result.outputName, productName: result.outputName,
    qtyNeeded: offer.quantity || 1, depth: 0, recipe: null, children: [],
    isManufacturable: false, isReaction: false, batchYield: offer.quantity || 1, runsNeeded: 1,
    isBuildingSelf: true, customME: 0, customTE: 0, unitEIV: 0, jobEIV: 0, jobFee: 0
  };

  await window.fetchMarketPrices([offer.type_id, ...(offer.required_items || []).map(r => r.type_id)]);
  // No recalculate() call here - isolateOffer (the only caller) does exactly one, awaited, right
  // after this returns. An un-awaited call here used to race that one: both are async (see
  // installLPRecalculateHook), so firing this one and then immediately awaiting another from the
  // caller meant two overlapping recalculates - redundant work at best, a real source of the "page
  // hangs for a second" reports at worst (each one rebuilds the redemption-requirement nodes via
  // injectLPRedemptionNodes, which isn't cheap when required items are toggled to Build).
}

function exitLPInspector() {
  _lpIsolatedResult = null;
  resetMarketDrawer();
  localStorage.removeItem('eve_lpstore_last_isolated_offer'); // explicit "Back to List" - don't re-isolate this on the next load
  ['viewport', 'bom-sidebar', 'lpstore-calc-stat-strip'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('lp-info-card-col')?.remove();
  document.getElementById('lpstore-main-area')?.classList.remove('hidden');
  // #lpstore-main-area is only the outer wrapper - the actual list (#lpstore-results-area, inside
  // it) is a SEPARATE element that renderLPStoreState() manages, and it deliberately stays hidden
  // across any loadAndRankLPStore() call that fires WHILE isolated (e.g. editing a tax/fee field -
  // see saveSharedTaxSettingsFromLPStore, which reloads unconditionally, isolated or not) so a
  // background refresh doesn't yank the canvas away. That guard means the list's hidden class can
  // still be set from one of those background refreshes at the moment isolation actually ends - just
  // unhiding the outer wrapper above isn't enough, and without this call the list stays invisible
  // (looks like "nothing loads") until something else happens to call renderLPStoreState() again,
  // e.g. a full page reload. Re-running it here re-evaluates that same guard now that
  // _lpIsolatedResult is null, so the list correctly reappears instead of needing a reload.
  renderLPStoreState();
}
window.exitLPInspector = exitLPInspector;

// How many separate times the isolated offer is being redeemed - just _lpRedemptionCount, the one
// stable source of truth for this (see its own comment). Used to be reverse-derived from
// window.globalRuns instead (runs / offer.quantity for a BPC) - which broke the moment anything reset
// globalRuns out from under it (toggling Build/Buy on any component, changing the home market
// station), since the reverse-derivation would just confidently recompute the WRONG redemption count
// from whatever globalRuns had been reset to, with nothing to catch it. _lpRedemptionCount never gets
// touched by any of that, so this is now always right regardless of what the tree/globalRuns just did.
function getLPRedemptionBatches(result) {
  return _lpRedemptionCount;
}

// The root card's own "Times Redeemed" input (js/app.js createNodeCard, isLPIsolatedRoot branch)
// calls this instead of the Calculator's normal syncCardRunsToGlobal - redemptions is the number the
// player actually edits, translated to the runs count the rest of the Calculator's machinery expects.
//
// Reported directly, with a screenshot of exactly this field: editing it visibly jumped the camera
// and the connecting lines. Root cause: this called window.recalculate() completely bare, with no
// withRootPanAnchor protection at all - not "unawaited" (already fixed for this file's other bare
// calls, see the comment above isolateOffer's own recalculate call) but never wrapped in the first
// place, so a change big enough to reflow the tree (redemption count changes how many of each
// required item are needed, which can flip a required item's own Build/Buy math) had nothing
// correcting root's position afterward. Same fix as every other camera-jump round on this bug.
function onLPRedemptionCountChange(e) {
  if (!_lpIsolatedResult) return;
  // Just set the one stable number - ensureLPRedemptionNodesPresent (run by the recalculate hook,
  // right below) derives window.globalRuns from this fresh on every recalculate, not the other way
  // around. See _lpRedemptionCount's own comment for why that direction matters.
  _lpRedemptionCount = Math.max(1, parseInt(e.target.value) || 1);
  if (typeof window.recalculate === 'function') {
    if (typeof window.withRootPanAnchor === 'function') window.withRootPanAnchor(async () => { await window.recalculate(); });
    else window.recalculate();
  }
}
window.onLPRedemptionCountChange = onLPRedemptionCountChange;

// Per-required-item "build this instead of buying it" choice, separate from the Calculator's own
// buildSelfOverrides (js/optimizers.js) - kept as its own map, keyed by the required item's PRODUCT
// typeId, rather than reusing buildSelfOverrides' existing blueprint-typeId convention, so there's
// no risk of this feature's key shape drifting out of sync with what the rest of the app expects
// there. Reset per-offer in isolateOffer.
window.__lpRequiredItemBuildOverrides = window.__lpRequiredItemBuildOverrides || {};

async function toggleLPRequiredItemBuild(e, typeId) {
  if (e) e.stopPropagation();
  const next = !window.__lpRequiredItemBuildOverrides[typeId];
  window.__lpRequiredItemBuildOverrides[typeId] = next;
  // __lpRequiredItemBuildOverrides above only gates whether injectLPRedemptionNodes attempts the
  // real sub-tree build at all - buildRecursiveRecipeTree (js/tree.js) itself decides a node's own
  // isBuildingSelf from window.buildSelfOverrides, keyed by BLUEPRINT id (the app-wide convention
  // every other node uses), which is a different key than typeId here (the product id). Without
  // this, the built node comes back correctly manufacturable but still flagged as "buy" - present
  // with a real recipe attached, just not actually expanded into its own materials.
  const recipe = window.recipeMap && window.recipeMap[typeId];
  if (recipe && recipe.blueprintTypeID) {
    window.buildSelfOverrides[parseInt(recipe.blueprintTypeID)] = next;
  }

  // Same pan-compensation every other per-card recalculate()-only control uses (app.js's
  // recalculateWithPanAnchor - see its own comment) - this required-item toggle used to call
  // recalculate() directly with no compensation at all. recalculateWithPanAnchor's own fallback
  // chain (pathKey, then _lpRequiredItemProductTypeId) is exactly what's needed here: building a
  // required item for the first time replaces its flat stub (node.typeId === the product id) with a
  // real recursive sub-tree (node.typeId === the BLUEPRINT id instead) - a brand new instanceId AND
  // a changed typeId, so even pathKey can't re-find it, only _lpRequiredItemProductTypeId (which
  // injectLPRedemptionNodes deliberately keeps stable across that transition) can.
  await window.recalculateWithPanAnchor(e);
}
window.toggleLPRequiredItemBuild = toggleLPRequiredItemBuild;

// Adds one child node per required_item, in the same shape a real tree node has (so createNodeCard/
// calculateTreeNodeCost/etc. handle them with zero special-casing beyond the isRedemptionRequirement
// flag) - instanceId comes from the SAME global counter tree.js/app.js use for their own nodes
// (config.js's `var instanceCounter` is a live global, not a snapshot), so there's no collision
// risk. A required item that has a REAL recipe in recipeMap (most don't - most LP redemption items
// are loot-only ammo/implants/boosters with no player blueprint, but some genuinely are ordinary
// buildable items, e.g. base-variant ammo turned in for a faction-flavor reward) gets marked
// isManufacturable so its card shows the normal Build/Buy toggle; if the player has toggled it to
// Build (window.__lpRequiredItemBuildOverrides), its own real sub-tree is built via
// buildRecursiveRecipeTree instead of a flat non-buildable stub, exactly like any other tree
// material.
async function injectLPRedemptionNodes(root, offer, batches) {
  const items = offer.required_items || [];
  const children = await Promise.all(items.map(async (ri) => {
    const totalQty = ri.quantity * batches;
    const recipe = window.recipeMap && window.recipeMap[ri.type_id];
    const isRealRecipe = !!(recipe && parseInt(recipe.productTypeID) === ri.type_id);
    const wantsBuild = isRealRecipe && !!window.__lpRequiredItemBuildOverrides[ri.type_id];

    let child = null;
    if (wantsBuild) {
      try {
        child = await window.buildRecursiveRecipeTree(parseInt(recipe.blueprintTypeID), getLPItemName(recipe.blueprintTypeID), totalQty, (root.depth || 0) + 1, 6, new Set(), root);
      } catch (e) {
        console.warn('[LP Store] Failed to build required-item sub-tree, falling back to a plain stub:', ri.type_id, e);
        child = null;
      }
    }
    if (!child) {
      child = {
        instanceId: ++window.instanceCounter, parentInstanceId: root.instanceId,
        typeId: ri.type_id, displayTypeId: ri.type_id, productTypeId: ri.type_id,
        name: getLPItemName(ri.type_id), productName: getLPItemName(ri.type_id),
        qtyNeeded: totalQty, depth: (root.depth || 0) + 1, recipe: null, children: [],
        isManufacturable: isRealRecipe, isReaction: false, batchYield: 1, runsNeeded: 1,
        isBuildingSelf: false, customME: 0, customTE: 0, unitEIV: 0, jobEIV: 0, jobFee: 0
      };
    }
    child.isRedemptionRequirement = true;
    child._perBatchQty = ri.quantity;
    // A stable key for toggleLPRequiredItemBuild, independent of build state: node.typeId itself
    // is ri.type_id (the product) for the flat stub but the BLUEPRINT's id once actually built via
    // buildRecursiveRecipeTree above - using node.typeId directly in the pill's onclick would toggle
    // a different window.__lpRequiredItemBuildOverrides key each time the node's own build state
    // changes, which would never turn back off correctly. This field stays ri.type_id always.
    child._lpRequiredItemProductTypeId = ri.type_id;
    return child;
  }));
  return children;
}

// Run before every recalculate() this page triggers (see installLPRecalculateHook) - rebuilds the
// redemption-requirement children fresh every time (not just once) so a required item's own Build/
// Buy toggle (toggleLPRequiredItemBuild above) and the current redemption count both stay reflected
// correctly. This also covers the case the old once-only injection was written for: js/app.js
// rebuilding the tree from scratch whenever "Build" is toggled on ANY component (optimizers.js
// toggleBuildSelf calls selectItem() again, which silently drops anything not part of its own
// recursive walk) - these synthetic nodes just get re-added afterward either way. For the exact same
// reason, this is ALSO the one place that forces window.globalRuns/window.globalJobs back to what
// they should be, derived fresh from _lpRedemptionCount, on every single pass - not just
// isLPIsolatedRoot/_lpRedemptionCount as before. All of those are exactly the fields a destructive
// selectItem() rebuild resets/drops, and the redemption count input (createNodeCard's "Times
// Redeemed" branch) needs them present and correct on whatever the CURRENT root object is, not just
// the first one selectItem() ever built - see _lpRedemptionCount's own comment for the full story of
// why this needed to change.
async function ensureLPRedemptionNodesPresent() {
  if (!_lpIsolatedResult || !window.recipeTreeRoot) return;
  const root = window.recipeTreeRoot;
  const result = _lpIsolatedResult;

  root.isLPIsolatedRoot = true;
  root._lpRedemptionCount = _lpRedemptionCount;
  // Each redemption of a BPC offer grants ONE physical blueprint copy with result.offer.quantity
  // runs on it (see evaluateBpcOffer's own comment - confirmed against ESI live data and the in-game
  // redemption preview, NOT several separate single-run copies). Redeeming the SAME offer several
  // times ("Times Redeemed") really does give several separate physical copies though - that part IS
  // jobCount, one real job per redemption - so jobCount = _lpRedemptionCount (how many separate
  // copies you're planning around) and runsPerJob = result.offer.quantity (runs on each one), via the
  // general node.jobCount mechanic (see buildRecursiveRecipeTree's own comment). Direct-sell has no
  // such concept (its synthetic root's recipe stays null, so scaleTreeQuantities never even reaches
  // the jobCount branch for it) - globalRuns there just directly means redemptions, same as
  // isolateDirectSellOffer already assumed.
  if (result.offerType === 'bpc') {
    window.globalJobs = _lpRedemptionCount;
    window.globalRuns = result.offer.quantity || 1;
  } else {
    window.globalJobs = 1;
    window.globalRuns = _lpRedemptionCount;
  }
  const batches = getLPRedemptionBatches(result);

  const redemptionChildren = await injectLPRedemptionNodes(root, result.offer, batches);
  // Keep any REAL children already there (a BPC-isolated root's own build materials) - only the
  // previous pass's redemption nodes get replaced.
  root.children = (root.children || []).filter(c => !c.isRedemptionRequirement).concat(redemptionChildren);
}

// Wraps the Calculator's own recalculate() ONCE, on this page only, to sync the redemption nodes
// first and refresh the LP-specific extra stat strip after - every existing trigger for recalculate
// (Build/Buy/LP toggles, runs change, ME/TE edits, tax/fee edits) picks both up automatically, with
// no new wiring needed at any of those call sites. async now (ensureLPRedemptionNodesPresent awaits
// buildRecursiveRecipeTree for any required item toggled to Build) - every existing caller on this
// page already treats recalculate() as fire-and-forget (onclick="recalculate()" etc.), so returning
// a Promise instead of undefined changes nothing observable for them.
//
// Coalesced (never run two passes concurrently): a REAL reported bug traced back here - toggling a
// required item's Build/Buy state fires this async wrapper without awaiting it (same as every other
// trigger above), and each pass itself awaits real async work (buildRecursiveRecipeTree for a newly-
// built required item, fetchMarketPrices). Two overlapping passes (a quick second toggle, or any
// other recalculate-triggering edit landing while the first was still mid-flight) could finish OUT OF
// ORDER, leaving the LP Economics card - and window.recipeTreeRoot itself - reflecting whichever pass
// happened to write last, not necessarily the one matching the CURRENT override state. That's exactly
// "toggle Build, ISK/LP drops hard; toggle back to Buy, it's still wrong" - a stale second pass
// finishing after the revert and clobbering the correct result, only ever fixed by some later,
// solo (non-overlapping) recalculate() - reported as fixed by switching the Sell/Buy strategy, but any
// recalculate that happens to run alone would have "fixed" it the same way. A call that arrives while
// one's already running no longer starts a second one - it marks that another pass is wanted once the
// current one finishes (picking up whatever's the LATEST state by then, not stale data from when it
// was queued) and shares that first pass's own promise, so every caller's await still resolves once
// the override state it cared about has actually been accounted for.
let _lpRecalcInFlight = null;
let _lpRecalcQueued = false;
function installLPRecalculateHook() {
  if (typeof window.recalculate !== 'function' || window.recalculate.__lpWrapped) return;
  const original = window.recalculate;
  const runOnce = async function (...args) {
    window.__lpSpentThisRecalc = 0; // calculateTreeNodeCost (js/optimizers.js) accumulates into this
    await ensureLPRedemptionNodesPresent();
    const result = original.apply(this, args);
    restoreCalculatorState(_lpSavedCalculatorState); // undo this call's own saveActiveState() - see the note above CALCULATOR_STATE_KEYS
    renderLPExtraStats();
    renderLPStoreActiveStationLabel(); // picks up a structure/preset change made via the sidebar
    // Reported directly, with a screenshot: the connecting lines briefly pointing at the top of the
    // root card instead of its middle, only ever on this page. Root cause: original.apply() above
    // (the real recalculate()) already drew every connecting line once, synchronously, against
    // whatever the tree looked like at that exact moment - but renderLPExtraStats() right above this
    // comment adds or resizes the "LP Store Economics" card as its own column, appended after
    // root's, inside the SAME align-items:center flex row (#tree-container) every other column
    // (including root's) is centered against. A column changing size after the fact re-centers the
    // whole row, which can shift root - and everything else - without the lines drawn a moment ago
    // knowing to follow. scheduleConnectingLinesRedraw() (already called inside original.apply())
    // catches this on its own after a couple of frames, but only after a real, visible flash of
    // wrong first - this draws fresh immediately, right after the layout that actually needs it has
    // landed, the same "why redraw synchronously instead of waiting" reasoning recalculate() and
    // resetPanZoom() already use elsewhere in this codebase.
    if (typeof window.drawConnectingLines === 'function') window.drawConnectingLines();
    return result;
  };
  const wrapped = function (...args) {
    if (_lpRecalcInFlight) {
      _lpRecalcQueued = true;
      return _lpRecalcInFlight;
    }
    _lpRecalcInFlight = (async () => {
      let result;
      do {
        _lpRecalcQueued = false;
        result = await runOnce.apply(this, args);
      } while (_lpRecalcQueued);
      _lpRecalcInFlight = null;
      return result;
    })();
    return _lpRecalcInFlight;
  };
  wrapped.__lpWrapped = true;
  window.recalculate = wrapped;
}

// The Calculator's own stat strip has no concept of LP. Rather than a separate strip of big boxes
// competing for space at the top of the page, this renders as ONE compact card - same glass-card/
// diagram-node styling real tree cards use - in its OWN column appended right after the root
// card's column in #tree-container, so it sits beside the root card (columns lay out left-to-right,
// and the root's column - depth 0 - is always the rightmost existing one, see renderTreeDiagram in
// js/app.js), reading as part of the tree rather than a bolted-on dashboard. Only the offer's flat
// isk_cost/lp_cost (no typeId, can't be a tree node) needs adding on top of the Calculator's own
// figure - required_items are real tree children at this point, so
// window.recipeTreeRoot.calculatedCost (materials + job fee, the Calculator's own unmodified
// number) already includes them.
function renderLPExtraStats() {
  if (!_lpIsolatedResult || !window.recipeTreeRoot) {
    document.getElementById('lp-info-card-col')?.remove();
    return;
  }

  const root = window.recipeTreeRoot;
  const treeContainer = document.getElementById('tree-container');
  const rootCardEl = document.getElementById(`node-card-${root.instanceId}`);
  if (!treeContainer || !rootCardEl) return; // tree hasn't rendered yet this pass

  const result = _lpIsolatedResult;
  const offer = result.offer;
  const batches = getLPRedemptionBatches(result);
  const flatIskCost = batches * offer.isk_cost;
  const flatLpCost = batches * offer.lp_cost;
  const acquiredLpCost = window.__lpSpentThisRecalc || 0;

  const totalIskCost = (root.calculatedCost || 0) + flatIskCost;
  const totalLpCost = acquiredLpCost + flatLpCost;

  // recalculate() already computed net sell revenue net of tax/broker (outputMarketValue is the
  // gross figure it derived that from) - profit is redone here against totalIskCost (which the
  // Calculator's own netProfitSell doesn't know about) rather than reused directly.
  let grossRevenue = root.outputMarketValue || 0;
  // Instant sell: the highest Jita buy order instead of the Auto sell price (a custom price set on
  // the Calculator's own card still wins, since that's a deliberate override).
  if (_lpSellMode === 'instant' && (window.rootSellStrategy || 'market-sell') === 'market-sell') {
    grossRevenue = lpOutputUnitPrice(root.productTypeId || root.typeId) * (root.qtyNeeded || 0);
  }
  const netRevenue = grossRevenue * lpSellNetFactor();
  const profit = netRevenue - totalIskCost;
  const iskPerLp = totalLpCost > 0 ? profit / totalLpCost : null;
  const profitColor = profit > 0 ? 'var(--accent)' : 'var(--red-400, #f87171)';
  const iskPerLpDisplay = iskPerLp === null ? '—' : Math.round(iskPerLp).toLocaleString();

  // Label above, value below, right-aligned - every single time, regardless of how long the value
  // is. A previous version switched a row between sitting-inline and stacked-onto-its-own-line
  // depending on the value's length, which kept any one row from overflowing but looked broken
  // across the card as a whole: a short "Total LP Spent" would sit compact on one line right next
  // to a "Redemption Fee" stacked onto two, at two different heights, with nothing lining up (this
  // is what a Komodo BPC's real numbers - 150,000,000,000 ISK + 150,000,000 LP - looked like). One
  // shape for every row removes the inconsistency instead of patching around it, and this card's
  // width already comfortably fits any realistic single ISK/LP figure on its own line (EVE's ISK
  // supply is large, but not "doesn't fit in ~46 mono characters" large).
  const row = (label, value, color, title) => `
    <div ${title ? `title="${window.esc(title)}"` : ''}>
      <div class="text-slate-400" style="font-size:11.5px;">${label}</div>
      <div class="text-right font-bold whitespace-nowrap" style="font-size:16px; color:${color || 'var(--text)'};">${value}</div>
    </div>`;

  // Same overflow logic as row() above, applied to the two standalone hero numbers: shrink the
  // font in steps as the string gets longer instead of letting it run past the card edge.
  const fitFontSize = (text, sizes) => {
    for (const [maxLen, size] of sizes) {
      if (text.length <= maxLen) return size;
    }
    return sizes[sizes.length - 1][1];
  };
  const profitText = Math.round(profit).toLocaleString() + ' ISK';
  const heroFontSize = fitFontSize(profitText, [[15, '32px'], [18, '26px'], [22, '21px'], [99, '17px']]);
  const iskPerLpFontSize = fitFontSize(iskPerLpDisplay, [[9, '20px'], [13, '16px'], [99, '13px']]);

  const innerHTML = `
    <div class="flex items-center gap-1.5 border-b border-[#3a3025] pb-2 mb-2.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5"/></svg>
      <span class="font-bold text-sm text-white">LP Store Economics</span>
    </div>
    <div class="text-sm mono lp-econ-rows">
      ${row('Total ISK Cost', Math.round(totalIskCost).toLocaleString() + ' ISK', null, 'Build materials + required redemption items (purple cards) + job install fee + the flat ISK portion of redeeming this offer')}
      ${row('Redemption Fee (ISK)', Math.round(flatIskCost).toLocaleString() + ' ISK', '#c084fc', 'The flat ISK portion of redeeming this offer - on top of the required items already counted in Total ISK Cost above')}
      ${row('Redemption Fee (LP)', flatLpCost.toLocaleString() + ' LP', '#c084fc', 'The flat LP portion of redeeming this offer')}
      ${row('Total LP Spent', totalLpCost.toLocaleString() + ' LP', '#c084fc', 'Redemption LP + any component set to "Acquire via LP" in the tree')}
      ${row('Valued as', _lpSellMode === 'instant' ? 'Instant sell' : 'Sell order', null, _lpSellMode === 'instant' ? 'Sold straight into the highest Jita buy order: no broker fee, sales tax only. Change it in Ranked Offers.' : 'Listed by you at the Jita sell price, net of sales tax and broker fee. Change it in Ranked Offers.')}
    </div>
    <div class="border-t border-[#3a3025] mt-2.5 pt-2.5">
      <div class="text-slate-400 text-xs uppercase tracking-wide" style="font-size:10.5px;" title="Sale value (per the Valued as setting, net of tax) minus build materials, required redemption items, job fee, and the flat redemption fee">LP-Aware Profit</div>
      <div class="hero-num ${profit >= 0 ? 'profit' : 'loss'}" style="font-size:${heroFontSize}; white-space:nowrap;">${profitText}</div>
    </div>
    <div class="border-t border-[#3a3025] mt-2.5 pt-2.5" title="Estimated ISK profit per LP spent">
      <div class="text-slate-400 text-xs uppercase tracking-wide" style="font-size:10.5px;">ISK / LP</div>
      <div class="text-right font-bold mono whitespace-nowrap" style="color:${profitColor}; font-size:${iskPerLpFontSize};">${iskPerLpDisplay}</div>
    </div>
  `;

  // Update the existing card IN PLACE when it's already correctly positioned (the common case -
  // every recalculate after the first) rather than removing and recreating both elements from
  // scratch every single pass. A same-typed remove+insert is a real, avoidable source of layout
  // churn on a page where a plain Hide/Compact or Build/Buy click already reflows a lot on its own
  // (see recalculateWithPanAnchor's own comment on this page's redemption-node rebuilding) - one
  // less thing moving on every keystroke/click. Still falls back to a full rebuild if the column
  // is missing or ended up somewhere else (defensive, not expected in normal use).
  const existingCol = document.getElementById('lp-info-card-col');
  const existingCard = document.getElementById('lp-info-card');
  if (existingCol && existingCard && existingCol.parentElement === treeContainer && treeContainer.lastElementChild === existingCol) {
    existingCard.innerHTML = innerHTML;
    return;
  }
  existingCol?.remove();

  const card = document.createElement('div');
  card.id = 'lp-info-card';
  card.className = 'diagram-node glass-card p-3.5 w-[26rem]';
  card.style.borderTopColor = '#c084fc';
  card.innerHTML = innerHTML;

  const col = document.createElement('div');
  col.id = 'lp-info-card-col';
  col.className = 'flex flex-col justify-center';
  col.appendChild(card);
  treeContainer.appendChild(col);
}
window.renderLPExtraStats = renderLPExtraStats;

// --- Market Economics pull-up drawer (isolation mode only) ----------------------------------
// Price history + trade volume for the isolated offer's own PRODUCT (its outputTypeId - already
// the right typeId for both offer types, see evaluateBpcOffer/evaluateDirectSellOffer), fetched
// from ESI market history (js/esi.js fetchMarketHistoryRaw) at whatever station the Calculator's
// own Home Market is set to - the same market every other price on this page already comes from.
// Two independent single-series charts (price line, volume bars) stacked with the same date domain
// and padding so they visually align, rather than one dual-axis chart on the same plot - this app
// has no charting library, so both are hand-rolled inline SVG with their own hover crosshair/
// tooltip, matching how the tree canvas's own connecting lines are hand-drawn SVG too.
let _lpMarketDrawerOpen = false;
let _lpMarketExpanded = false;
let _lpMarketRangeDays = 30;
let _lpMarketTableView = false;
let _lpMarketLoadedTypeId = null;
let _lpMarketHistoryRows = null; // full ~year of ESI history for the currently-loaded typeId, ascending by date
let _lpMarketRegionId = null;    // resolved once from the Home Market station, then cached for the session
let _lpMarketRegionName = null;  // resolved alongside the region id, for the drawer's "which market" label

const LP_MARKET_RANGES = [30, 90, 180];

// The drawer sizes itself to its actual content now (height:auto, capped by max-height - see
// styles.css), rather than a fixed px guess, so the pull tab's "sit right above the sheet's own
// top edge" offset has to be measured, not hardcoded - it's called after every content change that
// could move the drawer's real height (open, expand toggle, and every render pass below).
function positionMarketDrawerTab() {
  const tab = document.getElementById('lp-market-drawer-tab');
  const drawer = document.getElementById('lp-market-drawer');
  if (!tab || !drawer) return;
  tab.style.bottom = _lpMarketDrawerOpen ? `${drawer.offsetHeight + 16}px` : '';
}

function toggleMarketDrawer() {
  _lpMarketDrawerOpen = !_lpMarketDrawerOpen;
  document.getElementById('lp-market-drawer')?.classList.toggle('open', _lpMarketDrawerOpen);
  document.getElementById('lp-market-drawer-tab')?.classList.toggle('open', _lpMarketDrawerOpen);
  positionMarketDrawerTab();
  if (_lpMarketDrawerOpen) loadAndRenderMarketDrawer();
}
window.toggleMarketDrawer = toggleMarketDrawer;

// A taller drawer for anyone who wants more room to actually read the chart detail, rather than
// the compact default. Re-renders the charts too (not just a CSS height change) since their own
// SVG height is a function of this state - see buildPriceLineChart/buildVolumeLineChart.
function toggleMarketExpanded() {
  _lpMarketExpanded = !_lpMarketExpanded;
  document.getElementById('lp-market-drawer')?.classList.toggle('expanded', _lpMarketExpanded);
  document.getElementById('lp-market-drawer-tab')?.classList.toggle('expanded', _lpMarketExpanded);
  document.getElementById('lp-market-expand-toggle')?.classList.toggle('icon-rail-btn-active', _lpMarketExpanded);
  if (!_lpMarketTableView) renderMarketDrawerContent();
  positionMarketDrawerTab();
}
window.toggleMarketExpanded = toggleMarketExpanded;

// Called whenever a different offer gets isolated (or the inspector is exited entirely) so a
// previous item's data and open/closed/expanded state never carries over into the next one.
function resetMarketDrawer() {
  _lpMarketDrawerOpen = false;
  _lpMarketExpanded = false;
  _lpMarketLoadedTypeId = null;
  _lpMarketHistoryRows = null;
  document.getElementById('lp-market-drawer')?.classList.remove('open', 'expanded');
  const tab = document.getElementById('lp-market-drawer-tab');
  tab?.classList.remove('open', 'expanded');
  if (tab) tab.style.bottom = '';
}
window.resetMarketDrawer = resetMarketDrawer;

function renderMarketRangePills() {
  const el = document.getElementById('lp-market-range-pills');
  if (!el) return;
  el.innerHTML = LP_MARKET_RANGES.map(d => `<button onclick="setMarketRange(${d})" class="lp-pill${d === _lpMarketRangeDays ? ' active' : ''}" style="padding:4px 9px; font-size:10px;">${d}D</button>`).join('');
}

function setMarketRange(days) {
  _lpMarketRangeDays = days;
  renderMarketRangePills();
  renderMarketDrawerContent();
}
window.setMarketRange = setMarketRange;

function setMarketTableView(val) {
  _lpMarketTableView = val;
  document.getElementById('lp-market-table-toggle')?.classList.toggle('icon-rail-btn-active', val);
  renderMarketDrawerContent();
}
window.setMarketTableView = setMarketTableView;

async function loadAndRenderMarketDrawer() {
  if (!_lpIsolatedResult) return;
  const typeId = _lpIsolatedResult.outputTypeId;
  const nameEl = document.getElementById('lp-market-item-name');
  if (nameEl) nameEl.textContent = '— ' + _lpIsolatedResult.outputName;
  renderMarketRangePills();

  if (_lpMarketLoadedTypeId === typeId && _lpMarketHistoryRows) {
    renderMarketDrawerContent();
    return;
  }

  const body = document.getElementById('lp-market-drawer-body');
  if (body) body.innerHTML = `<div class="flex items-center justify-center h-full text-slate-500 italic text-sm">Loading market history…</div>`;

  if (!_lpMarketRegionId) {
    const homeStationId = localStorage.getItem('eve_home_station_id') || '60003760';
    const resolved = typeof window.resolveStationRegion === 'function' ? await window.resolveStationRegion(homeStationId) : null;
    _lpMarketRegionId = (resolved && resolved.regionId) || 10000002; // The Forge (Jita) fallback
    _lpMarketRegionName = typeof window.fetchRegionName === 'function' ? await window.fetchRegionName(_lpMarketRegionId) : null;
  }
  const marketLabelEl = document.getElementById('lp-market-region-label');
  if (marketLabelEl) {
    const stationName = localStorage.getItem('eve_home_station_name') || 'Jita IV - Moon 4';
    marketLabelEl.textContent = _lpMarketRegionName ? `${stationName} · ${_lpMarketRegionName}` : stationName;
  }

  const rows = await window.fetchMarketHistoryRaw(_lpMarketRegionId, typeId);
  // Bail if the isolated offer changed while this fetch was in flight (e.g. rapid clicking) -
  // rendering data for whatever's isolated NOW, not what was isolated when the fetch started.
  if (!_lpIsolatedResult || _lpIsolatedResult.outputTypeId !== typeId) return;

  _lpMarketLoadedTypeId = typeId;
  _lpMarketHistoryRows = (rows || []).slice().sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));

  if (!_lpMarketHistoryRows.length) {
    if (body) body.innerHTML = `<div class="flex items-center justify-center h-full text-slate-500 italic text-sm text-center px-6">No market history available for this item at your home market.</div>`;
    positionMarketDrawerTab();
    return;
  }
  renderMarketDrawerContent();
}
window.loadAndRenderMarketDrawer = loadAndRenderMarketDrawer;

function renderMarketDrawerContent() {
  const body = document.getElementById('lp-market-drawer-body');
  if (!body || !_lpMarketHistoryRows || !_lpMarketHistoryRows.length) return;

  const all = _lpMarketHistoryRows;
  const sliced = all.slice(-_lpMarketRangeDays);
  const last7 = all.slice(-7);

  const avgDailyVolume = last7.reduce((s, r) => s + (r.volume || 0), 0) / last7.length;
  const latestOrderCount = all[all.length - 1].order_count || 0;
  const firstPrice = sliced[0].average, lastPrice = sliced[sliced.length - 1].average;
  const priceChangePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const qtyNeeded = (window.recipeTreeRoot && window.recipeTreeRoot.qtyNeeded) || 0;
  const daysOfSupply = avgDailyVolume > 0 ? Math.ceil(qtyNeeded / avgDailyVolume) : null;
  const changeColor = priceChangePct > 0 ? 'var(--accent)' : (priceChangePct < 0 ? 'var(--red-400, #f87171)' : 'var(--text-mute)');
  const changeSign = priceChangePct > 0 ? '+' : '';

  // One thin strip, four cells - not four separate boxy cards. No icons, no per-cell background,
  // no accent bars - a hairline divider between cells is the only structure, closer to a stock
  // ticker readout than a dashboard of KPI cards.
  const statCell = (label, value, color, title) => `
    <div class="lp-market-stat-cell" ${title ? `title="${window.esc(title)}"` : ''}>
      <div class="stat-label">${label}</div>
      <div class="stat-value" style="${color ? `color:${color};` : ''}">${value}</div>
    </div>`;

  const statsHTML = `
    <div class="lp-market-stat-strip mb-3">
      ${statCell('Avg Daily Volume', formatCompactMarketUnits(avgDailyVolume) + '/day', null, 'Average units traded per day over the last 7 trading days')}
      ${statCell(`Price Change (${_lpMarketRangeDays}D)`, `${changeSign}${priceChangePct.toFixed(1)}%`, changeColor, `Average price change from ${formatMarketDate(sliced[0].date)} to ${formatMarketDate(sliced[sliced.length - 1].date)}`)}
      ${statCell('Sell Orders', latestOrderCount.toLocaleString(), null, 'Number of active sell orders as of the most recent trading day')}
      ${statCell('Est. Days to Sell', daysOfSupply !== null ? `${daysOfSupply}d` : '—', null, "Estimated days to move this redemption's full output at the recent average daily volume")}
    </div>`;

  if (_lpMarketTableView) {
    body.innerHTML = statsHTML + buildMarketTableHTML(sliced);
    positionMarketDrawerTab();
    return;
  }

  body.innerHTML = statsHTML + `
    <div class="lp-card p-3 mb-2">
      <div class="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style="color:var(--text-mute);">Average Daily Price</div>
      <div id="lp-market-price-chart-wrap" style="position:relative;"></div>
    </div>
    <div class="lp-card p-3">
      <div class="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style="color:var(--text-mute);">Units Traded Per Day</div>
      <div id="lp-market-volume-chart-wrap" style="position:relative;"></div>
    </div>`;

  const priceWrap = document.getElementById('lp-market-price-chart-wrap');
  const volWrap = document.getElementById('lp-market-volume-chart-wrap');
  buildPriceLineChart(sliced, priceWrap);
  buildVolumeCandlestickChart(sliced, volWrap);

  // Building the (fixed-height) volume chart can be what first pushes the drawer body past its
  // max-height, bringing a scrollbar into existence that narrows both wraps' real width - after
  // both charts already measured and locked in a wider one moments earlier. Both charts now pin
  // their SVG to an exact pixel width (see buildPriceLineChart's own note on why), so unlike the
  // old width:100% this won't silently rescale to the correction - it needs a rebuild. One
  // corrective pass is enough: the scrollbar's presence is already decided by this point, so a
  // second pass can't itself trigger a third.
  const priceSvg = document.getElementById('lp-market-price-svg');
  if (priceWrap && priceSvg && priceWrap.clientWidth !== parseInt(priceSvg.getAttribute('width'), 10)) {
    buildPriceLineChart(sliced, priceWrap);
  }
  const volSvg = document.getElementById('lp-market-volume-svg');
  if (volWrap && volSvg && volWrap.clientWidth !== parseInt(volSvg.getAttribute('width'), 10)) {
    buildVolumeCandlestickChart(sliced, volWrap);
  }
  positionMarketDrawerTab();
}
window.renderMarketDrawerContent = renderMarketDrawerContent;

function formatCompactMarketUnits(n) {
  const v = Math.round(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toLocaleString();
}

// ESI dates are plain "YYYY-MM-DD" - appending a UTC time avoids the well-known bug where
// `new Date("YYYY-MM-DD")` parses as UTC midnight but .toLocaleDateString() then renders it in the
// browser's LOCAL timezone, silently shifting the displayed day backward for anyone west of UTC.
function formatMarketDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function buildMarketTableHTML(rows) {
  const reversed = rows.slice().reverse(); // most recent first, matching the ranked-offer table's own convention
  const rowsHTML = reversed.map(r => `
    <tr>
      <td class="py-1">${formatMarketDate(r.date)}</td>
      <td class="text-right mono">${Math.round(r.average).toLocaleString()} ISK</td>
      <td class="text-right mono" style="color:var(--text-mute);">${Math.round(r.lowest).toLocaleString()} / ${Math.round(r.highest).toLocaleString()}</td>
      <td class="text-right mono">${(r.volume || 0).toLocaleString()}</td>
      <td class="text-right mono" style="color:var(--text-mute);">${(r.order_count || 0).toLocaleString()}</td>
    </tr>`).join('');
  return `
    <div class="overflow-x-auto">
      <table class="lp-table text-xs mono w-full">
        <thead><tr>
          <th>Date</th><th class="text-right">Avg Price</th><th class="text-right">Low / High</th><th class="text-right">Volume</th><th class="text-right">Orders</th>
        </tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>`;
}

function getOrCreateMarketTooltip(container) {
  let tooltip = container.querySelector('.lp-market-chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'lp-market-chart-tooltip';
    tooltip.style.display = 'none';
    container.appendChild(tooltip);
  }
  return tooltip;
}

// Straight segments between each day's real value - no curve-fit. A Catmull-Rom smoothed curve
// was tried here and rejected (feedback: "makes it look too curvy") - smoothing a *daily average
// price* series manufactures motion between points that didn't happen and can visually overshoot
// past real local highs/lows, which is exactly the wrong instinct for a price chart. A plain
// polyline is what every real market tool (eve-marketer, adam4eve, the in-game chart) uses for
// this kind of series, and it's honest: every vertex is a real traded day, every segment is a
// straight interpolation, nothing implied in between.
function linePathD(points) {
  if (points.length < 2) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

// Single series (average daily price) - per the dataviz "one axis" rule this is its own chart, not
// overlaid with volume on a second scale. Deliberately plain now: a straight 2px line (see
// linePathD's own note on why not smoothed), a flat (not gradient) low-opacity area wash, a dashed
// period-average reference line, light gridlines - no glow/blur filter and no pulsing end-marker,
// both cut after feedback that the earlier version read as busy rather than polished. An end-dot
// with a surface-color ring (.lp-market-hover-dot in styles.css), plus a crosshair+tooltip that
// snaps to the nearest day under the pointer.
//
// The viewBox width matches the container's REAL measured pixel width (not a fixed arbitrary
// number stretched via preserveAspectRatio="none" - see the earlier version's own note, still true)
// AND the SVG's rendered CSS size is pinned to that exact same integer pixel value (width:${W}px,
// not width:100%) - a percentage width can render at a fractional pixel value the layout engine
// picks (e.g. a 437.6px-wide flex child), which against an integer viewBox is a sub-1:1 scale of
// well under a pixel but still enough to soften/blur every glyph and hairline in the chart (this is
// what was still reading as "blurry, almost glowing" after the earlier Math.round()-on-text fix,
// which only fixed fractional *position*, not this fractional *scale*). Pinning both to the same
// integer removes the mismatch entirely; the debounced window resize listener below keeps it
// correct as the container's real width changes. Text coordinates are still rounded to whole pixels
// on top of that (Math.round, not the sub-pixel .toFixed(1) the path geometry uses), which remains
// correct and necessary in its own right.
// NOTE: this does NOT fix the "white outline" bug - that turned out to be an inherited
// stroke:currentColor from a sitewide svg[viewBox] icon-reset rule, fixed in styles.css (search
// there for svg[viewBox] for the full explanation) with a plain stroke:none on the chart roots.
// This function only addresses a separate, real complaint: --accent/--red-400 at full brand
// intensity read as too bright/glowy against this near-black card. Computes a 78%-toward-black mix
// via plain arithmetic (equivalent to color-mix(in srgb, var(--accent) 78%, black), avoided here
// only because it's one more moving part, not because it caused the outline). --accent/--red-400
// vary by the active EVE-faction theme, so this reads the live computed value, not a hardcoded hex.
function dimmedMarketColor(cssVarName, fallbackHex, pct) {
  const raw = (getComputedStyle(document.body).getPropertyValue(cssVarName).trim() || fallbackHex).replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16), g = parseInt(raw.slice(2, 4), 16), b = parseInt(raw.slice(4, 6), 16);
  const mix = (c) => Math.round(c * pct / 100);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function buildPriceLineChart(rows, container) {
  if (!container) return;
  const W = Math.max(280, Math.round(container.clientWidth || container.getBoundingClientRect().width || 640));
  const H = _lpMarketExpanded ? 280 : 145;
  const padL = 72, padR = 14, padT = 14, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = rows.length;
  const prices = rows.map(r => r.average);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const avgP = prices.reduce((s, p) => s + p, 0) / n;
  const range = (maxP - minP) || Math.max(minP, 1) * 0.1 || 1;
  const padRange = range * 0.12;
  const yMin = Math.max(0, minP - padRange), yMax = maxP + padRange;
  const yMid = (yMin + yMax) / 2;
  const yDen = (yMax - yMin) || 1;

  const xForIndex = (i) => n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW;
  const yForPrice = (p) => padT + innerH - ((p - yMin) / yDen) * innerH;

  const points = prices.map((p, i) => [xForIndex(i), yForPrice(p)]);
  const linePath = linePathD(points);
  const baseline = (padT + innerH).toFixed(1);
  const areaPath = `${linePath} L${points[n - 1][0].toFixed(1)},${baseline} L${points[0][0].toFixed(1)},${baseline} Z`;
  const lastX = points[n - 1][0], lastY = points[n - 1][1];
  const gridY1 = padT, gridYMid = yForPrice(yMid), gridY2 = padT + innerH, avgY = yForPrice(avgP);

  // Grid/reference lines are hairlines (stroke-width 1) at whatever fractional Y a price/date
  // happens to fall at - exactly like the sub-pixel TEXT positions fixed elsewhere in this file
  // (see the Math.round() note below), a 1px line straddling two device pixels anti-aliases into a
  // soft ~2px smear instead of one crisp line. Rounded to the pixel grid for the same reason text
  // coordinates are - this only applies to straight hairline geometry; the price line's own curve
  // keeps sub-pixel precision (smoothness there benefits from it, and a curve doesn't have the
  // single-hard-edge-per-pixel-row shape that makes off-grid placement read as blur).
  const gridY1R = Math.round(gridY1), gridYMidR = Math.round(gridYMid), gridY2R = Math.round(gridY2), avgYR = Math.round(avgY);
  const vLineCount = Math.min(4, n - 1);
  const vLines = Array.from({ length: vLineCount + 1 }, (_, i) => {
    const x = Math.round(padL + (i / vLineCount) * innerW);
    return `<line class="v" x1="${x}" y1="${gridY1R}" x2="${x}" y2="${gridY2R}"/>`;
  }).join('');
  const lineColor = dimmedMarketColor('--accent', '#9de137', 78);

  container.innerHTML = `
    <svg id="lp-market-price-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px; height:${H}px; display:block; cursor:crosshair;">
      <g class="lp-market-chart-grid">
        ${vLines}
        <line x1="${padL}" y1="${gridY1R}" x2="${W - padR}" y2="${gridY1R}"/>
        <line x1="${padL}" y1="${gridYMidR}" x2="${W - padR}" y2="${gridYMidR}"/>
        <line x1="${padL}" y1="${gridY2R}" x2="${W - padR}" y2="${gridY2R}"/>
      </g>
      <line class="lp-market-avg-line" x1="${padL}" y1="${avgYR}" x2="${W - padR}" y2="${avgYR}"/>
      <text class="lp-market-avg-label" x="${W - padR - 3}" y="${Math.round(avgY - 4)}" text-anchor="end">avg ${window.formatISKCompact(avgP)}</text>
      <text class="lp-market-chart-axis-label" x="${padL - 8}" y="${Math.round(gridY1 + 4)}" text-anchor="end">${window.formatISKCompact(yMax)}</text>
      <text class="lp-market-chart-axis-label" x="${padL - 8}" y="${Math.round(gridYMid + 3.5)}" text-anchor="end">${window.formatISKCompact(yMid)}</text>
      <text class="lp-market-chart-axis-label" x="${padL - 8}" y="${Math.round(gridY2 + 4)}" text-anchor="end">${window.formatISKCompact(yMin)}</text>
      <text class="lp-market-chart-axis-label" x="${padL}" y="${Math.round(H - 6)}" text-anchor="start">${formatMarketDate(rows[0].date)}</text>
      <text class="lp-market-chart-axis-label" x="${W - padR}" y="${Math.round(H - 6)}" text-anchor="end">${formatMarketDate(rows[n - 1].date)}</text>
      <path class="lp-market-price-area" d="${areaPath}" style="fill:${lineColor};"/>
      <path class="lp-market-price-line" d="${linePath}" style="stroke:${lineColor};"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" class="lp-market-hover-dot" style="fill:${lineColor};"/>
      <line id="lp-market-price-crosshair" class="lp-market-crosshair" x1="0" y1="${padT}" x2="0" y2="${gridY2}" style="display:none;"/>
      <circle id="lp-market-price-hoverdot" r="5" class="lp-market-hover-dot" style="display:none; fill:${lineColor};"/>
    </svg>`;

  const svgEl = document.getElementById('lp-market-price-svg');
  const tooltip = getOrCreateMarketTooltip(container);
  const crosshair = document.getElementById('lp-market-price-crosshair');
  const hoverDot = document.getElementById('lp-market-price-hoverdot');

  svgEl.addEventListener('pointermove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = Math.round(((relX - padL) / innerW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    const x = xForIndex(idx), y = yForPrice(prices[idx]);
    crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x); crosshair.style.display = '';
    hoverDot.setAttribute('cx', x); hoverDot.setAttribute('cy', y); hoverDot.style.display = '';
    tooltip.style.display = '';
    tooltip.style.left = `${(x / W) * 100}%`;
    tooltip.style.top = `${(y / H) * 100}%`;
    tooltip.innerHTML = `<div class="lbl">${formatMarketDate(rows[idx].date)}</div><div class="val">${Math.round(prices[idx]).toLocaleString()} ISK</div>`;
  });
  svgEl.addEventListener('pointerleave', () => {
    crosshair.style.display = 'none';
    hoverDot.style.display = 'none';
    tooltip.style.display = 'none';
  });
}

// Single series (units traded per day) - its own chart/axis, stacked below the price chart with
// the same padL/padR/date domain so the two visually align without being one dual-axis plot. Bars
// Single series (units traded per day) - candlestick-style: one thin, sharp-edged vertical stick
// per day (not the earlier chunky rounded bars, not a continuous line). There's no real open/high/
// low/close for a daily trade count, so this isn't literal OHLC - each stick is colored by that
// day's PRICE direction versus the day before (the same green/red convention a real candlestick
// price chart uses), which is honest to data this endpoint actually has and gives the sticks real
// meaning instead of being one flat color. Flat fills throughout, no gradients.
function buildVolumeCandlestickChart(rows, container) {
  if (!container) return;
  const W = Math.max(280, Math.round(container.clientWidth || container.getBoundingClientRect().width || 640));
  const H = _lpMarketExpanded ? 160 : 85;
  const padL = 72, padR = 14, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = rows.length;
  const volumes = rows.map(r => r.volume || 0);
  const prices = rows.map(r => r.average);
  const avgV = volumes.reduce((s, v) => s + v, 0) / n;
  const maxV = Math.max(...volumes, 1) * 1.1;

  const slotW = innerW / n;
  const stickW = Math.max(2, Math.min(9, slotW * 0.55));
  const xForIndex = (i) => padL + i * slotW + (slotW - stickW) / 2;
  const yForVol = (v) => padT + innerH - (v / maxV) * innerH;
  const baseline = padT + innerH;
  const avgY = yForVol(avgV);
  // Same pixel-grid rounding as the price chart's grid/avg lines, applied to the baseline too - see
  // that function's own comment on why hairline geometry needs this and curves don't.
  const baselineR = Math.round(baseline), avgYR = Math.round(avgY);

  const vLineCount = Math.min(4, n - 1);
  const vLines = Array.from({ length: vLineCount + 1 }, (_, i) => {
    const x = Math.round(padL + (i / vLineCount) * innerW);
    return `<line class="v" x1="${x}" y1="${padT}" x2="${x}" y2="${baselineR}"/>`;
  }).join('');

  // Candlestick rects get the identical treatment, and for the identical reason - a filled shape
  // with a hard edge (unlike the price line's smooth curve) reads as a soft glow/outline when that
  // edge sits between two device pixels instead of on one. Rounding x/y/width/height to the pixel
  // grid, plus shape-rendering:crispEdges (belt and suspenders - tells the renderer to prioritize
  // sharp edges over anti-aliased ones for this exact case), removes it. Flat full opacity now too,
  // not 80% - a semi-transparent fill anti-aliasing against the card background underneath was
  // compounding the same soft-edge look; hover swaps to a brightness filter instead of opacity so
  // there's still a hover state without reintroducing transparency.
  const upColor = dimmedMarketColor('--accent', '#9de137', 78);
  const downColor = dimmedMarketColor('--red-400', '#f87171', 78);
  const sticks = volumes.map((v, i) => {
    const x = Math.round(xForIndex(i)), y = Math.round(yForVol(v));
    const w = Math.max(1, Math.round(stickW));
    const h = Math.max(1, baselineR - y);
    const up = i === 0 ? true : prices[i] >= prices[i - 1];
    const color = up ? upColor : downColor;
    return `<rect data-idx="${i}" class="lp-market-candlestick" x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
  }).join('');

  container.innerHTML = `
    <svg id="lp-market-volume-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px; height:${H}px; display:block; cursor:crosshair;">
      <g class="lp-market-chart-grid">${vLines}<line x1="${padL}" y1="${baselineR}" x2="${W - padR}" y2="${baselineR}"/></g>
      <line class="lp-market-avg-line" x1="${padL}" y1="${avgYR}" x2="${W - padR}" y2="${avgYR}"/>
      <text class="lp-market-avg-label" x="${W - padR - 3}" y="${Math.round(avgY - 4)}" text-anchor="end">avg ${formatCompactMarketUnits(avgV)}</text>
      <text class="lp-market-chart-axis-label" x="${padL - 8}" y="${Math.round(padT + 6)}" text-anchor="end">${formatCompactMarketUnits(maxV)}</text>
      <text class="lp-market-chart-axis-label" x="${padL}" y="${Math.round(H - 6)}" text-anchor="start">${formatMarketDate(rows[0].date)}</text>
      <text class="lp-market-chart-axis-label" x="${W - padR}" y="${Math.round(H - 6)}" text-anchor="end">${formatMarketDate(rows[n - 1].date)}</text>
      ${sticks}
    </svg>`;

  const svgEl = document.getElementById('lp-market-volume-svg');
  const tooltip = getOrCreateMarketTooltip(container);
  let hoveredIdx = null;

  svgEl.addEventListener('pointermove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = Math.floor((relX - padL) / slotW);
    idx = Math.max(0, Math.min(n - 1, idx));
    if (idx !== hoveredIdx) {
      svgEl.querySelectorAll('rect[data-idx]').forEach(el => el.classList.remove('is-hovered'));
      const el = svgEl.querySelector(`rect[data-idx="${idx}"]`);
      if (el) el.classList.add('is-hovered');
      hoveredIdx = idx;
    }
    const x = xForIndex(idx) + stickW / 2, y = yForVol(volumes[idx]);
    tooltip.style.display = '';
    tooltip.style.left = `${(x / W) * 100}%`;
    tooltip.style.top = `${(y / H) * 100}%`;
    tooltip.innerHTML = `<div class="lbl">${formatMarketDate(rows[idx].date)}</div><div class="val">${volumes[idx].toLocaleString()} units</div>`;
  });
  svgEl.addEventListener('pointerleave', () => {
    svgEl.querySelectorAll('rect[data-idx]').forEach(el => el.classList.remove('is-hovered'));
    hoveredIdx = null;
    tooltip.style.display = 'none';
  });
}

// Both chart builders size their viewBox to the container's REAL measured width rather than
// scaling a fixed one to fit (see buildPriceLineChart's own comment on why) - that measurement
// goes stale if the browser window is resized while the drawer is open, so re-render on resize
// (debounced - a resize fires continuously while dragging) keeps the charts crisp instead of
// stretched/squished at the old width.
let _lpMarketResizeTimer = null;
window.addEventListener('resize', () => {
  if (!_lpMarketDrawerOpen || _lpMarketTableView) return;
  clearTimeout(_lpMarketResizeTimer);
  _lpMarketResizeTimer = setTimeout(() => renderMarketDrawerContent(), 150);
});

// --- Rendering: ranked list -------------------------------------------------------------------

function getLPStoreIconUrl(typeId, isBpc, size) {
  return `https://images.evetech.net/types/${typeId}/${isBpc ? 'bpc' : 'icon'}?size=${size || 32}`;
}

// Final stage of the icon fallback chain (icon -> render -> this) - now a thin alias for the shared
// js/config.js implementation (handleItemIconLoadError), which the Calculator's own node-card icon
// also needs for the exact same reason (a SKIN isolated from an LP Store offer has no image on either
// endpoint there either). Kept under this name so nothing else calling it needs to change.
function handleLPIconLoadError(imgEl) {
  return window.handleItemIconLoadError(imgEl);
}
window.handleLPIconLoadError = handleLPIconLoadError;

function renderLPStoreState(err) {
  const emptyState = document.getElementById('lpstore-empty-state');
  const loadingState = document.getElementById('lpstore-loading-state');
  const errorState = document.getElementById('lpstore-error-state');
  const resultsArea = document.getElementById('lpstore-results-area');
  [emptyState, loadingState, errorState, resultsArea].forEach(el => el && el.classList.add('hidden'));

  if (err) {
    if (errorState) { errorState.classList.remove('hidden'); errorState.textContent = `Failed to load this store's offers: ${err.message || err}`; }
    return;
  }
  if (_lpIsLoading) {
    if (loadingState) loadingState.classList.remove('hidden');
    return;
  }
  if (!_lpActiveCorpId) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  // Don't re-show the list if an offer is currently isolated (the canvas view stays up, e.g. across
  // a tax/fee edit that re-triggers loadAndRankLPStore).
  if (resultsArea && !_lpIsolatedResult) resultsArea.classList.remove('hidden');

  // Refreshes the Favorites pill's count for whichever corp _lpRankedResults now holds - without
  // this, switching corps left that badge showing the PREVIOUS corp's own count (or an earlier,
  // now-stale one) until something else happened to re-trigger renderLPCategoryBar (toggling a
  // favorite, clicking a category pill), same underlying bug as the count being unscoped at all.
  renderLPCategoryBar();
  renderLPStoreTable();
}

function sortIndicator(key) {
  if (_lpSortKey !== key) return '';
  return _lpSortDir === -1 ? ' ▼' : ' ▲';
}

function renderLPStoreTable() {
  const el = document.getElementById('lpstore-table-container');
  if (!el) return;

  let rows = _lpRankedResults.slice();
  if (_lpTypeFilter !== 'all') rows = rows.filter(r => r.offerType === _lpTypeFilter);
  if (_lpSearchQuery) {
    const q = _lpSearchQuery.toLowerCase();
    rows = rows.filter(r => r.outputName && r.outputName.toLowerCase().includes(q));
  }
  if (_lpCategoryFilter === 'favorites') {
    rows = rows.filter(r => _lpFavoriteOfferIds.has(lpFavoriteKey(r.offer.offer_id)));
  } else if (_lpCategoryFilter === 'blueprints') {
    // Cross-cutting, not an SDE category - every offer that grants a BPC, whatever it builds
    // (ship, implant, ammo...). Same test the "Blueprints" Offer Type pill above already uses.
    rows = rows.filter(r => r.offerType === 'bpc');
  } else if (_lpCategoryFilter !== 'all') {
    rows = rows.filter(r => {
      const cat = getLPItemCategory(r.outputTypeId);
      if (cat === undefined) return true; // not resolved yet - don't hide it, just not filterable yet
      if (_lpCategoryFilter === 'other') return cat === null || !LP_CATEGORY_LABELS[cat];
      return String(cat) === _lpCategoryFilter;
    });
  }
  rows.sort((a, b) => {
    const av = a[_lpSortKey], bv = b[_lpSortKey];
    const an = (av === null || av === undefined) ? -Infinity : av;
    const bn = (bv === null || bv === undefined) ? -Infinity : bv;
    return (an - bn) * _lpSortDir;
  });

  if (!rows.length) {
    el.innerHTML = `<div class="text-center py-10 italic" style="color:var(--text-mute);">No offers match this filter.</div>`;
    return;
  }

  const rowsHTML = rows.map(r => {
    const offer = r.offer;
    const isBpc = r.offerType === 'bpc';
    // A BPC offer's icon must come from the BLUEPRINT's own typeId (r.blueprintTypeId, i.e.
    // offer.type_id) - r.outputTypeId is the manufactured PRODUCT's typeId (e.g. the ship itself),
    // which has no /bpc art of its own and would 404/fall through to a wrong or generic image.
    const iconUrl = getLPStoreIconUrl(isBpc ? r.blueprintTypeId : r.outputTypeId, isBpc);
    const profitColor = r.profit > 0 ? 'var(--accent)' : 'var(--red-400, #f87171)';
    const iskPerLpDisplay = r.iskPerLp === null ? '—' : Math.round(r.iskPerLp).toLocaleString();
    const expanded = _lpExpandedOfferIds.has(offer.offer_id);
    // onerror is chained twice: /icon -> /render (covers most things, e.g. blueprints only have a
    // render, not an icon) -> handleLPIconLoadError swaps in a generic SVG placeholder (not hidden
    // - a gap in the row reads as broken, a placeholder reads as "no art for this one"). SKINs
    // (e.g. the FW LP store's own "Penumbral Shadows" SKINs) are the confirmed real case: images.
    // evetech.net has genuinely neither /icon nor /render for them, verified directly via fetch,
    // not just a loading hiccup. A named handler (not an inline outerHTML string) because svgIcon's
    // own markup uses double quotes throughout, which would terminate an inline onerror="..." the
    // moment it appeared.
    const iconFallback = `this.onerror=function(){window.handleLPIconLoadError(this);}; this.src='https://images.evetech.net/types/${r.outputTypeId}/render?size=32';`;

    const typeBadge = isBpc
      ? `<span class="text-[9px] mono px-1.5 py-0.5 rounded flex-shrink-0" style="background:rgba(192,132,252,0.15); color:#c084fc;" title="Redeeming this offer grants a Blueprint Copy - value shown is what building it out nets, not the BPC's own resale value.">BPC</span>`
      : `<span class="text-[9px] mono px-1.5 py-0.5 rounded flex-shrink-0" style="background:rgba(56,189,248,0.15); color:#38bdf8;">ITEM</span>`;

    // Visible without expanding - the actual reason two rows can share an item name (CCP offers
    // the same reward through several different LP/ISK/item combinations; each is a distinct
    // offer_id, not a data glitch). Previously only visible after a click, which read as duplicate
    // junk.
    const requiredItemsSummary = offer.required_items.length
      ? offer.required_items.map(r2 => `${r2.quantity}x ${window.esc(getLPItemName(r2.type_id))}`).join(', ')
      : (offer.isk_cost > 0 ? 'ISK + LP only' : 'LP only');

    // Isolate opens the real Calculator canvas for ANY offer now - a BPC gets its actual recipe
    // tree, a direct-sell item gets a synthetic root standing in for "the item you receive" (see
    // isolateDirectSellOffer) - either way its required_items render as real (purple) cards too.
    // A real icon+label button, in its own trailing table column (not squeezed into the crowded
    // Item cell alongside the favorite star/icon/name/badge, which is where this used to live as a
    // tiny 26px icon-only square - easy to miss and unclear what it even did without hovering for
    // the tooltip). "Isolate" matches the term used everywhere else this action is described
    // (isolateOffer, the detail row's own "Isolate this BPC/item →" button, the sidebar note).
    const isolateBtn = `<button onclick="event.stopPropagation(); isolateOffer(${offer.offer_id});" class="btn-glass btn-glass-muted py-1.5 px-3 text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap" title="Open this offer in the Calculator's own build-tree view">${window.svgIcon ? window.svgIcon('expand', { style: 'width:12px;height:12px;' }) : '⤢'} Isolate</button>`;

    // Favorited by corpId:offer_id (see the state-var comment above) - filled gold star when
    // favorited, hollow outline otherwise. stopPropagation so starring an offer doesn't also
    // toggle its detail row open.
    const isFav = _lpFavoriteOfferIds.has(lpFavoriteKey(offer.offer_id));
    const favBtn = `<button onclick="event.stopPropagation(); toggleLPFavorite(${offer.offer_id});" class="icon-btn flex-shrink-0" style="width:22px;height:22px;" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">${window.svgIcon('star', { style: isFav ? 'fill:#ffd23f; color:#ffd23f;' : 'color:var(--text-mute);' })}</button>`;

    let detailHTML = '';
    if (expanded) {
      detailHTML = `
        <tr class="lp-detail-row">
          <td colspan="8" class="px-3 pb-3">
            <div class="rounded-md p-3 text-[11px] mono" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);">
              <div class="grid grid-cols-2 gap-x-6 gap-y-1.5">
                <div><span style="color:var(--text-mute);">ISK Cost:</span> ${Math.round(offer.isk_cost).toLocaleString()} ISK</div>
                <div><span style="color:var(--text-mute);">LP Cost:</span> ${offer.lp_cost.toLocaleString()} LP</div>
                <div><span style="color:var(--text-mute);">Required Items (at Jita sell):</span> ${Math.round(r.requiredItemsCost).toLocaleString()} ISK</div>
                <div><span style="color:var(--text-mute);">Grants:</span> ${r.outputQty.toLocaleString()}x ${window.esc(r.outputName)}</div>
                ${isBpc ? `<div><span style="color:var(--text-mute);">Material Cost to Build:</span> ${Math.round(r.materialCost).toLocaleString()} ISK</div>` : ''}
                ${isBpc ? `<div><span style="color:var(--text-mute);">Job Install Fee:</span> ${Math.round(r.jobFee).toLocaleString()} ISK</div>` : ''}
                ${isBpc ? `<div><span style="color:var(--text-mute);">Build Time:</span> ${r.buildSeconds > 0 ? window.formatDurationCompact(r.buildSeconds) : 'no time data'}</div>` : ''}
                ${isBpc ? `<div><span style="color:var(--text-mute);">Blueprint Copy:</span> 1 copy, ${r.bpcRuns} run${r.bpcRuns === 1 ? '' : 's'}</div>` : ''}
              </div>
              <div class="mt-2 pt-2" style="border-top:1px solid rgba(255,255,255,0.06); color:var(--text-mute);">
                Turned in: ${requiredItemsSummary}
              </div>
              <div class="mt-2.5 pt-2.5" style="border-top:1px solid rgba(255,255,255,0.06);">
                <button onclick="event.stopPropagation(); isolateOffer(${offer.offer_id});" class="btn-glass px-2.5 py-1 text-[10px]">${isBpc ? 'Isolate this BPC →' : 'Isolate this item →'}</button>
              </div>
            </div>
          </td>
        </tr>`;
    }

    return `
      <tr class="lp-store-row cursor-pointer" onclick="toggleLPOfferExpanded(${offer.offer_id})" title="Click for a full cost/value breakdown">
        <td class="py-1.5">
          <div class="flex items-center gap-2 min-w-0">
            ${favBtn}
            <img src="${iconUrl}" alt="" class="w-6 h-6 rounded flex-shrink-0" loading="lazy" onerror="${iconFallback}">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate font-semibold text-white">${window.esc(r.outputName)}</span>
                ${typeBadge}
              </div>
              <div class="truncate text-[10px]" style="color:var(--text-mute);">${requiredItemsSummary}</div>
            </div>
          </div>
        </td>
        <td class="text-right mono">${offer.lp_cost.toLocaleString()}</td>
        <td class="text-right mono">${Math.round(r.cost).toLocaleString()}</td>
        <td class="text-right mono">${Math.round(r.revenue).toLocaleString()}</td>
        <td class="text-right mono font-bold" style="color:${profitColor};">${Math.round(r.profit).toLocaleString()}</td>
        <td class="text-right mono font-bold" style="color:${profitColor};">${iskPerLpDisplay}</td>
        <td class="text-right" style="color:var(--text-mute);">${isBpc && r.buildSeconds > 0 ? window.formatDurationCompact(r.buildSeconds) : '—'}</td>
        <td class="text-right">${isolateBtn}</td>
      </tr>
      ${detailHTML}`;
  }).join('');

  el.innerHTML = `
    <table class="lp-table text-xs mono w-full">
      <thead>
        <tr>
          <th>Item</th>
          <th class="text-right cursor-pointer" onclick="setLPStoreSort('lpCost')">LP Cost${sortIndicator('lpCost')}</th>
          <th class="text-right cursor-pointer" onclick="setLPStoreSort('cost')" title="ISK cost + required items, all priced at Jita sell/instant-buy - plus material cost and job install fee for BPC offers.">Total Cost${sortIndicator('cost')}</th>
          <th class="text-right cursor-pointer" onclick="setLPStoreSort('revenue')" title="${_lpSellMode === 'instant' ? 'Output sold into the highest Jita buy order, net of your Sales Tax setting (no broker fee).' : 'Output priced at Jita sell, net of your Sales Tax and Broker Fee settings (left sidebar).'}">Est. Value${sortIndicator('revenue')}</th>
          <th class="text-right cursor-pointer" onclick="setLPStoreSort('profit')">Est. Profit${sortIndicator('profit')}</th>
          <th class="text-right cursor-pointer" onclick="setLPStoreSort('iskPerLp')" title="Estimated ISK profit per LP spent - the ranking metric.">ISK / LP${sortIndicator('iskPerLp')}</th>
          <th class="text-right">Build Time</th>
          <th class="text-right"></th>
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
    </table>
  `;
}

// --- Shared tax/fee settings (same pattern + localStorage key as js/invention.js) --------------

function loadSharedTaxSettingsForLPStore() {
  try {
    const saved = localStorage.getItem('eve_tax_settings');
    if (!saved) return;
    const settings = window.safeParseJSON(saved, {});
    if (settings.facilityTax !== undefined && document.getElementById('facility-tax')) document.getElementById('facility-tax').value = settings.facilityTax;
    if (settings.sccSurcharge !== undefined && document.getElementById('scc-surcharge')) document.getElementById('scc-surcharge').value = settings.sccSurcharge;
    if (settings.salesTax !== undefined && document.getElementById('sales-tax')) document.getElementById('sales-tax').value = settings.salesTax;
    if (settings.brokerFee !== undefined && document.getElementById('broker-fee')) document.getElementById('broker-fee').value = settings.brokerFee;
  } catch (e) { console.warn('[LP Store] Failed to load saved tax/fee settings - falling back to defaults:', e); }
}
window.loadSharedTaxSettingsForLPStore = loadSharedTaxSettingsForLPStore;

function saveSharedTaxSettingsFromLPStore() {
  try {
    const existingRaw = localStorage.getItem('eve_tax_settings');
    const existing = existingRaw ? window.safeParseJSON(existingRaw, {}) : {};
    existing.facilityTax = document.getElementById('facility-tax')?.value;
    existing.sccSurcharge = document.getElementById('scc-surcharge')?.value;
    existing.salesTax = document.getElementById('sales-tax')?.value;
    existing.brokerFee = document.getElementById('broker-fee')?.value;
    localStorage.setItem('eve_tax_settings', JSON.stringify(existing));
  } catch (e) { console.warn('[LP Store] Failed to save tax/fee settings - they will reset on next reload:', e); }
  // Re-rank the list against the new fees, AND live-refresh the isolated canvas (if any) - the
  // Calculator's own recalculate() already reads these same #facility-tax/etc. ids directly.
  if (_lpActiveCorpId) loadAndRankLPStore(_lpActiveCorpId);
  // Wrapped in withRootPanAnchor, not a bare call - same camera-jump bug and fix as
  // onLPRedemptionCountChange's own comment above: a tax/fee edit can change ME/TE-driven build
  // costs enough to shift the tree's layout, with nothing correcting root's position otherwise.
  if (_lpIsolatedResult && typeof window.recalculate === 'function') {
    if (typeof window.withRootPanAnchor === 'function') window.withRootPanAnchor(async () => { await window.recalculate(); });
    else window.recalculate();
  }
}
window.saveSharedTaxSettingsFromLPStore = saveSharedTaxSettingsFromLPStore;

// Same "currently active station" label pattern as js/invention.js - synthesized from whatever
// system/structure/rigs are currently active in localStorage, since this page has no picker of its
// own (BPC offers are valued under the currently active production preset - change it from the
// Calculator's own Structure controls, which now also live right here since js/app.js is loaded).
function renderLPStoreActiveStationLabel() {
  const el = document.getElementById('lpstore-active-station-label');
  if (!el) return;
  const sel = window.safeParseJSON(localStorage.getItem('eve_selected_system'), {});
  const facilityKey = localStorage.getItem('eve_active_facility_key') || 'sotiyo';
  const rig1 = localStorage.getItem('eve_rig_slot_1') || '';
  const rig2 = localStorage.getItem('eve_rig_slot_2') || '';
  const rig3 = localStorage.getItem('eve_rig_slot_3') || '';

  const structureLabel = (window.STRUCTURE_TYPES && window.STRUCTURE_TYPES[facilityKey] && window.STRUCTURE_TYPES[facilityKey].shortLabel) || facilityKey;
  const rigCount = [rig1, rig2, rig3].filter(Boolean).length;
  const rigLabel = rigCount > 0 ? `, ${rigCount} rig${rigCount > 1 ? 's' : ''}` : ', no rigs';
  el.textContent = sel.name ? `${structureLabel} @ ${sel.name}${rigLabel}` : `${structureLabel}${rigLabel}`;
}
window.renderLPStoreActiveStationLabel = renderLPStoreActiveStationLabel;

// Corp picker, replacing the old flat <select> - 181 corps across 19 factions doesn't fit a
// dropdown (the whole reason this exists: see the user's own framing, "a dropdown list will not be
// good when there are tens or even hundreds of corporations"). Two views sharing one render
// function and one #lpstore-corp-list container:
//   - Empty query: grouped browse - one header row per faction (LP_STORE_CORPS' own array order,
//     alphabetical since that's how format_lp_corps.js sorted it), collapsed by default so the
//     initial view is 19 compact rows, not 181. Exactly one faction open at a time
//     (_lpCorpListOpenFaction) - simpler than a bitset of open groups, and there's rarely a reason
//     to compare two factions' rosters side by side.
//   - Non-empty query: flat filtered results across every corp, ignoring group boundaries entirely
//     - matches the corp's own name OR its faction's name, so "amarr" surfaces the whole Amarr
//     roster without needing to open that group first.
let _lpCorpListOpenFaction = null;

function lpStoreCorpRowHTML(c) {
  const active = c.corpId === _lpActiveCorpId ? ' lpstore-corp-row-active' : '';
  return `
    <button type="button" onclick="pickLPStoreCorp(${c.corpId})" class="lpstore-corp-row${active}">
      ${lpCorpLogoHTML(c.corpId, c.color)}
      <span class="lpstore-corp-row-name">${window.esc(c.corpName)}</span>
      <span class="lpstore-corp-row-faction" style="color:${c.color};">${window.esc(c.faction)}</span>
    </button>`;
}

function renderLPStoreCorpList(query) {
  const el = document.getElementById('lpstore-corp-list');
  if (!el) return;
  const q = (query || '').trim().toLowerCase();

  if (!q) {
    const factions = [...new Set(LP_STORE_CORPS.map(c => c.faction))];
    el.innerHTML = factions.map(faction => {
      const corps = LP_STORE_CORPS.filter(c => c.faction === faction);
      const isOpen = _lpCorpListOpenFaction === faction;
      const color = corps[0].color;
      return `
        <div class="lpstore-corp-faction-group">
          <button type="button" onclick="toggleLPStoreCorpFactionGroup('${window.esc(faction).replace(/'/g, "\\'")}')" class="lpstore-corp-faction-header" style="border-left-color:${color};">
            <span style="color:${color};">${window.esc(faction)}</span>
            <span class="lpstore-corp-faction-count">${corps.length}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lpstore-corp-faction-chevron${isOpen ? ' open' : ''}"><polyline points="9,6 15,12 9,18"/></svg>
          </button>
          ${isOpen ? `<div class="lpstore-corp-faction-rows">${corps.map(lpStoreCorpRowHTML).join('')}</div>` : ''}
        </div>`;
    }).join('');
    return;
  }

  const hits = LP_STORE_CORPS.filter(c => c.corpName.toLowerCase().includes(q) || c.faction.toLowerCase().includes(q));
  el.innerHTML = hits.length
    ? hits.map(lpStoreCorpRowHTML).join('')
    : `<div class="p-3 text-slate-400 text-xs italic">No corporation matching "${window.esc(query)}".</div>`;
}
window.renderLPStoreCorpList = renderLPStoreCorpList;

function filterLPStoreCorpList(query) {
  renderLPStoreCorpList(query);
}
window.filterLPStoreCorpList = filterLPStoreCorpList;

function toggleLPStoreCorpFactionGroup(faction) {
  _lpCorpListOpenFaction = (_lpCorpListOpenFaction === faction) ? null : faction;
  renderLPStoreCorpList(document.getElementById('lpstore-corp-search')?.value || '');
}
window.toggleLPStoreCorpFactionGroup = toggleLPStoreCorpFactionGroup;

// Kept separate from the search input's own value on purpose - once a corp is picked, the search
// box clears back to its placeholder (it's for FINDING a corp, not for permanently displaying the
// current one), so this label is the only place "what's currently loaded" stays visible.
function renderLPStoreCorpActiveLabel(corpIdOrStr) {
  const el = document.getElementById('lpstore-corp-active-label');
  if (!el) return;
  const corp = LP_STORE_CORPS.find(c => c.corpId === parseInt(corpIdOrStr));
  // Only the corp name itself is click-to-copy (the .copy-name convention app.js's own BOM rows
  // already use) - the faction after the dash is plain text, since only the corp name is ever
  // useful to paste somewhere (an in-game search, a contract, a message), not "Corp — Faction" as
  // one string.
  el.innerHTML = corp
    ? `<span class="copy-name" data-copy-name="${window.esc(corp.corpName)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(corp.corpName)}">${window.esc(corp.corpName)}</span> — ${window.esc(corp.faction)}`
    : '— none selected —';
  el.style.color = corp ? corp.color : 'var(--text-mute)';
}
window.renderLPStoreCorpActiveLabel = renderLPStoreCorpActiveLabel;

function pickLPStoreCorp(corpId) {
  const corp = LP_STORE_CORPS.find(c => c.corpId === corpId);
  const searchInput = document.getElementById('lpstore-corp-search');
  if (searchInput) searchInput.value = '';
  if (corp) _lpCorpListOpenFaction = corp.faction;
  selectLPStoreCorp(corpId);
  renderLPStoreCorpList('');
  closeLPStoreCorpPopover();
}
window.pickLPStoreCorp = pickLPStoreCorp;

// Two popovers now share the switcher bar (#lpstore-corp-switcher): the corp picker and "LP Owned"
// (a character's own LP balances). Listed together so opening one closes the other, and so the
// click-outside listener further down covers both without repeating itself per popover. "Find
// Item" (reverse search across every store) used to be a third popover here too, but a small
// popover was too cramped once results grouped one item under several corps - it's its own
// dedicated main-content area now (showLPItemSearchArea/exitLPItemSearchArea below), same idea as
// the isolated build canvas.
const LP_STORE_POPOVER_IDS = ['lpstore-corp-popover', 'lpstore-lp-owned-popover'];

function closeAllLPStorePopovers() {
  LP_STORE_POPOVER_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}
window.closeAllLPStorePopovers = closeAllLPStorePopovers;

// Popover (js/lpstore.js's own renderLPStoreCorpList/etc. fill #lpstore-corp-list inside it) -
// anchored to the persistent #lpstore-corp-switcher bar in lpstore.html, not a flyout panel. Only
// this small absolute-positioned box opens/closes, so picking a corp (or just glancing at the
// ranked list while deciding) never requires covering the whole page first.
function openLPStoreCorpPopover() {
  closeAllLPStorePopovers();
  const popover = document.getElementById('lpstore-corp-popover');
  if (!popover) return;
  popover.classList.remove('hidden');
  const searchInput = document.getElementById('lpstore-corp-search');
  if (searchInput) searchInput.focus();
}
window.openLPStoreCorpPopover = openLPStoreCorpPopover;

function closeLPStoreCorpPopover() {
  const popover = document.getElementById('lpstore-corp-popover');
  if (popover) popover.classList.add('hidden');
}
window.closeLPStoreCorpPopover = closeLPStoreCorpPopover;

function toggleLPStoreCorpPopover() {
  const popover = document.getElementById('lpstore-corp-popover');
  if (!popover) return;
  if (popover.classList.contains('hidden')) openLPStoreCorpPopover();
  else closeLPStoreCorpPopover();
}
window.toggleLPStoreCorpPopover = toggleLPStoreCorpPopover;

// --- LP Owned: a character's own real LP balance per corp -----------------------------------
// There is no such thing as corporation-held LP in EVE - confirmed directly against ESI, which has
// no /corporations/{id}/loyalty/points/ route at all (a genuine 404, not an auth-gated one). LP is
// always a personal character stat, same as standing. js/esi.js's fetchUserAndCorpAssets fetches
// the real GET /characters/{id}/loyalty/points/ (needs esi-characters.read_loyalty.v1, added
// alongside this feature - anyone who logged in before it existed needs to log in again once to
// grant it) and caches it to localStorage as 'eve_char_lp_balances'; this just reads and displays
// that cache, resolving each corporation_id against LP_STORE_CORPS for a name/faction/color.
function getLPOwnedBalances() {
  try {
    const raw = localStorage.getItem('eve_char_lp_balances');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
window.getLPOwnedBalances = getLPOwnedBalances;

function renderLPOwnedContent() {
  const el = document.getElementById('lpstore-lp-owned-content');
  if (!el) return;
  const charId = window.getActiveCharId ? window.getActiveCharId() : null;
  const charName = charId && window.getActiveCharacterRecord ? (window.getActiveCharacterRecord() || {}).charName : null;
  const loginBtn = `
    <button onclick="startEsiSSOLogin()" class="btn-glass w-full py-2 text-xs flex items-center justify-center gap-1.5 mt-2">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
      EVE SSO Login
    </button>`;

  if (!charId) {
    el.innerHTML = `<div class="text-sm" style="color:var(--text-soft);">Log in with EVE SSO to see your character's own LP balance with every corporation you've earned it from.</div>${loginBtn}`;
    return;
  }
  const balances = getLPOwnedBalances();
  if (!balances) {
    el.innerHTML = `<div class="text-sm italic" style="color:var(--text-mute);">No LP data yet - click Refresh Assets in the header, or reload the page.</div>`;
    return;
  }
  if (balances.missingScope) {
    el.innerHTML = `<div class="text-sm" style="color:var(--text-soft);">Your current login doesn't have permission to view LP balances yet (added after you last logged in) - log in again to grant it.</div>${loginBtn}`;
    return;
  }

  const rows = Object.entries(balances.byCorpId || {})
    .map(([corpIdStr, lp]) => ({ corpId: parseInt(corpIdStr), lp }))
    .filter(r => r.lp > 0)
    .sort((a, b) => b.lp - a.lp);

  if (!rows.length) {
    el.innerHTML = `<div class="text-sm italic" style="color:var(--text-mute);">${window.esc(charName || 'This character')} doesn't have LP with any corporation yet.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="text-[10px] uppercase tracking-wide mb-2" style="color:var(--text-mute);">${window.esc(charName || 'Your character')}'s LP balance - click one to view that store</div>
    <div class="lpstore-corp-list">
      ${rows.map(r => {
        const corp = LP_STORE_CORPS.find(c => c.corpId === r.corpId);
        const name = corp ? corp.corpName : `Corporation ${r.corpId}`;
        const color = corp ? corp.color : 'var(--text-mute)';
        return `
          <button type="button" onclick="jumpToOwnedLPCorp(${r.corpId})" class="lpstore-corp-row">
            ${lpCorpLogoHTML(r.corpId, color)}
            <span class="lpstore-corp-row-name">${window.esc(name)}</span>
            <span class="lpstore-corp-row-faction" style="color:${color};">${Math.round(r.lp).toLocaleString()} LP</span>
          </button>`;
      }).join('')}
    </div>`;
}
window.renderLPOwnedContent = renderLPOwnedContent;

async function jumpToOwnedLPCorp(corpId) {
  closeAllLPStorePopovers();
  const corp = LP_STORE_CORPS.find(c => c.corpId === corpId);
  if (corp) { _lpCorpListOpenFaction = corp.faction; renderLPStoreCorpList(''); }
  selectLPStoreCorp(corpId);
}
window.jumpToOwnedLPCorp = jumpToOwnedLPCorp;

function openLPOwnedPopover() {
  closeAllLPStorePopovers();
  const popover = document.getElementById('lpstore-lp-owned-popover');
  if (!popover) return;
  renderLPOwnedContent();
  popover.classList.remove('hidden');
}
window.openLPOwnedPopover = openLPOwnedPopover;

function closeLPOwnedPopover() {
  const popover = document.getElementById('lpstore-lp-owned-popover');
  if (popover) popover.classList.add('hidden');
}
window.closeLPOwnedPopover = closeLPOwnedPopover;

function toggleLPOwnedPopover() {
  const popover = document.getElementById('lpstore-lp-owned-popover');
  if (!popover) return;
  if (popover.classList.contains('hidden')) openLPOwnedPopover();
  else closeLPOwnedPopover();
}
window.toggleLPOwnedPopover = toggleLPOwnedPopover;

// --- Find Item: reverse search across every known LP store -----------------------------------
// The corp popover goes corp -> items; this goes the other way, item -> every corp that sells or
// grants it. That needs at least one offers fetch per corp (fetchLPStoreOffers already caches per
// corpId, so a corp the user's already browsed this session doesn't refetch) - ~180 stores, plus a
// market price lookup for every distinct item touched. _lpItemSearchIndex caches this in memory for
// the rest of the current page load; LP_ITEM_SEARCH_CACHE_KEY (below) additionally persists it to
// localStorage so a page RELOAD doesn't repeat the same ~180-store fetch from scratch every time
// (confirmed report: "is it loading from the API every time?" - yes, it was, since a plain JS
// variable doesn't survive a reload). ESI's own store-offers route documents itself as expiring
// server-side "daily at 11:05", so the underlying data can't have changed more often than that
// anyway - a several-hour client cache doesn't throw away anything actually fresh.
let _lpItemSearchIndex = null;   // null until built; array of flat, lightweight entries after
let _lpItemSearchBuilding = false;
const LP_ITEM_SEARCH_CACHE_KEY = 'eve_lpstore_item_search_cache';
const LP_ITEM_SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Stored as compact array tuples, not named-key objects, and derived text (outputName,
// requiredItemsSummary, profit, iskPerLp) isn't stored at all - only the raw ids/quantities are,
// with names and prices deduplicated by type id in their own small maps instead of repeated in
// full across ~32,000 entries. A first attempt storing fully-enriched objects measured at ~9MB,
// uncomfortably close to (or over) the ~5-10MB localStorage quota most browsers enforce; this
// compact form is a handful of numbers per entry plus two small lookup maps, several times smaller
// for the exact same underlying data. loadLPItemSearchIndexCache re-derives everything else
// (outputName/requiredItemsSummary/profit/iskPerLp) the same way buildLPItemSearchIndex does,
// which is pure local computation once the caches below are warmed - no network calls either way.
const LP_ITEM_SEARCH_CACHE_SCHEMA = 2; // bump whenever the compact tuple shape below changes, so an
// older cached shape (missing newly-added fields) is discarded and rebuilt rather than silently
// read back with those fields undefined.
// Est. ISK/LP for one Find Item entry, valued per the current sell mode (see LP_SELL_MODE_KEY). For a
// blueprint offer this stops short of building it - see buildLPItemSearchIndex's own note.
function lpApplyEstimate(e) {
  const requiredItemsCost = (e.requiredItems || []).reduce((sum, r) => sum + ((window.priceCache[r.type_id] || {}).sell || 0) * r.quantity, 0);
  const revenue = lpOutputUnitPrice(e.outputTypeId) * e.outputQty * lpSellNetFactor();
  e.profit = revenue - e.iskCost - requiredItemsCost;
  e.iskPerLp = e.lpCost > 0 ? e.profit / e.lpCost : null;
}
function saveLPItemSearchIndexCache(entries) {
  try {
    const typeIds = new Set();
    const compactEntries = entries.map(e => {
      typeIds.add(e.outputTypeId);
      if (e.blueprintTypeId) typeIds.add(e.blueprintTypeId);
      const req = (e.requiredItems || []).map(r => { typeIds.add(r.type_id); return [r.type_id, r.quantity]; });
      return [e.corpId, e.offerId, e.outputTypeId, e.outputQty, e.isBpc ? 1 : 0, e.iskCost, e.lpCost, req, e.blueprintTypeId || null, e.bpcRuns || null];
    });
    const names = {}, prices = {};
    typeIds.forEach(id => {
      names[id] = getLPItemName(id);
      const p = window.priceCache[id];
      if (p) prices[id] = [p.sell || 0, p.buy || 0];
    });
    localStorage.setItem(LP_ITEM_SEARCH_CACHE_KEY, JSON.stringify({ schemaVersion: LP_ITEM_SEARCH_CACHE_SCHEMA, builtAt: Date.now(), entries: compactEntries, names, prices }));
  } catch (e) {
    // Quota exceeded or similar, e.g. a browser with localStorage disabled entirely - non-fatal,
    // it just means the next open rebuilds from scratch same as every open did before this cache
    // existed, not a broken feature.
    console.warn('[LP Store] Failed to cache the item search index (will rebuild fresh next time):', e);
  }
}

function loadLPItemSearchIndexCache() {
  try {
    const raw = localStorage.getItem(LP_ITEM_SEARCH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries) || parsed.schemaVersion !== LP_ITEM_SEARCH_CACHE_SCHEMA || Date.now() - parsed.builtAt > LP_ITEM_SEARCH_CACHE_TTL_MS) return null;

    // Warms the SAME shared name/price caches getLPItemName/window.priceCache read from everywhere
    // else in this file (only filling gaps - never overwriting anything already resolved this
    // session) - a cache-loaded item search also means the ranked list/Isolate don't need to
    // refetch these specific items' names or prices either, not just this feature.
    Object.entries(parsed.names || {}).forEach(([id, name]) => { if (!_lpResolvedNames[id]) _lpResolvedNames[id] = name; });
    Object.entries(parsed.prices || {}).forEach(([id, pair]) => { if (!window.priceCache[id]) window.priceCache[id] = { sell: pair[0], buy: pair[1] }; });

    const corpsById = new Map(LP_STORE_CORPS.map(c => [c.corpId, c]));
    return parsed.entries.map(([corpId, offerId, outputTypeId, outputQty, isBpcFlag, iskCost, lpCost, req, blueprintTypeId, bpcRuns]) => {
      const corp = corpsById.get(corpId);
      const outputName = getLPItemName(outputTypeId);
      const requiredItemsSummary = req.length
        ? req.map(([tId, qty]) => `${qty}x ${getLPItemName(tId)}`).join(', ')
        : (iskCost > 0 ? 'ISK + LP only' : 'LP only');
      const entry = {
        corpId, corpName: corp ? corp.corpName : `Corporation ${corpId}`, color: corp ? corp.color : 'var(--text-mute)',
        offerId, outputTypeId, outputQty, isBpc: !!isBpcFlag, blueprintTypeId: blueprintTypeId || null, bpcRuns: bpcRuns || null,
        iskCost, lpCost, outputName, requiredItemsSummary,
        requiredItems: req.map(([type_id, quantity]) => ({ type_id, quantity })),
        profit: 0, iskPerLp: null
      };
      lpApplyEstimate(entry);
      return entry;
    });
  } catch (e) {
    return null;
  }
}

// Same concurrency-limited-map shape as scripts/fetch_lp_corps.js's own mapWithConcurrency (a
// separate Node-only script, not loaded in the browser, so this is a small duplicate rather than a
// shared import - this project has no bundler/module system to share it through). Return values
// aren't needed here (each worker call pushes into a shared array as a side effect instead).
async function mapWithConcurrencyLP(items, concurrency, worker) {
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      await worker(items[next++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
}

async function buildLPItemSearchIndex() {
  if (_lpItemSearchIndex || _lpItemSearchBuilding) return;
  _lpItemSearchBuilding = true;

  const cached = loadLPItemSearchIndexCache();
  if (cached) {
    _lpItemSearchIndex = cached;
    _lpItemSearchBuilding = false;
    renderLPItemSearchResultsArea();
    filterLPItemSearchResults(document.getElementById('lpstore-item-search-input')?.value || '');
    return;
  }

  const resultsEl = document.getElementById('lpstore-item-search-results');
  const setProgress = (done) => {
    if (resultsEl) resultsEl.innerHTML = `<div class="p-3 text-slate-400 text-xs italic">Indexing every LP store... ${done}/${LP_STORE_CORPS.length}</div>`;
  };
  setProgress(0);

  const entries = [];
  let done = 0;
  await mapWithConcurrencyLP(LP_STORE_CORPS, 15, async (corp) => {
    try {
      const offers = await fetchLPStoreOffers(corp.corpId);
      offers.forEach(offer => {
        const isBpc = isBlueprintOffer(offer);
        // offer.type_id IS the blueprint's own type id for a BPC offer - reassigned below to the
        // PRODUCT's type id for outputTypeId, so it's captured here first as blueprintTypeId. The
        // two are different items with different icons (the blueprint's own icon, via the /bpc
        // render endpoint, needs the blueprint's OWN type id - requesting it with the product's type
        // id, which is what outputTypeId holds, returns the wrong/missing icon). Same fields
        // evaluateBpcOffer already returns (blueprintTypeId, bpcRuns) - kept consistent with that.
        let outputTypeId = offer.type_id;
        let outputQty = offer.quantity;
        const blueprintTypeId = isBpc ? offer.type_id : null;
        const bpcRuns = isBpc ? offer.quantity : null;
        if (isBpc) {
          const recipe = window.recipeMap[offer.type_id];
          outputTypeId = recipe ? parseInt(recipe.productTypeID) : offer.type_id;
          // offer.quantity is the RUN COUNT on the one blueprint copy this offer grants (see
          // evaluateBpcOffer's own comment - confirmed against ESI live data and the in-game
          // redemption preview, NOT several separate single-run copies), so the actual product yield
          // is that times the blueprint's own per-run output.
          outputQty = recipe ? offer.quantity * (recipe.productQtyPerRun || 1) : offer.quantity;
        }
        entries.push({
          corpId: corp.corpId, corpName: corp.corpName, color: corp.color,
          offerId: offer.offer_id, outputTypeId, outputQty, isBpc, blueprintTypeId, bpcRuns,
          iskCost: offer.isk_cost, lpCost: offer.lp_cost,
          requiredItems: offer.required_items || []
        });
      });
    } catch (e) {
      console.warn('[LP Store] Item search index: failed to fetch offers for corp', corp.corpId, e);
    }
    done++;
    setProgress(done);
  });

  // Same name-resolution helper the ranked list itself uses, batched once across every distinct
  // type id this index touches rather than per-entry.
  const allTypeIds = new Set();
  entries.forEach(e => { allTypeIds.add(e.outputTypeId); e.requiredItems.forEach(r => allTypeIds.add(r.type_id)); });
  await resolveMissingItemNames(Array.from(allTypeIds));

  // Est. ISK/LP per entry - same formula evaluateDirectSellOffer uses (net of sales tax + broker
  // fee, output value minus required-items cost minus the offer's own isk_cost). For a BPC offer
  // this deliberately stops short of the ranked list's full evaluateBpcOffer - it prices the
  // PRODUCT's market value but not what it actually costs to BUILD from the blueprint (materials,
  // job fee), so it reads optimistic for BPC offers specifically. Good enough for "which corp looks
  // like the better deal" at a glance across ~180 stores without building a full recipe tree for
  // every BPC offer in the index (that's what Isolate is for - the real number, one offer at a
  // time) - labeled "Est." wherever it's shown so that trade-off is visible, not just assumed.
  await window.fetchMarketPrices(Array.from(allTypeIds));
  entries.forEach(e => {
    e.outputName = getLPItemName(e.outputTypeId);
    e.requiredItemsSummary = e.requiredItems.length
      ? e.requiredItems.map(r => `${r.quantity}x ${getLPItemName(r.type_id)}`).join(', ')
      : (e.iskCost > 0 ? 'ISK + LP only' : 'LP only');
    lpApplyEstimate(e);
  });

  _lpItemSearchIndex = entries;
  _lpItemSearchBuilding = false;
  saveLPItemSearchIndexCache(entries);
  renderLPItemSearchResultsArea();
  filterLPItemSearchResults(document.getElementById('lpstore-item-search-input')?.value || '');
}

// Small <img>+fallback pattern shared by every corp row in this file (corp picker, LP Owned, Find
// Item) - a real logo is far more recognizable than an abstract color dot. The wrap's own
// background is a neutral, fixed tone (not the corp's color) - a good many corp logo PNGs have
// real transparent regions around the emblem, and coloring the wrap behind them showed as a
// distracting colored halo THROUGH the logo even when it loaded fine, not just as a fallback for a
// failed one (confirmed report: "strange blue background" - Caldari-faction corps' assigned color
// is blue). The corp's own color only ever appears as a plain background if the logo fails to load
// at all (removed via onerror, at which point this fills in as a color-coded fallback instead of a
// blank circle). size=64 (was 32) since the display size is considerably bigger now too.
function lpCorpLogoHTML(corpId, color) {
  return `<span class="lpstore-corp-logo-wrap"><img src="https://images.evetech.net/corporations/${corpId}/logo?size=64" alt="" loading="lazy" class="lpstore-corp-logo" onerror="this.remove(); this.parentElement.style.background='${color}';"></span>`;
}

// One row per CORP within an item's group (see filterLPItemSearchResults below) - the item name
// itself is only shown once, on the group's own header, not repeated per corp like the old flat
// per-offer row did.
function lpItemSearchCorpRowHTML(entry, hasEnough, myLp) {
  // Optional, per the user's own framing ("that's optional, not sure if it's a good idea") - only
  // checks the offer's own LP cost against the character's balance with THAT corp, nothing about
  // isk_cost or required_items availability, and only appears at all when logged in with real
  // balance data (getLPOwnedBalances - see its own comment on why corp-held LP isn't a real thing).
  let lpBadge = '';
  if (myLp !== null) {
    lpBadge = hasEnough
      ? `<span class="lpstore-item-search-lp-badge lpstore-item-search-lp-ok" title="You have ${Math.round(myLp).toLocaleString()} LP with ${window.esc(entry.corpName)}">&#10003; enough LP</span>`
      : `<span class="lpstore-item-search-lp-badge lpstore-item-search-lp-short" title="You have ${Math.round(myLp).toLocaleString()} LP with ${window.esc(entry.corpName)}">need ${Math.round(entry.lpCost - myLp).toLocaleString()} more LP</span>`;
  }
  const iskPart = entry.iskCost > 0 ? `<span class="lpstore-item-search-isk">${Math.round(entry.iskCost).toLocaleString()} ISK</span> + ` : '';
  // Est. ISK/LP - see buildLPItemSearchIndex's own comment on why this is an estimate (a BPC
  // offer's build cost isn't in it). null when the offer is free (no LP cost to divide against, or
  // priced entirely in required-items with nothing to compare) - shown as a plain dash then.
  const profitKnown = entry.iskPerLp !== null;
  const profitColor = profitKnown ? (entry.iskPerLp >= 0 ? 'var(--accent)' : 'var(--red-400, #f87171)') : 'var(--text-mute)';
  const profitText = profitKnown ? `${Math.round(entry.iskPerLp).toLocaleString()} ISK/LP` : '—';
  // offer.quantity (bpcRuns) is the run count on the ONE blueprint copy this offer grants - not a
  // count of several separate single-run copies (see evaluateBpcOffer's own comment - confirmed
  // against ESI live data and the in-game redemption preview). Can differ corp to corp for the same
  // product, so it's shown per row, not once on the shared group header.
  const runsPart = entry.isBpc ? `<span class="lpstore-item-search-bpc-runs" title="One blueprint copy, with this many runs on it">1x BPC &middot; ${entry.bpcRuns || 1} run${(entry.bpcRuns || 1) === 1 ? '' : 's'}</span>` : '';
  return `
    <button type="button" onclick="jumpToLPItemSearchResult(${entry.corpId}, ${entry.offerId})" class="lpstore-item-search-corp-row${hasEnough ? ' lpstore-item-search-corp-row-affordable' : ''}" title="${window.esc(entry.requiredItemsSummary)}">
      ${lpCorpLogoHTML(entry.corpId, entry.color)}
      <span class="lpstore-item-search-corp-name-wrap">
        <span class="lpstore-corp-row-name">${window.esc(entry.corpName)}</span>
        ${runsPart}
      </span>
      <span class="lpstore-item-search-corp-row-stats">
        <span class="lpstore-item-search-corp-row-cost">${iskPart}<span class="lpstore-item-search-lp">${entry.lpCost.toLocaleString()} LP</span></span>
        <span class="lpstore-item-search-profit" style="color:${profitColor};" title="Est. profit per LP spent - see the Find Item header note on how this is estimated">Est. ${profitText}</span>
      </span>
      ${lpBadge}
    </button>`;
}

// One group per distinct item (outputTypeId, not name - two different items could coincidentally
// share a name) - the corps that offer it are sorted so ones you already have enough LP with float
// to the top (per the user's own request), best estimated ISK/LP as the tiebreaker either side of
// that split (falling back to cheapest LP cost when profit can't be estimated for one side).
function lpItemSearchGroupHTML(group) {
  const balances = getLPOwnedBalances();
  const withLp = group.entries.map(entry => {
    const myLp = (balances && balances.byCorpId) ? (balances.byCorpId[entry.corpId] || 0) : null;
    return { entry, myLp, hasEnough: myLp !== null && myLp >= entry.lpCost };
  });
  withLp.sort((a, b) => {
    if (a.hasEnough !== b.hasEnough) return a.hasEnough ? -1 : 1;
    if (a.entry.iskPerLp !== null && b.entry.iskPerLp !== null) return b.entry.iskPerLp - a.entry.iskPerLp;
    if (a.entry.iskPerLp !== null) return -1; // a known profit beats an inestimable one
    if (b.entry.iskPerLp !== null) return 1;
    return a.entry.lpCost - b.entry.lpCost;
  });
  // Same blue ITEM / purple BPC pill the ranked list's own rows use (see its typeBadge, same
  // colors/style) - always shown, never just for BPC. Grouping used to be keyed by outputTypeId
  // alone, which silently MERGED an item sold directly by one corp with the same item granted as a
  // BPC by another - a BPC's outputTypeId already resolves to the product it builds (so a
  // "Vindicator" BPC and a directly-sold "Vindicator" shared one group), hiding exactly the
  // distinction reported as important. The key is outputTypeId+isBpc now (see
  // filterLPItemSearchResults/renderLPItemSearchResultsArea) so those are always two separate
  // groups, each unambiguously labeled.
  const typeBadge = group.isBpc
    ? `<span class="lpstore-item-search-type-badge lpstore-item-search-type-bpc" title="Redeeming these offers grants a Blueprint Copy - Est. ISK/LP is what building it out nets, not the BPC's own resale value.">BPC</span>`
    : `<span class="lpstore-item-search-type-badge lpstore-item-search-type-item">ITEM</span>`;
  // Same icon + onerror fallback chain the ranked list's own rows already use (icon -> render -> a
  // generic placeholder via handleLPIconLoadError, for the confirmed real case of SKINs having
  // neither) - see that code's own comment for why. Shown once per group, same as the name itself,
  // rather than repeated per corp row. For a BPC group the primary icon must come from the
  // BLUEPRINT's own type id (group.blueprintTypeId, i.e. offer.type_id) via the /bpc render
  // endpoint - group.outputTypeId is the manufactured PRODUCT's type id, which has no /bpc art of
  // its own; the fallback still uses the product's /render though, same as the ranked list, since
  // that's at least a recognizable image if the blueprint's own art 404s.
  const groupIconTypeId = (group.isBpc && group.blueprintTypeId) ? group.blueprintTypeId : group.outputTypeId;
  const iconUrl = getLPStoreIconUrl(groupIconTypeId, group.isBpc, 64);
  const iconFallback = `this.onerror=function(){window.handleLPIconLoadError(this);}; this.src='https://images.evetech.net/types/${group.outputTypeId}/render?size=64';`;
  return `
    <div class="lpstore-item-search-group">
      <div class="lpstore-item-search-group-header">
        <img src="${iconUrl}" alt="" class="lpstore-item-search-group-icon" loading="lazy" onerror="${iconFallback}">
        <span class="lpstore-item-search-group-name">${window.esc(group.outputName)}</span>
        ${typeBadge}
        <span class="lpstore-item-search-group-count">${group.entries.length} corp${group.entries.length === 1 ? '' : 's'}</span>
      </div>
      <div class="lpstore-item-search-group-rows">
        ${withLp.map(({ entry, myLp, hasEnough }) => lpItemSearchCorpRowHTML(entry, hasEnough, myLp)).join('')}
      </div>
    </div>`;
}

// Which item's own corp list is currently shown in #lpstore-item-search-results - null until a
// suggestion is actually picked (see pickLPItemSearchSuggestion). Typing alone only ever populates
// the SUGGESTIONS dropdown now, not this - "only when I select an item it should show the corps".
// isBpc is tracked alongside the type id - see lpItemSearchGroupHTML's own note on why identity
// here is outputTypeId+isBpc together, not outputTypeId alone.
let _lpItemSearchSelectedTypeId = null;
let _lpItemSearchSelectedIsBpc = false;

function lpItemSearchSuggestionRowHTML(group) {
  // Same BPC-icon fix as lpItemSearchGroupHTML - the blueprint's own type id, not the product's.
  const groupIconTypeId = (group.isBpc && group.blueprintTypeId) ? group.blueprintTypeId : group.outputTypeId;
  const iconUrl = getLPStoreIconUrl(groupIconTypeId, group.isBpc, 32);
  const iconFallback = `this.onerror=function(){window.handleLPIconLoadError(this);}; this.src='https://images.evetech.net/types/${group.outputTypeId}/render?size=32';`;
  const typeBadge = group.isBpc
    ? `<span class="lpstore-item-search-type-badge lpstore-item-search-type-bpc">BPC</span>`
    : `<span class="lpstore-item-search-type-badge lpstore-item-search-type-item">ITEM</span>`;
  return `
    <button type="button" onclick="pickLPItemSearchSuggestion(${group.outputTypeId}, ${group.isBpc ? 'true' : 'false'})" class="lpstore-item-search-suggestion-row">
      <img src="${iconUrl}" alt="" class="lpstore-item-search-suggestion-icon" loading="lazy" onerror="${iconFallback}">
      <span class="lpstore-corp-row-name">${window.esc(group.outputName)}</span>
      ${typeBadge}
      <span class="lpstore-item-search-group-count">${group.entries.length} corp${group.entries.length === 1 ? '' : 's'}</span>
    </button>`;
}

// Renders whichever item is currently selected (or the initial prompt if none is yet) into
// #lpstore-item-search-results - separate from filterLPItemSearchResults (suggestions) so the two
// can be called independently: this after a pick, that on every keystroke.
function renderLPItemSearchResultsArea() {
  const el = document.getElementById('lpstore-item-search-results');
  if (!el) return;
  if (_lpItemSearchSelectedTypeId === null) {
    el.innerHTML = `<p class="text-sm italic" style="color:var(--text-mute);">Search for an item above, then select it from the suggestions to see which corps offer it.</p>`;
    return;
  }
  const matching = (_lpItemSearchIndex || []).filter(e => e.outputTypeId === _lpItemSearchSelectedTypeId && e.isBpc === _lpItemSearchSelectedIsBpc);
  if (!matching.length) { _lpItemSearchSelectedTypeId = null; renderLPItemSearchResultsArea(); return; }
  const group = { outputTypeId: _lpItemSearchSelectedTypeId, outputName: matching[0].outputName, isBpc: _lpItemSearchSelectedIsBpc, blueprintTypeId: matching[0].blueprintTypeId, entries: matching };
  el.innerHTML = lpItemSearchGroupHTML(group);
}
window.renderLPItemSearchResultsArea = renderLPItemSearchResultsArea;

// Typing only ever fills the suggestions dropdown - a real autocomplete, not the old live filter
// straight into the results area (that matched a different, flat/grouped-list design this replaced;
// see #lpstore-item-search-results' own note in lpstore.html). Grouped by item (not one suggestion
// per offer) for the same reason the results themselves are - "Caldari Navy Ballistic Control
// System" is one suggestion regardless of how many corps sell it, with a corp count so that's still
// visible before picking it.
function filterLPItemSearchResults(query) {
  const suggestionsEl = document.getElementById('lpstore-item-search-suggestions');
  if (!suggestionsEl) return;
  if (_lpItemSearchBuilding) return; // buildLPItemSearchIndex owns #lpstore-item-search-results (progress) until it finishes
  if (!_lpItemSearchIndex) { buildLPItemSearchIndex(); return; }

  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) {
    suggestionsEl.classList.add('hidden');
    return;
  }
  const hits = _lpItemSearchIndex.filter(e => e.outputName.toLowerCase().includes(q));
  if (!hits.length) {
    suggestionsEl.innerHTML = `<div class="p-3 text-slate-400 text-xs italic">No LP store sells or grants anything matching "${window.esc(query)}".</div>`;
    suggestionsEl.classList.remove('hidden');
    return;
  }

  // Keyed by outputTypeId+isBpc together, not outputTypeId alone - a BPC's outputTypeId already
  // resolves to the product it builds, so an item sold directly by one corp and the same item
  // granted as a BPC by another corp would otherwise land in one merged group. See
  // lpItemSearchGroupHTML's own note for the full story.
  const groups = new Map();
  hits.forEach(e => {
    const key = e.outputTypeId + ':' + (e.isBpc ? 1 : 0);
    if (!groups.has(key)) groups.set(key, { outputTypeId: e.outputTypeId, outputName: e.outputName, isBpc: e.isBpc, blueprintTypeId: e.blueprintTypeId, entries: [] });
    groups.get(key).entries.push(e);
  });
  const MAX_SUGGESTIONS = 30; // a common word (e.g. "charge") can otherwise match dozens of distinct items
  const sortedGroups = [...groups.values()].sort((a, b) => a.outputName.localeCompare(b.outputName));
  const shown = sortedGroups.slice(0, MAX_SUGGESTIONS);
  suggestionsEl.innerHTML = shown.map(lpItemSearchSuggestionRowHTML).join('')
    + (sortedGroups.length > MAX_SUGGESTIONS ? `<div class="p-2 text-center text-slate-500 text-[10px]">+ ${sortedGroups.length - MAX_SUGGESTIONS} more - keep typing to narrow it down</div>` : '');
  suggestionsEl.classList.remove('hidden');
}
window.filterLPItemSearchResults = filterLPItemSearchResults;

function pickLPItemSearchSuggestion(outputTypeId, isBpc) {
  document.getElementById('lpstore-item-search-suggestions')?.classList.add('hidden');
  const match = _lpItemSearchIndex && _lpItemSearchIndex.find(e => e.outputTypeId === outputTypeId && e.isBpc === isBpc);
  const input = document.getElementById('lpstore-item-search-input');
  if (input && match) input.value = match.outputName;
  _lpItemSearchSelectedTypeId = outputTypeId;
  _lpItemSearchSelectedIsBpc = !!isBpc;
  renderLPItemSearchResultsArea();
}
window.pickLPItemSearchSuggestion = pickLPItemSearchSuggestion;

async function jumpToLPItemSearchResult(corpId, offerId) {
  document.getElementById('lpstore-item-search-area')?.classList.add('hidden');
  closeAllLPStorePopovers();
  const corp = LP_STORE_CORPS.find(c => c.corpId === corpId);
  if (corp) { _lpCorpListOpenFaction = corp.faction; renderLPStoreCorpList(''); }
  renderLPStoreCorpActiveLabel(corpId);
  await loadAndRankLPStore(corpId);
  isolateOffer(offerId);
}
window.jumpToLPItemSearchResult = jumpToLPItemSearchResult;

// Keeps the switcher bar's "This Store"/"All Stores" tabs in sync with whichever main-content view
// is actually showing, so which search scope you're in is always visible at a glance rather than
// only knowable from a button you already clicked - see showLPItemSearchArea/exitLPItemSearchArea,
// the only two places main content switches between the ranked list and the item-search view.
function setLPStoreSearchModeTab(mode) {
  document.getElementById('lpstore-tab-store')?.classList.toggle('active', mode === 'store');
  document.getElementById('lpstore-tab-finditem')?.classList.toggle('active', mode === 'finditem');
}

// Dedicated main-content view, not a popover - "just like the LP store [ranked-offer] list" per the
// user's own framing; a popover was too cramped once results grouped one item under several corps.
// Same shown/hidden-sibling-state pattern the isolated build canvas already uses (see
// exitLPInspector), just for this state instead of #viewport.
function showLPItemSearchArea() {
  closeAllLPStorePopovers();
  setLPStoreSearchModeTab('finditem');
  ['lpstore-empty-state', 'lpstore-loading-state', 'lpstore-error-state', 'lpstore-results-area'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  const area = document.getElementById('lpstore-item-search-area');
  if (area) area.classList.remove('hidden');
  document.getElementById('lpstore-item-search-suggestions')?.classList.add('hidden');
  const input = document.getElementById('lpstore-item-search-input');
  if (input) input.focus();
  if (_lpItemSearchIndex) renderLPItemSearchResultsArea();
  else buildLPItemSearchIndex(); // renders its own progress, then the prompt (or a prior selection) once done
}
window.showLPItemSearchArea = showLPItemSearchArea;

function exitLPItemSearchArea() {
  setLPStoreSearchModeTab('store');
  document.getElementById('lpstore-item-search-area')?.classList.add('hidden');
  renderLPStoreState(); // re-shows whichever of empty/loading/results-area actually applies now
}
window.exitLPItemSearchArea = exitLPItemSearchArea;

// Click-outside-to-close, not blur-to-close - a faction group header is a <button> inside the
// popover, so expanding one blurs the search input same as clicking a corp row does, and a blur
// handler can't tell those two apart (confirmed report: expanding a category closed the whole
// popover before a corp was ever picked). This only closes on a click that lands OUTSIDE the
// entire switcher bar (any of the three popovers, or their trigger buttons), so anything clicked
// inside it is left alone; only an explicit close call (picking something) or clicking elsewhere
// closes whichever popover is open.
//
// Uses composedPath(), not switcher.contains(e.target) - a faction group header's own onclick
// (toggleLPStoreCorpFactionGroup) replaces #lpstore-corp-list's innerHTML SYNCHRONOUSLY, which
// detaches the clicked button from the document before this listener (further up the bubble
// phase, on the same click) ever runs. A detached node has no parent at all, so
// switcher.contains(e.target) then always returns false regardless of where the click actually
// started - confirmed report: it closed on every category click, not just the ones after a
// re-render happened to still be attached. composedPath() is captured once, at dispatch time,
// before any handler has a chance to mutate the DOM, so it still lists switcher as an ancestor of
// the ORIGINAL click target even after that target itself has since been removed.
document.addEventListener('click', (e) => {
  const switcher = document.getElementById('lpstore-corp-switcher');
  if (!switcher) return;
  const anyOpen = LP_STORE_POPOVER_IDS.some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
  if (!anyOpen) return;
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  if (!path.includes(switcher)) closeAllLPStorePopovers();
});

// addEventListener rather than a plain `window.onload =` assignment - js/app.js (also loaded on
// this page, for the real tree canvas/BOM sidebar) registers its own load handler the same way;
// a raw assignment here would silently clobber it. js/app.js's own onload already covers
// buildPrepackedIndexes, handleEsiSSOCallback, loadSavedSystem, and fetchAdjustedPrices (its
// listener registers first, since app.js's <script> tag comes before this one) - only this page's
// own setup is repeated here.
window.addEventListener('load', async () => {
  // Snapshot BEFORE anything on this page can touch it (app.js's own onload has already run its
  // synchronous restore of whatever the Calculator last had, since its listener registers first -
  // see the CALCULATOR_STATE_KEYS note above) - this is what gets written back after every
  // recalculate() this page triggers, so isolating an LP offer never survives into index.html's own
  // next load.
  _lpSavedCalculatorState = snapshotCalculatorState();

  renderLPStoreCorpList('');
  renderLPStoreCorpActiveLabel(null);
  loadSharedTaxSettingsForLPStore();
  renderLPStoreActiveStationLabel();
  if (typeof window.renderProductionPresetDropdown === 'function') window.renderProductionPresetDropdown();
  renderLPCategoryBar();
  updateLPSellModeButtons();
  renderLPStoreState();
  installLPRecalculateHook();

  // Only auto-open the corp popover when there's genuinely nothing to restore - a first-time
  // visitor who needs the picker, guided straight to it instead of staring at the empty state.
  // Never on a returning visitor: popping it open over a list that already restored correctly
  // would read as "everything reset" even though the real state was fine.
  const lastCorp = localStorage.getItem('eve_lpstore_last_corp');
  if (lastCorp) {
    // Pre-open the restored corp's own faction group so opening the popover later (to switch
    // corps) shows it expanded rather than starting from the fully-collapsed default.
    const corp = LP_STORE_CORPS.find(c => c.corpId === parseInt(lastCorp));
    if (corp) { _lpCorpListOpenFaction = corp.faction; renderLPStoreCorpList(''); }
    renderLPStoreCorpActiveLabel(lastCorp);
    await loadAndRankLPStore(lastCorp);
    // If an offer was isolated when the page was last closed, re-isolate it now that
    // _lpRankedResults is populated - isolateOffer() itself no-ops harmlessly if the saved id
    // isn't found (a different corp now, or the offer's gone from the store).
    const lastOfferId = localStorage.getItem('eve_lpstore_last_isolated_offer');
    if (lastOfferId) isolateOffer(parseInt(lastOfferId));
  } else {
    openLPStoreCorpPopover();
  }
});
