/**
 * map.js
 * Map initialization, layer management, and drawing controls
 *
 * Dependencies: Leaflet, Leaflet.draw, datasets.js (CONFIG)
 */

// ============================================
// MAP GLOBAL VARIABLES
// ============================================
let map;                          // Leaflet map instance
let drawControl;                  // Leaflet.draw control
let drawnItems;                   // Feature group for drawn items
let polylineDrawer;               // Polyline draw handler
let markerDrawer;                 // Marker draw handler
let drawnLayer = null;            // Currently drawn polyline layer

// Layer groups for reference data (dynamically populated from DATASETS)
const featureLayers = {};

// Measurement tool variables
let measureControl;           // Leaflet control instance
let measurementDrawer;        // L.Draw.Polyline handler for measurements
let measurementItems;         // FeatureGroup for measurement layers
let isMeasuring = false;      // Track measurement tool state

// ============================================
// SHARED UTILITY FUNCTIONS
// ============================================

function escapeHtmlMap(text) { return AppUtils.escapeHtml(text); }
function isValidColor(color) { return AppUtils.isValidColor(color); }

/**
 * Format distance with dynamic units (feet for short distances, miles for long)
 * Uses 528 feet (0.1 miles) as threshold for switching to miles
 * @param {number} feet - Distance in feet
 * @returns {string} Formatted distance string (e.g., "1,234 ft" or "2.5 mi")
 */
function formatDistance(feet) {
  const THRESHOLD = 528; // 0.1 miles (528 ft exactly)

  if (feet < THRESHOLD) {
    // Short distances: display in feet with comma separators
    return `${Math.round(feet).toLocaleString('en-US')} ft`;
  } else {
    // Long distances: display in miles rounded to 1 decimal place (starting at 528 ft = 0.1 mi)
    const miles = feet / CONVERSIONS.FEET_PER_MILE;
    return `${miles.toFixed(1)} mi`;
  }
}

/**
 * Override Leaflet.draw's distance formatter to use our custom formatDistance
 * This ensures both measurement tool and project drawing tool show distances identically
 */
function patchLeafletDrawFormatter() {
  if (L.GeometryUtil && L.GeometryUtil.readableDistance) {
    L.GeometryUtil.readableDistance = function(distance, isMetric, isFeet, isNauticalMile, precision) {
      // Convert meters to feet (Leaflet.draw internally uses meters)
      const distanceInFeet = distance * CONVERSIONS.FEET_PER_METER;

      // Use our unified formatDistance function
      return formatDistance(distanceInFeet);
    };
  }
}

// ============================================
// MAP INITIALIZATION
// ============================================

/**
 * Initialize the Leaflet map with basemap and controls
 * @returns {boolean} True if map was initialized successfully, false otherwise
 */
function initializeMap() {
  try {
    // Check if Leaflet is available
    if (typeof L === 'undefined') {
      console.error('Leaflet library is not loaded');
      return false;
    }

    // Create map instance
    // Using canvas renderer instead of SVG to fix html2canvas offset issues in PDF export
    map = L.map('map', {
      zoomControl: true,
      attributionControl: true,
      renderer: L.canvas()
    });

    // Verify map was created
    if (!map) {
      console.error('Failed to create map instance');
      return false;
    }

    // Add OpenStreetMap standard basemap (no API key required)
    const basemap = L.tileLayer(CONFIG.basemapUrl, {
      attribution: CONFIG.basemapAttribution,
      maxZoom: 19
    }).addTo(map);

    // Add scale control (bottom left)
    L.control.scale({
      imperial: true,
      metric: false,
      position: 'bottomleft'
    }).addTo(map);

    return true;
  } catch (error) {
    console.error('Error initializing map:', error);
    return false;
  }
}

/**
 * Dynamically add all reference layers to the map based on DATASETS configuration
 * Configures styling, tooltips, and hover interactions for each dataset
 */
