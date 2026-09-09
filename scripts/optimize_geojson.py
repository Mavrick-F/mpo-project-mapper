#!/usr/bin/env python3
"""
GeoJSON/JSON Optimization Tool
Analyzes and optimizes spatial JSON files regardless of geometry type

Handles:
- This is a supplementary tool that helps shrink MPO files to be small enough to work as self-hosted JSONs
- GIS files are often saved at a higher resolution than they need to be for this purpose!
- Points, Lines, Polygons, and Multi-* variants
- Coordinate precision reduction
- Geometry simplification for lines and polygons
- Size analysis and optimization

Note: output files use the .json extension (not .geojson) to match the data/ folder convention.

Usage:
    python scripts/optimize_geojson.py input.json [output.json] [--tolerance 0.0001]
"""

import json
import sys
from pathlib import Path
import argparse

def count_coordinates(geometry):
    """Recursively count all coordinate pairs in a geometry"""
    if not geometry:
        return 0
    
    geom_type = geometry.get('type', '')
    coords = geometry.get('coordinates', [])
    
    if geom_type == 'Point':
        return 1
    elif geom_type == 'LineString':
        return len(coords)
    elif geom_type == 'Polygon':
        return sum(len(ring) for ring in coords)
    elif geom_type == 'MultiPolygon':
        return sum(sum(len(ring) for ring in polygon) for polygon in coords)
    elif geom_type in ['MultiPoint', 'MultiLineString']:
        return sum(len(part) if isinstance(part, list) else 1 for part in coords)
    elif geom_type == 'GeometryCollection':
        return sum(count_coordinates(geom) for geom in geometry.get('geometries', []))
    
    return 0

def round_coordinates(geometry, precision=6):
    """Round all coordinates to specified decimal places (modifies in place)"""
    if not geometry:
        return geometry
    
    geom_type = geometry.get('type', '')
    coords = geometry.get('coordinates')
    
    if not coords:
        return geometry
    
    def round_coord(coord):
        """Round a single coordinate pair/triple"""
        if isinstance(coord, (int, float)):
            return round(coord, precision)
        elif isinstance(coord, list):
            return [round(c, precision) if isinstance(c, (int, float)) else round_coord(c) for c in coord]
        return coord
    
    geometry['coordinates'] = round_coord(coords)
    return geometry

def simplify_line(coords, tolerance=0.0001):
    """
    Douglas-Peucker algorithm for line simplification
    tolerance: degrees (~36 feet at Memphis latitude for 0.0001)
    """
    if len(coords) <= 2:
        return coords
    
    def perpendicular_distance(point, line_start, line_end):
        """Calculate perpendicular distance from point to line"""
        x, y = point[0], point[1]
        x1, y1 = line_start[0], line_start[1]
        x2, y2 = line_end[0], line_end[1]
        
        num = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
        den = ((y2 - y1) ** 2 + (x2 - x1) ** 2) ** 0.5
        
        if den == 0:
            return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
        
        return num / den
    
    def douglas_peucker(points, tolerance):
        """Recursive Douglas-Peucker algorithm"""
        if len(points) <= 2:
            return points
        
        dmax = 0
        index = 0
        end = len(points) - 1
        
        for i in range(1, end):
            d = perpendicular_distance(points[i], points[0], points[end])
            if d > dmax:
                index = i
                dmax = d
        
        if dmax > tolerance:
            rec_results1 = douglas_peucker(points[:index + 1], tolerance)
            rec_results2 = douglas_peucker(points[index:], tolerance)
            result = rec_results1[:-1] + rec_results2
        else:
            result = [points[0], points[end]]
        
        return result
    
    return douglas_peucker(coords, tolerance)

