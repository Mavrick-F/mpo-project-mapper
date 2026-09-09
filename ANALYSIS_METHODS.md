# Analysis Methods Guide

This guide explains all 10 analysis methods available in the MPO Project Application Tool. Each method is designed for specific types of spatial analysis and data outputs.

---

## Table of Contents

1. [Quick Reference Chart](#quick-reference-chart)
2. [Decision Tree](#decision-tree)
3. [Method Descriptions](#method-descriptions)
   - [listParallelFeatures](#1-listparallelfeatures)
   - [listIntersectingFeatures](#2-listintersectingfeatures)
   - [listNearbyFeatures](#3-listnearbyfeatures)
   - [countByCategory](#4-countbycategory)
   - [hasNearbyFeatures](#5-hasnearbyfeatures)
   - [measureProjectByCategory](#6-measureprojectbycategory)
   - [measureIntersectedArea](#7-measureintersectedarea)
   - [projectCoverage](#8-projectcoverage)
   - [sumNearbyValues](#9-sumnearbyvalues)
   - [findNearestFeatures](#10-findnearestfeatures)

---

## Quick Reference Chart

| Analysis Method | Best For | Feature Geometry | Returns | Typical Use Case |
|----------------|----------|------------------|---------|------------------|
| `listParallelFeatures` | Lines running parallel to project | LineString | List of matched features | Bike routes, transit lines, freight corridors |
| `listIntersectingFeatures` | Areas or lines that cross/overlap project | Any | List of matched features | Districts, zones, road networks |
| `listNearbyFeatures` | Points, lines, or areas near project | Any | List of matched features | Bridges, employers, parks |
| `countByCategory` | Counting features by type | Any | Counts grouped by field | Crash severity counts |
| `hasNearbyFeatures` | Yes/No detection only | Any | Boolean (detected or not) | Large datasets where you only need presence |
| `measureProjectByCategory` | Length breakdown by status | LineString | Percentage by category | Reliable vs unreliable road segments |
| `measureIntersectedArea` | Area of overlapping regions | Polygon | Total area | Wetlands, flood zones |
| `projectCoverage` | What % of project is covered | LineString | Percentage (0-100%) | High Injury Corridor coverage |
| `sumNearbyValues` | Total of numeric attribute | Any | Numeric sum | Total injuries, total jobs |
| `findNearestFeatures` | Nearest X features with distances | Any | Distance-ranked list | 3 nearest hospitals, closest bus stop |

---

## Decision Tree

**Start here: What type of geometry is your dataset?**

### For POINT, LINESTRING, or POLYGON Features (General Methods)

These methods work with **any** feature geometry type:

**Do you want to count features by category?**
- **Yes** → `countByCategory` (e.g., crashes by severity, tracts by type)

**Do you want to sum a numeric value?**
- **Yes** → `sumNearbyValues` (e.g., total injuries, total population)

**Do you want nearest X features with distances?**
- **Yes** → `findNearestFeatures` (e.g., 3 nearest hospitals)

**Do you just need to know if ANY exist nearby?**
- **Yes** → `hasNearbyFeatures` (e.g., superfund sites present?)

**Do you want a simple list of nearby features?**
- **Yes** → `listNearbyFeatures` (e.g., list bridges, parks, tracts)

**Do features OVERLAP/INTERSECT the project directly?**
- **Yes** → `listIntersectingFeatures` (e.g., opportunity zones, road networks)

### For LINESTRING Features Only

These methods require LineString feature data (corridor/parallel matching):

**Do you need features running PARALLEL (not just crossing)?**
- **Yes** → `listParallelFeatures` (e.g., bike routes alongside project)

**Do you want length breakdown by status?**
- **Yes** → `measureProjectByCategory` (e.g., % on reliable roads)

**Do you want % of project overlapping features?**
- **Yes** → `projectCoverage` (e.g., % in safety network)

**Do you want a weighted average of a numeric field from parallel lines?**
- **Yes** → `averageParallelValue` (e.g., average LOTTR)

### For POLYGON Features Only

**Do you need the area of intersection?**
- **Yes** → `measureIntersectedArea` (e.g., acres of wetlands)

---

## Method Descriptions

### 1. listParallelFeatures

**Use when:** You need to find linear features that run parallel to your project (transit routes, bike lanes, existing corridors)

**Geometry:** LineString

**Parameters:**
```yaml
analysisMethod: listParallelFeatures
bufferDistance: 100         # Initial intersection check (feet)
minSharedLength: 300        # Minimum feet of parallel alignment
```

**Example:** Transit routes along project corridor
```yaml
mataRoutes:
  analysisMethod: listParallelFeatures
  bufferDistance: 100
  minSharedLength: 300
  properties:
    displayField: Name
```

**Why it works:** Checks if features run parallel for at least 300ft, avoiding false positives from perpendicular crossings.

**See also:** MATA Routes in sample datasets

---

### 2. listIntersectingFeatures

**Use when:** You need to identify areas or lines that cross, overlap, or intersect your project

**Geometry:** LineString or Polygon

**Parameters:**
```yaml
analysisMethod: listIntersectingFeatures
# No buffer needed - uses direct intersection
```

**Example:** Opportunity zones intersected by project
```yaml
opportunityZones:
  analysisMethod: listIntersectingFeatures
  geometryType: Polygon
  properties:
    displayField: CENSUSTRAC
```

**Why it works:** Direct geometric intersection - any overlap counts as a match.

**See also:** Opportunity Zones in sample datasets

---

### 3. listNearbyFeatures

**Use when:** You want a simple list of features within a buffer distance

**Geometry:** Any (Point, LineString, or Polygon)

**Parameters:**
```yaml
analysisMethod: listNearbyFeatures
proximityBuffer: 500        # Buffer distance in feet
```

**Example:** Historic sites within 200ft
```yaml
historicPlaces:
  analysisMethod: listNearbyFeatures
  proximityBuffer: 200
  properties:
    displayField: RESNAME
```

**Why it works:** Simple proximity check - lists all features within buffer.

**See also:** Use this pattern for historic resources, schools, bridges, parks, or other nearby assets.

---

### 4. countByCategory

**Use when:** You need counts grouped by a category field (severity, type, status)

**Geometry:** Any (Point, LineString, or Polygon)

**Parameters:**
```yaml
analysisMethod: countByCategory
proximityBuffer: 200        # Buffer distance in feet
properties:
  displayField: CategoryField  # Field to group by
```

**Example:** Count crashes by severity
```yaml
ksi_crashes:
  analysisMethod: countByCategory
  proximityBuffer: 200
  properties:
    displayField: Severity    # Groups: "Fatal", "Serious Injury"
```

**Returns:** "Fatal: 3, Serious Injury: 7"

**See also:** KSI Crashes in sample datasets

---

### 5. hasNearbyFeatures

**Use when:** You only need YES/NO detection, not details (useful for large datasets or simple flags)

**Geometry:** Point, LineString, or Polygon

**Parameters:**
```yaml
analysisMethod: hasNearbyFeatures
proximityBuffer: 500
```

**Example:** Check for superfund sites
```yaml
superfundSites:
  analysisMethod: hasNearbyFeatures
  proximityBuffer: 1000
  properties:
    displayField: SITE_NAME
```

**Returns:** "Detected" or "Not Found" (no counts, no lists)

**Why use this:** Faster than listing all features for large datasets; useful for binary flags.

---

### 6. measureProjectByCategory

**Use when:** You want project length broken down by a status field (condition, congestion level)

**Geometry:** LineString

**Parameters:**
```yaml
analysisMethod: measureProjectByCategory
bufferDistance: 100
minSharedLength: 100
properties:
  displayField: StatusField  # Field to measure by
```

**Example:** Length on reliable vs unreliable roads
```yaml
roadCongestion:
  analysisMethod: measureProjectByCategory
  bufferDistance: 100
  properties:
    displayField: Reliable_Segment_  # Values: True/False
```

**Returns:** "Reliable: 1,200 ft (60%), Unreliable: 800 ft (40%)"

**See also:** Travel Time Reliability in sample datasets

---

### 7. measureIntersectedArea

**Use when:** You need the area (acres, sq ft, etc.) of overlapping polygon areas

**Geometry:** Polygon

**Parameters:**
```yaml
analysisMethod: measureIntersectedArea
proximityBuffer: 200  # Optional buffer around project
```

**Example:** Acres of wetlands impacted
```yaml
wetlands:
  analysisMethod: measureIntersectedArea
  proximityBuffer: 200
  properties:
    displayField: WETLAND_TYPE
```

**Returns:** "Total Area: 3.2 acres"

**Why use this:** Environmental impacts, land use calculations, regulatory compliance.

---

### 8. projectCoverage

**Use when:** You want to know what percentage of your project falls within certain areas/corridors

**Geometry:** LineString or Polygon

**Parameters:**
```yaml
analysisMethod: projectCoverage
bufferDistance: 100
minSharedLength: 100
```

**Example:** % of project in High Injury Network
```yaml
HIN_Corridors:
  analysisMethod: projectCoverage
  bufferDistance: 100
  minSharedLength: 100
  properties:
    staticLabel: High Injury Corridor
```

**Returns:** "67% (2,100 ft of 3,150 ft total)"

**See also:** High Injury Corridors in sample datasets

---

### 9. sumNearbyValues

**Use when:** You need to total up numeric values from nearby features (population, employment, crash counts)

**Geometry:** Point or Polygon

**Parameters:**
```yaml
analysisMethod: sumNearbyValues
proximityBuffer: 2640  # 0.5 mile = 2,640 feet
properties:
  numericField: POPULATION  # Field to sum
```

**Example:** Total population within 0.5 mile
```yaml
censusBlocks:
  analysisMethod: sumNearbyValues
  proximityBuffer: 2640
  properties:
    displayField: GEOID
    numericField: POP100
```

**Returns:** "Total Population: 12,450"

**Why use this:** Equity analysis, impact estimation, benefit calculations.

---

### 10. findNearestFeatures

**Use when:** You want the nearest X features ranked by distance

**Geometry:** Point or Polygon

**Parameters:**
```yaml
analysisMethod: findNearestFeatures
nearestCount: 3         # How many to find
maxDistance: 5280       # Max distance to search (optional, in feet)
```

**Example:** 3 nearest hospitals
```yaml
hospitals:
  analysisMethod: findNearestFeatures
  nearestCount: 3
  maxDistance: 26400    # 5 miles
  properties:
    displayField: NAME
```

**Returns:** "1. Regional Medical Center (0.8 mi), 2. Baptist Memorial (1.2 mi), 3. Methodist LeBonheur (2.1 mi)"

**Why use this:** Access analysis, emergency services proximity, facility planning.

---

## Common Patterns

### Pattern: Simple Proximity List
**Use for:** Parks, schools, bridges, any features where you just need to know what's nearby
```yaml
analysisMethod: listNearbyFeatures
proximityBuffer: 500
properties:
  displayField: NAME
```

### Pattern: Count by Type
**Use for:** Crashes, signals, complaints - anything with categories to count
```yaml
analysisMethod: countByCategory
proximityBuffer: 200
properties:
  displayField: CATEGORY_FIELD
resultStyle: count
```

### Pattern: Corridor Matching
**Use for:** Transit, bike routes, freight corridors running parallel to project
```yaml
analysisMethod: listParallelFeatures
bufferDistance: 100
minSharedLength: 300
properties:
  displayField: Name
```

### Pattern: Yes/No Detection
**Use for:** Large datasets where you only need to flag presence (wetlands, contaminated sites)
```yaml
analysisMethod: hasNearbyFeatures
proximityBuffer: 1000
```

### Pattern: Percentage Coverage
**Use for:** Safety networks, equity areas, special districts
```yaml
analysisMethod: projectCoverage
bufferDistance: 100
minSharedLength: 100
resultStyle: percentage
```

### Pattern: Area Intersection
**Use for:** Opportunity zones, districts, watersheds
```yaml
analysisMethod: listIntersectingFeatures
geometryType: Polygon
properties:
  displayField: NAME
```

---

## Tips for Choosing Methods

1. **Start with geometry type** - Point, LineString, or Polygon? This eliminates 60% of choices
2. **Think about output format** - Do you need a list, count, percentage, or measurement?
3. **Consider performance** - For huge datasets, use `hasNearbyFeatures` instead of listing all features
4. **Test with samples** - Copy a similar sample configuration and modify it
5. **Check the decision tree** - Follow it step-by-step if unsure

## Need More Help?

- **Configuration examples:** See `datasets.yaml` for 6 working samples
- **Sample datasets:** See README.md for dataset gallery with use cases
- **Setup guide:** See `GUIDE.md` for the full setup, data, testing, and deployment workflow

---

**Questions?** Open an issue on GitHub or reference the sample datasets in `datasets.yaml` for real-world examples.
