"""Shrinks eve_db.js (8.7 MB -> about 3.3 MB, ~1.1 MB -> ~0.5 MB to download) without changing
what the site sees.

Two kinds of waste, two fixes:
  - EVE_RECIPES: every recipe is stored twice (under its blueprint id AND its product id), and each
    of ~10,000 entries repeats the same long field names plus item names EVE_ITEMS already has.
    Packed as one compact array, each recipe once, no field names.
  - EVE_ITEMS / EVE_VOLUMES / EVE_CATEGORIES / EVE_GROUP_IDS / EVE_SYSTEMS are {"typeId": value}
    maps. Long, nearly-sequential id strings compress badly; stored instead as the gaps between
    sorted ids plus a list of values, which compresses several times better.

A few lines of JavaScript appended to eve_db.js rebuild every one of those window.EVE_* objects the
moment the file loads - same keys, same fields, same values (a fresh recipe object per key, just like
before) - so nothing else on the site has to know.

Run from the repo root:  python scripts/pack_eve_db.py   (generate_db.py runs it after writing
eve_db.js). It refuses to write anything unless unpacking the result gives back the original data
exactly, and does nothing if the file is already packed.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'eve_db.js')
PACKED_VAR = '__EVE_RECIPES_PACKED'
MAP_PREFIX = '__EVE_PACKED_'
MAP_BLOCKS = ['EVE_ITEMS', 'EVE_VOLUMES', 'EVE_SYSTEMS', 'EVE_CATEGORIES', 'EVE_GROUP_IDS']

UNPACKER = """
// Rebuilds the packed tables above (scripts/pack_eve_db.py) into the normal window.EVE_* objects.
// Id maps were stored as [gaps between sorted ids, values]. Each recipe was stored once; it is
// listed again under its blueprint id and/or product id (bit 1 / bit 2 of its last field), as a
// separate object each time, exactly as the unpacked file used to hold it.
(function () {
  ['EVE_ITEMS', 'EVE_VOLUMES', 'EVE_SYSTEMS', 'EVE_CATEGORIES', 'EVE_GROUP_IDS'].forEach(function (name) {
    var packed = window['__EVE_PACKED_' + name];
    if (!packed) return;
    var o = {}, id = 0, gaps = packed[0], vals = packed[1];
    for (var i = 0; i < gaps.length; i++) { id += gaps[i]; o[id] = vals[i]; }
    window[name] = o;
    try { delete window['__EVE_PACKED_' + name]; } catch (e) { window['__EVE_PACKED_' + name] = undefined; }
  });
})();
(function () {
  var P = window.__EVE_RECIPES_PACKED, I = window.EVE_ITEMS || {}, R = {};
  function pairs(a, f) { if (a === null) return null; var o = []; for (var i = 0; i < a.length; i += 2) o.push(f(a[i], a[i + 1])); return o; }
  function nm(id, own) { return own !== undefined ? own : I[id]; }
  function make(p) {
    return {
      blueprintTypeID: p[0], productTypeID: p[1], productQtyPerRun: p[2], time: p[3],
      requiredSkills: pairs(p[4], function (a, b) { return { skillId: a, level: b }; }),
      mfgMaterials: pairs(p[5], function (a, b) { return { typeId: a, baseQty: b }; }),
      reactionMaterials: pairs(p[6], function (a, b) { return { typeId: a, baseQty: b }; }),
      inventionSkills: pairs(p[7], function (a, b) { return { skillId: a, level: b, name: I[a] }; }),
      inventionMaterials: pairs(p[8], function (a, b) { return { typeId: a, name: I[a], qty: b }; }),
      inventionProducts: p[9] === null ? null : p[9].map(function (e) { return { typeId: e[0], name: nm(e[0], e[2]), probability: e[1] }; }),
      inventionTime: p[10]
    };
  }
  for (var i = 0; i < P.length; i++) {
    var p = P[i];
    if (p[11] & 1) R[p[0]] = make(p);
    if (p[11] & 2) R[p[1]] = make(p);
  }
  window.EVE_RECIPES = R;
  try { delete window.__EVE_RECIPES_PACKED; } catch (e) { window.__EVE_RECIPES_PACKED = undefined; }
})();
"""

RECIPE_FIELDS = ['blueprintTypeID', 'productTypeID', 'productQtyPerRun', 'time', 'requiredSkills', 'mfgMaterials',
                 'reactionMaterials', 'inventionSkills', 'inventionMaterials', 'inventionProducts', 'inventionTime']


def find_block(text, name):
    m = re.search(r'^window\.' + name + r'\s*=\s*', text, re.M)
    if not m:
        return None
    value, end = json.JSONDecoder().raw_decode(text, m.end())
    if text[end:end + 1] == ';':
        end += 1
    return m.start(), end, value


def flat(lst, a, b):
    if lst is None:
        return None
    out = []
    for e in lst:
        out += [e[a], e[b]]
    return out


def pack(recipes, items):
    by_identity = {}
    for key, r in recipes.items():
        if list(r.keys()) != RECIPE_FIELDS:
            raise ValueError(f'recipe {key} has unexpected fields {list(r.keys())}')
        ident = json.dumps(r, sort_keys=True)
        entry = by_identity.setdefault(ident, {'r': r, 'mask': 0})
        if key == str(r['blueprintTypeID']):
            entry['mask'] |= 1
        elif key == str(r['productTypeID']):
            entry['mask'] |= 2
        else:
            raise ValueError(f'recipe key {key} is neither its blueprint nor its product id')

    def name_ok(e, id_field):
        return str(e[id_field]) in items and e.get('name') == items[str(e[id_field])]

    packed = []
    for entry in by_identity.values():
        r = entry['r']
        for fld in ('inventionSkills', 'inventionMaterials'):
            for e in r[fld] or []:
                idf = 'skillId' if fld == 'inventionSkills' else 'typeId'
                if not name_ok(e, idf):
                    raise ValueError(f'{fld} name for {e[idf]} differs from EVE_ITEMS - packer would lose it')
        prods = None
        if r['inventionProducts'] is not None:
            prods = []
            for e in r['inventionProducts']:
                row = [e['typeId'], e['probability']]
                if not name_ok(e, 'typeId'):
                    row.append(e.get('name'))
                prods.append(row)
        packed.append([
            r['blueprintTypeID'], r['productTypeID'], r['productQtyPerRun'], r['time'],
            flat(r['requiredSkills'], 'skillId', 'level'),
            flat(r['mfgMaterials'], 'typeId', 'baseQty'),
            flat(r['reactionMaterials'], 'typeId', 'baseQty'),
            flat(r['inventionSkills'], 'skillId', 'level'),
            flat(r['inventionMaterials'], 'typeId', 'qty'),
            prods,
            r['inventionTime'],
            entry['mask'],
        ])
    packed.sort(key=lambda p: (p[0], p[1]))
    return packed


def unpack(packed, items):
    """Python mirror of UNPACKER, used to prove the packed form round-trips exactly."""
    def pairs(a, f):
        return None if a is None else [f(a[i], a[i + 1]) for i in range(0, len(a), 2)]

    def make(p):
        return {
            'blueprintTypeID': p[0], 'productTypeID': p[1], 'productQtyPerRun': p[2], 'time': p[3],
            'requiredSkills': pairs(p[4], lambda a, b: {'skillId': a, 'level': b}),
            'mfgMaterials': pairs(p[5], lambda a, b: {'typeId': a, 'baseQty': b}),
            'reactionMaterials': pairs(p[6], lambda a, b: {'typeId': a, 'baseQty': b}),
            'inventionSkills': pairs(p[7], lambda a, b: {'skillId': a, 'level': b, 'name': items.get(str(a))}),
            'inventionMaterials': pairs(p[8], lambda a, b: {'typeId': a, 'name': items.get(str(a)), 'qty': b}),
            'inventionProducts': None if p[9] is None else [
                {'typeId': e[0], 'name': e[2] if len(e) > 2 else items.get(str(e[0])), 'probability': e[1]} for e in p[9]],
            'inventionTime': p[10],
        }
    out = {}
    for p in packed:
        if p[11] & 1:
            out[str(p[0])] = make(p)
        if p[11] & 2:
            out[str(p[1])] = make(p)
    return out


def pack_map(d, name):
    keys = []
    for k in d:
        if str(int(k)) != k or int(k) < 0:
            raise ValueError(f'{name} key {k!r} is not a plain id - can\'t gap-encode it')
        keys.append(int(k))
    keys.sort()
    gaps, prev = [], 0
    for k in keys:
        gaps.append(k - prev)
        prev = k
    return [gaps, [d[str(k)] for k in keys]]


def unpack_map(packed):
    out, k = {}, 0
    for gap, v in zip(*packed):
        k += gap
        out[str(k)] = v
    return out


def main(path=DB_PATH):
    text = open(path, encoding='utf-8').read()
    if PACKED_VAR in text or MAP_PREFIX in text:
        print('   eve_db.js is already packed - nothing to do.')
        return
    items_block = find_block(text, 'EVE_ITEMS')
    rec_block = find_block(text, 'EVE_RECIPES')
    if not items_block or not rec_block:
        raise RuntimeError('EVE_ITEMS or EVE_RECIPES not found in eve_db.js')
    items, recipes = items_block[2], rec_block[2]

    compact = (',', ':')
    replacements = []  # (start, end, new_js)
    packed = pack(recipes, items)
    if json.dumps(unpack(packed, items), sort_keys=True) != json.dumps(recipes, sort_keys=True):
        raise RuntimeError('Packed recipes do not unpack to the original - eve_db.js left unchanged')
    replacements.append((rec_block[0], rec_block[1], 'window.' + PACKED_VAR + ' = ' + json.dumps(packed, separators=compact, ensure_ascii=False) + ';'))

    for name in MAP_BLOCKS:
        block = find_block(text, name)
        if not block:
            continue
        start, end, d = block
        pm = pack_map(d, name)
        if json.dumps(unpack_map(pm), sort_keys=True) != json.dumps(d, sort_keys=True):
            raise RuntimeError(f'Packed {name} does not unpack to the original - eve_db.js left unchanged')
        replacements.append((start, end, 'window.' + MAP_PREFIX + name + ' = ' + json.dumps(pm, separators=compact, ensure_ascii=False) + ';'))

    new_text = text
    for start, end, js in sorted(replacements, reverse=True):
        new_text = new_text[:start] + js + new_text[end:]
    if not new_text.endswith('\n'):
        new_text += '\n'
    # Lines that read a packed table while the file loads (e.g. the EVE_GROUP_NAMES loop over
    # EVE_GROUP_IDS) would see nothing yet, so they move to after the unpacker.
    uses_packed = re.compile(r'window\.(' + '|'.join(MAP_BLOCKS + ['EVE_RECIPES']) + r')\b')
    keep, after = [], []
    for line in new_text.splitlines(keepends=True):
        (after if not line.startswith('window.__EVE_') and uses_packed.search(line) else keep).append(line)
    new_text = ''.join(keep) + UNPACKER.lstrip('\n') + ''.join(after)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(new_text)
    os.replace(tmp, path)
    print(f'   packed {len(recipes):,} recipe keys into {len(packed):,} recipes, plus {len(replacements) - 1} id tables: '
          f'{len(text.encode("utf-8")):,} -> {len(new_text.encode("utf-8")):,} bytes')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else DB_PATH)
