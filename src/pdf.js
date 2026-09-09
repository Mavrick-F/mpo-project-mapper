/**
 * pdf.js
 * PDF generation and export functionality
 *
 * Dependencies: jsPDF, html2canvas, Turf.js, Leaflet, map.js, analysis.js, datasets.js
 */

// ============================================
// CONFIGURATION
// ============================================

/**
 * Enable/disable color coding of PDF text to match map layer colors
 * Set to true to color dataset names with their map layer colors
 * Set to false to keep all text black
 */
const ENABLE_COLOR_CODED_TEXT = true;

// ============================================
// HELPER FUNCTIONS FOR FILTERED LAYER STYLING
// ============================================

/**
 * Get style for a GeoJSON feature based on dataset config
 * Handles styleByProperty for conditional styling
 * @param {Object} feature - GeoJSON Feature
 * @param {Object} config - Dataset configuration from DATASETS
 * @returns {Object} Leaflet style object
 */
function getFeatureStyle(feature, config) {
  let style = { ...config.style };

  if (config.styleByProperty && feature.properties) {
    const propertyField = config.styleByProperty.field;
    const propertyValue = feature.properties[propertyField];
    const styleMap = config.styleByProperty.values;
    if (styleMap && styleMap[propertyValue]) {
      style = { ...style, ...styleMap[propertyValue] };
    }
  }

  return style;
}

/**
 * Create Leaflet marker for Point features
 * Applies styling from dataset config
 * @param {Object} feature - GeoJSON Feature
 * @param {Object} latlng - Leaflet LatLng object
 * @param {Object} config - Dataset configuration from DATASETS
 * @returns {Object} Leaflet CircleMarker
 */
function createPointMarker(feature, latlng, config) {
  const style = getFeatureStyle(feature, config);

  return L.circleMarker(latlng, {
    radius: style.radius || 5,
    fillColor: style.fillColor || '#007cbf',
    color: style.color || '#000000',
    weight: style.weight || 1,
    opacity: style.opacity || 1,
    fillOpacity: style.fillOpacity || 0.8
  });
}

/**
 * Convert hex color to RGB array
 * @param {string} hex - Hex color code (e.g., '#FF0000' or 'FF0000')
 * @returns {Array} RGB array [r, g, b] with values 0-255, or [0, 0, 0] if invalid
 */
