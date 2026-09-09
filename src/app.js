/**
 * app.js
 * Application initialization, event handlers, and UI management
 *
 * Dependencies: All other modules (datasets.js, map.js, analysis.js, pdf.js)
 */

// ============================================
// APP GLOBAL VARIABLES
// ============================================
const geoJsonData = {};  // Raw GeoJSON data for all datasets
const DEFAULT_MAX_RECORDS = 5000;

// Fetch timeout durations (milliseconds)
const FETCH_TIMEOUT_GEOJSON = 10000;         // 10s for local GeoJSON files
const FETCH_TIMEOUT_FEATURE_SERVICE = 15000; // 15s for ArcGIS Feature Service queries

/**
 * Wrapper around fetch() that aborts and rejects after a timeout.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {Object} [fetchOptions] - Additional options passed to fetch()
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeoutMs, fetchOptions = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOptions, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

// ============================================
// APPLICATION INITIALIZATION
// ============================================

/**
 * Main initialization function
 * Loads data, initializes map, sets up controls and event listeners
 */
async function init() {
  try {
    showLoading(true, 'Loading configuration...');

    // Load application configuration first
    await window.loadConfig();

    // Update page title dynamically
    if (window.CONFIG_APP?.branding?.pageTitle) {
      document.title = window.CONFIG_APP.branding.pageTitle + ' v' + (window.CONFIG_APP.branding.version || '');
    }

    // Update header text dynamically
    if (window.CONFIG_APP?.branding?.headerYear) {
      const headerYearSpan = document.querySelector('.header-year');
      if (headerYearSpan) {
        headerYearSpan.textContent = window.CONFIG_APP.branding.headerYear;
      }
    }

    // Update logo dynamically
    const logoImg = document.getElementById('header-logo');
    if (logoImg && window.CONFIG_APP?.branding?.logoPath) {
      logoImg.src = window.CONFIG_APP.branding.logoPath;
      logoImg.alt = (window.CONFIG_APP.organization?.name || 'Organization') + ' Logo';
      logoImg.onerror = () => {
        logoImg.style.display = 'none';
        showWarning(`Logo file not found at "${window.CONFIG_APP.branding.logoPath}". Check the logoPath in config.yaml.`);
      };
    }

    // Wait for datasets configuration to load from YAML
    await datasetsLoaded;

    // Validate that DATASETS loaded successfully
    if (!DATASETS || typeof DATASETS !== 'object') {
      throw new Error('DATASETS configuration object is not available.');
    }

    if (Object.keys(DATASETS).length === 0) {
      throw new Error('No datasets loaded from YAML configuration. Check console for errors.');
    }

    console.log(`✓ Configuration loaded: ${Object.keys(DATASETS).length} datasets configured`);

    showLoading(true, 'Loading map data...');

    // Load all GeoJSON files and track failures
    const loadResults = await loadGeoJsonData();

    // Check for failed datasets
    if (loadResults && loadResults.failed && loadResults.failed.length > 0) {
      console.warn(`⚠ ${loadResults.failed.length} dataset(s) failed to load:`, loadResults.failed);
    }

    // Collect all startup warnings to show in the UI (deferred so sidebar exists after map init)
    const startupWarnings = [];

    // Config structure warnings (invalid methods, missing required fields, bad colors)
    if (typeof configValidationWarnings !== 'undefined' && configValidationWarnings.length > 0) {
      configValidationWarnings.forEach(w => startupWarnings.push(w));
    }

    // Failed dataset load warnings
    if (loadResults && loadResults.failed) {
      loadResults.failed.forEach(item => startupWarnings.push(`${item.name}: ${item.error}`));
    }

    // Field name validation warnings (field names declared in config vs. actual data properties)
    if (loadResults && loadResults.fieldWarnings) {
      loadResults.fieldWarnings.forEach(w => startupWarnings.push(w));
    }

    if (startupWarnings.length > 0) {
      setTimeout(() => {
        startupWarnings.forEach(w => showWarning(w));
      }, 0);
    }

    if (loadResults && loadResults.loaded === 0) {
      throw new Error('No datasets could be loaded. Check network connection and data files.');
    }

    console.log(`✓ Data loaded: ${loadResults?.loaded || 0} dataset(s) loaded successfully`);

    // Initialize the Leaflet map
    const mapInitialized = initializeMap();

    // Validate map initialization
    if (!mapInitialized || !window.map) {
      throw new Error('Map initialization failed. Leaflet library may not have loaded correctly.');
    }

    console.log('✓ Map initialized successfully');

    // Add reference layers to map
    addReferenceLayers();

    // Calculate and fit map to data bounds
    fitMapToBounds();

    // Set up drawing controls
    setupDrawingControls();

    // Set up event listeners
    setupEventListeners();

    // Hide loading overlay
    showLoading(false);

    console.log('✓ Application initialized successfully');

    // Show tutorial popup if first visit
    showTutorialIfFirstVisit();

  } catch (error) {
    console.error('Initialization error:', error);
    showLoading(false);
    error.__userNotified = true;
    showError(`Failed to initialize the application: ${error.message}\n\nPlease refresh the page and try again.`);
    throw error; // Re-throw to stop execution
  }
}

/**
 * Show tutorial popup
 * Only shows on the first visit for this browser
 */
function showTutorialIfFirstVisit() {
  try {
    if (localStorage.getItem('tutorialSeen') === 'true') {
      return;
    }
  } catch (storageError) {
    console.warn('Could not read tutorialSeen from localStorage:', storageError);
  }

  document.getElementById('tutorialOverlay').classList.add('visible');
  document.getElementById('tutorialPopup').classList.add('visible');
}

/**
 * Close tutorial popup
 */
function closeTutorial() {
  document.getElementById('tutorialOverlay').classList.remove('visible');
  document.getElementById('tutorialPopup').classList.remove('visible');

  try {
    localStorage.setItem('tutorialSeen', 'true');
  } catch (storageError) {
    console.warn('Could not persist tutorialSeen to localStorage:', storageError);
  }
}

// ============================================
// FEATURE SERVICE QUERY
// ============================================

/**
 * Discover the correct layer from a FeatureServer by querying its metadata
 * @param {string} serviceUrl - The base FeatureServer URL (without /N at the end)
 * @param {Object} options - Discovery options
 * @param {string} options.layerName - Optional layer name to match (case-insensitive)
 * @returns {Promise<Object>} - Object with {layerIndex, layerInfo} or null if not found
 */
async function discoverFeatureServiceLayer(serviceUrl, options = {}) {
  try {
    // Remove trailing slash if present
    const baseUrl = serviceUrl.replace(/\/$/, '');

    // Query the service metadata
    const metadataUrl = `${baseUrl}?f=json`;
    console.log('Fetching service metadata from:', metadataUrl);

    const response = await fetchWithTimeout(metadataUrl, FETCH_TIMEOUT_FEATURE_SERVICE);
    if (!response.ok) {
      throw new Error(`Failed to fetch service metadata: ${response.status} ${response.statusText}`);
    }

    const metadata = await response.json();

    // Check for error in response
    if (metadata.error) {
      throw new Error(`Service error: ${metadata.error.message || JSON.stringify(metadata.error)}`);
    }

    // Get layers from metadata
    const layers = metadata.layers || [];
    console.log('Available layers:', layers.map(l => ({ id: l.id, name: l.name })));

    if (layers.length === 0) {
      console.warn('No layers found in service metadata');
      return null;
    }

    // If a specific layer name is requested, find it
    if (options.layerName) {
      const targetName = options.layerName.toLowerCase();
      const matchedLayer = layers.find(layer =>
        layer.name && layer.name.toLowerCase().includes(targetName)
      );

      if (matchedLayer) {
        console.log(`Found matching layer: ${matchedLayer.name} (ID: ${matchedLayer.id})`);
        return {
          layerIndex: matchedLayer.id,
          layerInfo: matchedLayer,
          serviceMetadata: metadata
        };
      }
    }

    // Default to first layer if no specific name requested
    const firstLayer = layers[0];
    console.log(`Using first layer: ${firstLayer.name} (ID: ${firstLayer.id})`);
    return {
      layerIndex: firstLayer.id,
      layerInfo: firstLayer,
      serviceMetadata: metadata
    };

  } catch (error) {
    console.error('Error discovering feature service layer:', error);
    return null;
  }
}

