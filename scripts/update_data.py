#!/usr/bin/env python3
"""Download the latest climate records and write data/climate.json.

Uses only the Python standard library, so it runs the same on a laptop and in
GitHub Actions. If a source is unavailable, the series already in the file is
kept and a warning is printed.
"""
import collections
import csv
import datetime as dt
import io
import json
import pathlib
import sys
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "climate.json"
UA = {"User-Agent": "earth-vital-signs-dashboard (data refresh script)"}
GML = "https://gml.noaa.gov/webdata/ccgg/trends"
NSIDC = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data"
GISS = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
STAR = "https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/slr/slr_sla_gbl_free_ref_90.csv"


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as res:
        return res.read().decode("utf-8", "replace")


def num(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def gistemp():
    rows = fetch(GISS).splitlines()[1:]
    out = {}
    for row in csv.reader(io.StringIO("\n".join(rows))):
        if not row or not row[0].isdigit():
            continue
        for month in range(1, 13):
            val = num(row[month])
            if val is not None:
                out[f"{int(row[0]):04d}-{month:02d}"] = val
    return out


def gml(gas, value_col, filename=None):
    out = {}
    for line in fetch(f"{GML}/{gas}/{filename or gas + '_mm_gl.csv'}").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split(",")
        if not parts[0].strip().isdigit():
            continue
        val = num(parts[value_col])
        if val is not None and val > 0:
            out[f"{int(parts[0]):04d}-{int(parts[1]):02d}"] = val
    return out


def sea_ice():
    out = {}
    for month in range(1, 13):
        text = fetch(f"{NSIDC}/N_{month:02d}_extent_v4.0.csv")
        for line in text.splitlines()[1:]:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 5 or not parts[0].isdigit():
                continue
            val = num(parts[4])
            if val is not None and val > 0:
                out[f"{int(parts[0]):04d}-{int(parts[1]):02d}"] = val
    return out


def sea_level():
    """Average the 10-day satellite values into months, in millimetres."""
    buckets = collections.defaultdict(list)
    for line in fetch(STAR).splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split(",")
        when = num(parts[0])
        vals = [v for v in map(num, parts[1:]) if v is not None]
        if when is None or not vals:
            continue
        year = int(when)
        month = min(int((when - year) * 12), 11) + 1
        buckets[f"{year:04d}-{month:02d}"].append(sum(vals) / len(vals))
    return {k: round(sum(v) / len(v), 2) for k, v in buckets.items()}


SERIES = [
    {"id": "temperature", "name": "Global temperature", "short": "Temperature", "unit": "°C", "decimals": 2,
     "note": "Difference from the 1951-1980 average", "source": "NASA GISS GISTEMP v4", "url": GISS,
     "good": "down", "load": gistemp},
    {"id": "co2", "name": "Carbon dioxide", "short": "CO₂", "unit": "ppm", "decimals": 1,
     "note": "Monthly mean at Mauna Loa", "source": "NOAA GML, as shown on NASA Vital Signs",
     "url": f"{GML}/co2/co2_mm_mlo.csv", "good": "down", "load": lambda: gml("co2", 3, "co2_mm_mlo.csv")},
    {"id": "methane", "name": "Methane", "short": "CH₄", "unit": "ppb", "decimals": 0,
     "note": "Global monthly mean", "source": "NOAA GML", "url": f"{GML}/ch4/ch4_mm_gl.csv",
     "good": "down", "load": lambda: gml("ch4", 3)},
    {"id": "n2o", "name": "Nitrous oxide", "short": "N₂O", "unit": "ppb", "decimals": 1,
     "note": "Global monthly mean", "source": "NOAA GML", "url": f"{GML}/n2o/n2o_mm_gl.csv",
     "good": "down", "load": lambda: gml("n2o", 3)},
    {"id": "sealevel", "name": "Sea level", "short": "Sea level", "unit": "mm", "decimals": 1,
     "note": "Satellite altimetry, seasonal signal removed", "source": "NOAA Laboratory for Satellite Altimetry (NASA/CNES/NOAA missions)",
     "url": STAR, "good": "down", "load": sea_level},
    {"id": "seaice", "name": "Arctic sea ice", "short": "Sea ice", "unit": "million km²", "decimals": 2,
     "note": "Monthly mean extent", "source": "NSIDC Sea Ice Index v4 (NASA and NOAA satellites)",
     "url": f"{NSIDC}/", "good": "up", "load": sea_ice},
]


def main():
    old = {}
    if OUT.exists():
        old = {s["id"]: s for s in json.loads(OUT.read_text(encoding="utf-8"))["series"]}
    series = []
    failed = 0
    for spec in SERIES:
        meta = {k: v for k, v in spec.items() if k != "load"}
        try:
            data = spec["load"]()
            if len(data) < 120:
                raise ValueError(f"only {len(data)} rows")
            keys = sorted(data)
            meta.update(dates=keys, values=[data[k] for k in keys])
            print(f"{spec['id']:12s} {len(keys):4d} months, latest {keys[-1]} = {data[keys[-1]]}")
        except Exception as err:  # keep the last good copy of this series
            failed += 1
            print(f"WARNING {spec['id']}: {err}", file=sys.stderr)
            if spec["id"] not in old:
                continue
            meta.update(dates=old[spec["id"]]["dates"], values=old[spec["id"]]["values"])
        series.append(meta)
    if not series:
        sys.exit("No data available")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {"updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"), "series": series}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({failed} source(s) failed)")


if __name__ == "__main__":
    main()
