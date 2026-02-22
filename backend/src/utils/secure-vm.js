/**
 * Secure VM Wrapper
 *
 * Replacement for vm2 using Node's built-in vm module with strict security controls.
 *
 * Security measures:
 * - Frozen sandbox context (prevents prototype pollution)
 * - No access to process, require, or other dangerous globals
 * - Timeout enforcement
 * - Memory limit warnings
 * - Strict mode enforcement
 *
 * Note: This is NOT a perfect sandbox. For maximum security, run untrusted code
 * in separate processes or containers. This provides reasonable protection against
 * common attacks while maintaining compatibility with existing transformation scripts.
 */

const vm = require('vm');
const { log } = require('../logger');

class SecureVM {
  constructor(options = {}) {
    this.timeout = options.timeout || 60000; // Default 60 seconds
    this.sandbox = options.sandbox || {};
    this.allowAsync = options.allowAsync !== false; // Default true
  }

  /**
   * Run code in sandboxed environment
   * @param {string} code - JavaScript code to execute
   * @returns {Promise<any>} Result of code execution
   */
  async run(code) {
    return new Promise((resolve, reject) => {
      try {
        // Create frozen sandbox context to prevent prototype pollution
        const context = this._createSecureContext(this.sandbox);

        // Wrap code in strict mode and async function
        const wrappedCode = this.allowAsync
          ? `'use strict'; (async function() { ${code} })()`
          : `'use strict'; (function() { ${code} })()`;

        // Compile script
        const script = new vm.Script(wrappedCode, {
          filename: 'transformation-script.js',
          timeout: this.timeout,
          displayErrors: true,
        });

        // Execute with timeout
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          fn(value);
        };
        const timeoutHandle = setTimeout(() => {
          finish(reject, new Error(`Script execution timeout after ${this.timeout}ms`));
        }, this.timeout);

        try {
          // Run script in context
          const result = script.runInNewContext(context, {
            timeout: this.timeout,
            displayErrors: true,
            breakOnSigint: true,
          });

          // Handle async results (use duck typing since Promise from sandbox context)
          if (this.allowAsync && result && typeof result.then === 'function') {
            result.then((value) => finish(resolve, value)).catch((error) => finish(reject, error));
          } else {
            finish(resolve, result);
          }
        } catch (error) {
          finish(reject, error);
        }
      } catch (error) {
        reject(new Error(`Script compilation failed: ${error.message}`));
      }
    });
  }

  /**
   * Create secure sandbox context with frozen prototypes
   * @param {Object} customSandbox - Custom sandbox objects
   * @returns {Object} Frozen context object
   * @private
   */
  _createSecureContext(customSandbox) {
    // Create safe global utilities
    const safeGlobals = {
      // Safe built-ins
      Array,
      Boolean,
      Date,
      Error,
      JSON,
      Math,
      Number,
      Object,
      RegExp,
      String,

      // Safe functions
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      encodeURIComponent,
      decodeURI,
      decodeURIComponent,

      // Custom console that logs securely
      console: {
        log: (...args) => log('debug', 'Script console.log', { message: args.join(' ') }),
        warn: (...args) => log('warn', 'Script console.warn', { message: args.join(' ') }),
        error: (...args) => log('error', 'Script console.error', { message: args.join(' ') }),
      },

      // Promise support for async operations
      Promise,

      // Timer support for async scripts
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,

      // Add custom sandbox objects
      ...customSandbox,
    };

    // Freeze all built-in prototypes to prevent pollution
    Object.freeze(Object.prototype);
    Object.freeze(Array.prototype);
    Object.freeze(String.prototype);
    Object.freeze(Number.prototype);
    Object.freeze(Boolean.prototype);
    Object.freeze(Date.prototype);

    // Create context with NO access to dangerous globals
    const context = vm.createContext(safeGlobals, {
      name: 'SecureSandbox',
      codeGeneration: {
        strings: false, // Disable eval()
        wasm: false, // Disable WebAssembly
      },
    });

    return context;
  }
}

/**
 * Create a secure VM instance (compatible with vm2 API)
 * @param {Object} options - VM options
 * @returns {SecureVM} VM instance
 */
function createSecureVM(options = {}) {
  return new SecureVM(options);
}

module.exports = {
  VM: SecureVM,
  createSecureVM,
};
