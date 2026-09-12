/**
 * datasets.js
 * Configuration and dataset definitions for MPO Project Application Tool
 *
 * This file must load after config.js and before other application scripts
 * Dependencies: js-yaml (loaded from CDN), config.js
 */

// ============================================
// APPLICATION CONFIGURATION
// ============================================
const CONFIG = {
  // Minimum project length in feet — projects shorter than this should use
  // the point marker tool instead. Applies only to line-drawn projects.
  minLineLength: 100,

  // Map configuration
  basemapUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  basemapAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Drawn geometry style - read from config.yaml or use defaults
  drawnLineStyle: window.CONFIG_APP?.mapStyling?.drawnLine || {
    color: '#FF0000',
    weight: 12,
    opacity: 0.9
  },

  // Logo path (will be set from CONFIG_APP after loading)
  logoPath: null
};

// ============================================
// RESULT STYLE CONSTANTS
// ============================================
const RESULT_STYLES = {
  LIST:            'list',
  COUNT:           'count',
  BINARY:          'binary',
  LENGTH_BY_STATUS:'lengthByStatus',
  AREA:            'area',
  PERCENTAGE:      'percentage',
  SUM:             'sum',
  NEAREST:         'nearest',
  AVERAGE_VALUE:   'averageValue',
  TABLE:           'table',
};

// ============================================
// FIELD LABEL HELPER
// ============================================

/**
 * Return the human-readable label for a field name, or the raw field name as fallback.
 * @param {string} fieldName - Raw property field name (e.g. 'CRASH_TYPE')
 * @param {Object} fieldLabels - The fieldLabels map from dataset config
 * @returns {string}
 */
function getFieldLabel(fieldName, fieldLabels) {
  return fieldLabels[fieldName] || fieldName;
}

// ============================================
// DATASET CONFIGURATION (Loaded from YAML)
// ============================================
/**
 * Configuration object for all datasets in the application
 * Loaded dynamically from datasets.yaml
 * Each dataset defines its file path, geometry type, analysis method,
 * display properties, and styling options
 */
let DATASETS = {};

// ============================================
// YAML DATASET LOADER
// ============================================
/**
 * Loads dataset configuration from datasets.yaml file
 * Populates the DATASETS object with parsed YAML data
 * @returns {Promise<void>} Resolves when datasets are loaded
 */
async function loadDatasets() {
  try {
    console.log('Loading datasets from YAML...');
    const response = await fetch('./datasets.yaml');

    if (!response.ok) {
      console.error(`Failed to fetch datasets.yaml: ${response.status} ${response.statusText}`);
      console.error('Fetch URL was:', response.url);
      throw new Error(`Failed to load datasets.yaml: ${response.statusText}`);
    }

    const yamlText = await response.text();
    console.log(`Received YAML (${yamlText.length} characters)`);

    const parsedDatasets = jsyaml.load(yamlText);

    // Populate DATASETS object with parsed YAML data
    Object.assign(DATASETS, parsedDatasets);

    // Inject id from the YAML key so datasets never need an explicit id: field
    // and normalize optional properties so consumers never hit undefined
    Object.entries(DATASETS).forEach(([key, dataset]) => {
      if (dataset && typeof dataset === 'object') {
        dataset.id = key;
        // Ensure properties block exists so downstream code never hits null
        if (!dataset.properties) {
          dataset.properties = {};
        }
        dataset.properties.additionalFields = dataset.properties.additionalFields || [];
        dataset.properties.fieldLabels = dataset.properties.fieldLabels || {};
      }
    });

    // Update CONFIG with logo path from CONFIG_APP if available
    if (window.CONFIG_APP && window.CONFIG_APP.branding && window.CONFIG_APP.branding.logoPath) {
      CONFIG.logoPath = window.CONFIG_APP.branding.logoPath;
    }

    // Update CONFIG with basemap settings from CONFIG_APP if available
    if (window.CONFIG_APP?.mapStyling?.basemapUrl) {
      CONFIG.basemapUrl = window.CONFIG_APP.mapStyling.basemapUrl;
    }
    if (window.CONFIG_APP?.mapStyling?.basemapAttribution) {
      CONFIG.basemapAttribution = window.CONFIG_APP.mapStyling.basemapAttribution;
    }

    console.log('✓ Datasets loaded successfully from YAML:', Object.keys(DATASETS).length, 'datasets');

    // Run config validation — returns warnings array for UI display
    configValidationWarnings = validateDatasetConfigs();
  } catch (error) {
    console.error('Error loading datasets from YAML:', error);
    console.error('Stack trace:', error.stack);
    if (error.name === 'YAMLException') {
      const lineNum = error.mark ? error.mark.line + 1 : '?';
      throw new Error(
        `YAML syntax error in datasets.yaml at line ${lineNum}:\n${error.reason || error.message}\n\n` +
        `How to fix:\n` +
        `  1. Check line ${lineNum} for missing colons, wrong indentation, or stray characters\n` +
        `  2. Validate your file at https://www.yamllint.com/\n` +
        `  3. Indentation must use spaces, not tabs`
      );
    }
    throw error;
  }
}

// ============================================
// DATASET CONFIG VALIDATION
// ============================================

/**
 * Compatibility matrix: which analysis methods work with which feature geometry types.
 * true = works, false = logically impossible (validated with a warning).
 */
