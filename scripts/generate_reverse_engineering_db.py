"""Builds eve_re_db.js: the Tech III reverse-engineering table for the Invention page's T3 mode.

Why a separate file: generate_db.py stores recipes under the item a blueprint MANUFACTURES. A relic
(Intact Hull Section, Wrecked Armor Nanobot, ...) manufactures nothing - its only activity is
invention (activity 8, which is what reverse engineering became in Crius) - so relics never get a
recipe entry there and the page had no way to know which relic makes which T3 blueprint.

Everything here comes straight from the SDE tables in Fuzzwork's dump (same source generate_db.py
already trusts for industryActivityProducts), never hand-typed numbers:
  industryActivityProducts.csv      relic -> T3 blueprint, quantity = runs on the resulting BPC
  industryActivityProbabilities.csv relic -> T3 blueprint, base success chance (Intact/Malf/Wrecked)
  industryActivityMaterials.csv     datacores consumed per attempt
  industryActivitySkills.csv        the encryption + two science skills
  industryActivity.csv              base job time
and the T3 blueprint's own manufacturing product (activity 1) so the page can find its recipe.

Run on its own (python scripts/generate_reverse_engineering_db.py) or let generate_db.py call it at
the end. Writes eve_re_db.js in the project root, next to eve_db.js.
"""
import csv
import io
import json
import os
import ssl
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, 'eve_re_db.js')
BASES = [
    "https://www.fuzzwork.co.uk/dump/latest/csv/",
    "https://www.fuzzwork.co.uk/dump/latest/",
]
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
SSL_CTX = ssl._create_unverified_context()  # same Windows certificate workaround generate_db.py uses
INVENTION = 8
MANUFACTURING = 1


def fetch_csv(name):
    last_error = None
    for base in BASES:
        url = base + name
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            text = urllib.request.urlopen(req, context=SSL_CTX, timeout=60).read().decode('utf-8-sig')
            print(f"   -> {name}: fetched from {url}")
            return list(csv.DictReader(io.StringIO(text)))
        except Exception as e:
            last_error = e
    raise RuntimeError(f"Could not fetch {name} ({last_error})")


def main():
    print("=== Tech III Reverse Engineering table ===")
    types = fetch_csv('invTypes.csv')
    groups = fetch_csv('invGroups.csv')
    products = fetch_csv('industryActivityProducts.csv')
    probabilities = fetch_csv('industryActivityProbabilities.csv')
    materials = fetch_csv('industryActivityMaterials.csv')
    skills = fetch_csv('industryActivitySkills.csv')
    activity_times = fetch_csv('industryActivity.csv')

    names = {int(r['typeID']): (r.get('typeName') or '').strip() for r in types}
    published = {int(r['typeID']) for r in types if r.get('published') not in ('0', 'False', 'false')}
    group_of = {int(r['typeID']): int(r['groupID']) for r in types if r.get('groupID')}
    category_of_group = {int(r['groupID']): int(r['categoryID']) for r in groups if r.get('categoryID')}

    # A relic is anything in the Ancient Relics category (34) with an invention activity. Checked by
    # category, not by name, so a new relic family added in a later patch is picked up automatically.
    def is_relic(type_id):
        return category_of_group.get(group_of.get(type_id)) == 34

    bp_to_product = {}
    relic_outputs = {}  # relic -> {t3 blueprint: runs}
    for r in products:
        bp, act, prod, qty = int(r['typeID']), int(r['activityID']), int(r['productTypeID']), int(r['quantity'])
        if act == MANUFACTURING:
            bp_to_product[bp] = prod
        elif act == INVENTION and is_relic(bp):
            relic_outputs.setdefault(bp, {})[prod] = qty

    chance = {}
    for r in probabilities:
        if int(r['activityID']) == INVENTION:
            chance[(int(r['typeID']), int(r['productTypeID']))] = float(r['probability'])

    relic_materials = {}
    for r in materials:
        bp = int(r['typeID'])
        if int(r['activityID']) == INVENTION and bp in relic_outputs:
            mid = int(r['materialTypeID'])
            relic_materials.setdefault(bp, []).append({'typeId': mid, 'name': names.get(mid, ''), 'qty': int(r['quantity'])})

    relic_skills = {}
    for r in skills:
        bp = int(r['typeID'])
        if int(r['activityID']) == INVENTION and bp in relic_outputs:
            sid = int(r['skillID'])
            relic_skills.setdefault(bp, []).append({'skillId': sid, 'name': names.get(sid, ''), 'level': int(r['level'])})

    relic_time = {}
    for r in activity_times:
        bp = int(r['typeID'])
        if int(r['activityID']) == INVENTION and bp in relic_outputs:
            relic_time[bp] = int(r['time'])

    relics = {}
    for relic_id, outputs in sorted(relic_outputs.items()):
        if relic_id not in published:
            continue
        out_list = []
        for t3_bp, runs in sorted(outputs.items()):
            product = bp_to_product.get(t3_bp)
            if not product or product not in published:
                continue
            out_list.append({
                'blueprintTypeId': t3_bp,
                'productTypeId': product,
                'runs': runs,
                'probability': chance.get((relic_id, t3_bp)),
            })
        if not out_list:
            continue
        relics[relic_id] = {
            'name': names.get(relic_id, ''),
            'time': relic_time.get(relic_id),
            'skills': sorted(relic_skills.get(relic_id, []), key=lambda s: s['skillId']),
            'materials': sorted(relic_materials.get(relic_id, []), key=lambda m: m['typeId']),
            'products': out_list,
        }

    if not relics:
        print("   ERROR: found no relics at all - not overwriting eve_re_db.js.")
        return 1

    missing_chance = [r['name'] for r in relics.values() if any(p['probability'] is None for p in r['products'])]
    if missing_chance:
        print(f"   WARNING: no base chance in the SDE for: {', '.join(missing_chance)}")

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write("// Generated by scripts/generate_reverse_engineering_db.py from the SDE - do not edit by hand.\n")
        f.write("// relic typeId -> { name, time, skills, materials, products: [{ blueprintTypeId, productTypeId, runs, probability }] }\n")
        f.write("window.EVE_REVERSE_ENGINEERING = " + json.dumps(relics, separators=(',', ':')) + ";\n")
    total_products = sum(len(r['products']) for r in relics.values())
    print(f"-> Wrote {len(relics)} relics covering {total_products} relic->T3 blueprint routes to {OUT_PATH}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