/**
 * Query an ArcGIS Feature Service and return results as GeoJSON
 * @param {string} serviceUrl - The Feature Service URL (can be base URL or layer-specific)
 * @param {Object} options - Query options
 * @param {Array} options.bbox - Bounding box [minX, minY, maxX, maxY] in WGS84
 * @param {string} options.where - SQL where clause (default: "1=1")
 * @param {Array} options.outFields - Fields to return (default: ["*"])
 * @param {number} options.maxRecords - Max features to return (default: 1000)
 * @param {string} options.layerName - Optional layer name to discover (if serviceUrl is base URL)
 * @returns {Promise<Object>} - {success, data (GeoJSON FeatureCollection), error}
 */
async function queryFeatureService(serviceUrl, options = {}) {
  try {
    let queryUrl = serviceUrl;

    // Check if the URL already has a layer index (ends with /N)
    const hasLayerIndex = /\/\d+\/?$/.test(serviceUrl);

    if (!hasLayerIndex) {
      // Need to discover the layer first
      console.log('No layer index found in URL, discovering layer...');
      const layerInfo = await discoverFeatureServiceLayer(serviceUrl, {
        layerName: options.layerName
      });

      if (!layerInfo) {
        throw new Error('Could not discover layer from service metadata');
      }

      // Construct the layer-specific URL
      queryUrl = `${serviceUrl.replace(/\/$/, '')}/${layerInfo.layerIndex}`;
      console.log('Discovered layer URL:', queryUrl);
    }

    // Build query parameters
    const params = new URLSearchParams({
      where: options.where || '1=1',
      outFields: options.outFields ? options.outFields.join(',') : '*',
      returnGeometry: 'true',
      outSR: '4326',  // Request WGS84 coordinates for output
      f: 'json'
    });

    // Add bounding box if provided
    if (options.bbox && options.bbox.length === 4) {
      const [minX, minY, maxX, maxY] = options.bbox;
      params.append('geometry', JSON.stringify({
        xmin: minX,
        ymin: minY,
        xmax: maxX,
        ymax: maxY,
        spatialReference: { wkid: 3857 }  // Input bbox is in Web Mercator
      }));
      params.append('geometryType', 'esriGeometryEnvelope');
      params.append('spatialRel', 'esriSpatialRelIntersects');
      params.append('inSR', '3857');  // Input spatial reference is Web Mercator
    }

    // Add max records limit
    if (options.maxRecords) {
      params.append('resultRecordCount', options.maxRecords);
    }

    // Execute query
    const fullQueryUrl = `${queryUrl}/query?${params.toString()}`;
    console.log('Querying Feature Service:', fullQueryUrl);

    const response = await fetchWithTimeout(fullQueryUrl, FETCH_TIMEOUT_FEATURE_SERVICE);
    if (!response.ok) {
      throw new Error(`Query failed: ${response.status} ${response.statusText}`);
    }

    let arcgisJson;
    try {
      arcgisJson = await response.json();
    } catch (parseError) {
      let preview = '';
      try { preview = (await response.clone().text()).slice(0, 200); } catch (_) {}
      throw new Error(
        `Feature Service returned a non-JSON response (likely an error page or auth redirect).\n` +
        `Response preview: ${preview || '(unreadable)'}\n` +
        `Check that your featureServiceUrl is correct and publicly accessible.`
      );
    }

    // Check for error in response
    if (arcgisJson.error) {
      throw new Error(`Query error: ${arcgisJson.error.message || JSON.stringify(arcgisJson.error)}`);
    }

    // Convert ArcGIS JSON to GeoJSON
    const geojson = convertArcGIStoGeoJSON(arcgisJson);

    console.log(`Query successful: ${geojson.features.length} features returned`);

    return {
      success: true,
      data: geojson,
      error: null
    };

  } catch (error) {
    console.error('Feature Service query error:', error);
    return {
      success: false,
      data: null,
      error: error.message
    };
  }
}

/**
 * Convert ArcGIS JSON format to GeoJSON format
 * @param {Object} arcgisJson - ArcGIS REST API response
 * @returns {Object} - GeoJSON FeatureCollection
 */
function convertArcGIStoGeoJSON(arcgisJson) {
  const features = (arcgisJson.features || []).map(arcgisFeature => {
    // Convert geometry
    const geometry = convertArcGISGeometry(
      arcgisFeature.geometry,
      arcgisJson.geometryType
    );

    return {
      type: 'Feature',
      properties: arcgisFeature.attributes || {},
      geometry: geometry
    };
  });

  return {
    type: 'FeatureCollection',
    features: features
  };
}

/**
 * Convert ArcGIS geometry to GeoJSON geometry
 * @param {Object} arcgisGeom - ArcGIS geometry object
 * @param {string} geometryType - ArcGIS geometry type
 * @returns {Object} - GeoJSON geometry
 */
function convertArcGISGeometry(arcgisGeom, geometryType) {
  if (!arcgisGeom) return null;

  switch (geometryType) {
    case 'esriGeometryPoint':
      return {
        type: 'Point',
        coordinates: [arcgisGeom.x, arcgisGeom.y]
      };

    case 'esriGeometryPolyline':
      // ArcGIS polylines can have multiple paths
      if (arcgisGeom.paths && arcgisGeom.paths.length === 1) {
        return {
          type: 'LineString',
          coordinates: arcgisGeom.paths[0]
        };
      } else if (arcgisGeom.paths && arcgisGeom.paths.length > 1) {
        return {
          type: 'MultiLineString',
          coordinates: arcgisGeom.paths
        };
      }
      return null;

    case 'esriGeometryPolygon':
      // ArcGIS polygons can have multiple rings
      if (arcgisGeom.rings && arcgisGeom.rings.length === 1) {
        return {
          type: 'Polygon',
          coordinates: arcgisGeom.rings
        };
      } else if (arcgisGeom.rings && arcgisGeom.rings.length > 1) {
        return {
          type: 'MultiPolygon',
          coordinates: [arcgisGeom.rings]
        };
      }
      return null;

    default:
      console.warn('Unknown geometry type:', geometryType);
      return null;
  }
}

// ============================================
// DATA LOADING
// ============================================

/**
 * Validate that field names declared in a dataset config exist in the actual GeoJSON data.
 * Checks the first feature's properties (representative sample).
 * @param {string} datasetKey - Key from DATASETS
 * @param {Object} config - Dataset config object
 * @param {Object} geojsonData - Loaded GeoJSON FeatureCollection
 * @returns {Array<string>} Warning messages for any missing fields
 */
