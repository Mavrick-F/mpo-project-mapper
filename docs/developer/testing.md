# Testing Guide

## Running Tests

Start the development server and open test files in your browser:

```bash
python -m http.server 5000
```

Then open `http://localhost:5000/tests/test-[name].html`.

For a quick repository smoke check from the terminal:

```bash
python tests/test-decoupled-node.py
```

Recommended high-value checks:

- `tests/test-decoupled-node.py` - verifies JavaScript syntax, version consistency, enabled sample files, and sample GeoJSON validity.
- `tests/test-config-validation.html` - verifies config validation and template interpolation behavior.
- `tests/test-projectCoverage.html` - regression test for corridor coverage percentage calculations.

## Writing Analysis Function Tests

Test files are self-contained HTML pages that load Turf.js and test the analysis function directly.

### Basic Test Structure

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Analysis Tests</title>
  <script src="https://unpkg.com/@turf/turf@6.5.0/turf.min.js"></script>
</head>
<body>
  <h1>My Analysis Tests</h1>
  <div id="results"></div>

  <script>
    const tests = [];

    function myAnalysisFunction(drawnGeometry, datasetConfig, geoJsonData) {
      // Copy the analysis function from src/analysis.js.
    }

    (() => {
      const geometry = turf.point([-90.0, 35.0]);
      const config = {};
      const data = { features: [] };

      const result = myAnalysisFunction(geometry, config, data);

      tests.push({
        name: "Test description",
        pass: result.total === 0,
        details: `Expected 0, got ${result.total}`
      });
    })();
  </script>
</body>
</html>
```

## What to Test

- Geometry types: point, line, and polygon behavior where applicable.
- Edge cases: empty data, zero values, null values, and missing fields.
- Filters: `analysisFilter` behavior when supported.
- Precision: rounding and unit conversions.
- Buffers: proximity and corridor matching distances.

## Test Data Tips

Use Turf.js helpers to create test data:

```javascript
turf.point([-90.0, 35.0], { propertyName: "value" });
turf.lineString([[-90.0, 35.0], [-90.01, 35.01]], { propertyName: "value" });
turf.polygon([[[-90.0, 35.0], [-90.0, 35.01], [-90.01, 35.01], [-90.01, 35.0], [-90.0, 35.0]]], { propertyName: "value" });
turf.featureCollection([feature1, feature2, feature3]);
```

## Coordinate Reference

Memphis area WGS84 coordinates:

- Longitude: `-90.1` to `-89.6`.
- Latitude: `34.9` to `35.3`.

Approximate distances at 35 degrees north:

- `0.001` degrees longitude is about 90 meters.
- `0.001` degrees latitude is about 110 meters.
- 100 feet is about 30 meters.
- 1000 feet is about 300 meters.

Keep test points close together for reliable buffer intersections.

## Example

Use `tests/test-sumNearbyValues.html` as a complete example with helper functions, multiple test cases, visual result rendering, and console logging.