function hexToRgb(hex) {
  // Validate input
  if (!hex || typeof hex !== 'string') {
    console.warn('Invalid color value:', hex, '- using black (#000000)');
    return [0, 0, 0];
  }

  // Remove all # characters (handles ## cases)
  const cleanHex = hex.replace(/#/g, '');

  // Validate hex format (must be 6 characters)
  if (cleanHex.length !== 6 || !/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    console.warn('Invalid hex color:', hex, '- using black (#000000)');
    return [0, 0, 0];
  }

  // Parse hex values
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  return [r, g, b];
}

/**
 * Get the primary color for a dataset from its style configuration
 * @param {Object} config - Dataset configuration from DATASETS
 * @returns {string} Hex color code (validated)
 */
function getDatasetColor(config) {
  // Validate config
  if (!config || !config.style) {
    return '#000000';
  }

  let color;

  // Prefer fillColor for point features, color for line/polygon features
  if (config.geometryType === 'Point') {
    color = config.style.fillColor || config.style.color || '#000000';
  } else {
    color = config.style.color || config.style.fillColor || '#000000';
  }

  // Validate the color is a string
  if (typeof color !== 'string' || !color) {
    return '#000000';
  }

  return color;
}

// ============================================
// PDF GENERATION
// ============================================

/**
 * Generate PDF report with map image and analysis results
 * Captures map, formats data, and downloads PDF file
 */
async function generatePDF() {
  const projectName = document.getElementById('projectName').value.trim();

  // Validate project name
  if (!projectName) {
    showError('Please enter a project name before generating the PDF.');
    return;
  }

  // Track which layers were visible before PDF generation
  const layerStates = {};
  Object.keys(DATASETS).forEach(datasetKey => {
    if (featureLayers[datasetKey]) {
      layerStates[datasetKey] = map.hasLayer(featureLayers[datasetKey]);
    }
  });

  // Temporary layers for filtered rendering
  const tempLayers = [];

  try {
    // Disable button and show loading state
    const pdfButton = document.getElementById('pdfButton');
    const originalText = pdfButton.textContent;
    pdfButton.disabled = true;
    pdfButton.textContent = 'Generating PDF...';

    // Show loading overlay with PDF progress
    showLoading(true, 'Preparing map for PDF...');

    // Auto-zoom map FIRST, before adding filtered layers
    // Use animate: false to ensure immediate positioning
    const optimalBounds = getOptimalMapBounds();
    if (optimalBounds) {
      // Temporarily enable fractional zoom so fitBounds uses the tightest
      // possible zoom level instead of rounding down to the nearest integer
      const originalZoomSnap = map.options.zoomSnap;
      map.options.zoomSnap = 0;

      // Measure the legend control so we can offset the right side
      const legend = document.querySelector('.leaflet-control-layers');
      const legendWidth = legend ? legend.offsetWidth + 20 : 0; // +20 for margin/gap

      map.fitBounds(optimalBounds, {
        paddingTopLeft: [0, 0],
        paddingBottomRight: [legendWidth, 0],  // Push map content left of the legend
        maxZoom: 18,         // Allow closer zoom since fractional zoom is enabled
        animate: false       // Avoid capturing the map during fitBounds animation
      });

      // Restore original zoomSnap after positioning
      map.options.zoomSnap = originalZoomSnap;
    }

    // Force Leaflet to update size/position after zoom
    map.invalidateSize();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Turn off all user-selected layers before adding filtered features
    Object.keys(DATASETS).forEach(datasetKey => {
      if (featureLayers[datasetKey] && map.hasLayer(featureLayers[datasetKey])) {
        map.removeLayer(featureLayers[datasetKey]);
      }
    });

    // Create temporary layers from the matched analysis results after the map is positioned.
    Object.keys(currentResults).forEach(datasetKey => {
      const results = currentResults[datasetKey];
      const config = DATASETS[datasetKey];

      if (!results || !config) return;

      // Skip rendering if dataset is marked to not show in PDF
      if (config.hideInPdfRendering) {
        return;
      }

      // Get features array (handle count results differently)
      let features;
      if (results.features) {
        // proximityCount results have a features array
        features = results.features;
      } else if (Array.isArray(results) && results.length > 0 && results[0] && results[0].feature && results[0].feature.geometry) {
        // findNearestFeatures results are arrays of { feature, distance } objects
        features = results.map(r => r.feature);
      } else if (Array.isArray(results) && results.length > 0 && results[0] && results[0].geometry) {
        // corridor, intersection, proximity results are arrays of features
        features = results;
      } else {
        // No features to render (empty results or unexpected format)
        return;
      }

      if (features.length === 0) return;

      // Create GeoJSON FeatureCollection
      const featureCollection = {
        type: 'FeatureCollection',
        features: features
      };

      // Create Leaflet layer with appropriate styling
      const tempLayer = L.geoJSON(featureCollection, {
        style: (feature) => getFeatureStyle(feature, config),
        pointToLayer: (feature, latlng) => createPointMarker(feature, latlng, config)
      });

      tempLayer.addTo(map);
      tempLayers.push(tempLayer);
    });

    // Wait for tiles and vector layers to finish rendering before capture.

    // Step 1: Wait for basemap tiles to load at new position
    showLoading(true, 'Loading basemap tiles...');
    await waitForTilesToLoad();

    // Step 2: Wait for newly added temp layers to render
    showLoading(true, 'Rendering filtered layers...');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 3: Wait for GeoJSON vector layers to render
    showLoading(true, 'Rendering vector layers...');
    await waitForGeoJSONLayersToRender();

    // Step 4: Give browser one more render cycle to finalize
    showLoading(true, 'Finalizing map display...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 5: Force Leaflet to recalculate internal state one final time
    // This ensures all layer positions are correct
    map.invalidateSize();
    await new Promise(resolve => setTimeout(resolve, 200));

    showLoading(true, 'Capturing map image...');

    // Capture the current map view and ensure cloned Leaflet panes stay visible.
    const mapElement = document.getElementById('map');
    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      allowTaint: true,
      scale: 2,  // Higher DPI for better quality
      logging: false,
      backgroundColor: '#ffffff',
      onclone: function(clonedDoc) {
        // Simple: just ensure all Leaflet panes are visible
        const panes = clonedDoc.querySelectorAll('.leaflet-pane');
        panes.forEach(pane => {
          pane.style.opacity = '1';
          pane.style.visibility = 'visible';
        });
      }
    });

    // Remove temporary filtered layers
    tempLayers.forEach(layer => map.removeLayer(layer));

    // Restore user-selected layers
    Object.keys(DATASETS).forEach(datasetKey => {
      if (featureLayers[datasetKey] && layerStates[datasetKey]) {
        map.addLayer(featureLayers[datasetKey]);
      }
    });

    showLoading(true, 'Building PDF document...');

    const mapImageData = canvas.toDataURL('image/jpeg', 0.92);

    // Create PDF using jsPDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: 'letter'  // 8.5 x 11 inches
    });

    // PDF dimensions (letter size with margins)
    const pageWidth = 8.5;
    const pageHeight = 11;
    const margin = 0.5;
    const contentWidth = pageWidth - (2 * margin);

    let yPosition = margin;

    // ========== HEADER SECTION ==========

    // Center the project name at the top of the report.
    try {
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text(projectName, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 0.3;
    } catch (error) {
      console.warn('Could not add logo to PDF:', error);
    }

    // Project Application Report as subtitle
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Project Application Report', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 0.3;

    // Date generated
    pdf.setFontSize(10);
    pdf.setTextColor(128, 128, 128);
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    pdf.text(`Generated: ${currentDate}`, pageWidth - margin, yPosition, { align: 'right' });
    yPosition += 0.2;

    // Project length (only for line features)
    if (drawnGeometry && drawnGeometry.geometry && drawnGeometry.geometry.type === 'LineString') {
      const lengthInMiles = turf.length(drawnGeometry.geometry, { units: 'miles' });
      pdf.text(`Project Length: ${lengthInMiles.toFixed(1)} miles`, pageWidth - margin, yPosition, { align: 'right' });
    }

    pdf.setTextColor(0, 0, 0);
    yPosition += 0.5;

    // ========== MAP SECTION ==========

    // Add map image
    const mapWidth = 7;
    const mapHeight = (canvas.height / canvas.width) * mapWidth;
    const mapX = (pageWidth - mapWidth) / 2;

    pdf.addImage(mapImageData, 'JPEG', mapX, yPosition, mapWidth, mapHeight);
    yPosition += mapHeight + 0.4;

    // ========== RESULTS SECTION ==========
    // Only include sections that have results

    // Helper function to check if we need a new page
    const checkPageBreak = (neededSpace = 0.5) => {
      const footerSpace = 0.5;
      if (yPosition + neededSpace > pageHeight - footerSpace) {
        pdf.addPage();
        yPosition = margin;
        return true;
      }
      return false;
    };

    // Check if we have any results from any dataset
    const hasAnyResults = Object.keys(currentResults).some(datasetKey => {
      const results = currentResults[datasetKey];
      if (!results) return false;

      if (Array.isArray(results)) return results.length > 0;
      if ('total' in results) return results.total > 0;
      if ('detected' in results) return results.detected;
      if ('totalArea' in results) return results.totalArea > 0;
      if ('percentage' in results) return results.percentage > 0;
      if ('avg' in results) return results.avg !== null && results.count > 0;
      return false;
    });

    checkPageBreak(0.5);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Analysis Results', margin, yPosition);
    yPosition += 0.3;

    if (!hasAnyResults) {
      const noResultsMsg = window.CONFIG_APP?.branding?.noResultsMessage
        || 'No GIS data layers intersected this project alignment.';
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(100, 100, 100);
      const wrappedLines = pdf.splitTextToSize(noResultsMsg, contentWidth);
      pdf.text(wrappedLines, margin, yPosition);
      yPosition += wrappedLines.length * 0.18 + 0.1;
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'normal');
    }

    // Group datasets by category
    const configuredOrder = window.CONFIG_APP?.categoryOrder || DEFAULT_CATEGORY_ORDER;
    const datasetsByCategory = {};

    Object.keys(DATASETS).forEach(datasetKey => {
      const config = DATASETS[datasetKey];
      const results = currentResults[datasetKey];

      // Skip if dataset is disabled or has no results
      if (!config.enabled || !results) {
        return;
      }

      // Check if results are empty (handle different result types)
      let isEmpty = false;
      if (config.resultStyle === RESULT_STYLES.BINARY && typeof results === 'object' && 'detected' in results) {
        isEmpty = !results.detected;
      } else if (config.resultStyle === RESULT_STYLES.PERCENTAGE && typeof results === 'object' && 'percentage' in results) {
        isEmpty = results.percentage === 0;
      } else if (config.resultStyle === RESULT_STYLES.AREA && typeof results === 'object' && 'totalArea' in results) {
        isEmpty = results.totalArea === 0;
      } else if (config.resultStyle === RESULT_STYLES.SUM && typeof results === 'object' && 'sum' in results) {
        isEmpty = results.sum === 0;
      } else if (config.resultStyle === RESULT_STYLES.NEAREST && Array.isArray(results)) {
        isEmpty = results.length === 0;
      } else if (config.resultStyle === RESULT_STYLES.AVERAGE_VALUE && typeof results === 'object' && 'avg' in results) {
        isEmpty = results.avg === null || results.count === 0;
      } else if (config.resultStyle === RESULT_STYLES.LENGTH_BY_STATUS && typeof results === 'object' && 'total' in results) {
        isEmpty = results.total === 0;
      } else if (typeof results === 'object' && 'total' in results) {
        isEmpty = results.total === 0;
      } else if (Array.isArray(results)) {
        isEmpty = results.length === 0;
      } else {
        // Unknown result type - treat as empty
        isEmpty = true;
      }

      if (isEmpty) {
        return;
      }

      // Group by category
      const category = config.category || 'Other';
      if (!datasetsByCategory[category]) {
        datasetsByCategory[category] = [];
      }
      datasetsByCategory[category].push({ config, results });
    });

    // Build full category order: configured order + any extra categories found in datasets
    const categoryOrder = [...configuredOrder];
    Object.keys(datasetsByCategory).forEach(cat => {
      if (!categoryOrder.includes(cat)) {
        categoryOrder.push(cat);
      }
    });

    // Loop through categories in order
    categoryOrder.forEach(category => {
      if (!datasetsByCategory[category] || datasetsByCategory[category].length === 0) {
        return;
      }

      // Add category header (centered)
      checkPageBreak(0.4);
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0, 102, 204); // Blue color for category headers
      pdf.text(category, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 0.25;
      pdf.setTextColor(0, 0, 0); // Reset to black

      // Loop through datasets in this category
      datasetsByCategory[category].forEach(({ config, results }) => {

      // Add section header with optional color coding
      checkPageBreak(0.5);
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');

      // Apply dataset color if enabled
      if (ENABLE_COLOR_CODED_TEXT) {
        const hexColor = getDatasetColor(config);
        const [r, g, b] = hexToRgb(hexColor);
        pdf.setTextColor(r, g, b);
      }

      pdf.text(`${config.name}:`, margin, yPosition);

      // Reset to black for result text
      pdf.setTextColor(0, 0, 0);

      yPosition += 0.2;
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');

      // Render based on resultStyle
      if (config.resultStyle === RESULT_STYLES.BINARY) {
        // Binary format (for flood zones and wetlands - just show Yes)
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`  Yes`, margin, yPosition);
        yPosition += 0.2;
        yPosition += 0.1;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.AREA) {
        // Area format (for area impact analysis - show total only)
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');
        const areaUnit = config.resultUnit || 'acres';
        const areaDesc = config.areaLabel ? ` of ${config.areaLabel}` : '';
        const areaLabelText = `  Total: ${results.totalArea.toFixed(2)} ${areaUnit}${areaDesc}`;
        pdf.text(areaLabelText, margin, yPosition);
        yPosition += 0.2;
        yPosition += 0.1;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.SUM) {
        // Sum format (for summing numeric values from nearby features)
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');
        const displayValue = Number.isInteger(results.sum) ? results.sum : results.sum.toFixed(2);
        let sumLabel;
        if (config.sumUnit) {
          sumLabel = `  Total: ${displayValue} ${config.sumUnit}`;
        } else if (config.sumField) {
          sumLabel = `  Total ${getFieldLabel(config.sumField, config.properties.fieldLabels)}: ${displayValue}`;
        } else {
          sumLabel = `  Total: ${displayValue}`;
        }
        pdf.text(sumLabel, margin, yPosition);
        yPosition += 0.2;
        yPosition += 0.1;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.NEAREST) {
        // Nearest features format (for findNearestFeatures analysis)
        results.forEach(result => {
          checkPageBreak(0.2);
          pdf.setFont('helvetica', 'normal');
          const props = result.feature.properties || result.feature;
          const displayName = props._displayName || props[config.properties.displayField] || 'Unknown';
          const distanceFormatted = Number.isInteger(result.distance)
            ? result.distance.toLocaleString()
            : result.distance.toFixed(2);
          const distUnit = config.resultUnit || 'ft';
          pdf.text(`  • ${displayName} - ${distanceFormatted} ${distUnit}`, margin, yPosition);
          yPosition += 0.16;
        });
        yPosition += 0.2;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.AVERAGE_VALUE) {
        // Average value format (for averageParallelValue — e.g. LOTTR)
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');
        const fieldLabel = config.averageField ? `Avg. ${getFieldLabel(config.averageField, config.properties.fieldLabels)}` : 'Average';
        pdf.text(`  ${fieldLabel}: ${results.avg.toFixed(2)}`, margin, yPosition);
        yPosition += 0.18;

        // Show tier label if displayThresholds are configured
        if (config.displayThresholds && results.avg !== null) {
          for (const threshold of config.displayThresholds) {
            if (threshold.max == null || results.avg < threshold.max) {
              checkPageBreak(0.2);
              pdf.text(`  Reliability: ${threshold.label}`, margin, yPosition);
              yPosition += 0.16;
              break;
            }
          }
        }
        yPosition += 0.1;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.LENGTH_BY_STATUS) {
        // Length by status format (for travel time reliability - show percentages and median LOTTR)
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');

        // Show weighted average if available
        if (results.avg !== null && results.avg !== undefined) {
          const avgLabel = config.averageField ? `Avg. ${getFieldLabel(config.averageField, config.properties.fieldLabels)}` : 'Average';
          pdf.text(`  ${avgLabel}: ${results.avg.toFixed(2)}`, margin, yPosition);
          yPosition += 0.18;
        }

        if (results.breakdown && Object.keys(results.breakdown).length > 0) {
          // Sort breakdown by percentage descending
          const sortedBreakdown = Object.entries(results.breakdown).sort((a, b) => b[1] - a[1]);

          sortedBreakdown.forEach(([status, percentage]) => {
            checkPageBreak(0.2);
            pdf.text(`    • ${status}: ${percentage.toFixed(1)}%`, margin, yPosition);
            yPosition += 0.16;
          });
        }
        yPosition += 0.2;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.COUNT) {
        // Count format
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');
        const countLabelText = config.countLabel
          ? `  Total ${config.countLabel}: ${results.total}`
          : `  Total: ${results.total}`;
        pdf.text(countLabelText, margin, yPosition);
        yPosition += 0.18;

        if (results.breakdown && Object.keys(results.breakdown).length > 0) {
          // Sort breakdown by count (descending)
          const sortedBreakdown = Object.entries(results.breakdown).sort((a, b) => b[1] - a[1]);

          sortedBreakdown.forEach(([category, count]) => {
            checkPageBreak(0.2);
            pdf.text(`    • ${category}: ${count}`, margin, yPosition);
            yPosition += 0.16;
          });
        }
        yPosition += 0.2;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.PERCENTAGE) {
        // Percentage format (for project coverage analysis)
        checkPageBreak(0.3);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`  ${results.percentage}% of project`, margin, yPosition);
        yPosition += 0.2;
        yPosition += 0.1;  // Add spacing between datasets

      } else if (config.resultStyle === RESULT_STYLES.TABLE && config.properties.additionalFields.length > 0) {
        // Table format
        pdf.setFont('helvetica', 'bold');

        // Table header
        const columnWidth = 2.5;
        let xOffset = margin + 0.2;

        pdf.text(getFieldLabel(config.properties.displayField, config.properties.fieldLabels), xOffset, yPosition);
        xOffset += columnWidth;

        config.properties.additionalFields.forEach(field => {
          pdf.text(getFieldLabel(field, config.properties.fieldLabels), xOffset, yPosition);
          xOffset += columnWidth;
        });

        yPosition += 0.18;
        pdf.setFont('helvetica', 'normal');

        // Table rows
        results.forEach(result => {
          checkPageBreak(0.2);
          xOffset = margin + 0.2;

          // Access properties from Feature or flat object
          const props = result.properties || result;

          // Display field
          const displayValue = props[config.properties.displayField] || 'Unknown';
          pdf.text(String(displayValue), xOffset, yPosition);
          xOffset += columnWidth;

          // Additional fields
          config.properties.additionalFields.forEach(field => {
            const fieldValue = props[field] || 'Unknown';
            pdf.text(String(fieldValue), xOffset, yPosition);
            xOffset += columnWidth;
          });

          yPosition += 0.15;
        });
        yPosition += 0.1;  // Add spacing between datasets

      } else {
        // List format (default)
        results.forEach(result => {
          checkPageBreak(0.2);

          let displayText;
          if (typeof result === 'string') {
            displayText = result;
          } else if (typeof result === 'object') {
            // Access properties from Feature or flat object
            const props = result.properties || result;
            displayText = props._displayName || props[config.properties.displayField] || 'Unknown';

            // Add additional fields if present
            if (config.properties.additionalFields.length > 0) {
              config.properties.additionalFields.forEach(field => {
                let value = props[field];

                // Format as percentage if specified
                if (config.properties.formatPercentage === field && value !== undefined && value !== 'Unknown') {
                  value = `${(value * 100).toFixed(1)}%`;
                }

                const fieldLabel = getFieldLabel(field, config.properties.fieldLabels);
                displayText += ` | ${fieldLabel}: ${value}`;
              });
            }
          } else {
            displayText = String(result);
          }

          pdf.text(`  • ${displayText}`, margin, yPosition);
          yPosition += 0.18;
        });
        yPosition += 0.2;  // Add spacing between datasets
      }
      }); // End of datasets in category loop
    }); // End of category loop

    // ========== FOOTER (on each page) ==========
    const totalPages = pdf.internal.getNumberOfPages();
    const footerText = window.CONFIG_APP?.branding?.pdfFooter || 'Generated by MPO Project Application Tool';
    const disclaimerText = window.CONFIG_APP?.branding?.pdfDisclaimer || 'For preliminary analysis';

    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(128, 128, 128);
      const footerY = pageHeight - 0.4;
      pdf.text(footerText, pageWidth / 2, footerY, { align: 'center' });

      // Add disclaimer
      pdf.setFontSize(7);
      pdf.text(disclaimerText, pageWidth / 2, footerY + 0.12, { align: 'center' });

      if (totalPages > 1) {
        pdf.setFontSize(8);
        pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin, footerY, { align: 'right' });
      }
    }

    // ========== SAVE PDF ==========

    const fileName = formatFileName(projectName);
    pdf.save(fileName);

    // Hide loading overlay
    showLoading(false);

    // Re-enable button
    pdfButton.disabled = false;
    pdfButton.textContent = originalText;

  } catch (error) {
    console.error('PDF generation error:', error);

    // Clean up temporary layers on error
    tempLayers.forEach(layer => {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });

    showLoading(false);
    const errorMessage = error && error.message ? error.message : 'Unknown error';
    showError(`Failed to generate PDF: ${errorMessage}. Check the browser console for details.`);

    // Re-enable button
    const pdfButton = document.getElementById('pdfButton');
    pdfButton.disabled = false;
    pdfButton.textContent = 'Download PDF Report';
  }
}