function validateDatasetFields(datasetKey, config, geojsonData) {
  const warnings = [];
  if (!geojsonData || !geojsonData.features || geojsonData.features.length === 0) return warnings;
  const sampleProps = geojsonData.features[0].properties;
  if (!sampleProps) return warnings;

  const fieldNames = Object.keys(sampleProps);
  const label = config.name || datasetKey;

  const fieldsToCheck = [
    config.properties && config.properties.displayField,
    config.statusField,
    config.averageField,
    config.sumField,
    config.countByField,
    config.analysisFilter && config.analysisFilter.field,
    config.styleByProperty && config.styleByProperty.field,
    config.filterByThreshold && config.filterByThreshold.field,
    ...(config.properties && config.properties.additionalFields ? config.properties.additionalFields : [])
  ].filter(Boolean);

  fieldsToCheck.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(sampleProps, field)) {
      const suggestion = fieldNames.find(f => f.toLowerCase() === field.toLowerCase());
      const hint = suggestion
        ? ` Did you mean "${suggestion}"?`
        : ` Available fields: ${fieldNames.slice(0, 6).join(', ')}`;
      const msg = `${label}: Field "${field}" not found in data.${hint}`;
      console.warn(`[Field Warning] ${datasetKey}: field "${field}" not in first feature's properties.${hint}`);
      warnings.push(msg);
    }
  });

  return warnings;
}

/**
 * Dynamically load all enabled GeoJSON datasets from the DATASETS configuration
 * Fetches all dataset files and feature services in parallel for better performance
 * @returns {Promise<Object>} Object with {loaded: number, failed: Array<string>, fieldWarnings: Array<string>}
 */
async function loadGeoJsonData() {
  const failedDatasets = [];
  const fieldWarnings = [];
  let loadedCount = 0;

  try {
    // Build array of fetch promises for all enabled datasets
    const fetchPromises = [];
    const datasetKeys = [];

    Object.keys(DATASETS).forEach(datasetKey => {
      const config = DATASETS[datasetKey];

      // Only load enabled datasets that are NOT lazy-loaded
      if (config.enabled && !config.lazyLoad) {
        if (config.filePath) {
          // Regular GeoJSON file (add cache-busting query parameter for fresh loads)
          const filePathWithVersion = config.filePath + '?v=' + (window.CONFIG_APP?.branding?.version || '1.0');
          fetchPromises.push(fetchWithTimeout(filePathWithVersion, FETCH_TIMEOUT_GEOJSON));
          datasetKeys.push({ key: datasetKey, isFeatureService: false });
        } else if (config.featureServiceUrl) {
          // Feature service - needs to query for data
          // Note: Don't use bbox filter - feature services are stored in Web Mercator (EPSG:3857)
          // and bbox filtering with WGS84 coords fails. These services are already scoped to the MPO's geographic area.
          const maxRecords = config.maxRecords || DEFAULT_MAX_RECORDS;
          fetchPromises.push(queryFeatureService(config.featureServiceUrl, {
            maxRecords: maxRecords
          }));
          datasetKeys.push({ key: datasetKey, isFeatureService: true, maxRecords: maxRecords });
        }
      }
    });

    // Fetch all datasets in parallel; allSettled ensures one failure doesn't cancel others
    const settledResponses = await Promise.allSettled(fetchPromises);

    // Convert settled fetch results into data promises (null sentinel on failure)
    const dataPromises = settledResponses.map((settled, index) => {
      const datasetInfo = datasetKeys[index];
      const config = DATASETS[datasetInfo.key];

      if (settled.status === 'rejected') {
        // Network error, timeout (AbortError), or other fetch failure
        const reason = settled.reason;
        const errMsg = reason && reason.name === 'AbortError'
          ? `Request timed out after ${FETCH_TIMEOUT_GEOJSON / 1000}s`
          : (reason?.message || 'Network error');
        console.warn(`Failed to load ${config.name}: ${errMsg}`);
        failedDatasets.push({ name: config.name, error: errMsg });
        return Promise.resolve(null);
      }

      const response = settled.value;

      if (datasetInfo.isFeatureService) {
        // queryFeatureService() returns {success, data, error} — never rejects
        if (response.success) {
          const featureCount = response.data?.features?.length ?? 0;
          if (featureCount === 0) {
            const msg = `${config.name}: Feature Service returned 0 features — check the featureServiceUrl and verify the service has data.`;
            console.warn(`⚠ ${datasetInfo.key}:`, msg);
            fieldWarnings.push(msg);
          } else if (datasetInfo.maxRecords && featureCount >= datasetInfo.maxRecords) {
            const msg = `${config.name}: Only first ${datasetInfo.maxRecords} features loaded — results may be incomplete. Contact your GIS admin to increase the service's maxRecordCount.`;
            console.warn(`⚠ ${datasetInfo.key}:`, msg);
            fieldWarnings.push(msg);
          }
          return Promise.resolve(response.data);
        } else {
          const errMsg = response.error || 'Query failed';
          console.warn(`Failed to query ${config.name}: ${errMsg}`);
          failedDatasets.push({ name: config.name, error: errMsg });
          return Promise.resolve(null);
        }
      } else {
        // Regular HTTP fetch response
        if (!response.ok) {
          const errMsg = `HTTP ${response.status} ${response.statusText}`;
          console.warn(`Failed to load ${config.name}: ${errMsg}`);
          failedDatasets.push({ name: config.name, error: errMsg });
          return Promise.resolve(null);
        }
        return response.json().catch(e => {
          const errMsg = `JSON parse error: ${e.message}`;
          console.warn(`Failed to parse ${config.name}: ${errMsg}`);
          failedDatasets.push({ name: config.name, error: errMsg });
          return null;
        });
      }
    });

    const dataResults = await Promise.all(dataPromises);

    // Store loaded data and log results
    const loadedCounts = {};

    dataResults.forEach((data, index) => {
      const datasetInfo = datasetKeys[index];
      const datasetKey = datasetInfo.key;
      const config = DATASETS[datasetKey];

      if (data) {
        // Apply filters if specified
        if (config.filterByThreshold) {
          // Filter features by threshold (for analysis, not display)
          // Store original data with all features for map display
          const allFeatures = [...data.features];

          // Filter features that meet the threshold for analysis
          const filteredFeatures = data.features.filter(feature => {
            const value = feature.properties[config.filterByThreshold.field];
            if (config.filterByThreshold.operator === '>=') {
              return value >= config.filterByThreshold.value;
            } else if (config.filterByThreshold.operator === '<=') {
              return value <= config.filterByThreshold.value;
            } else if (config.filterByThreshold.operator === '>') {
              return value > config.filterByThreshold.value;
            } else if (config.filterByThreshold.operator === '<') {
              return value < config.filterByThreshold.value;
            }
            return true;
          });

          // Store both versions: all features for display, filtered for analysis
          geoJsonData[datasetKey + '_all'] = { ...data, features: allFeatures };
          data.features = filteredFeatures;
        }

        geoJsonData[datasetKey] = data;
        loadedCounts[datasetKey] = data.features ? data.features.length : 0;
        loadedCount++;
      } else {
        // Failure already recorded in failedDatasets during fetch/parse stage above
        geoJsonData[datasetKey] = null;
        loadedCounts[datasetKey] = 'failed';
      }
    });

    console.log('Data loaded:', loadedCounts);

    // Validate coordinate systems and field names for all loaded datasets
    Object.keys(DATASETS).forEach(datasetKey => {
      const config = DATASETS[datasetKey];
      if (config.enabled && geoJsonData[datasetKey]) {
        try {
          validateProjection(geoJsonData[datasetKey], config.name);
        } catch (projError) {
          // Projection validation failed - treat as load failure
          console.error(`Projection validation failed for ${config.name}:`, projError);
          geoJsonData[datasetKey] = null;
          failedDatasets.push({ name: config.name, error: projError.message });
          loadedCount--;
          return;
        }
        // Validate that config field names match actual data properties
        const fw = validateDatasetFields(datasetKey, config, geoJsonData[datasetKey]);
        fw.forEach(w => fieldWarnings.push(w));
      }
    });

    return {
      loaded: loadedCount,
      failed: failedDatasets,
      fieldWarnings: fieldWarnings
    };

  } catch (error) {
    console.error('Error loading GeoJSON data:', error);
    throw error;
  }
}