function addReferenceLayers() {
  // Group layers by category
  const layersByCategory = {};

  // Loop through all enabled datasets and create layers
  Object.keys(DATASETS).forEach(datasetKey => {
    const config = DATASETS[datasetKey];

    // Skip if dataset is disabled or data not loaded
    if (!config.enabled || !geoJsonData[datasetKey]) {
      return;
    }

    try {
      let layer;

      // Use all features for display if threshold filtering is enabled
      const dataToDisplay = config.filterByThreshold && geoJsonData[datasetKey + '_all']
        ? geoJsonData[datasetKey + '_all']
        : geoJsonData[datasetKey];

      // Unified layer creation — one L.geoJSON() handles all geometry types
      layer = L.geoJSON(dataToDisplay, {
        // pointToLayer: Leaflet only calls this for Point geometries
        pointToLayer: (feature, latlng) => {
          let featureStyle = config.style;
          if (config.styleByProperty) {
            const propertyValue = feature.properties[config.styleByProperty.field];
            const propertyStyle = config.styleByProperty.values[propertyValue];
            if (propertyStyle) featureStyle = { ...config.style, ...propertyStyle };
          }
          return L.circleMarker(latlng, featureStyle);
        },

        // style: Leaflet calls this for LineString and Polygon geometries
        style: (feature) => {
          let featureStyle = config.style;

          // styleByProperty — works for all geometry types
          if (config.styleByProperty) {
            const propertyValue = feature.properties[config.styleByProperty.field];
            const propertyStyle = config.styleByProperty.values[propertyValue];
            if (propertyStyle) featureStyle = { ...config.style, ...propertyStyle };
          }

          // filterByThreshold — works for all geometry types
          if (config.filterByThreshold) {
            const value = feature.properties[config.filterByThreshold.field];
            const meetsThreshold = config.filterByThreshold.operator === '>='
              ? value >= config.filterByThreshold.value
              : value > config.filterByThreshold.value;
            if (!meetsThreshold) return config.styleTranslucent;
          }

          // offsetByDirection — only applied to line features
          if (config.offsetByDirection && (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')) {
            const dirConfig = config.offsetByDirection;
            const dirField = dirConfig.field || 'direction';
            const dir = (feature.properties[dirField] || '').toUpperCase();
            const positiveValues = (dirConfig.positiveValues || []).map(v => v.toUpperCase());
            const offsetAmount = dirConfig.offset || 2;
            const offsetPx = positiveValues.includes(dir) ? offsetAmount : -offsetAmount;
            featureStyle = { ...featureStyle, offset: offsetPx };
          }

          return featureStyle;
        },

        // onEachFeature: tooltips and hover for all geometry types
        onEachFeature: (feature, leafletLayer) => {
          const displayValue = config.properties.staticLabel ||
                              feature.properties[config.properties.displayField] ||
                              'Unknown';

          // Build tooltip text with additional fields
          let tooltipText = displayValue;
          if (config.properties.additionalFields.length > 0) {
            config.properties.additionalFields.forEach(field => {
              let value = feature.properties[field];

              if (config.properties.formatPercentage === field && value !== undefined) {
                value = `${(value * 100).toFixed(1)}%`;
              } else if (value === undefined) {
                value = 'Unknown';
              }

              const fieldLabel = (config.properties.fieldLabels && config.properties.fieldLabels[field]) || field;
              tooltipText += ` | ${fieldLabel}: ${value}`;
            });
          }

          leafletLayer.bindTooltip(escapeHtmlMap(tooltipText), {
            sticky: true,
            className: 'leaflet-tooltip'
          });

          // Compute current style for hover effect baseline
          let currentStyle = config.style;
          if (config.styleByProperty) {
            const propertyValue = feature.properties[config.styleByProperty.field];
            const propertyStyle = config.styleByProperty.values[propertyValue];
            if (propertyStyle) currentStyle = { ...config.style, ...propertyStyle };
          }
          if (config.filterByThreshold) {
            const value = feature.properties[config.filterByThreshold.field];
            const meetsThreshold = config.filterByThreshold.operator === '>='
              ? value >= config.filterByThreshold.value
              : value > config.filterByThreshold.value;
            if (!meetsThreshold) currentStyle = config.styleTranslucent;
          }

          // Geometry-appropriate hover effects
          const geomType = feature.geometry.type;
          let hoverStyle;
          if (geomType === 'Point' || geomType === 'MultiPoint') {
            hoverStyle = { ...currentStyle, radius: (currentStyle.radius || 3) + 2 };
          } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
            hoverStyle = { ...currentStyle, fillOpacity: (currentStyle.fillOpacity || 0.3) + 0.2 };
          } else {
            hoverStyle = { ...currentStyle, weight: (currentStyle.weight || 2) + 0.5, opacity: (currentStyle.opacity || 0.7) + 0.15 };
          }

          leafletLayer.on('mouseover', function() { this.setStyle(hoverStyle); });
          leafletLayer.on('mouseout',  function() { this.setStyle(currentStyle); });
        }
      });

      // Store layer and organize by category
      if (layer) {
        featureLayers[datasetKey] = layer;

        // Create layer control label with colored symbol
        let symbol = '●';
        if (config.geometryType === 'Polygon') symbol = '■';
        if (config.geometryType === 'LineString') symbol = '─';

        // Use legendColor if specified, otherwise use style color — validate before CSS interpolation
        const rawColor = config.legendColor || config.style.color;
        const symbolColor = isValidColor(rawColor) ? rawColor : '#888888';
        const layerLabel = `<span style="color:${symbolColor};">${symbol}</span> ${escapeHtmlMap(config.name)}`;

        // Group by category
        const category = config.category || 'Other';
        if (!layersByCategory[category]) {
          layersByCategory[category] = {};
        }
        layersByCategory[category][layerLabel] = layer;
      }

    } catch (error) {
      console.error(`Error creating layer for ${datasetKey}:`, error);
    }
  });

  // ========== LAYER CONTROL ==========
  // Build overlay layers grouped by category (with spacing between categories)
  const overlayLayers = {};
  const configuredOrder = window.CONFIG_APP?.categoryOrder || DEFAULT_CATEGORY_ORDER;
  // Append any categories found in datasets that aren't in the configured list
  const categoryOrder = [...configuredOrder];
  Object.keys(layersByCategory).forEach(cat => {
    if (!categoryOrder.includes(cat)) {
      categoryOrder.push(cat);
    }
  });

  categoryOrder.forEach((category, catIndex) => {
    if (layersByCategory[category]) {
      // Add all layers in this category
      Object.keys(layersByCategory[category]).forEach((layerLabel, index) => {
        // Add extra top margin to first layer of non-first categories for visual separation
        let styledLabel = layerLabel;
        if (index === 0 && catIndex > 0) {
          // Add spacing by wrapping in inline-block span with margin-top
          styledLabel = `<span style="display: inline-block; margin-top: 12px;">${layerLabel}</span>`;
        }
        overlayLayers[styledLabel] = layersByCategory[category][layerLabel];
      });
    }
  });

  // Add layer control to map if we have any layers
  if (Object.keys(overlayLayers).length > 0) {
    L.control.layers(null, overlayLayers, {
      collapsed: false,
      position: 'topright'
    }).addTo(map);
  }
}

