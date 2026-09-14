# MPO Project Application Tool

## What This Is
Configurable web-based spatial analysis tool for regional transportation planning. Users draw project alignments or mark point locations, tool automatically analyzes against locally-configured datasets and generates a PDF report. Deployable for any MPO or planning agency by configuring `datasets.yaml` with local data.

**Current Status:** v3.1
**Deployment:** GitHub Pages for development; self-hosted for production

## Architecture
- **Client-side only** — no backend, no server, no build step
- **Configuration over code** — datasets added via `datasets.yaml`, not code changes
- **Vanilla JS + CDN libraries** — no npm, no bundler; no development environment required
- **Desktop only** — 1024px minimum, not a mobile use case

## Adapting for a New Region
Configuration lives in `datasets.yaml` and `data/` — no code changes needed:

1. Export your GeoJSON datasets in **WGS84 (EPSG:4326)** — other projections will silently fail
2. Place files in `data/`
3. Edit `datasets.yaml` — copy an existing entry matching your geometry type (Point, LineString, Polygon) and update the file path, field names, colors, and analysis method
4. Run locally to test: `python -m http.server 5000`, then open `http://localhost:5000`
5. Deploy by copying files to any static web host (GitHub Pages, IIS, etc.)

**Field names in `datasets.yaml` must exactly match your GeoJSON properties — they are case-sensitive.**

## Project Constraints
- **No data persistence** — analysis results only exist in the session; PDF export is the only save mechanism
- **No authentication** — everything is anonymous and client-side
- **Large datasets** — use ArcGIS Feature Service (`featureServiceUrl`) instead of a local file; the server does the filtering

## Configuration Reference
All dataset configuration lives in `datasets.yaml` (self-documenting with inline comments). Key properties:

- `analysisMethod`: controls how features are matched to drawn alignments
- `geometryType`: `'Point'` | `'LineString'` | `'Polygon'`
- `styleByProperty`: conditional styling (e.g., color-code routes by category)
- `staticLabel`: show a constant label instead of a field value
- `filterByThreshold`: filter features by numeric field value
- `lazyLoad`: defer loading until analysis runs (use for large Feature Services)
- `featureServiceUrl`: ArcGIS Feature Service endpoint (alternative to `filePath`)

## PDF Generation
Two things that will break PDF capture if changed in `src/pdf.js`:
- **Wait for ALL layers** before capture — basemap tiles and GeoJSON vectors both need to finish rendering
- **Use `animate: false`** on `fitBounds` — animation interrupts capture

## File Structure
- `datasets.yaml` — dataset configuration (start here)
- `data/*.json` — GeoJSON datasets
- `scripts/inspect_geojson.py` — CLI helper: prints geometry type, CRS check, and property fields for GeoJSON files (`python scripts/inspect_geojson.py data/*.json`)
- `scripts/optimize_geojson.py` — CLI helper: analyzes and optimizes large GeoJSON files
- `GUIDE.md` — human setup, data preparation, testing, and deployment workflow
- `docs/developer/testing.md` — developer testing guide
- `src/datasets.js` — YAML loader and CONFIG object
- `src/map.js` — Leaflet map, layers, drawing controls
- `src/analysis.js` — analysis functions (12 methods)
- `src/pdf.js` — PDF generation
- `src/app.js` — application startup and UI
- `tests/` — HTML test files (open in browser at `/tests/`)

## Documenting Changes
1. Edit files in `src/` or `data/`
2. Test in browser (dev tools console for errors; `tests/` for regression tests)
3. Add entry to top of `CHANGELOG.md` — brief, follow existing format
4. Update version in `README.md` badge, `index.html` title, and `?v=X.X.X` cache-busting strings on script tags
5. Commit following recent commit message style

## Testing
Tests are HTML files in `tests/` — open directly in browser. Write tests for:
- Spatial analysis edge cases (zero-length features, self-intersecting polygons)
- Rendering (colors, visibility, layer order)
- PDF capture
- Configuration loading (YAML parsing, missing fields)