/**
 * Load lazy-load datasets (feature services) on demand
 * Called when user draws a project to query feature services with project bounds
 * @param {Object} drawnGeometry - GeoJSON geometry of drawn project
 * @returns {Promise<Array>} Array of {name, error} objects for any datasets that failed
 */
async function loadLazyDatasets(drawnGeometry) {
  const failures = [];

  try {
    const lazyDatasets = Object.keys(DATASETS).filter(key =>
      DATASETS[key].enabled && DATASETS[key].lazyLoad && DATASETS[key].featureServiceUrl
    );

    if (lazyDatasets.length === 0) {
      return failures;
    }

    console.log(`Loading ${lazyDatasets.length} lazy-load datasets...`);

    // Extract geometry from Feature if needed
    const geometry = drawnGeometry.type === 'Feature' ? drawnGeometry.geometry : drawnGeometry;

    // Create a buffer around the drawn geometry (use max proximityBuffer from all lazy datasets)
    const maxBuffer = Math.max(...lazyDatasets.map(key => DATASETS[key].proximityBuffer || 200));
    const buffered = turf.buffer(geometry, maxBuffer, { units: 'feet' });

    // Get the bounding box of the buffered geometry in WGS84
    const bbox = turf.bbox(buffered); // [minX, minY, maxX, maxY] in WGS84

    // Convert WGS84 bbox to Web Mercator (EPSG:3857) for feature service query
    const webMercatorBbox = convertWGS84BboxToWebMercator(bbox);

    console.log(`Query bbox (Web Mercator): [${webMercatorBbox.map(v => v.toFixed(2)).join(', ')}]`);

    // Query all feature services in parallel; allSettled keeps partial successes
    const queryPromises = lazyDatasets.map(datasetKey => {
      const config = DATASETS[datasetKey];
      const maxRecords = config.maxRecords || DEFAULT_MAX_RECORDS;
      return queryFeatureService(config.featureServiceUrl, {
        bbox: webMercatorBbox,
        maxRecords: maxRecords
      });
    });

    const settled = await Promise.allSettled(queryPromises);

    settled.forEach((result, index) => {
      const datasetKey = lazyDatasets[index];
      const config = DATASETS[datasetKey];
      const maxRecords = config.maxRecords || DEFAULT_MAX_RECORDS;

      if (result.status === 'rejected') {
        const errMsg = result.reason?.name === 'AbortError'
          ? `Request timed out after ${FETCH_TIMEOUT_FEATURE_SERVICE / 1000}s`
          : (result.reason?.message || 'Network error');
        console.warn(`Failed to load ${config.name}:`, errMsg);
        geoJsonData[datasetKey] = null;
        failures.push({ name: config.name, error: errMsg });
        return;
      }

      const queryResult = result.value;
      if (queryResult.success && queryResult.data) {
        const featureCount = queryResult.data.features?.length ?? 0;
        if (featureCount === 0) {
          showWarning(`${config.name}: Feature Service returned 0 features — check the featureServiceUrl and verify the service has data.`);
        } else if (featureCount >= maxRecords) {
          showWarning(`${config.name}: Only first ${maxRecords} features loaded — results may be incomplete. Contact your GIS admin to increase the service's maxRecordCount.`);
        }
        geoJsonData[datasetKey] = queryResult.data;
        // Validate field names now that data is available (init() has already completed,
        // so show warnings directly rather than pushing to startupWarnings)
        const fieldWarnings = validateDatasetFields(datasetKey, config, queryResult.data);
        fieldWarnings.forEach(w => showWarning(w));
        console.log(`✓ ${config.name}: ${featureCount} features loaded`);
      } else {
        const errMsg = queryResult.error || 'Feature Service unavailable';
        console.warn(`Failed to load ${config.name}:`, errMsg);
        geoJsonData[datasetKey] = null;
        failures.push({ name: config.name, error: errMsg });
      }
    });

  } catch (error) {
    console.error('Error loading lazy datasets:', error);
    // Return whatever partial failures were collected
  }

  return failures;
}

/**
 * Convert WGS84 bounding box to Web Mercator (EPSG:3857)
 * @param {Array} bbox - [minX, minY, maxX, maxY] in WGS84 (longitude, latitude)
 * @returns {Array} [minX, minY, maxX, maxY] in Web Mercator
 */
function convertWGS84BboxToWebMercator(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  // Web Mercator transformation formulas
  const earthRadius = 6378137; // Earth radius in meters

  const minX = earthRadius * minLon * Math.PI / 180;
  const maxX = earthRadius * maxLon * Math.PI / 180;

  const minY = earthRadius * Math.log(Math.tan(Math.PI / 4 + minLat * Math.PI / 360));
  const maxY = earthRadius * Math.log(Math.tan(Math.PI / 4 + maxLat * Math.PI / 360));

  return [minX, minY, maxX, maxY];
}

/**
 * Validate that GeoJSON data is in WGS84 (EPSG:4326) coordinate system
 * Throws error if coordinates appear to be in projected CRS
 * @param {Object} data - GeoJSON FeatureCollection
 * @param {string} datasetName - Name of dataset for error messages
 */