def simplify_geometry(geometry, tolerance=0.0001):
    """Simplify geometry while preserving topology"""
    if not geometry:
        return geometry
    
    geom_type = geometry.get('type', '')
    coords = geometry.get('coordinates', [])
    
    if geom_type == 'Point' or geom_type == 'MultiPoint':
        # Points don't need simplification
        return geometry
    
    elif geom_type == 'LineString':
        simplified = simplify_line(coords, tolerance)
        if len(simplified) >= 2:
            geometry['coordinates'] = simplified
    
    elif geom_type == 'MultiLineString':
        simplified_coords = []
        for line in coords:
            simplified_line = simplify_line(line, tolerance)
            if len(simplified_line) >= 2:
                simplified_coords.append(simplified_line)
            else:
                simplified_coords.append(line)
        geometry['coordinates'] = simplified_coords
    
    elif geom_type == 'Polygon':
        simplified_coords = []
        for ring in coords:
            simplified_ring = simplify_line(ring, tolerance)
            if len(simplified_ring) >= 4:  # Polygon rings need at least 4 points (including closing point)
                simplified_coords.append(simplified_ring)
            else:
                simplified_coords.append(ring)
        geometry['coordinates'] = simplified_coords
    
    elif geom_type == 'MultiPolygon':
        simplified_coords = []
        for polygon in coords:
            simplified_polygon = []
            for ring in polygon:
                simplified_ring = simplify_line(ring, tolerance)
                if len(simplified_ring) >= 4:
                    simplified_polygon.append(simplified_ring)
                else:
                    simplified_polygon.append(ring)
            if simplified_polygon:
                simplified_coords.append(simplified_polygon)
        geometry['coordinates'] = simplified_coords
    
    return geometry

def get_feature_name(properties):
    """Try common name fields to identify a feature"""
    name_fields = ['NAME', 'Name', 'name', 'TITLE', 'Title', 'title', 
                   'LABEL', 'Label', 'label', 'ID', 'Id', 'id', 'FID', 'OBJECTID']
    
    for field in name_fields:
        if field in properties and properties[field]:
            return str(properties[field])
    
    return None

