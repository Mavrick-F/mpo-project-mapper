# MPO Project Application Tool

![Version](https://img.shields.io/badge/v-3.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-web-lightgrey)

Web-based spatial analysis tool for Metropolitan Planning Organization (MPO) project applications.

Applicants draw proposed projects on an interactive map. The tool analyzes those projects against configured regional planning datasets and generates a PDF report.

## Try the Demo

1. Download or clone this repository.
2. Open a terminal in the project folder.
3. Run `python -m http.server 5000`.
4. Open `http://localhost:5000`.
5. Draw a line or point on the map.
6. Review the automatic analysis results.
7. Click `Download PDF Report`.

The demo uses Memphis MPO sample data.

## Where to Start

| Goal | Use This |
|------|----------|
| See what the tool does | Follow `Try the Demo` above |
| Adapt it for your MPO | Read `GUIDE.md` |
| Choose an analysis method | Read `ANALYSIS_METHODS.md` |
| Understand code/test expectations | Read `CLAUDE.md` and `docs/developer/testing.md` |
| Review release history | Read `CHANGELOG.md` |

## What This Tool Does

1. Applicant draws a project alignment or location.
2. Configured datasets load in the browser.
3. Spatial analysis runs automatically.
4. A PDF report is generated with the map, analysis results, and data tables.
5. The applicant attaches the PDF to the project application.

No GIS expertise is required for applicants. GIS and configuration work happens during setup.

## Key Features

- Client-side only: no backend server, database, or API required.
- Configuration-driven: add datasets through `datasets.yaml`, not code changes.
- Ten analysis methods: proximity, intersection, counting, measurement, and nearest-feature queries.
- PDF export: report output with map capture and result tables.
- Custom branding: logo, organization name, colors, map bounds, and datasets.
- Static hosting: works on organization web servers or GitHub Pages.

## Included Sample Datasets

The repository includes Memphis MPO sample datasets that demonstrate common patterns:

| Dataset | Geometry | Method | Example Use |
|---------|----------|--------|-------------|
| High Injury Corridors | LineString | `projectCoverage` | Percent of project in a priority network |
| Transit Routes | LineString | `listParallelFeatures` | Routes running along the project corridor |
| Crash Locations | Point | `countByCategory` | Crashes by severity within a buffer |
| Opportunity Zones | Polygon | `listIntersectingFeatures` | Policy areas touched by the project |
| Travel Time Reliability | LineString | `averageParallelValue` | Length-weighted average pavement condition |

Use these as templates when adding your own data in `datasets.yaml`.

## Requirements

- Desktop browser: Chrome, Firefox, Safari, or Edge.
- Python 3 for local testing with `python -m http.server`.
- Text editor for `config.yaml` and `datasets.yaml`.
- GIS data in GeoJSON format using WGS84 / EPSG:4326 coordinates.

The app is desktop-oriented and expects a screen width of at least 1024px.

## Documentation

- `GUIDE.md` - single setup, data, testing, and deployment workflow.
- `ANALYSIS_METHODS.md` - reference for all analysis methods and configuration patterns.
- `docs/developer/testing.md` - developer testing notes.
- `CLAUDE.md` - agent/developer context for maintaining the project.
- `CHANGELOG.md` - version history.

## Deployment Summary

Most production deployments should use an organization web server so IT can manage access and data visibility. GitHub Pages is useful for demos and public-data projects, but the repository and data files are public.

See `GUIDE.md` for the deployment checklist and hosting details.

## Project Status

Version 3.0 is the initial public release. The tool was originally developed for Memphis MPO's RTP 2055 application process and is open source under the MIT license.

## Support

- Start with `GUIDE.md`.
- Use `ANALYSIS_METHODS.md` when configuring dataset behavior.
- Open a GitHub issue for bugs or questions, including the relevant console error and sanitized configuration.

## License

MIT License. See `LICENSE`.

## Acknowledgments

- Developed by Mavrick Fitzgerald for Memphis MPO.
- Funded by Memphis Metropolitan Planning Organization.
- Sample data provided by Memphis MPO.
- Built with Leaflet, Turf.js, jsPDF, js-yaml, html2canvas, and related open source libraries.