function validateProjection(data, datasetName) {
  if (!data.features || data.features.length === 0) {
    console.log(`⚠ ${datasetName}: No features to validate`);
    return true;
  }

  const firstFeature = data.features[0];
  let coords;

  // Extract first coordinate based on geometry type
  if (firstFeature.geometry.type === 'Point') {
    coords = firstFeature.geometry.coordinates;
  } else if (firstFeature.geometry.type === 'LineString') {
    coords = firstFeature.geometry.coordinates[0];
  } else if (firstFeature.geometry.type === 'MultiLineString') {
    coords = firstFeature.geometry.coordinates[0][0];
  } else if (firstFeature.geometry.type === 'Polygon') {
    coords = firstFeature.geometry.coordinates[0][0];
  } else if (firstFeature.geometry.type === 'MultiPolygon') {
    coords = firstFeature.geometry.coordinates[0][0][0];
  } else if (firstFeature.geometry.type === 'MultiPoint') {
    coords = firstFeature.geometry.coordinates[0];
  }

  if (!coords || coords.length < 2) {
    console.warn(`⚠ ${datasetName}: Could not extract coordinates for validation`);
    return true;
  }

  const [lng, lat] = coords;

  // Get validation bounds from configuration or use defaults
  const bounds = window.CONFIG_APP.geography.validationBounds;

  const isValidWGS84 = (
    lng >= bounds.minLng && lng <= bounds.maxLng &&
    lat >= bounds.minLat && lat <= bounds.maxLat
  );

  if (!isValidWGS84) {
    const orgName = window.CONFIG_APP?.organization?.name || 'MPO';
    console.error(`❌ PROJECTION ERROR in ${datasetName}!`);
    console.error(`Found coordinates: [${lng}, ${lat}]`);
    console.error(`Expected ${orgName} area bounds:`, bounds);
    console.error(`Data appears to be in projected CRS, not WGS84!`);

    throw new Error(
      `"${datasetName}" is using the wrong coordinate system.\n\n` +
      `The tool expected geographic coordinates (latitude/longitude) within the ${orgName} area ` +
      `(lng ${bounds.minLng} to ${bounds.maxLng}, lat ${bounds.minLat} to ${bounds.maxLat}), ` +
      `but found [${lng.toFixed(1)}, ${lat.toFixed(1)}].\n\n` +
      `This usually means the data is in a projected coordinate system (like State Plane) instead of WGS84.\n\n` +
      `How to fix:\n` +
      `  ArcGIS Pro: Right-click layer > Export Features > set Output Coordinate System to GCS_WGS_1984\n` +
      `  QGIS: Right-click layer > Export > Save Features As > set CRS to EPSG:4326`
    );
  }

  console.log(`✓ ${datasetName} projection validated (WGS84): [${lng.toFixed(3)}, ${lat.toFixed(3)}]`);
  return true;
}

// ============================================
// EVENT HANDLERS
// ============================================

/**
 * Handle completion of drawing a project alignment or location
 * Validates geometry and triggers spatial analysis
 * @param {Object} event - Leaflet draw event
 * @param {L.FeatureGroup} drawnItems - Feature group containing drawn items
 */
async function onDrawCreated(event, drawnItems) {
  const layer = event.layer;

  // Remove any previous drawing
  if (drawnLayer) {
    map.removeLayer(drawnLayer);
    drawnItems.clearLayers();
  }

  // Add new drawing to map
  drawnLayer = layer;
  drawnItems.addLayer(layer);

  // Convert to GeoJSON for analysis
  drawnGeometry = layer.toGeoJSON();

  // Validate geometry
  if (!validateGeometry(drawnGeometry)) {
    const geomType = drawnGeometry.geometry.type;
    if (geomType === 'LineString') {
      showError(`Project alignment must be at least ${CONFIG.minLineLength} feet long.`);
    } else {
      showError('Invalid geometry drawn. Please try again.');
    }
    map.removeLayer(drawnLayer);
    drawnLayer = null;
    drawnGeometry = null;
    return;
  }

  // Show loading overlay while querying feature services
  showLoading(true, 'Loading feature service datasets...');

  try {
    // Load lazy-load datasets (feature services) before analysis
    const lazyFailures = await loadLazyDatasets(drawnGeometry);

    // Hide loading overlay
    showLoading(false);

    // Warn user about any feature services that failed to load
    lazyFailures.forEach(failure => {
      showWarning(`${failure.name}: Feature Service unavailable — ${failure.error}. Results for this dataset may be incomplete.`);
    });

    // Run spatial analysis on all datasets
    const results = analyzeAllDatasets(drawnGeometry);

    // Display results in sidebar
    displayResults(results);

    // Show project name/PDF section
    document.getElementById('projectNameSection').classList.add('visible');

    // Disable draw buttons after project is drawn
    setDrawButtonsEnabled(false);

    // Focus project name input
    document.getElementById('projectName').focus();

  } catch (error) {
    showLoading(false);
    console.error('Error during analysis:', error);
    showError('Failed to complete analysis. Please try again.');
  }
}

/**
 * Handle clear button click
 * Removes drawn feature and resets results
 */
function onClearClicked() {
  // Remove drawn layer from map
  if (drawnLayer) {
    map.removeLayer(drawnLayer);
    drawnLayer = null;
    drawnGeometry = null;
  }

  // Clear lazy-loaded datasets from memory
  Object.keys(DATASETS).forEach(datasetKey => {
    const config = DATASETS[datasetKey];
    if (config.lazyLoad && geoJsonData[datasetKey]) {
      geoJsonData[datasetKey] = null;
      console.log(`Cleared lazy-loaded data: ${config.name}`);
    }
  });

  // Clear results
  clearResults();

  // Hide project name/PDF section
  document.getElementById('projectNameSection').classList.remove('visible');

  // Re-enable draw buttons
  setDrawButtonsEnabled(true);
}

/**
 * Handle PDF button click
 * Generates and downloads PDF report
 */
async function onPDFButtonClicked() {
  await generatePDF();
}

/**
 * Handle project name input
 * Enables/disables PDF button based on input
 */
function onProjectNameInput() {
  const projectName = document.getElementById('projectName').value.trim();
  const pdfButton = document.getElementById('pdfButton');

  // Enable PDF button only if project name is entered and we have results
  pdfButton.disabled = !projectName || !drawnGeometry;
}

/**
 * Handle draw line button click
 * Triggers polyline drawing mode
 */
function onDrawLineButtonClicked() {
  // Disable marker drawing if active
  if (markerDrawer._enabled) {
    markerDrawer.disable();
  }

  // Disable measurement tool if active
  if (isMeasuring) {
    toggleMeasurementTool();
  }

  // Toggle polyline drawing
  if (polylineDrawer._enabled) {
    polylineDrawer.disable();
  } else {
    polylineDrawer.enable();
  }
}

/**
 * Handle draw point button click
 * Triggers marker drawing mode
 */
function onDrawPointButtonClicked() {
  // Disable polyline drawing if active
  if (polylineDrawer._enabled) {
    polylineDrawer.disable();
  }

  // Disable measurement tool if active
  if (isMeasuring) {
    toggleMeasurementTool();
  }

  // Toggle marker drawing
  if (markerDrawer._enabled) {
    markerDrawer.disable();
  } else {
    markerDrawer.enable();
  }
}

/**
 * Update visual state of draw buttons
 * @param {boolean} isDrawing - Whether drawing is active
 */
function updateDrawButtonStates(isDrawing) {
  const lineButton = document.getElementById('drawLineButton');
  const pointButton = document.getElementById('drawPointButton');

  if (isDrawing) {
    if (polylineDrawer._enabled) {
      lineButton.classList.add('active');
      pointButton.classList.remove('active');
    } else if (markerDrawer._enabled) {
      pointButton.classList.add('active');
      lineButton.classList.remove('active');
    }
  } else {
    lineButton.classList.remove('active');
    pointButton.classList.remove('active');
  }
}

/**
 * Enable or disable draw buttons
 * @param {boolean} enabled - Whether buttons should be enabled
 */
function setDrawButtonsEnabled(enabled) {
  const lineButton = document.getElementById('drawLineButton');
  const pointButton = document.getElementById('drawPointButton');

  lineButton.disabled = !enabled;
  pointButton.disabled = !enabled;

  if (!enabled) {
    lineButton.style.opacity = '0.5';
    pointButton.style.opacity = '0.5';
    lineButton.style.cursor = 'not-allowed';
    pointButton.style.cursor = 'not-allowed';
  } else {
    lineButton.style.opacity = '1';
    pointButton.style.opacity = '1';
    lineButton.style.cursor = 'pointer';
    pointButton.style.cursor = 'pointer';
  }
}

