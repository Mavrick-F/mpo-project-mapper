/**
 * utils.js
 * Shared utility functions for the MPO Project Application Tool
 *
 * Must be loaded before all other src/ scripts (see index.html).
 */

window.AppUtils = {
  /**
   * Escape a value for safe insertion into HTML.
   * @param {*} str - Value to escape (non-strings are coerced)
   * @returns {string} HTML-safe string
   */
  escapeHtml(str) {
    if (typeof str !== 'string') return String(str == null ? '' : str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Validate a CSS color string (hex, named, or rgb/rgba format).
   * @param {string} color - Color value to test
   * @returns {boolean} True if the value looks like a valid CSS color
   */
  isValidColor(color) {
    if (!color || typeof color !== 'string') return false;
    return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}.*\))$/.test(color);
  },

  /**
   * Show a dismissible error banner that is safe to call before app.js loads.
   * Falls back to console.error if document.body is not available yet.
   * @param {string} message - Error message to display
   */
  showError(message) {
    if (!document.body) {
      console.error(message);
      return;
    }

    const bannerId = 'app-utils-global-error-banner';
    const existingBanner = document.getElementById(bannerId);
    if (existingBanner) {
      const messageNode = existingBanner.querySelector('[data-role="message"]');
      if (messageNode) {
        messageNode.textContent = message;
      }
      return;
    }

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10000;max-width:min(680px, calc(100vw - 32px));background-color:#F8D7DA;color:#721C24;border:1px solid #F5C6CB;border-radius:4px;padding:12px 40px 12px 12px;font-size:13px;line-height:1.4;white-space:pre-line;box-shadow:0 4px 12px rgba(0,0,0,0.15);';

    const messageNode = document.createElement('div');
    messageNode.setAttribute('data-role', 'message');
    messageNode.textContent = message;
    banner.appendChild(messageNode);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '\u00d7';
    closeBtn.setAttribute('aria-label', 'Dismiss error');
    closeBtn.style.cssText = 'position:absolute;top:4px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#721C24;padding:0;line-height:1;';
    closeBtn.addEventListener('click', () => banner.remove());
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);
  }
};