def analyze_geojson(filepath):
    """Analyze GeoJSON to diagnose size and complexity"""
    print(f"\n{'='*60}")
    print(f"ANALYZING: {Path(filepath).name}")
    print(f"{'='*60}")
    
    file_size_mb = Path(filepath).stat().st_size / 1024 / 1024
    print(f"\nFile size: {file_size_mb:.2f} MB")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    features = data.get('features', [])
    print(f"Features: {len(features)}")
    
    if not features:
        print("ERROR: No features found!")
        return None
    
    # Analyze geometry
    print(f"\nGEOMETRY ANALYSIS:")
    
    total_coords = 0
    max_coords = 0
    max_coords_idx = 0
    min_coords = float('inf')
    geometry_types = {}
    
    for idx, feature in enumerate(features):
        geom = feature.get('geometry', {})
        geom_type = geom.get('type', 'Unknown')
        geometry_types[geom_type] = geometry_types.get(geom_type, 0) + 1
        
        coords = count_coordinates(geom)
        total_coords += coords
        
        if coords > max_coords:
            max_coords = coords
            max_coords_idx = idx
        
        if coords > 0 and coords < min_coords:
            min_coords = coords
    
    avg_coords = total_coords / len(features)
    
    print(f"   Geometry types: {geometry_types}")
    print(f"   Total coordinates: {total_coords:,}")
    print(f"   Average per feature: {avg_coords:.0f}")
    print(f"   Max in single feature: {max_coords:,} (feature #{max_coords_idx})")
    print(f"   Min in single feature: {min_coords:,}")
    
    # Determine if simplification is relevant
    primary_type = max(geometry_types.items(), key=lambda x: x[1])[0] if geometry_types else 'Unknown'
    
    if primary_type in ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']:
        # Expected complexity by geometry type
        if primary_type in ['LineString', 'MultiLineString']:
            normal_range = "20-100"
            complex_range = "100-500"
        else:  # Polygon
            normal_range = "50-200"
            complex_range = "200-500"
        
        if avg_coords > 500:
            print(f"\n   WARNING: OVER-DETAILED GEOMETRY DETECTED!")
            print(f"      - Average {avg_coords:.0f} vertices per {primary_type}")
            print(f"      - Normal: {normal_range} vertices")
            print(f"      - Complex: {complex_range} vertices")
            print(f"      - Optimization recommended")
        elif avg_coords > 200:
            print(f"\n   Moderately detailed geometry")
            print(f"      - Simplification may reduce size by 30-50%")
        else:
            print(f"\n   OK: Reasonable geometry complexity")
            print(f"      - Simplification may provide minor benefits")
    else:
        print(f"\n   INFO: Point geometry - simplification not applicable")
    
    # Show worst offender details
    if max_coords > 1000:
        worst_feature = features[max_coords_idx]
        feature_name = get_feature_name(worst_feature.get('properties', {})) or f"Feature #{max_coords_idx}"
        
        print(f"\n   MOST COMPLEX FEATURE: {feature_name}")
        print(f"      - {max_coords:,} vertices")
    
    # Check coordinate precision
    first_geom = features[0].get('geometry', {})
    if first_geom.get('coordinates'):
        sample_coord = get_first_coordinate(first_geom)
        if sample_coord:
            lon_str = str(sample_coord[0])
            lat_str = str(sample_coord[1])
            lon_decimals = len(lon_str.split('.')[-1]) if '.' in lon_str else 0
            lat_decimals = len(lat_str.split('.')[-1]) if '.' in lat_str else 0
            avg_decimals = (lon_decimals + lat_decimals) / 2
            
            print(f"\nCOORDINATE PRECISION:")
            print(f"   Sample: {sample_coord}")
            print(f"   Decimal places: ~{avg_decimals:.0f}")
            
            if avg_decimals > 8:
                print(f"   WARNING: EXCESSIVE PRECISION!")
                print(f"      - 6 decimals = ~4 inches accuracy")
                print(f"      - {avg_decimals:.0f} decimals = unnecessary")
                precision_saving = ((avg_decimals - 6) / avg_decimals) * 100
                print(f"      - Trimming to 6 decimals: ~{precision_saving:.0f}% size reduction")
            elif avg_decimals > 6:
                print(f"   High precision")
                print(f"      - Trimming to 6 decimals recommended")
            else:
                print(f"   OK: Appropriate precision")
    
    # Attribute analysis
    print(f"\nATTRIBUTES:")
    if features:
        props = features[0].get('properties', {})
        print(f"   Fields: {len(props)}")
        
        # Check for large attribute values
        large_fields = []
        for key, value in props.items():
            if isinstance(value, str) and len(value) > 1000:
                large_fields.append(f"{key} ({len(value)} chars)")
        
        if large_fields:
            print(f"   WARNING: Large text fields detected:")
            for field in large_fields:
                print(f"      - {field}")
    
    return data

def get_first_coordinate(geometry):
    """Extract first coordinate from any geometry type"""
    if not geometry:
        return None
    
    coords = geometry.get('coordinates')
    if not coords:
        return None
    
    geom_type = geometry.get('type', '')
    
    if geom_type == 'Point':
        return coords
    elif geom_type in ['LineString', 'MultiPoint']:
        return coords[0] if coords else None
    elif geom_type in ['Polygon', 'MultiLineString']:
        return coords[0][0] if coords and coords[0] else None
    elif geom_type == 'MultiPolygon':
        return coords[0][0][0] if coords and coords[0] and coords[0][0] else None
    
    return None

