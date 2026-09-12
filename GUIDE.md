# MPO Project Application Tool Guide

This is the single human workflow for adapting, testing, and deploying the MPO Project Application Tool.

Use `ANALYSIS_METHODS.md` only when you need to choose or tune a dataset analysis method.

## 1. Confirm Prerequisites

You need:

- A modern desktop browser: Chrome, Firefox, Safari, or Edge.
- Python 3 for local testing.
- A text editor.
- GIS data exported as GeoJSON.
- WGS84 / EPSG:4326 coordinates for every dataset.

Optional:

- Git, if you want version control or GitHub Pages deployment.
- ArcGIS Pro, QGIS, or geopandas for preparing datasets.

## 2. Get the Code

Choose one:

- Clone the repository with Git.
- Download the repository as a ZIP and extract it.

Open a terminal in the project folder before running commands.

## 3. Run the Sample App

Start a local web server:

```bash
python -m http.server 5000
```

If `python` is not available, try:

```bash
python3 -m http.server 5000
```

Open `http://localhost:5000`.

Do not open `index.html` directly from the file system. Browser security rules can block local data loading.

Quick test:

1. Confirm the Memphis MPO demo loads.
2. Draw a line or point.
3. Confirm analysis results appear.
4. Click `Download PDF Report`.

If port `5000` is in use, run `python -m http.server 8080` and open `http://localhost:8080`.

## 4. Update Organization Settings

Edit `config.yaml`.

Set the organization fields:

```yaml
organization:
  name: "Your MPO Name"
  shortName: "Your MPO"
  planName: "Your Long-Range Transportation Plan Name"
  planYear: "2050"
```

Refresh the browser and confirm the organization name appears in the app and PDF output.

## 5. Replace the Logo

1. Save the logo in `assets/`, such as `assets/your-logo.png`.
2. Update `config.yaml`:

```yaml
branding:
  logoPath: "./assets/your-logo.png"
```

Recommended logo format: PNG, JPG, or SVG. A 300-500px wide image with a transparent background works well.

Refresh the browser and confirm the logo appears in the header.

## 6. Set Geographic Bounds

Edit `config.yaml`.

```yaml
geography:
  mapBounds:
    southwest: [35.0, -85.0]
    northeast: [36.0, -84.0]

  validationBounds:
    minLng: -86
    maxLng: -83
    minLat: 34
    maxLat: 37

  defaultZoom: 10
```

How to choose bounds:

1. Open `https://www.openstreetmap.org/`.
2. Navigate to the planning region.
3. Zoom until the full region is visible.
4. Use the southwest and northeast corners for `mapBounds`.
5. Make `validationBounds` slightly wider than `mapBounds` so regional data outside the core map still validates.

Refresh the browser and confirm the map centers on the correct region.

## 7. Prepare GIS Data

Every dataset must meet these requirements:

- Coordinate system: WGS84 / EPSG:4326.
- Coordinate order: GeoJSON uses `[longitude, latitude]`.
- Format: `.json` or `.geojson`.
- File size: ideally under 5MB, under 10MB if possible.
- Property names: exact and case-sensitive in `datasets.yaml`.

Recommended workflow:

```text
Source GIS data
  -> Reproject to WGS84 / EPSG:4326
  -> Export to GeoJSON
  -> Optimize if large
  -> Place in data/
  -> Configure in datasets.yaml
  -> Test in browser
```

### ArcGIS Pro Export

1. Add the layer to ArcGIS Pro.
2. Right-click the layer and choose `Data` > `Export Features`.
3. Save the output in the project's `data/` folder.
4. Use GeoJSON output.
5. Set output coordinate system to `GCS WGS 1984` / EPSG:4326.
6. Run the export.
7. Verify the exported layer source uses WGS84.

### QGIS Export

1. Add the layer to QGIS.
2. Right-click the layer and choose `Export` > `Save Features As`.
3. Set `Format` to `GeoJSON`.
4. Save the output in the project's `data/` folder.
5. Set `CRS` to `EPSG:4326 - WGS 84`.
6. Set encoding to `UTF-8`.
7. Export.

### Python Export

```python
import geopandas as gpd

gdf = gpd.read_file("path/to/your/data.shp")
gdf = gdf.to_crs(epsg=4326)
gdf.to_file("data/output.geojson", driver="GeoJSON")
```

### Verify Data

Run the included inspection script:

```bash
python scripts/inspect_geojson.py data/*.json
```

Check for:

- Geometry type.
- Feature count.
- WGS84 sanity check.
- Available property fields.

Manual coordinate check:

- Correct WGS84 example: `[-90.0489, 35.1495]`.
- Incorrect projected-coordinate example: `[765432.1, 3892156.8]`.

If coordinates are large numbers, reproject to WGS84.

### Optimize Large Files

For files larger than 1MB:

```bash
python scripts/optimize_geojson.py data/your-file.geojson
```

This reduces coordinate precision and removes unnecessary whitespace. Do not optimize if survey-grade coordinate precision is required.

### Organize Files

Place datasets in `data/`.

Good file names:

- `bridges.geojson`
- `transit_routes.json`
- `opportunity_zones.geojson`

Avoid spaces and inconsistent capitalization. Web servers may be case-sensitive.

## 8. Configure Datasets

Edit `datasets.yaml`.

For each new dataset:

1. Choose the closest sample dataset as a template.
2. Copy its configuration block.
3. Change the dataset ID, display name, file path, geometry type, analysis method, fields, and styles.
4. Test one dataset at a time.

Template:

```yaml
yourDataset:
  id: yourDataset
  name: "Your Dataset Name"
  description: "What this dataset measures"
  category: "Transportation"
  filePath: ./data/your-file.geojson
  geometryType: Point
  analysisMethod: listNearbyFeatures
  proximityBuffer: 500
  properties:
    displayField: NAME
    additionalFields:
      - CATEGORY
  style:
    color: "#0066CC"
    fillColor: "#0066CC"
    fillOpacity: 0.5
    radius: 5
  resultStyle: list
```

Important rules:

- `displayField` must exactly match a GeoJSON property name.
- `geometryType` must match the data: `Point`, `LineString`, or `Polygon`.
- `filePath` should usually start with `./data/`.
- Hex colors must include `#`, such as `#0066CC`.

Common patterns:

| Need | Method | Typical Result Style |
|------|--------|----------------------|
| List nearby parks, schools, bridges, or resources | `listNearbyFeatures` | `list` |
| Count crashes, signals, complaints, or assets by type | `countByCategory` | `count` |
| Find routes or facilities running along a corridor | `listParallelFeatures` | `list` |
| Measure project length by pavement, congestion, or class | `measureProjectByCategory` | `lengthByStatus` |
| Calculate percent of project in a priority network | `projectCoverage` | `percentage` |
| Identify intersecting districts or zones | `listIntersectingFeatures` | `list` |

See `ANALYSIS_METHODS.md` for the full method reference.

## 9. Test Locally

After each dataset change:

1. Save `datasets.yaml`.
2. Refresh the browser.
3. Open browser developer tools with `F12`.
4. Check the console for errors.
5. Draw a test line or point.
6. Confirm map display, analysis results, and PDF output.

Before deployment, verify:

- The app loads without console errors.
- Lines and points can be drawn.
- Every dataset loads.
- Analysis results are plausible.
- PDF generation works.
- The app works in Chrome and at least one other browser.

## 10. Deploy

The app is static HTML, JavaScript, YAML, JSON, and image files. There is no backend and no database.

### Recommended: Organization Website

Use this for production when IT can host the files and manage access.

Ask IT for:

- A static web directory, such as `yoursite.org/tools/project-mapper/`.
- HTTPS.
- Permission to upload or replace files when datasets change.
- Correct MIME support for `.json`, `.yaml`, `.js`, `.css`, and image files.

IT notes:

- No server-side runtime is required.
- No database is required.
- Updates are file replacements.
- If `.json` files fail on IIS, add MIME type `application/json`.
- If `.yaml` files are blocked, rename `datasets.yaml` to `datasets.txt` and update the fetch path in `src/datasets.js`.

### Alternative: GitHub Pages

Use GitHub Pages only when the repository and data files can be public.

Setup:

1. Push the project to a public GitHub repository.
2. Open repository `Settings` > `Pages`.
3. Set source to your default branch, folder `/ (root)`.
4. Save.
5. Open `https://YOUR-USERNAME.github.io/REPO-NAME/`.

Update flow:

```bash
git add .
git commit -m "Update project application tool"
git push
```

GitHub Pages usually updates within a few minutes.

### Deployment Checklist

- `config.yaml` has final organization name, plan name, logo, and map bounds.
- `datasets.yaml` points to final datasets, not sample-only placeholders.
- All data files exist in `data/`.
- All paths use consistent capitalization.
- All datasets use WGS84 / EPSG:4326.
- No dataset includes personally identifiable information.
- PDF generation works after the final data load.
- `index.html` version query strings are updated if cache busting is needed.

## 11. Data Visibility

All configured data files are served to the user's browser.

- On GitHub Pages, data files are public and downloadable.
- On an organization website, access depends on IT's web-server controls.
- The tool itself does not provide login, authorization, or row-level data protection.

Do not include personally identifiable information or restricted data unless your hosting environment explicitly protects it.

## 12. Troubleshooting

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| Blank screen | App opened directly or dependency failed | Run a local server and check console errors |
| `Failed to load config.yaml` | Missing file or server blocks YAML | Confirm file location and server MIME settings |
| Dataset does not appear | Bad path, bad GeoJSON, or wrong projection | Check console, file path, and WGS84 coordinates |
| `PROJECTION ERROR` | Dataset is not WGS84 | Reproject to EPSG:4326 and export again |
| Field not found | Property name mismatch | Match exact capitalization from GeoJSON properties |
| Analysis returns no results | Method, buffer, or geometry mismatch | Confirm `geometryType`, method, and buffer values |
| PDF is blank or incomplete | Layers still loading or capture failed | Wait for layers, test a smaller project, check console |
| Works locally but not deployed | Case-sensitive path, MIME type, or HTTPS issue | Use lowercase paths, set MIME types, and use HTTPS |

## 13. Self-Host Libraries When Needed

The default app loads libraries from public CDNs. Self-host libraries if your organization blocks CDN access or requires offline operation.

Process:

1. Create a `lib/` folder.
2. Download each CDN library referenced in `index.html`.
3. Update each `<script>` or `<link>` tag to use the local `lib/` path.
4. Remove CDN-only `integrity` and `crossorigin` attributes from local tags.
5. Test the app without external CDN access.

Libraries currently used include Leaflet, Leaflet Draw, Leaflet PolylineOffset, Turf, Martinez, jsPDF, html2canvas, and js-yaml.

## 14. When You Need More Detail

- Analysis behavior: `ANALYSIS_METHODS.md`.
- Automated tests: `docs/developer/testing.md`.
- Developer maintenance notes: `CLAUDE.md`.
- Version history: `CHANGELOG.md`.
