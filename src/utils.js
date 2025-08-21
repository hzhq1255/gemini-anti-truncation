/**
 * @fileoverview Utility functions for configuration, logging, and error handling.
 */

/**
 * Parses environment variables into a structured configuration object.
 * @param {object} env - The environment variables from the Worker context.
 * @returns {object} A configuration object.
 */
export function parseConfig(env) {
  return {
    upstreamUrlBase: env.UPSTREAM_URL_BASE || "https://generativelanguage.googleapis.com",
    maxRetries: parseInt(env.MAX_RETRIES, 10) || 3,
    debugMode: env.DEBUG_MODE === "true",
    startOfThought: env.START_OF_THOUGHT || "Here's a",
  };
}

/**
 * Logs messages to the console if debug mode is enabled.
 * @param {boolean} debugMode - Whether debug mode is active.
 * @param {...any} args - The messages or objects to log.
 */
export function logDebug(debugMode, ...args) {
  if (debugMode) {
    console.log(`[DEBUG ${new Date().toISOString()}]`, ...args);
  }
}

/**
 * Creates a standardized JSON error response.
 * @param {number} status - The HTTP status code.
 * @param {string} message - The error message.
 * @param {any} [details=null] - Optional details about the error.
 * @returns {Response} A Response object.
 */
export function jsonError(status, message, details = null) {
  const errorBody = {
    error: {
      code: status,
      message,
      details,
    },
  };
  return new Response(JSON.stringify(errorBody), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Handles CORS preflight (OPTIONS) requests.
 * @returns {Response} A Response object with CORS headers.
 */
export function handleOptionsRequest() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key",
    },
  });
}