/**
 * Set up all event listeners for the application
 */
function setupEventListeners() {
  document.getElementById('clearButton').addEventListener('click', onClearClicked);
  document.getElementById('pdfButton').addEventListener('click', onPDFButtonClicked);
  document.getElementById('projectName').addEventListener('input', onProjectNameInput);
  document.getElementById('drawLineButton').addEventListener('click', onDrawLineButtonClicked);
  document.getElementById('drawPointButton').addEventListener('click', onDrawPointButtonClicked);
  document.getElementById('zoomExtentButton').addEventListener('click', fitMapToBounds);
  document.getElementById('tutorialCloseButton').addEventListener('click', closeTutorial);
  document.getElementById('tutorialOverlay').addEventListener('click', closeTutorial);
}

// ============================================
// RESULTS DISPLAY
// ============================================

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for HTML insertion
 */
function escapeHtml(text) {
  return AppUtils.escapeHtml(text);
}

/**
 * Validate a CSS color value (hex, named, rgb/rgba)
 * Used to prevent CSS injection via config-sourced color values
 * @param {string} color - Color string to validate
 * @returns {boolean} True if color appears safe for CSS interpolation
 */
function isValidColor(color) {
  if (typeof color !== 'string') return false;
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\))$/.test(color);
}

/**
 * Create HTML for a single results card
 * @param {Object} datasetConfig - Configuration from DATASETS
 * @param {Array} results - Analysis results for this dataset
 * @returns {string} HTML string for the results card
 */