/**
 * Fit map to MPO area extent
 * Uses bounds from CONFIG_APP or defaults
 */
function fitMapToBounds() {
  // Get bounds from configuration or use defaults
  const sw = window.CONFIG_APP.geography.mapBounds.southwest;
  const ne = window.CONFIG_APP.geography.mapBounds.northeast;

  const mpoBounds = L.latLngBounds(sw, ne);

  // Fit map to bounds with padding
  map.fitBounds(mpoBounds, { padding: [50, 50] });
}

/**
 * Set up Leaflet.draw controls for drawing project alignments
 * Only allows polyline drawing, one feature at a time
 */
function setupDrawingControls() {
  // Patch Leaflet.draw's distance formatter to use our unified formatting
  patchLeafletDrawFormatter();

  // Create a feature group to store drawn items
  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  // Create draw handlers (but don't add toolbar to map)
  // These will be triggered programmatically from sidebar buttons
  polylineDrawer = new L.Draw.Polyline(map, {
    shapeOptions: CONFIG.drawnLineStyle,
    showLength: true,
    metric: false,  // Use imperial units (feet)
    feet: true
  });

  markerDrawer = new L.Draw.Marker(map, {
    icon: L.divIcon({
      className: 'project-marker',
      html: '<div style="background-color: #FF0000; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white;"></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  });

  // Event handler: When drawing is created
  map.on(L.Draw.Event.CREATED, function(event) {
    // Route to appropriate handler based on tool state
    if (isMeasuring) {
      onMeasurementCreated(event);
      return; // Don't process as project drawing
    }
    onDrawCreated(event, drawnItems);
  });

  // Event handler: When drawing starts
  map.on(L.Draw.Event.DRAWSTART, function() {
    if (isMeasuring) {
      onMeasurementDrawStart();
    } else {
      updateDrawButtonStates(true);
    }
  });

  // Event handler: When drawing stops
  map.on(L.Draw.Event.DRAWSTOP, function() {
    updateDrawButtonStates(false);
  });

  // Initialize measurement tool
  setupMeasurementTool();
}

// ============================================
// MEASUREMENT TOOL
// ============================================

/**
 * Custom Leaflet control for distance measurement
 * Positioned in top-left corner near zoom buttons
 */
L.Control.Measure = L.Control.extend({
  options: { position: 'topleft' },

  onAdd: function(map) {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-measure');
    container.innerHTML = `
      <a href="#" title="Measure Distance" role="button" aria-label="Measure Distance">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M3 11h18M3 9v4M7 10v2M11 9v4M15 10v2M19 9v4"/>
        </svg>
      </a>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(container, 'click', this._toggleMeasure, this);
    return container;
  },

  _toggleMeasure: function(e) {
    L.DomEvent.preventDefault(e);
    toggleMeasurementTool();
  }
});

L.control.measure = function(opts) {
  return new L.Control.Measure(opts);
};

/**
 * Initialize the measurement tool control and drawer
 * Creates separate feature group and drawer for measurements
 */
function setupMeasurementTool() {
  // Create feature group for measurements
  measurementItems = new L.FeatureGroup();
  map.addLayer(measurementItems);

  // Create measurement drawer with distinctive orange dashed style
  measurementDrawer = new L.Draw.Polyline(map, {
    shapeOptions: window.CONFIG_APP?.mapStyling?.measurementLine || {
      color: '#FF8C00',
      weight: 4,
      opacity: 0.8,
      dashArray: '8, 8'
    },
    showLength: true,
    metric: false,
    feet: true,
    repeatMode: false
  });

  // Add control to map
  measureControl = L.control.measure({ position: 'topleft' });
  measureControl.addTo(map);
}

/**
 * Toggle measurement tool on/off
 * If measurements exist, clear them on first click, then disable on second click
 * Manages state and clears previous measurements
 */
function toggleMeasurementTool() {
  const controlElement = document.querySelector('.leaflet-control-measure a');

  if (isMeasuring) {
    // Check if there are existing measurements
    if (measurementItems.getLayers().length > 0) {
      // Clear measurements on first click
      measurementItems.clearLayers();
      return;
    }

    // No measurements exist, so disable the tool
    measurementDrawer.disable();
    controlElement.classList.remove('active');
    isMeasuring = false;
  } else {
    // Disable project drawing tools if active
    if (polylineDrawer && polylineDrawer._enabled) polylineDrawer.disable();
    if (markerDrawer && markerDrawer._enabled) markerDrawer.disable();

    // Clear previous measurements and activate
    measurementItems.clearLayers();
    measurementDrawer.enable();
    controlElement.classList.add('active');
    isMeasuring = true;
  }
}

/**
 * Handle measurement creation - add total distance label
 * @param {Object} event - Leaflet draw event
 */
function onMeasurementCreated(event) {
  if (!isMeasuring || event.layerType !== 'polyline') return;

  const layer = event.layer;

  // Calculate total distance with Turf.js
  const coords = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
  const linestring = turf.lineString(coords);
  const totalFeet = turf.length(linestring, { units: 'feet' });

  // Format distance with shared formatting function
  const formattedDistance = formatDistance(totalFeet);

  // Add permanent label at final vertex
  const finalPoint = layer.getLatLngs()[layer.getLatLngs().length - 1];
  const label = L.tooltip({
    permanent: true,
    direction: 'top',
    className: 'measurement-total-label',
    offset: [0, -10]
  })
  .setContent(`Total: ${formattedDistance}`)
  .setLatLng(finalPoint);

  measurementItems.addLayer(layer);
  measurementItems.addLayer(label);
}

/**
 * Handle measurement draw start - clear previous measurements
 */
function onMeasurementDrawStart() {
  if (isMeasuring) {
    measurementItems.clearLayers(); // Clear previous when starting new
  }
}

/**
 * Calculate optimal bounds for PDF map capture
 * Expands drawn geometry bounds for better framing
 * @returns {L.LatLngBounds|null} Expanded bounds or null if no drawing
 */
function getOptimalMapBounds() {
  if (!drawnLayer) return null;

  // Handle different layer types
  if (drawnLayer.getBounds) {
    // LineString - has getBounds method
    const lineBounds = drawnLayer.getBounds();
    const center = lineBounds.getCenter();
    const latDiff = Math.abs(lineBounds.getNorth() - lineBounds.getSouth());
    const lngDiff = Math.abs(lineBounds.getEast() - lineBounds.getWest());

    // Ensure minimum extent so narrow lines don't produce degenerate bounds
    // 0.003 degrees ~ 330m, prevents extreme aspect ratios for axis-aligned lines
    const effectiveLatDiff = Math.max(latDiff, 0.003);
    const effectiveLngDiff = Math.max(lngDiff, 0.003);

    // Expand bounds evenly around center by 15% on each side for readable context
    const latPad = effectiveLatDiff * 0.15;
    const lngPad = effectiveLngDiff * 0.15;

    // Total half-extent in each dimension
    const latHalf = effectiveLatDiff / 2 + latPad;
    const lngHalf = effectiveLngDiff / 2 + lngPad;

    // Create new bounds centered on the project center
    return L.latLngBounds([
      [center.lat - latHalf, center.lng - lngHalf],
      [center.lat + latHalf, center.lng + lngHalf]
    ]);
  } else if (drawnLayer.getLatLng) {
    // Point/Marker - use getLatLng
    const latlng = drawnLayer.getLatLng();
    // Create balanced bounds around the point (0.008 degrees ~ 800m for better framing)
    const offset = 0.008;
    return L.latLngBounds([
      [latlng.lat - offset, latlng.lng - offset],
      [latlng.lat + offset, latlng.lng + offset]
    ]);
  }

  return null;
}