def optimize_geojson(input_path, output_path, simplify_tolerance=0.0001, coord_precision=6):
    """Create optimized version of GeoJSON"""
    
    print(f"\n{'='*60}")
    print(f"OPTIMIZING")
    print(f"{'='*60}")
    print(f"Input: {Path(input_path).name}")
    print(f"Output: {Path(output_path).name}")
    print(f"Simplification tolerance: {simplify_tolerance} degrees")
    print(f"Coordinate precision: {coord_precision} decimals")
    
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    features = data.get('features', [])
    
    print(f"\nProcessing {len(features)} features...")
    
    optimized_features = []
    total_coords_before = 0
    total_coords_after = 0
    
    for idx, feature in enumerate(features):
        if (idx + 1) % 50 == 0 or (idx + 1) == len(features):
            print(f"  Processing feature {idx + 1}/{len(features)}...")
        
        geom = feature.get('geometry', {})
        
        # Count before
        coords_before = count_coordinates(geom)
        total_coords_before += coords_before
        
        # Simplify geometry
        simplified_geom = simplify_geometry(geom.copy(), simplify_tolerance)
        
        # Round coordinates
        rounded_geom = round_coordinates(simplified_geom, coord_precision)
        
        # Count after
        coords_after = count_coordinates(rounded_geom)
        total_coords_after += coords_after
        
        # Update feature
        optimized_feature = feature.copy()
        optimized_feature['geometry'] = rounded_geom
        optimized_features.append(optimized_feature)
    
    # Create output GeoJSON
    output_data = {
        'type': 'FeatureCollection',
        'features': optimized_features
    }
    
    # Add CRS if present in original
    if 'crs' in data:
        output_data['crs'] = data['crs']
    
    # Save to file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f)
    
    # Report results
    output_size_mb = Path(output_path).stat().st_size / 1024 / 1024
    input_size_mb = Path(input_path).stat().st_size / 1024 / 1024
    
    reduction_pct = ((input_size_mb - output_size_mb) / input_size_mb) * 100 if input_size_mb > 0 else 0
    coord_reduction_pct = ((total_coords_before - total_coords_after) / total_coords_before) * 100 if total_coords_before > 0 else 0
    
    print(f"\n{'='*60}")
    print(f"OPTIMIZATION COMPLETE")
    print(f"{'='*60}")
    print(f"\nRESULTS:")
    print(f"   Coordinates: {total_coords_before:,} -> {total_coords_after:,}")
    print(f"   Coord reduction: {coord_reduction_pct:.1f}%")
    print(f"   File size: {input_size_mb:.2f} MB -> {output_size_mb:.2f} MB")
    print(f"   Size reduction: {reduction_pct:.1f}%")
    print(f"\nOK: Optimized file saved: {output_path}")
    
    # Provide guidance based on results
    if output_size_mb > 10:
        print(f"\nWARNING: File still large ({output_size_mb:.2f} MB)")
        print(f"    Consider more aggressive simplification:")
        print(f"    --tolerance 0.0002 (~72 feet) or --tolerance 0.0005 (~180 feet)")
    elif output_size_mb < 1:
        print(f"\nOK: File size excellent for web use!")
    else:
        print(f"\nOK: File size good for web use")

def main():
    parser = argparse.ArgumentParser(
        description='Analyze and optimize spatial JSON files (GeoJSON format, .json extension)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze only
  python scripts/optimize_geojson.py input.json
  
  # Analyze and optimize with default settings
  python scripts/optimize_geojson.py input.json output.json
  
  # Optimize with custom tolerance (more aggressive)
  python scripts/optimize_geojson.py input.json output.json --tolerance 0.0002
  
  # Optimize with custom precision
  python scripts/optimize_geojson.py input.json output.json --precision 5
        """
    )
    
    parser.add_argument('input', help='Input file (GeoJSON format, typically .json)')
    parser.add_argument('output', nargs='?', help='Output file (optional; use .json extension)')
    parser.add_argument('--tolerance', type=float, default=0.0001,
                       help='Simplification tolerance in degrees (default: 0.0001, about 36ft)')
    parser.add_argument('--precision', type=int, default=6,
                       help='Coordinate decimal places (default: 6, about 4in)')
    
    args = parser.parse_args()
    
    input_path = args.input
    
    if not Path(input_path).exists():
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)
    
    # Analyze input
    analyze_geojson(input_path)
    
    # If output path provided, optimize
    if args.output:
        output_path = args.output
        
        print(f"\n{'='*60}")
        response = input("Proceed with optimization? (y/n): ")
        
        if response.lower() == 'y':
            optimize_geojson(input_path, output_path, args.tolerance, args.precision)
        else:
            print("Optimization cancelled.")
    else:
        print(f"\nTIP: Run with output path to create optimized version:")
        print(f"   python scripts/optimize_geojson.py {Path(input_path).name} output.json")

if __name__ == '__main__':
    main()