function createResultCard(datasetConfig, results) {
  // Feature service datasets (wetlands, flood zones) have display issues in sidebar
  // Show simplified message instead (except for area results which we want to display)
  if (datasetConfig.lazyLoad && datasetConfig.resultStyle !== RESULT_STYLES.AREA) {
    let cardHtml = `<div class="results-card" data-dataset="${escapeHtml(datasetConfig.id)}">`;
    cardHtml += `<div class="section-heading">`;
    cardHtml += `${escapeHtml(datasetConfig.name)}`;

    // Add info icon with tooltip if description is available
    if (datasetConfig.description) {
      cardHtml += `<span class="info-icon">`;
      cardHtml += `<span class="info-icon-circle">i</span>`;
      cardHtml += `<span class="info-tooltip">${escapeHtml(datasetConfig.description)}</span>`;
      cardHtml += `</span>`;
    }

    cardHtml += `</div>`;
    cardHtml += `<p style="padding: 10px; background-color: #F5F5F5; border-left: 4px solid #0066CC; margin-top: 10px; font-size: 14px;">
      See full PDF Report for results
    </p>`;
    cardHtml += `</div>`;
    return cardHtml;
  }

  // Handle count results differently (object with total and breakdown)
  const isCountResult = datasetConfig.resultStyle === RESULT_STYLES.COUNT && typeof results === 'object' && 'total' in results;
  const isLengthByStatusResult = datasetConfig.resultStyle === RESULT_STYLES.LENGTH_BY_STATUS && typeof results === 'object' && 'total' in results;
  const isPercentageResult = datasetConfig.resultStyle === RESULT_STYLES.PERCENTAGE && typeof results === 'object' && 'percentage' in results;
  const isAreaResult = datasetConfig.resultStyle === RESULT_STYLES.AREA && typeof results === 'object' && 'totalArea' in results;
  const isSumResult = datasetConfig.resultStyle === RESULT_STYLES.SUM && typeof results === 'object' && 'sum' in results;
  const isNearestResult = datasetConfig.resultStyle === RESULT_STYLES.NEAREST && Array.isArray(results);
  const isAverageValueResult = datasetConfig.resultStyle === RESULT_STYLES.AVERAGE_VALUE && typeof results === 'object' && 'avg' in results;

  // For lengthByStatus, use features.length as count; for count results use total; for percentage/area/sum results use features.length; for nearest use array length; otherwise use array length
  const count = isLengthByStatusResult ? (results.features ? results.features.length : 0) :
                isPercentageResult ? (results.features ? results.features.length : 0) :
                isAreaResult ? (results.features ? results.features.length : 0) :
                isSumResult ? (results.features ? results.features.length : 0) :
                isNearestResult ? results.length :
                isAverageValueResult ? results.count :
                (isCountResult ? results.total : results.length);
  const hasResults = count > 0;

  let cardHtml = `<div class="results-card" data-dataset="${escapeHtml(datasetConfig.id)}">`;
  cardHtml += `<div class="section-heading">`;
  cardHtml += `${escapeHtml(datasetConfig.name)} `;
  cardHtml += `<span class="result-count">${escapeHtml(count)}</span>`;

  // Add info icon with tooltip if description is available
  if (datasetConfig.description) {
    cardHtml += `<span class="info-icon">`;
    cardHtml += `<span class="info-icon-circle">i</span>`;
    cardHtml += `<span class="info-tooltip">${escapeHtml(datasetConfig.description)}</span>`;
    cardHtml += `</span>`;
  }

  cardHtml += `</div>`;

  if (!hasResults) {
    cardHtml += `<p class="empty-state">No ${escapeHtml(datasetConfig.name.toLowerCase())} found</p>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.LENGTH_BY_STATUS) {
    // Length by status format — show percentages by category and optional weighted average
    cardHtml += `<div class="result-card-body">`;

    // Show weighted average of averageField if available
    if (results.avg !== null && results.avg !== undefined && datasetConfig.averageField) {
      const avgLabel = `Avg. ${getFieldLabel(datasetConfig.averageField, datasetConfig.properties.fieldLabels)}`;
      cardHtml += `<p style="margin: 0 0 10px 0; font-size: 14px;">${escapeHtml(avgLabel)}: ${escapeHtml(results.avg.toFixed(2))}</p>`;
    }

    if (results.breakdown && Object.keys(results.breakdown).length > 0) {
      cardHtml += `<ul class="results-list" style="margin: 0; padding-left: 20px;">`;

      // Sort breakdown by percentage descending
      const sortedBreakdown = Object.entries(results.breakdown).sort((a, b) => b[1] - a[1]);

      sortedBreakdown.forEach(([status, percentage]) => {
        cardHtml += `<li>${escapeHtml(status)}: ${escapeHtml(percentage.toFixed(1))}%</li>`;
      });

      cardHtml += `</ul>`;
    }

    cardHtml += `</div>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.PERCENTAGE) {
    // Percentage format (for project coverage analysis)
    cardHtml += `<div class="result-card-body">`;
    cardHtml += `<p style="margin: 0; font-size: 14px;">${escapeHtml(results.percentage)}% of project</p>`;
    cardHtml += `</div>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.COUNT) {
    // Count format (for datasets that count features by category)
    cardHtml += `<div class="result-card-body">`;
    const countLabelText = datasetConfig.countLabel
      ? `Total ${escapeHtml(datasetConfig.countLabel)}: ${escapeHtml(results.total)}`
      : `Total: ${escapeHtml(results.total)}`;
    cardHtml += `<p style="margin: 0 0 10px 0; font-size: 14px;">${countLabelText}</p>`;

    if (results.breakdown && Object.keys(results.breakdown).length > 0) {
      cardHtml += `<ul class="results-list" style="margin: 0; padding-left: 20px;">`;

      // Sort breakdown by count (descending)
      const sortedBreakdown = Object.entries(results.breakdown).sort((a, b) => b[1] - a[1]);

      sortedBreakdown.forEach(([category, categoryCount]) => {
        cardHtml += `<li>${escapeHtml(category)}: ${escapeHtml(categoryCount)}</li>`;
      });

      cardHtml += `</ul>`;
    }

    cardHtml += `</div>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.AREA) {
    // Area format (for area impact analysis - show only total)
    cardHtml += `<div class="result-card-body">`;
    const areaUnit = datasetConfig.resultUnit || 'acres';
    const areaDesc = datasetConfig.areaLabel ? ` of ${datasetConfig.areaLabel}` : '';
    cardHtml += `<p style="margin: 0; font-size: 14px;">Total: ${escapeHtml(results.totalArea.toFixed(2))} ${escapeHtml(areaUnit)}${escapeHtml(areaDesc)}</p>`;
    cardHtml += `</div>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.SUM) {
    // Sum format (for summing numeric values from nearby features)
    cardHtml += `<div class="result-card-body">`;
    // Determine if we should show integer or decimal places
    const displayValue = Number.isInteger(results.sum) ? results.sum : results.sum.toFixed(2);
    let sumLabel;
    if (datasetConfig.sumUnit) {
      sumLabel = `Total: ${escapeHtml(String(displayValue))} ${escapeHtml(datasetConfig.sumUnit)}`;
    } else if (datasetConfig.sumField) {
      sumLabel = `Total ${escapeHtml(getFieldLabel(datasetConfig.sumField, datasetConfig.properties.fieldLabels))}: ${escapeHtml(String(displayValue))}`;
    } else {
      sumLabel = `Total: ${escapeHtml(String(displayValue))}`;
    }
    cardHtml += `<p style="margin: 0; font-size: 14px;">${sumLabel}</p>`;
    cardHtml += `</div>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.AVERAGE_VALUE) {
    // Average value format — shows length-weighted average with optional color-coded tier badge
    // Tier label and color come from displayThresholds in datasets.yaml (first threshold where avg < max wins)
    let tierLabel = null;
    let tierColor = '#888888';
    if (datasetConfig.displayThresholds && results.avg !== null) {
      for (const threshold of datasetConfig.displayThresholds) {
        if (threshold.max == null || results.avg < threshold.max) {
          tierLabel = threshold.label;
          tierColor = isValidColor(threshold.color) ? threshold.color : '#888888';
          break;
        }
      }
    }
    const fieldLabel = datasetConfig.averageField ? `Avg. ${escapeHtml(getFieldLabel(datasetConfig.averageField, datasetConfig.properties.fieldLabels))}` : 'Average';
    cardHtml += `<div class="result-card-body">`;
    cardHtml += `<p style="margin: 0 0 6px 0; font-size: 18px; font-weight: bold;">${fieldLabel}: ${escapeHtml(results.avg.toFixed(2))}</p>`;
    if (tierLabel) {
      cardHtml += `<span style="display:inline-block; background-color:${escapeHtml(tierColor)}; color:white; font-size:12px; font-weight:bold; padding:2px 8px; border-radius:3px;">${escapeHtml(tierLabel)}</span>`;
    }
    cardHtml += `<p style="margin: 8px 0 0 0; font-size: 12px; color: #666;">Based on ${escapeHtml(results.count)} parallel segments</p>`;
    cardHtml += `</div>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.NEAREST) {
    // Nearest features format (for findNearestFeatures analysis)
    cardHtml += `<ul class="results-list">`;
    results.forEach(result => {
      const props = result.feature.properties || result.feature;
      const displayName = props._displayName || props[datasetConfig.properties.displayField] || 'Unknown';
      const distanceFormatted = Number.isInteger(result.distance)
        ? result.distance.toLocaleString()
        : result.distance.toFixed(2);
      const distUnit = datasetConfig.resultUnit || 'ft';
      cardHtml += `<li>${escapeHtml(displayName)} - ${escapeHtml(String(distanceFormatted))} ${escapeHtml(distUnit)}</li>`;
    });
    cardHtml += `</ul>`;
  } else if (datasetConfig.resultStyle === RESULT_STYLES.TABLE && datasetConfig.properties.additionalFields.length > 0) {
    // Table format (for datasets with additional fields like bridges)
    cardHtml += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; background-color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">`;
    cardHtml += `<thead><tr>`;
    cardHtml += `<th style="background-color: #E6F2FF; padding: 10px; text-align: left; font-weight: bold; border: 1px solid #CCCCCC; font-size: 12px;">${escapeHtml(getFieldLabel(datasetConfig.properties.displayField, datasetConfig.properties.fieldLabels))}</th>`;

    datasetConfig.properties.additionalFields.forEach(field => {
      cardHtml += `<th style="background-color: #E6F2FF; padding: 10px; text-align: left; font-weight: bold; border: 1px solid #CCCCCC; font-size: 12px;">${escapeHtml(getFieldLabel(field, datasetConfig.properties.fieldLabels))}</th>`;
    });

    cardHtml += `</tr></thead><tbody>`;

    results.forEach((result, index) => {
      const bgColor = index % 2 === 0 ? 'white' : '#F9F9F9';
      cardHtml += `<tr style="background-color: ${bgColor};">`;

      // Access properties from Feature or flat object
      const props = result.properties || result;
      cardHtml += `<td style="padding: 8px 10px; border: 1px solid #CCCCCC; font-size: 12px;">${escapeHtml(props[datasetConfig.properties.displayField])}</td>`;

      datasetConfig.properties.additionalFields.forEach(field => {
        cardHtml += `<td style="padding: 8px 10px; border: 1px solid #CCCCCC; font-size: 12px;">${escapeHtml(props[field])}</td>`;
      });

      cardHtml += `</tr>`;
    });

    cardHtml += `</tbody></table>`;
  } else {
    // List format (default)
    cardHtml += `<ul class="results-list">`;

    results.forEach(result => {
      let displayText;
      if (typeof result === 'string') {
        displayText = result;
      } else if (typeof result === 'object') {
        // Access properties from Feature or flat object
        const props = result.properties || result;
        displayText = props._displayName || props[datasetConfig.properties.displayField] || 'Unknown';

        // Add additional fields if present
        if (datasetConfig.properties.additionalFields.length > 0) {
          datasetConfig.properties.additionalFields.forEach(field => {
            let value = props[field];

            // Format as percentage if specified
            if (datasetConfig.properties.formatPercentage === field && value !== undefined && value !== 'Unknown') {
              value = `${(value * 100).toFixed(1)}%`;
            }

            const fieldLabel = getFieldLabel(field, datasetConfig.properties.fieldLabels);
            displayText += ` | ${fieldLabel}: ${value}`;
          });
        }
      } else {
        displayText = String(result);
      }

      cardHtml += `<li>${escapeHtml(displayText)}</li>`;
    });

    cardHtml += `</ul>`;
  }

  cardHtml += `</div>`;

  return cardHtml;
}

/**
 * Display analysis results in the sidebar
 * Dynamically creates result cards for all datasets with results
 * @param {Object} results - Analysis results keyed by dataset ID
 */
