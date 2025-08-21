/**
 * @fileoverview Cloudflare Worker entry point.
 * Routes requests to the appropriate handler based on the request type.
 */

import { handleNonStreamingRequest, handleStreamingRequest } from './handlers.js';
import { parseConfig, jsonError, handleOptionsRequest, logDebug } from './utils.js';

export default {
  /**
   * Main fetch handler for the Worker.
   * @param {Request} request - The incoming request.
   * @param {object} env - The environment variables.
   * @param {object} context - The execution context.
   * @returns {Promise<Response>}
   */
  async fetch(request, env, context) {
    const config = parseConfig(env);
    logDebug(config.debugMode, `Request received: ${request.method} ${request.url}`);

    try {
      const url = new URL(request.url);
      const apiKey = url.searchParams.get('key') || request.headers.get('X-Goog-Api-Key');

      if (!apiKey) {
        logDebug(config.debugMode, "Gemini API key not detected. Rejecting request.");
        return jsonError(403, "Forbidden", "Gemini API key not detected");
      }

      if (request.method === "OPTIONS") {
        logDebug(config.debugMode, "Handling OPTIONS preflight request.");
        return handleOptionsRequest();
      }

      // Only POST requests are processed by the anti-truncation logic
      if (request.method === "POST") {
        const isStream = url.pathname.includes(":stream") || url.searchParams.get("alt") === "sse";
        
        logDebug(config.debugMode, `Request identified as ${isStream ? "streaming" : "non-streaming"}.`);

        if (isStream) {
          return await handleStreamingRequest(request, config, url);
        } else {
          return await handleNonStreamingRequest(request, config, url);
        }
      }

      // For all other HTTP methods, directly proxy the request to the upstream
      logDebug(config.debugMode, `Passthrough for method: ${request.method}`);
      const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
      return fetch(upstreamUrl, request);

    } catch (e) {
      logDebug(config.debugMode, "Top-level exception caught:", e);
      return jsonError(500, "Internal Server Error", e.message);
    }
  }
};
