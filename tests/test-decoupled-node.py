"""
Headless smoke test for the current front-end bundle.
Uses Python plus the actual project files to validate that:
1. Key JavaScript files parse cleanly via `node --check`
2. Core structural patterns are still present after refactors
3. Version markers stay internally consistent
4. Sample GeoJSON files still parse successfully

This does not execute Turf.js spatial logic in a browser, but it catches
syntax mistakes, broken release metadata, and accidental structural drift.

Run: python tests/test-decoupled-node.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
from urllib.parse import unquote

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'src')
DATA = os.path.join(REPO, 'data')

passed = 0
failed = 0

def test(name, condition, detail=''):
    global passed, failed
    if condition:
        print(f'  PASS  {name}')
        passed += 1
    else:
        print(f'  FAIL  {name}')
        if detail:
            print(f'        {detail}')
        failed += 1

def read(path):
    with open(os.path.join(REPO, path), 'r', encoding='utf-8') as f:
        return f.read()

def parse_config_version():
    configyaml = read('config.yaml')
    match = re.search(r'version:\s*"([0-9.]+)"', configyaml)
    return match.group(1) if match else None, configyaml

# ============================================
# 1. FILE STRUCTURE CHECKS
# ============================================
print('\n=== File Structure ===')

analysis = read('src/analysis.js')
mapjs = read('src/map.js')
datasets = read('src/datasets.js')
appjs = read('src/app.js')
pdfjs = read('src/pdf.js')

test('analysis.js loads without encoding errors', len(analysis) > 1000)
test('map.js loads without encoding errors', len(mapjs) > 500)
test('datasets.js loads without encoding errors', len(datasets) > 500)

config_version, configyaml = parse_config_version()
test('config.yaml declares a version', config_version is not None)

# ============================================
# 2. JAVASCRIPT SYNTAX CHECKS
# ============================================
print('\n=== JavaScript Syntax ===')

NODE = shutil.which('node')

def node_check(path):
    if not NODE:
        return False, 'node executable not found in PATH'

    result = subprocess.run(
        [NODE, '--check', os.path.join(REPO, path)],
        capture_output=True,
        text=True,
        check=False
    )
    detail = (result.stderr or result.stdout or '').strip()
    return result.returncode == 0, detail

for path in ['src/analysis.js', 'src/map.js', 'src/datasets.js', 'src/app.js', 'src/pdf.js']:
    ok, detail = node_check(path)
    test(f'{path}: node --check passes', ok, detail)

# ============================================
# 3. SPATIAL PRIMITIVES EXIST
# ============================================
print('\n=== Spatial Primitives (analysis.js) ===')

test('isFeatureNearby function exists', 'function isFeatureNearby(' in analysis)
test('getFeatureDistance function exists', 'function getFeatureDistance(' in analysis)
test('getCorridorMatch function exists', 'function getCorridorMatch(' in analysis)
test('getIntersectionArea function exists', 'function getIntersectionArea(' in analysis)

# ============================================
# 4. PRIMITIVES ARE CALLED BY ANALYSIS METHODS
# ============================================
print('\n=== Primitive Usage ===')

# Extract function bodies (rough: from function declaration to next function or EOF)
def get_function_body(code, fname):
    pattern = rf'function {fname}\('
    match = re.search(pattern, code)
    if not match:
        return ''
    start = match.start()
    # Find the next top-level function declaration
    next_fn = re.search(r'\nfunction \w+\(', code[start + 10:])
    if next_fn:
        return code[start:start + 10 + next_fn.start()]
    return code[start:]

# Proximity methods should call isFeatureNearby
for method in ['analyzeCountByCategory', 'analyzeListNearbyFeatures', 'analyzeHasNearbyFeatures', 'analyzeSumNearbyValues']:
    body = get_function_body(analysis, method)
    test(f'{method} calls isFeatureNearby', 'isFeatureNearby(' in body, f'Body length: {len(body)}')

# Distance method should call getFeatureDistance
body = get_function_body(analysis, 'analyzeFindNearestFeatures')
test('analyzeFindNearestFeatures calls getFeatureDistance', 'getFeatureDistance(' in body)

# Area method should call getIntersectionArea
body = get_function_body(analysis, 'analyzeMeasureIntersectedArea')
test('analyzeMeasureIntersectedArea calls getIntersectionArea', 'getIntersectionArea(' in body)

# Corridor methods should call getCorridorMatch
for method in ['analyzeListParallelFeatures', 'analyzeMeasureProjectByCategory', 'analyzeAverageParallelValue']:
    body = get_function_body(analysis, method)
    test(f'{method} calls getCorridorMatch', 'getCorridorMatch(' in body)

# ============================================
# 5. OLD GEOMETRY BRANCHING REMOVED
# ============================================
print('\n=== Old Geometry Branching Removed ===')

# These methods should NOT have geometry-type branching anymore
for method in ['analyzeCountByCategory', 'analyzeListNearbyFeatures', 'analyzeSumNearbyValues']:
    body = get_function_body(analysis, method)
    has_geom_check = "geometryType === 'Point'" in body or "geometryType === 'LineString'" in body
    test(f'{method}: no config.geometryType branching', not has_geom_check,
         'Still has geometryType checks')

for method in ['analyzeListParallelFeatures', 'analyzeMeasureProjectByCategory', 'analyzeAverageParallelValue']:
    body = get_function_body(analysis, method)
    has_dual_path = ("geometry.type === 'Point'" in body and "geometry.type === 'LineString'" in body) or \
                    ("geometry.type !== 'LineString'" in body)
    test(f'{method}: no Point/LineString dual paths', not has_dual_path,
         'Still has Point/LineString dual paths')

# findNearestFeatures should not have 3-way if/else
body = get_function_body(analysis, 'analyzeFindNearestFeatures')
has_3way = "geometryType === 'Point'" in body and "geometryType === 'LineString'" in body
test('analyzeFindNearestFeatures: no 3-way geometry branching', not has_3way)

# ============================================
# 6. NORMALIZETOLINESTRINGS HANDLES MULTILINESTRING
# ============================================
print('\n=== normalizeToLineStrings Fix ===')

body = get_function_body(analysis, 'normalizeToLineStrings')
test('normalizeToLineStrings handles MultiLineString', 'MultiLineString' in body)

# ============================================
# 7. MAP.JS UNIFIED RENDERING
# ============================================
print('\n=== map.js Unified Rendering ===')

# Should have exactly ONE L.geoJSON call inside addReferenceLayers
add_ref_body = get_function_body(mapjs, 'addReferenceLayers')
# Count actual L.geoJSON() calls (assignments), not comments mentioning it
geojson_calls = len(re.findall(r'=\s*L\.geoJSON\(', add_ref_body))
test('addReferenceLayers has exactly 1 L.geoJSON call', geojson_calls == 1, f'Found {geojson_calls}')

# Should NOT have separate "POINT LAYERS", "LINE LAYERS", "POLYGON LAYERS" sections
test('No separate "POINT LAYERS" section', 'POINT LAYERS' not in add_ref_body)
test('No separate "LINE LAYERS" section', 'LINE LAYERS' not in add_ref_body)
test('No separate "POLYGON LAYERS" section', 'POLYGON LAYERS' not in add_ref_body)

# Should have pointToLayer, style, and onEachFeature in the unified call
test('Has pointToLayer callback', 'pointToLayer:' in add_ref_body)
test('Has style callback', 'style: (feature)' in add_ref_body or 'style: function' in add_ref_body)
test('Has onEachFeature callback', 'onEachFeature:' in add_ref_body)

# Hover effects should be geometry-aware
test('Hover: Point/MultiPoint radius', "geomType === 'Point'" in add_ref_body)
test('Hover: Polygon/MultiPolygon fillOpacity', "geomType === 'Polygon'" in add_ref_body)

# offsetByDirection should only apply to lines
test('offsetByDirection guarded by LineString check',
     "config.offsetByDirection && (feature.geometry.type === 'LineString'" in add_ref_body)

# filterByThreshold should be in unified style callback (not just Polygon block)
test('filterByThreshold in unified style callback', 'filterByThreshold' in add_ref_body)

# ============================================
# 8. CONFIG VALIDATION
# ============================================
print('\n=== datasets.js Validation ===')

test('validateDatasetConfigs function exists', 'function validateDatasetConfigs()' in datasets)
test('METHOD_GEOMETRY_COMPAT defined', 'METHOD_GEOMETRY_COMPAT' in datasets)
test('METHOD_REQUIRED_FIELDS defined', 'METHOD_REQUIRED_FIELDS' in datasets)
test('validateDatasetConfigs called in loadDatasets', 'validateDatasetConfigs()' in datasets)

# Check compatibility matrix entries
test('Corridor methods incompatible with Point', "listParallelFeatures" in datasets and "Point: false" in datasets)
test('measureIntersectedArea incompatible with LineString', "measureIntersectedArea" in datasets and "LineString: false" in datasets)
test('countByCategory compatible with all', "countByCategory" in datasets)

# ============================================
# 9. COUNTLABEL SUPPORT
# ============================================
print('\n=== countLabel Support ===')

test('app.js has countLabel in COUNT rendering', 'countLabel' in appjs and 'countLabelText' in appjs)
test('pdf.js has countLabel in COUNT rendering', 'countLabel' in pdfjs and 'countLabelText' in pdfjs)

# ============================================
# 10. VERSION CONSISTENCY
# ============================================
print('\n=== Version Consistency ===')

indexhtml = read('index.html')
readme = read('README.md')
changelog = read('CHANGELOG.md')

title_version_match = re.search(r'<title>[^<]* v([0-9.]+)</title>', indexhtml)
cache_versions = re.findall(r'\?v=([0-9.]+)', indexhtml)
badge_version_match = re.search(r'badge/v-([0-9.]+)-', readme)
changelog_version_match = re.search(r'^## v([0-9.]+)', changelog, re.MULTILINE)
config_version_match = re.search(r'version:\s*"([0-9.]+)"', configyaml)

title_version = title_version_match.group(1) if title_version_match else None
badge_version = badge_version_match.group(1) if badge_version_match else None
changelog_version = changelog_version_match.group(1) if changelog_version_match else None
config_version = config_version_match.group(1) if config_version_match else None

test('index.html title exposes a version', title_version is not None)
test('index.html cache-busting strings are present', len(cache_versions) > 0)
test(
    'All cache-busting strings match index.html title version',
    bool(title_version) and all(v == title_version for v in cache_versions),
    f'title={title_version}, cache={cache_versions}'
)
test(
    'README badge matches index.html title version',
    badge_version == title_version,
    f'title={title_version}, badge={badge_version}'
)
test(
    'Latest changelog entry matches index.html title version',
    changelog_version == title_version,
    f'title={title_version}, changelog={changelog_version}'
)
test(
    'config.yaml version matches index.html title version',
    config_version == title_version,
    f'title={title_version}, config={config_version}'
)

# ============================================
# 11. SHIPPED CONFIG + SAMPLE ASSETS
# ============================================
print('\n=== Shipped Config + Sample Assets ===')

config_text = read('config.yaml')
datasets_text = read('datasets.yaml')

logo_match = re.search(r'logoPath:\s*"([^"]+)"', config_text)
logo_path = logo_match.group(1) if logo_match else None
logo_repo_path = logo_path.replace('./', '').replace('/', os.sep) if logo_path else None

test('config.yaml declares a logoPath', logo_repo_path is not None)
if logo_repo_path:
    logo_abs_path = os.path.join(REPO, logo_repo_path)
    test(
        'Configured logo file exists',
        os.path.exists(logo_abs_path),
        logo_abs_path
    )
    if os.path.exists(logo_abs_path):
        logo_size = os.path.getsize(logo_abs_path)
        test(
            'Configured logo stays under 2 MB',
            logo_size < 2 * 1024 * 1024,
            f'{logo_size} bytes'
        )

enabled_dataset_matches = []
current_dataset = None
current_file_path = None
current_enabled = None

for raw_line in datasets_text.splitlines():
    if not raw_line.strip() or raw_line.lstrip().startswith('#'):
        continue

    top_level_match = re.match(r'^([A-Za-z0-9_]+):\s*$', raw_line)
    if top_level_match:
        if current_dataset and current_file_path and current_enabled is True:
            enabled_dataset_matches.append((current_dataset, current_file_path))
        current_dataset = top_level_match.group(1)
        current_file_path = None
        current_enabled = None
        continue

    if current_dataset:
        file_path_match = re.match(r'^\s+filePath:\s+(\./[^\r\n]+)', raw_line)
        if file_path_match:
            current_file_path = file_path_match.group(1)
            continue

        enabled_match = re.match(r'^\s+enabled:\s+(true|false)\b', raw_line)
        if enabled_match:
            current_enabled = enabled_match.group(1) == 'true'

if current_dataset and current_file_path and current_enabled is True:
    enabled_dataset_matches.append((current_dataset, current_file_path))

test('datasets.yaml has enabled file-based sample datasets', len(enabled_dataset_matches) > 0)

for dataset_id, raw_path in enabled_dataset_matches:
    normalized = unquote(raw_path.strip()).replace('./', '').replace('/', os.sep)
    abs_path = os.path.join(REPO, normalized)
    test(
        f'Enabled dataset file exists: {dataset_id}',
        os.path.exists(abs_path),
        abs_path
    )

# ============================================
# 12. DATA FILES VALID
# ============================================
print('\n=== Data File Validation ===')

for fname in os.listdir(DATA):
    if fname == 'removed_samples':
        continue
    fpath = os.path.join(DATA, fname)
    if not (fname.endswith('.json') or fname.endswith('.geojson')):
        continue
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            gj = json.load(f)
        has_features = 'features' in gj and len(gj['features']) > 0
        test(f'Data: {fname} valid GeoJSON ({len(gj.get("features", []))} features)', has_features)
    except Exception as e:
        test(f'Data: {fname} valid JSON', False, str(e))

# Also check removed_samples used in tests
removed_dir = os.path.join(DATA, 'removed_samples')
for fname in ['parks.json', 'freight_routes.json', 'bridges.json', 'greenprint.geojson']:
    fpath = os.path.join(removed_dir, fname)
    if os.path.exists(fpath):
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                gj = json.load(f)
            test(f'Removed sample: {fname} valid ({len(gj.get("features", []))} features)',
                 'features' in gj and len(gj['features']) > 0)
        except Exception as e:
            test(f'Removed sample: {fname} valid', False, str(e))

# ============================================
# SUMMARY
# ============================================
print(f'\n{"="*50}')
total = passed + failed
if failed == 0:
    print(f'ALL TESTS PASSED: {passed}/{total}')
else:
    print(f'TESTS: {passed}/{total} passed, {failed} FAILED')
sys.exit(1 if failed else 0)