const METHOD_GEOMETRY_COMPAT = {
  listParallelFeatures:     { Point: false, LineString: true,  Polygon: false },
  averageParallelValue:     { Point: false, LineString: true,  Polygon: false },
  measureProjectByCategory: { Point: false, LineString: true,  Polygon: false },
  projectCoverage:          { Point: false, LineString: true,  Polygon: false },
  measureIntersectedArea:   { Point: false, LineString: false, Polygon: true  },
  listIntersectingFeatures: { Point: true,  LineString: true,  Polygon: true  },
  listNearbyFeatures:       { Point: true,  LineString: true,  Polygon: true  },
  countByCategory:          { Point: true,  LineString: true,  Polygon: true  },
  hasNearbyFeatures:        { Point: true,  LineString: true,  Polygon: true  },
  sumNearbyValues:          { Point: true,  LineString: true,  Polygon: true  },
  measureNearbyArea:        { Point: true,  LineString: true,  Polygon: true  },
  findNearestFeatures:      { Point: true,  LineString: true,  Polygon: true  },
};

/** Required config fields per analysis method */
const METHOD_REQUIRED_FIELDS = {
  listParallelFeatures:     ['bufferDistance', 'minSharedLength'],
  averageParallelValue:     ['bufferDistance', 'minSharedLength', 'averageField'],
  measureProjectByCategory: ['bufferDistance', 'minSharedLength', 'statusField'],
  projectCoverage:          ['bufferDistance'],
  measureIntersectedArea:   ['proximityBuffer'],
  listNearbyFeatures:       ['proximityBuffer'],
  countByCategory:          ['proximityBuffer'],
  hasNearbyFeatures:        ['proximityBuffer'],
  sumNearbyValues:          ['proximityBuffer', 'sumField'],
  measureNearbyArea:        ['proximityBuffer', 'sumField'],
  findNearestFeatures:      ['nearestCount'],
};

/** Delegate to AppUtils (loaded first via utils.js) */
function isValidColor(color) { return AppUtils.isValidColor(color); }

/**
 * Validate all loaded dataset configs and return warnings for display.
 * Also logs warnings to console for developer visibility.
 * @returns {Array<string>} Array of human-readable warning messages
 */
function validateDatasetConfigs() {
  const warnings = [];

  Object.entries(DATASETS).forEach(([key, config]) => {
    if (!config || typeof config !== 'object' || !config.enabled) return;

    const method = config.analysisMethod;
    const geom = config.geometryType;
    const prefix = `[Config Warning] ${key}:`;

    // Check for unknown analysisMethod
    const VALID_METHODS = Object.keys(METHOD_REQUIRED_FIELDS);
    if (method && !METHOD_GEOMETRY_COMPAT[method]) {
      const msg = `${config.name || key}: Unknown analysisMethod "${method}". Valid values: ${Object.keys(METHOD_GEOMETRY_COMPAT).join(', ')}`;
      console.warn(`[Config Warning] ${key}:`, msg);
      warnings.push(msg);
    }

    // Check method-geometry compatibility
    if (method && geom && METHOD_GEOMETRY_COMPAT[method]) {
      if (METHOD_GEOMETRY_COMPAT[method][geom] === false) {
        const msg = `${config.name || key}: analysisMethod "${method}" is incompatible with geometryType "${geom}". Results will be empty.`;
        console.warn(`${prefix} analysisMethod "${method}" is incompatible with geometryType "${geom}". Results will be empty.`);
        warnings.push(msg);
      }
    }

    // Check required fields
    if (method && METHOD_REQUIRED_FIELDS[method]) {
      METHOD_REQUIRED_FIELDS[method].forEach(field => {
        if (config[field] === undefined || config[field] === null) {
          const msg = `${config.name || key}: analysisMethod "${method}" requires "${field}" to be set in datasets.yaml.`;
          console.warn(`${prefix} analysisMethod "${method}" requires "${field}" but it is not set.`);
          warnings.push(msg);
        }
      });
    }

    // Check for unknown resultStyle
    if (config.resultStyle) {
      const validStyles = Object.values(RESULT_STYLES);
      if (!validStyles.includes(config.resultStyle)) {
        const msg = `${config.name || key}: Unknown resultStyle "${config.resultStyle}". Valid values: ${validStyles.join(', ')}`;
        console.warn(`[Config Warning] ${key}:`, msg);
        warnings.push(msg);
      }
    }

    // Validate color values in style
    if (config.style) {
      ['color', 'fillColor'].forEach(prop => {
        const val = config.style[prop];
        if (val && !isValidColor(val)) {
          const msg = `${config.name || key}: style.${prop} "${val}" is not a valid color — fix in datasets.yaml to avoid PDF rendering issues.`;
          console.warn(`${prefix} style.${prop} "${val}" is not a valid color. This may cause PDF rendering issues.`);
          warnings.push(msg);
        }
      });
    }

    // Validate colors in styleByProperty
    if (config.styleByProperty && config.styleByProperty.values) {
      Object.entries(config.styleByProperty.values).forEach(([valueKey, style]) => {
        ['color', 'fillColor'].forEach(prop => {
          const val = style[prop];
          if (val && !isValidColor(val)) {
            const msg = `${config.name || key}: styleByProperty.values.${valueKey}.${prop} "${val}" is not a valid color — fix in datasets.yaml.`;
            console.warn(`${prefix} styleByProperty.values.${valueKey}.${prop} "${val}" is not a valid color. This may cause PDF rendering issues.`);
            warnings.push(msg);
          }
        });
      });
    }
  });

  return warnings;
}

/** Warnings collected during config validation — read by app.js after datasetsLoaded resolves */
let configValidationWarnings = [];

// Promise that resolves when datasets are loaded
// Other scripts can await this before initialization
const datasetsLoaded = loadDatasets();