/**
 * Format project name into valid filename for PDF download
 * Replaces spaces with underscores and adds ISO date
 * @param {string} projectName - User-entered project name
 * @returns {string} Formatted filename
 */
function formatFileName(projectName) {
  // Replace special characters with underscores, collapse runs, trim edges
  const sanitized = projectName
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);

  return `${sanitized}.pdf`;
}

/**
 * Wait for all map tiles to finish loading
 * Returns a promise that resolves when tiles are loaded
 * @returns {Promise} Resolves when tiles are loaded or after timeout
 */
function waitForTilesToLoad() {
  return new Promise((resolve) => {
    // Get the tile layer from map
    let tileLayer = null;
    map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) {
        tileLayer = layer;
      }
    });

    if (!tileLayer) {
      console.warn('No tile layer found');
      resolve();
      return;
    }

    // Helper function to check pending tiles
    const checkTiles = () => {
      let pending = 0;
      const container = tileLayer.getContainer();
      if (container) {
        const tiles = container.querySelectorAll('img');
        tiles.forEach(tile => {
          if (!tile.complete) pending++;
        });
      }
      return pending;
    };

    // Check if tiles are already loaded
    const initialPending = checkTiles();
    console.log(`Basemap tiles: ${initialPending} pending`);

    if (initialPending === 0) {
      console.log('✓ All basemap tiles already loaded');
      resolve();
      return;
    }

    // Wait for 'load' event or timeout
    let resolved = false;
    let timeoutHandle;

    const onLoad = () => {
      const stillPending = checkTiles();
      if (!resolved && stillPending === 0) {
        resolved = true;
        clearTimeout(timeoutHandle);
        tileLayer.off('load', onLoad);
        tileLayer.off('tileerror', onTileError);
        console.log('✓ All basemap tiles loaded successfully');
        resolve();
      } else if (stillPending > 0) {
        console.log(`Basemap tiles: ${stillPending} still pending...`);
      }
    };

    const onTileError = (error) => {
      console.warn('Tile load error:', error);
      // Continue anyway - some tiles may have failed but we should proceed
    };

    tileLayer.on('load', onLoad);
    tileLayer.on('tileerror', onTileError);

    // Timeout fallback (10 seconds max wait for slower connections)
    timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        tileLayer.off('load', onLoad);
        tileLayer.off('tileerror', onTileError);
        const finalPending = checkTiles();
        console.warn(`⚠ Tile load timeout after 10s - ${finalPending} tiles still pending - proceeding anyway`);
        resolve();
      }
    }, 10000);
  });
}