function displayResults(results) {
  // Get results container
  const resultsContainer = document.getElementById('resultsContainer');

  // Clear existing results
  resultsContainer.innerHTML = '';

  // Group datasets by category
  const configuredOrder = window.CONFIG_APP?.categoryOrder || DEFAULT_CATEGORY_ORDER;
  const datasetsByCategory = {};

  Object.keys(DATASETS).forEach(datasetKey => {
    const config = DATASETS[datasetKey];
    const datasetResults = results[datasetKey];

    // Skip disabled datasets
    if (!config.enabled) {
      return;
    }

    // Skip datasets that don't exist in results (not analyzed) or are explicitly undefined/null
    if (datasetResults === undefined || datasetResults === null) {
      return;
    }

    // Determine if results are empty based on result type
    let isEmpty = true; // Default to empty

    if (config.resultStyle === RESULT_STYLES.BINARY && typeof datasetResults === 'object' && 'detected' in datasetResults) {
      isEmpty = !datasetResults.detected;
    } else if (config.resultStyle === RESULT_STYLES.PERCENTAGE && typeof datasetResults === 'object' && 'percentage' in datasetResults) {
      isEmpty = datasetResults.percentage === 0;
    } else if (config.resultStyle === RESULT_STYLES.AREA && typeof datasetResults === 'object' && 'totalArea' in datasetResults) {
      isEmpty = datasetResults.totalArea === 0;
    } else if (config.resultStyle === RESULT_STYLES.SUM && typeof datasetResults === 'object' && 'sum' in datasetResults) {
      isEmpty = datasetResults.sum === 0;
    } else if (config.resultStyle === RESULT_STYLES.NEAREST && Array.isArray(datasetResults)) {
      isEmpty = datasetResults.length === 0;
    } else if (config.resultStyle === RESULT_STYLES.LENGTH_BY_STATUS && typeof datasetResults === 'object' && 'total' in datasetResults) {
      isEmpty = datasetResults.total === 0;
    } else if (config.resultStyle === RESULT_STYLES.AVERAGE_VALUE && typeof datasetResults === 'object' && 'avg' in datasetResults) {
      isEmpty = datasetResults.avg === null || datasetResults.count === 0;
    } else if (typeof datasetResults === 'object' && 'total' in datasetResults) {
      isEmpty = datasetResults.total === 0;
    } else if (Array.isArray(datasetResults)) {
      isEmpty = datasetResults.length === 0;
    } else {
      // Unknown result type - skip it
      return;
    }

    // Skip datasets with no results
    if (isEmpty) {
      return;
    }

    const category = config.category || 'Other';
    if (!datasetsByCategory[category]) {
      datasetsByCategory[category] = [];
    }
    datasetsByCategory[category].push({ key: datasetKey, config });
  });

  // Build full category order: configured order + any extra categories found in datasets
  const categoryOrder = [...configuredOrder];
  Object.keys(datasetsByCategory).forEach(cat => {
    if (!categoryOrder.includes(cat)) {
      categoryOrder.push(cat);
    }
  });

  // Display results by category — accumulate HTML string, then assign once
  // (avoids repeated innerHTML += which re-parses the entire DOM on each iteration)
  let html = '';
  categoryOrder.forEach(category => {
    if (!datasetsByCategory[category]) return;

    // Add category header
    html += `
      <div style="font-weight: bold; font-size: 16px; color: #333; margin-top: 20px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #0066CC;">
        ${escapeHtml(category)}
      </div>
    `;

    // Add dataset cards for this category
    datasetsByCategory[category].forEach(({ key, config }) => {
      // Get results for this dataset
      const datasetResults = results[key] || [];

      // Create and append result card
      html += createResultCard(config, datasetResults);
    });
  });
  if (!html) {
    const msg = window.CONFIG_APP?.branding?.noResultsMessage
      || 'No datasets were intersected by this project. Verify the project location and try again.';
    html = `
      <div style="padding: 20px; text-align: center; color: #666;">
        <p style="font-size: 15px; margin: 0; color: #555;">${escapeHtml(msg)}</p>
      </div>
    `;
  }
  resultsContainer.innerHTML = html;

  // Enable PDF button if project name is entered
  onProjectNameInput();
}

/**
 * Clear all results from the sidebar
 * Resets to initial empty state
 */
function clearResults() {
  // Get results container
  const resultsContainer = document.getElementById('resultsContainer');

  // Display placeholder message
  resultsContainer.innerHTML = `
    <div style="padding: 20px; text-align: center; color: #666;">
      <p style="font-size: 16px; margin: 0;">Draw a project to see analysis results</p>
      <p style="font-size: 13px; margin-top: 10px; color: #999;">Click "Draw Alignment" or "Mark Location" above to get started</p>
    </div>
  `;

  // Clear project name
  document.getElementById('projectName').value = '';

  // Disable PDF button
  document.getElementById('pdfButton').disabled = true;

  // Clear stored results
  Object.keys(currentResults).forEach(key => delete currentResults[key]);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Create a dismissible banner at the top of the sidebar.
 * @param {string} message - Message to display
 * @param {object} options - Styling options
 * @returns {boolean} True if the banner was rendered in the sidebar
 */
function showSidebarBanner(message, options) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return false;

  const banner = document.createElement('div');
  banner.style.cssText = [
    `background-color:${options.backgroundColor}`,
    `color:${options.textColor}`,
    `border:1px solid ${options.borderColor}`,
    'border-radius:4px',
    'padding:10px 30px 10px 10px',
    'margin-bottom:15px',
    'font-size:13px',
    'position:relative',
    'line-height:1.4',
    'white-space:pre-line'
  ].join(';') + ';';
  banner.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '\u00d7';
  closeBtn.setAttribute('aria-label', options.closeLabel);
  closeBtn.style.cssText = `position:absolute;top:4px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:${options.textColor};padding:0;line-height:1;`;
  closeBtn.addEventListener('click', () => banner.remove());
  banner.appendChild(closeBtn);

  sidebar.prepend(banner);
  return true;
}

/**
 * Show a dismissible warning banner at the top of the sidebar
 * @param {string} message - Warning message to display
 */
function showWarning(message) {
  showSidebarBanner(message, {
    backgroundColor: '#FFF3CD',
    textColor: '#856404',
    borderColor: '#FFEEBA',
    closeLabel: 'Dismiss warning'
  });
}

/**
 * Show user-friendly error message
 * @param {string} message - Error message to display
 */
function showError(message) {
  const renderedInSidebar = showSidebarBanner(message, {
    backgroundColor: '#F8D7DA',
    textColor: '#721C24',
    borderColor: '#F5C6CB',
    closeLabel: 'Dismiss error'
  });

  if (!renderedInSidebar) {
    AppUtils.showError(message);
  }
}

/**
 * Show or hide loading overlay
 * @param {boolean} show - Whether to show or hide the overlay
 * @param {string} message - Optional loading message
 */
function showLoading(show, message = 'Loading...') {
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');

  if (show) {
    loadingText.textContent = message;
    overlay.style.display = 'flex';
  } else {
    overlay.style.display = 'none';
  }
}

// ============================================
// INITIALIZE APPLICATION
// ============================================

window.onerror = function(message, source, lineno, colno, error) {
  if (error && error.__userNotified) {
    return false;
  }

  console.error('Unhandled error:', { message, source, lineno, colno, error });
  showError('An unexpected error occurred. Please refresh the page and try again. Check the browser console for details.');
  return false;
};

window.onunhandledrejection = function(event) {
  const reason = event.reason;
  if (reason && reason.__userNotified) {
    return;
  }

  console.error('Unhandled promise rejection:', reason);
  showError('An unexpected error occurred. Please refresh the page and try again. Check the browser console for details.');
};

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', init);
