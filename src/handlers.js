/**
 * @fileoverview Request handlers for streaming and non-streaming requests.
 */

import {
  FINISHED_TOKEN,
  INCOMPLETE_TOKEN,
  TARGET_MODELS,
  RETRYABLE_STATUS_CODES,
  FATAL_STATUS_CODES,
  MAX_FETCH_RETRIES,
  MAX_NON_RETRYABLE_STATUS_RETRIES,
  BEGIN_TOKEN
} from "./constants.js";
import {
  isCherryRequest,
  injectSystemPrompts,
  isResponseComplete,
  isFormalResponseStarted,
  cleanFinalText,
  buildRetryRequest,
  buildUpstreamRequest,
  parseParts,
  isStructuredOutputRequest,
} from "./core.js";
import { logDebug, jsonError } from "./utils.js";

/**
 * Handles non-streaming requests with a retry mechanism.
 * @param {Request} request - The original incoming request.
 * @param {object} config - The worker configuration.
 * @param {URL} url - The parsed URL of the request.
 * @returns {Promise<Response>}
 */
export async function handleNonStreamingRequest(request, config, url) {
  const isTargetModel = TARGET_MODELS.some(model => url.pathname.includes(`models/${model}:generateContent`));

  if (!isTargetModel) {
    logDebug(config.debugMode, "Passing through non-streaming request without modification.");
    const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
    const upstreamRequest = new Request(upstreamUrl, request);
    return fetch(upstreamRequest);
  }

  let attempts = 0;
  const originalRequestBody = await request.json();

  // 检查是否为结构化输出请求
  if (isStructuredOutputRequest(originalRequestBody)) {
    logDebug(config.debugMode, "Structured output request detected. Passing through without modification.");
    const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
    const upstreamRequest = buildUpstreamRequest(upstreamUrl, request, originalRequestBody);
    return fetch(upstreamRequest);
  }

  // 处理 thinkingBudget
  let injectBeginTokenPrompt = true;
  let originalThinkingBudget = originalRequestBody.generationConfig?.thinkingConfig?.thinkingBudget;

  // 检查 thinkingBudget 是否存在且为0
  if (originalThinkingBudget !== undefined && originalThinkingBudget === 0) {
    injectBeginTokenPrompt = false;
  }

  // 如果 thinkingBudget 存在且不为0，将其规范在128-32768之间
  if (originalThinkingBudget !== undefined && originalThinkingBudget !== 0) {
    if (originalThinkingBudget < 128) {
      originalRequestBody.generationConfig.thinkingConfig.thinkingBudget = 128;
    } else if (originalThinkingBudget > 32768) {
      originalRequestBody.generationConfig.thinkingConfig.thinkingBudget = 32768;
    }
  }

  let currentRequestBody = injectSystemPrompts(originalRequestBody, config, injectBeginTokenPrompt, true);
  let thoughtAccumulatedText = injectBeginTokenPrompt ? config.startOfThought : "";
  let formalAccumulatedText = "";
  let isThoughtFinished = !injectBeginTokenPrompt;

  logDebug(config.debugMode, "Starting non-streaming request handler.");

  while (attempts <= config.maxRetries) {
    attempts++;
    logDebug(config.debugMode, `Non-streaming attempt ${attempts}/${config.maxRetries + 1}`);

    const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
    logDebug(config.debugMode, `Upstream URL: ${upstreamUrl}`);
    const upstreamRequest = buildUpstreamRequest(upstreamUrl, request, currentRequestBody);

    try {
      const upstreamResponse = await fetch(upstreamRequest);

      if (upstreamResponse.ok) {
        const responseJson = await upstreamResponse.json();
        // Parse parts to extract thoughts, response text, and function calls
        const parts = responseJson?.candidates?.[0]?.content?.parts || [];

        // Check if response contains function call
        let hasFunctionCall = false;
        for (const part of parts) {
          if (part.functionCall) {
            hasFunctionCall = true;
            break;
          }
        }

        if (hasFunctionCall) {
          logDebug(config.debugMode, "Non-streaming response contains function call. Returning as is.");
          return new Response(JSON.stringify(responseJson), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          });
        }

        // Process each part in the parts array
        for (const part of parts) {
          if (part.text && !part.thought) {
            if (!isThoughtFinished) {
              // 思维尚未结束，检查当前text是否标记思维结束
              if (isFormalResponseStarted(part.text)) {
                isThoughtFinished = true;
                // 将当前text添加到正式响应累积文本
                formalAccumulatedText += part.text;
              } else {
                // 思维继续，累积到思维累积文本
                thoughtAccumulatedText += part.text;
              }
            } else {
              // 思维已经结束，在整个非流式处理中接下来收到的都是正式响应文本
              formalAccumulatedText += part.text;
            }
          }
        }

        if (isThoughtFinished && isResponseComplete(formalAccumulatedText)) {
          logDebug(config.debugMode, "Non-streaming response is complete.");
          // Clean the final text and reconstruct the parts array
          const finalParts = [];
          // Add thought accumulated text
          finalParts.push({ text: thoughtAccumulatedText, thought: true });
          // Add the cleaned response text
          finalParts.push({ text: cleanFinalText(formalAccumulatedText) });

          responseJson.candidates[0].content.parts = finalParts;
          return new Response(JSON.stringify(responseJson), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          });
        } else {
          logDebug(config.debugMode, "Non-streaming response is incomplete. Preparing for retry.");
          currentRequestBody = buildRetryRequest(currentRequestBody, thoughtAccumulatedText + formalAccumulatedText);
        }
      } else {
        logDebug(config.debugMode, `Non-streaming attempt ${attempts} failed with status ${upstreamResponse.status}`);

        // Check for fatal status codes first
        if (FATAL_STATUS_CODES.includes(upstreamResponse.status)) {
          logDebug(config.debugMode, `Fatal status ${upstreamResponse.status} received. Aborting retries.`);
          return jsonError(upstreamResponse.status, "Upstream API returned a fatal error.", await upstreamResponse.text());
        }

        const isRetryableStatus = RETRYABLE_STATUS_CODES.includes(upstreamResponse.status);
        const maxRetriesForThisError = isRetryableStatus ? config.maxRetries : MAX_NON_RETRYABLE_STATUS_RETRIES;

        if (attempts > maxRetriesForThisError) {
          return jsonError(upstreamResponse.status, "Upstream API error after max retries.", await upstreamResponse.text());
        }
      }
    } catch (error) {
      logDebug(config.debugMode, `Fetch error during non-streaming attempt ${attempts}:`, error);
      if (attempts > MAX_FETCH_RETRIES) {
        return jsonError(500, "Internal Server Error after max retries.", error.message);
      }
    }
  }

  // If the loop finishes, all retries have been used up.
  logDebug(config.debugMode, "Max retries reached for non-streaming request.");

  // Construct final response with all accumulated thought parts and incomplete text
  const finalParts = [];
  // Add thought accumulated text if it exists
  if (thoughtAccumulatedText) {
    finalParts.push({ text: thoughtAccumulatedText, thought: true });
  }
  // Add the incomplete text, ensuring any partial tokens are cleaned.
  finalParts.push({ text: `${cleanFinalText(formalAccumulatedText)}\n${INCOMPLETE_TOKEN}` });

  const finalJson = {
    candidates: [{
      content: {
        parts: finalParts
      },
      finishReason: "MAX_RETRIES"
    }]
  };
  return new Response(JSON.stringify(finalJson), {
    status: 200, // Still a "successful" response from the proxy's perspective
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

/**
 * Handles streaming requests with a retry mechanism.
 * @param {Request} request - The original incoming request.
 * @param {object} config - The worker configuration.
 * @param {URL} url - The parsed URL of the request.
 * @returns {Promise<Response>}
 */
export async function handleStreamingRequest(request, config, url) {
  const isTargetModel = TARGET_MODELS.some(model => url.pathname.includes(`models/${model}:streamGenerateContent`));

  if (!isTargetModel) {
    logDebug(config.debugMode, "Passing through streaming request without modification.");
    const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
    const upstreamRequest = new Request(upstreamUrl, request);
    return fetch(upstreamRequest);
  }

  const originalRequestBody = await request.json();

  // 检查是否为结构化输出请求
  if (isStructuredOutputRequest(originalRequestBody)) {
    logDebug(config.debugMode, "Structured output request detected. Passing through without modification.");
    const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
    const upstreamRequest = buildUpstreamRequest(upstreamUrl, request, originalRequestBody);
    return fetch(upstreamRequest);
  }

  // 检查是不是Cherry Studio客户端的请求
  let isFromCherryRequest = isCherryRequest(request);

  // 处理 thinkingBudget
  let injectBeginTokenPrompt = true;
  let originalThinkingBudget = originalRequestBody.generationConfig?.thinkingConfig?.thinkingBudget;

  // 检查 thinkingBudget 是否存在且为0
  if (originalThinkingBudget !== undefined && originalThinkingBudget === 0) {
    injectBeginTokenPrompt = false;
  }

  // 如果 thinkingBudget 存在且不为0，将其规范在128-32768之间
  if (originalThinkingBudget !== undefined && originalThinkingBudget !== 0) {
    if (originalThinkingBudget < 128) {
      originalRequestBody.generationConfig.thinkingConfig.thinkingBudget = 128;
    } else if (originalThinkingBudget > 32768) {
      originalRequestBody.generationConfig.thinkingConfig.thinkingBudget = 32768;
    }
  }

  let isThoughtFinished = !injectBeginTokenPrompt;

  logDebug(config.debugMode, "Starting streaming request handler.");

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const TOKEN_LEN = FINISHED_TOKEN.length;
  const LOOKAHEAD_SIZE = TOKEN_LEN + 4;

  const process = async () => {
    let attempts = 0;
    let currentRequestBody = injectSystemPrompts(originalRequestBody, config, injectBeginTokenPrompt, true);

    while (attempts <= config.maxRetries) {
      attempts++;
      logDebug(config.debugMode, `Streaming attempt ${attempts}/${config.maxRetries + 1}`);

      let accumulatedTextThisAttempt = (injectBeginTokenPrompt && attempts === 1) ? config.startOfThought : "";
      accumulatedTextThisAttempt && writer.write(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: accumulatedTextThisAttempt, thought: true }], role: "model" }, index: 0 }] })}\n\n`));
      let hasFunctionCallInStream = false;
      let passthroughMode = false;

      // --- Buffers for the current attempt ---
      let lineBuffer = "";
      let textBuffer = ""; // Buffer for lookahead
      let linesBuffer = []; // Buffer of objects: { rawLine, isTransitionLine, text }

      const upstreamUrl = `${config.upstreamUrlBase}${url.pathname}${url.search}`;
      const upstreamRequest = buildUpstreamRequest(upstreamUrl, request, currentRequestBody);

      try {
        const upstreamResponse = await fetch(upstreamRequest);

        if (upstreamResponse.ok) {
          const reader = upstreamResponse.body.getReader();

          while (true) {
            const { value, done } = await reader.read();

            if (value) {
              const chunkString = decoder.decode(value, { stream: true });

              if (passthroughMode) {
                writer.write(encoder.encode(chunkString));
                continue;
              }

              const processableString = lineBuffer + chunkString;
              const lines = processableString.split(/\r?\n\r?\n/);
              lineBuffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.startsWith('data:')) {
                  if (line) writer.write(encoder.encode(line + '\n\n'));
                  continue;
                }

                const jsonStr = line.substring(5).trim();
                if (!jsonStr) continue;

                try {
                  const data = JSON.parse(jsonStr);
                  const parts = data?.candidates?.[0]?.content?.parts || [];
                  const parsedParts = parseParts(parts);

                  if (parsedParts.hasFunctionCall) {
                    hasFunctionCallInStream = true;
                  }

                  if (parsedParts.hasThought && !parsedParts.responseText && !parsedParts.hasFunctionCall) {
                    logDebug(config.debugMode, "Skipping garbage thought-only part.");
                    continue;
                  }

                  if (hasFunctionCallInStream && !passthroughMode) {
                    logDebug(config.debugMode, "Function call detected. Switching to passthrough mode.");
                    // Forward all buffered lines immediately
                    if (linesBuffer.length > 0) {
                      for (const lineObj of linesBuffer) {
                        writer.write(encoder.encode(lineObj.rawLine + '\n\n'));
                      }
                      linesBuffer = [];
                      textBuffer = "";
                    }
                    writer.write(encoder.encode(line + '\n\n'));
                    passthroughMode = true;
                    continue;
                  }

                  const responseText = parsedParts.responseText || "";
                  let isTransitionLine = false;
                  if (!isThoughtFinished && isFormalResponseStarted(responseText)) {
                    isThoughtFinished = true;
                    isTransitionLine = true;
                    accumulatedTextThisAttempt += BEGIN_TOKEN + "\n";
                    logDebug(config.debugMode, "Thought finished. Transition line detected.");
                  }

                  let lineToStore = line;
                  try {
                    const data = JSON.parse(jsonStr);
                    const parts = data?.candidates?.[0]?.content?.parts;

                    if (Array.isArray(parts)) {
                      let wasModified = false;

                      // Step 1: Filter out parts that are explicitly marked as thought.
                      let processedParts = parts.filter(part => !part.thought);
                      if (processedParts.length < parts.length) {
                        wasModified = true;
                      }

                      // Step 2: If the thought phase is not finished, all remaining text parts are considered thoughts.
                      if (!isThoughtFinished) {
                        let markedAsThought = false;
                        processedParts.forEach(part => {
                          // Mark any part with text as a thought.
                          if (part.text) {
                            part.thought = true;
                            markedAsThought = true;
                          }
                        });
                        if (markedAsThought) {
                          wasModified = true;
                        }
                      }

                      if (wasModified) {
                        data.candidates[0].content.parts = processedParts;
                        lineToStore = `data: ${JSON.stringify(data)}`;
                      }
                    }
                  } catch (e) {
                    logDebug(config.debugMode, "Could not process thought parts, storing raw line.", e);
                  }
                  linesBuffer.push({ rawLine: lineToStore, isTransitionLine, text: responseText });
                  textBuffer += responseText;
                  attempts > 1 && logDebug(config.debugMode, "responseText:", responseText);

                } catch (e) {
                  logDebug(config.debugMode, "Error processing SSE line, forwarding as is.", line, e);
                  writer.write(encoder.encode(line + '\n\n'));
                }
              }

              // --- Lookahead and Safe Forwarding ---
              if (textBuffer.length > LOOKAHEAD_SIZE) {
                const safeTextLength = textBuffer.length - LOOKAHEAD_SIZE;
                let forwardedTextLength = 0;

                while (linesBuffer.length > 0) {
                  const lineObject = linesBuffer[0];
                  if (forwardedTextLength + lineObject.text.length <= safeTextLength) {
                    linesBuffer.shift(); // Remove from buffer

                    if (lineObject.isTransitionLine) {
                      const data = JSON.parse(lineObject.rawLine.substring(5).trim());
                      const cleanedBeginText = cleanFinalText(lineObject.text, true, false);
                      data.candidates[0].content.parts = [{ text: cleanedBeginText }];
                      const cleanedLine = `data: ${JSON.stringify(data)}`;
                      writer.write(encoder.encode(cleanedLine + '\n\n'));
                      accumulatedTextThisAttempt += cleanedBeginText;
                    } else {
                      writer.write(encoder.encode(lineObject.rawLine + '\n\n'));
                      accumulatedTextThisAttempt += lineObject.text;
                    }

                    forwardedTextLength += lineObject.text.length;
                  } else {
                    break;
                  }
                }
                textBuffer = textBuffer.slice(forwardedTextLength);
              }
            }

            if (done) {
              if (passthroughMode) {
                writer.close();
                return;
              }

              if (isThoughtFinished && isResponseComplete(textBuffer)) {
                logDebug(config.debugMode, "Streaming response is complete. Constructing final payload from buffers. textBuffer:", textBuffer);

                // Accumulate all thought text from the remaining lines in the buffer.
                let thoughtTextBuffer = "";
                let responseTextBuffer = "";
                for (const lineObject of linesBuffer) {
                  try {
                    const line = lineObject.rawLine;
                    if (line.startsWith('data:')) {
                      const data = JSON.parse(line.substring(5).trim());
                      const parts = data?.candidates?.[0]?.content?.parts || [];
                      for (const part of parts) {
                        if (part.thought && part.text) {
                          thoughtTextBuffer += part.text;
                        }
                        else if (!part.thought && part.text) {
                          responseTextBuffer += part.text;
                        }
                      }
                    }
                  } catch (e) { /* ignore malformed lines */ }
                }

                let finalPayload = null;
                // Find the last valid line to use as a template for metadata.
                for (let i = linesBuffer.length - 1; i >= 0; i--) {
                  try {
                    const line = linesBuffer[i].rawLine;
                    if (line.startsWith('data:')) {
                      finalPayload = JSON.parse(line.substring(5).trim());
                      break;
                    }
                  } catch (e) { /* ignore */ }
                }

                // If no valid template was found, create a default one.
                if (!finalPayload) {
                  finalPayload = {
                    candidates: [{ content: { parts: [], role: "model" }, finishReason: "STOP", index: 0 }]
                  };
                }

                const finalText = cleanFinalText(responseTextBuffer);
                const finalParts = [];
                if (thoughtTextBuffer) {
                  finalParts.push({ text: thoughtTextBuffer, thought: true });
                }
                if (finalText) {
                  finalParts.push({ text: finalText });
                }

                finalPayload.candidates[0].content.parts = finalParts;
                finalPayload.candidates[0].finishReason = "STOP";

                writer.write(encoder.encode(`data: ${JSON.stringify(finalPayload)}\n\n`));
                writer.close();
                return; // Success, stream finished.
              } else {
                // The stream ended, but the buffered text is not a complete response.
                // This means the model was cut off. Time to retry.
                logDebug(config.debugMode, `Streaming response is incomplete. Preparing for retry. textBuffer:`, textBuffer);
                currentRequestBody = buildRetryRequest(currentRequestBody, accumulatedTextThisAttempt);
                break; // Break inner while to start next retry attempt
              }
            }
          }
        } else {
          logDebug(config.debugMode, `Streaming attempt ${attempts} failed with status ${upstreamResponse.status}`);
          if (FATAL_STATUS_CODES.includes(upstreamResponse.status)) {
            logDebug(config.debugMode, `Fatal status ${upstreamResponse.status} received. Aborting retries.`);
            const errorData = await upstreamResponse.text();
            writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { code: upstreamResponse.status, message: "Upstream API returned a fatal error.", details: errorData } })}\n\n`));
            writer.close();
            return;
          }
          if (attempts > config.maxRetries) {
            const errorData = await upstreamResponse.text();
            writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { code: upstreamResponse.status, message: "Upstream API error after max retries.", details: errorData } })}\n\n`));
            writer.close();
            return;
          }
        }
      } catch (error) {
        logDebug(config.debugMode, `Fetch error during streaming attempt ${attempts}:`, error);
        if (attempts > config.maxRetries) {
          writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { code: 500, message: "Internal Server Error after max retries.", details: error.message } })}\n\n`));
          writer.close();
          return;
        }
      }
    }

    // If the loop finishes, all retries have been used up.
    logDebug(config.debugMode, "Max retries reached for streaming request.");
    if (linesBuffer.length > 0) {
      for (const lineObj of linesBuffer) {
        writer.write(encoder.encode(lineObj.rawLine + '\n\n'));
      }
    }
    const incompletePayload = {
      candidates: [{
        content: {
          parts: [{ text: INCOMPLETE_TOKEN }]
        },
        finishReason: "MAX_RETRIES",
        index: 0
      }]
    };
    writer.write(encoder.encode(`data: ${JSON.stringify(incompletePayload)}\n\n`));
    writer.close();
  };

  let heartbeatInterval;

  // Start the heartbeat after setting up the stream, but before starting the processing
  heartbeatInterval = setInterval(() => {
    try {
      if (writer.desiredSize !== null && writer.desiredSize > 0) {
        logDebug(config.debugMode, "Sending SSE heartbeat.");
        const heartbeatPayload = {
          candidates: [{
            content: isFromCherryRequest || isThoughtFinished ? { parts: [{ text: "" }], role: "model" } : { parts: [{ text: "", thought: true }], role: "model" },
            index: 0
          }]
        };
        writer.write(encoder.encode(`data: ${JSON.stringify(heartbeatPayload)}\n\n`));
      }
    } catch (e) {
      logDebug(config.debugMode, "Failed to send heartbeat, stream likely closed.", e);
      clearInterval(heartbeatInterval);
    }
  }, 5000);

  process().catch(e => {
    logDebug(config.debugMode, "Unhandled error in streaming process:", e);
    try {
      writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { code: 500, message: "Internal worker error.", details: e.message } })}\n\n`));
      writer.close();
    } catch (_) { /* writer might already be closed */ }
  }).finally(() => {
    logDebug(config.debugMode, "Clearing SSE heartbeat interval.");
    clearInterval(heartbeatInterval);
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