/**
 * Wait for all GeoJSON vector layers to finish rendering in the DOM
 * GeoJSON layers render as SVG elements in the overlay pane
 * This ensures all vector features are visible before PDF capture
 * @returns {Promise} Resolves when layers are rendered or timeout (2s)
 */
async function waitForGeoJSONLayersToRender() {
  return new Promise((resolve) => {
    let checks = 0;
    const maxChecks = 20; // 2 seconds max wait (20 * 100ms)

    const checkRendered = () => {
      checks++;

      // Find the Leaflet overlay pane that contains vector layers
      const overlayPane = document.querySelector('.leaflet-overlay-pane');
      if (!overlayPane) {
        if (checks < maxChecks) {
          setTimeout(checkRendered, 100);
        } else {
          console.warn('GeoJSON layers: overlay pane not found - proceeding anyway');
          resolve();
        }
        return;
      }

      // Count rendered SVG paths (GeoJSON features render as SVG)
      const svgPaths = overlayPane.querySelectorAll('svg path');
      const canvasElements = overlayPane.querySelectorAll('canvas');

      // Count total rendered elements
      const totalElements = svgPaths.length + canvasElements.length;

      // Log progress every 5 checks
      if (checks % 5 === 0 || checks === 1) {
        console.log(`GeoJSON render check ${checks}: ${svgPaths.length} SVG paths, ${canvasElements.length} canvas elements`);
      }

      // Consider rendered if we have some elements OR reached max checks
      // We expect at least a few paths for the drawn geometry + reference layers
      if (totalElements > 0 || checks >= maxChecks) {
        if (checks >= maxChecks && totalElements === 0) {
          console.warn('GeoJSON layers: timeout reached with no elements - check if layers are actually enabled');
        } else {
          console.log(`✓ GeoJSON layers rendered: ${totalElements} elements found after ${checks * 100}ms`);
        }
        resolve();
      } else {
        // Keep checking
        setTimeout(checkRendered, 100);
      }
    };

    checkRendered();
  });
}

