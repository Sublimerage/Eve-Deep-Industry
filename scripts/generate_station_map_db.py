"""Builds eve_map_db.js: NPC stations by owning corporation, plus the stargate map.

Powers the LP Store's "nearest station" finder. ESI can tell you who owns ONE station you already
know the id of, but has no "every station this corporation owns" lookup and no bulk station list,
so the candidates have to come from static game data instead. NPC station ownership doesn't change,
so it belongs in a generated file like eve_db.js, not a live fetch.

From Fuzzwork's SDE dump (same source as generate_db.py and generate_reverse_engineering_db.py):
  staStations.csv          every NPC station: owning corporationID, solarSystemID, name
  mapSolarSystemJumps.csv  every stargate connection (both directions)
  mapSolarSystems.csv      each system's security status (for the "avoid low/null" option)

Output (all keyed by id as strings, the way JSON objects are):
  window.EVE_NPC_STATIONS    = { corpId: [[stationId, systemId, "Station name"], ...] }
  window.EVE_SYSTEM_JUMPS    = { systemId: [neighbourSystemId, ...] }
  window.EVE_SYSTEM_SECURITY = { systemId: security x 1000, rounded (e.g. 0.9463 -> 946) }
  window.EVE_SYSTEM_NAMES    = { systemId: "Jita" }  (systems with stargates only)
Station names get the planet in Roman numerals ("Jita IV - Moon 4 - ..."), the way the game shows them.

Run on its own (python scripts/generate_station_map_db.py) or let generate_db.py call it at the end.
Refuses to write a file that looks broken (too few stations or connections), keeping the old one.
"""
import csv
import io
import json
import os
import ssl
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, 'eve_map_db.js')
BASES = [
    "https://www.fuzzwork.co.uk/dump/latest/csv/",
    "https://www.fuzzwork.co.uk/dump/latest/",
]
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
SSL_CTX = ssl._create_unverified_context()  # same Windows certificate workaround generate_db.py uses


def fetch_csv(name):
    last_error = None
    for base in BASES:
        url = base + name
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            text = urllib.request.urlopen(req, context=SSL_CTX, timeout=90).read().decode('utf-8-sig')
            print(f"   -> {name}: fetched from {url}")
            return list(csv.DictReader(io.StringIO(text)))
        except Exception as e:
            last_error = e
    raise RuntimeError(f"Could not fetch {name} ({last_error})")


ROMAN = [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]


def roman(n):
    out = ''
    for value, numeral in ROMAN:
        while n >= value:
            out += numeral
            n -= value
    return out


def in_game_station_name(name, system_name):
    # The dump writes the planet as a number ("Jita 4 - Moon 4 - ..."); the game shows it in Roman
    # numerals ("Jita IV - Moon 4 - ..."), which is what in-game search matches. Only the planet
    # right after the system name changes - moons stay numbers, as in game.
    if system_name and name.startswith(system_name + ' '):
        num, sep, tail = name[len(system_name) + 1:].partition(' - ')
        if num.isdigit():
            return f"{system_name} {roman(int(num))}{sep}{tail}"
    return name


def main():
    print("=== NPC stations + stargate map ===")
    stations = fetch_csv('staStations.csv')
    jumps = fetch_csv('mapSolarSystemJumps.csv')
    systems = fetch_csv('mapSolarSystems.csv')

    system_names = {}
    for r in systems:
        try:
            system_names[int(r['solarSystemID'])] = (r.get('solarSystemName') or '').strip()
        except (KeyError, ValueError):
            continue

    by_corp = {}
    for r in stations:
        try:
            corp, sid, sys_id = int(r['corporationID']), int(r['stationID']), int(r['solarSystemID'])
        except (KeyError, ValueError):
            continue
        name = in_game_station_name((r.get('stationName') or '').strip(), system_names.get(sys_id, ''))
        by_corp.setdefault(corp, []).append([sid, sys_id, name])
    for lst in by_corp.values():
        lst.sort(key=lambda s: s[0])

    adjacency = {}
    for r in jumps:
        try:
            a, b = int(r['fromSolarSystemID']), int(r['toSolarSystemID'])
        except (KeyError, ValueError):
            continue
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    security = {}
    for r in systems:
        try:
            sys_id = int(r['solarSystemID'])
            if sys_id in adjacency:
                security[sys_id] = round(float(r['security']) * 1000)
        except (KeyError, ValueError):
            continue

    n_stations = sum(len(v) for v in by_corp.values())
    n_links = sum(len(v) for v in adjacency.values()) // 2
    print(f"   {n_stations:,} stations across {len(by_corp):,} corporations, {len(adjacency):,} systems, {n_links:,} stargate links")
    if n_stations < 3000 or n_links < 5000:
        raise RuntimeError("Station or stargate data looks incomplete - keeping the previous eve_map_db.js")

    compact = (',', ':')
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write("// Generated by scripts/generate_station_map_db.py from the EVE static data (Fuzzwork SDE dump).\n")
        f.write("// Do not edit by hand. Used by the LP Store's nearest-station finder.\n")
        f.write("window.EVE_NPC_STATIONS = " + json.dumps({str(k): v for k, v in sorted(by_corp.items())}, separators=compact, ensure_ascii=False) + ";\n")
        f.write("window.EVE_SYSTEM_JUMPS = " + json.dumps({str(k): sorted(v) for k, v in sorted(adjacency.items())}, separators=compact) + ";\n")
        f.write("window.EVE_SYSTEM_SECURITY = " + json.dumps({str(k): v for k, v in sorted(security.items())}, separators=compact) + ";\n")
        # Proper-case names (eve_db.js's EVE_SYSTEMS are all upper case), only for systems with stargates.
        names = {str(k): system_names[k] for k in sorted(adjacency) if system_names.get(k)}
        f.write("window.EVE_SYSTEM_NAMES = " + json.dumps(names, separators=compact, ensure_ascii=False) + ";\n")
    print(f"   wrote {OUT_PATH} ({os.path.getsize(OUT_PATH):,} bytes)")


if __name__ == '__main__':
    main()
