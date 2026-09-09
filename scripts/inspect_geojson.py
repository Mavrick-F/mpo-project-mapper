#!/usr/bin/env python3
"""Inspect GeoJSON files and print a compact summary for datasets.yaml authoring.

Usage:
    python scripts/inspect_geojson.py data/*.json
"""

import json
import sys
import os

# Ensure Unicode prints safely on Windows consoles
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def extract_coords(geometry):
    """Yield individual [lon, lat] pairs from any GeoJSON geometry."""
    gtype = geometry.get("type", "")
    coords = geometry.get("coordinates", [])

    if gtype == "Point":
        yield coords
    elif gtype in ("MultiPoint", "LineString"):
        yield from coords
    elif gtype in ("MultiLineString", "Polygon"):
        for ring in coords:
            yield from ring
    elif gtype in ("MultiPolygon",):
        for polygon in coords:
            for ring in polygon:
                yield from ring
    elif gtype == "GeometryCollection":
        for geom in geometry.get("geometries", []):
            yield from extract_coords(geom)


def truncate(value, maxlen=40):
    s = str(value)
    return s if len(s) <= maxlen else s[:maxlen - 1] + "\u2026"


def json_type_label(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string" if value != "" else "empty"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def inspect_file(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    count = len(features)

    if count == 0:
        print(f"  (empty FeatureCollection -- 0 features)")
        return

    # Geometry type from first feature
    first_geom = features[0].get("geometry") or {}
    geom_type = first_geom.get("type", "unknown")

    # --- CRS sanity check (sample up to 200 features evenly) ---
    sample_step = max(1, count // 200)
    min_lon = float("inf")
    max_lon = float("-inf")
    min_lat = float("inf")
    max_lat = float("-inf")
    coord_count = 0

    for i in range(0, count, sample_step):
        geom = (features[i].get("geometry") or {})
        for coord in extract_coords(geom):
            if len(coord) >= 2:
                lon, lat = coord[0], coord[1]
                if lon < min_lon:
                    min_lon = lon
                if lon > max_lon:
                    max_lon = lon
                if lat < min_lat:
                    min_lat = lat
                if lat > max_lat:
                    max_lat = lat
                coord_count += 1

    is_wgs84 = (
        coord_count > 0
        and -180 <= min_lon <= max_lon <= 180
        and -90 <= min_lat <= max_lat <= 90
    )

    # --- Property field analysis ---
    field_stats = {}  # field -> { type_set, unique_values, sample_values }

    for feat in features:
        props = feat.get("properties") or {}
        for key, value in props.items():
            if key not in field_stats:
                field_stats[key] = {
                    "types": set(),
                    "uniques": set(),
                    "samples": [],
                    "empty_count": 0,
                }
            stats = field_stats[key]
            tl = json_type_label(value)
            stats["types"].add(tl)

            if value is None or value == "":
                stats["empty_count"] += 1
            else:
                stats["uniques"].add(value if not isinstance(value, (list, dict)) else json.dumps(value))
                if len(stats["samples"]) < 3:
                    stats["samples"].append(value)

    # --- Output ---
    print(f"  Geometry : {geom_type}")
    print(f"  Features : {count:,}")

    if coord_count == 0:
        print(f"  CRS      : (no coordinates found)")
    elif is_wgs84:
        print(f"  CRS      : WGS84 \u2713")
        print(f"             lon [{min_lon:.4f}, {max_lon:.4f}]  lat [{min_lat:.4f}, {max_lat:.4f}]")
    else:
        print(f"  CRS      : \u2717 NOT WGS84 -- reproject to EPSG:4326 first")
        print(f"             observed x [{min_lon:.2f}, {max_lon:.2f}]  y [{min_lat:.2f}, {max_lat:.2f}]")

    print()
    print(f"  {'Field':<30} {'Type':<12} {'Unique':>7}  Samples")
    print(f"  {'-----':<30} {'----':<12} {'------':>7}  -------")

    for field, stats in field_stats.items():
        types_str = "/".join(sorted(stats["types"]))
        unique_count = len(stats["uniques"])
        samples_str = ", ".join(truncate(repr(s), 30) for s in stats["samples"])
        print(f"  {truncate(field, 30):<30} {types_str:<12} {unique_count:>7}  {samples_str}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/inspect_geojson.py <file.json> [file2.json ...]")
        sys.exit(1)

    for path in sys.argv[1:]:
        print()
        print(f"=== {os.path.basename(path)} ===")
        try:
            inspect_file(path)
        except json.JSONDecodeError as e:
            print(f"  ERROR: invalid JSON -- {e}")
        except Exception as e:
            print(f"  ERROR: {e}")
        print()


if __name__ == "__main__":
    main()
