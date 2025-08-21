/**
 * @fileoverview Core logic for request modification, validation, and retry preparation.
 */

import { BEGIN_TOKEN_PROMPT, FINISH_TOKEN_PROMPT, REMINDER_PROMPT, BEGIN_TOKEN, FINISHED_TOKEN } from "./constants.js";
import { logDebug } from "./utils.js";

/**
 * 处理 systemInstruction 和 system_instruction 的兼容性
 * 如果 systemInstruction 和 system_instruction 都存在，以 systemInstruction 为准，并删除 system_instruction
 * 如果只有 system_instruction，则改其名为 systemInstruction
 * @param {object} body - 请求体对象
 * @returns {object} 处理后的请求体对象
 */
export function normalizeSystemInstruction(body) {
  if (!body) return body;

  // 处理 systemInstruction 和 system_instruction 的兼容性
  // 如果 systemInstruction 和 system_instruction 都存在，以 systemInstruction 为准，并删除 system_instruction
  // 如果只有 system_instruction，则改其名为 systemInstruction
  if (body.systemInstruction && body.system_instruction) {
    // 两者都存在，以 systemInstruction 为准，删除 system_instruction
    delete body.system_instruction;
  } else if (!body.systemInstruction && body.system_instruction) {
    // 只有 system_instruction，改其名为 systemInstruction
    body.systemInstruction = body.system_instruction;
    delete body.system_instruction;
  }

  return body;
}

/**
 * 
 * @param {object} body 
 * @returns {boolean}
 */
export function isCherryRequest(body) {
  return body.headers.has("User-Agent") && body.headers.get("User-Agent").includes("CherryStudio");
}

/**
 * Injects system prompts into the request body, including begin token, finish token, and reminder prompts.
 * Handles systemInstruction compatibility and adds thought chain引导词 if needed.
 * Creates `systemInstruction` if it doesn't exist.
 * @param {object} body - The original request body.
 * @param {object} config - The worker configuration.
 * @param {boolean} injectBeginTokenPrompt - Whether to inject the begin token prompt.
 * @param {boolean} injectFinishTokenPrompt - Whether to inject the finish token prompt.
 * @returns {object} The modified request body.
 */
export function injectSystemPrompts(body, config, injectBeginTokenPrompt = true, injectFinishTokenPrompt = true) {
  logDebug(config && config.debugMode, "Running injectSystemPrompts...", { injectBeginTokenPrompt, injectFinishTokenPrompt });
  const newBody = structuredClone(body); // Deep copy

  // 处理 systemInstruction 和 system_instruction 的兼容性
  normalizeSystemInstruction(newBody);

  // 构建要注入的提示文本
  let promptToInject = "";
  if (injectBeginTokenPrompt && injectFinishTokenPrompt) {
    // 如果两者都要注入，就直接把finish Token Prompt拼接到begin Token Prompt后面
    promptToInject = BEGIN_TOKEN_PROMPT + FINISH_TOKEN_PROMPT;
  } else if (injectBeginTokenPrompt) {
    promptToInject = BEGIN_TOKEN_PROMPT;
  } else if (injectFinishTokenPrompt) {
    promptToInject = FINISH_TOKEN_PROMPT;
  }

  // 如果没有要注入的提示，直接返回原对象
  if (!promptToInject) {
    logDebug(config && config.debugMode, "No token prompts to inject.");
    return newBody;
  }
  logDebug(config && config.debugMode, `Prompt to inject into systemInstruction: "${promptToInject.substring(0, 100)}..."`);

  const tokenPromptPart = { text: promptToInject };

  if (!newBody.systemInstruction) {
    logDebug(config && config.debugMode, "Creating new systemInstruction with token prompt");
    newBody.systemInstruction = { parts: [tokenPromptPart] };
  } else if (!Array.isArray(newBody.systemInstruction.parts)) {
    logDebug(config && config.debugMode, "Converting systemInstruction.parts to array with token prompt");
    newBody.systemInstruction.parts = [tokenPromptPart];
  } else if (newBody.systemInstruction.parts.length === 0 || !newBody.systemInstruction.parts[0].text) {
    // 如果 parts 数组为空，或者第一个 part 没有 text 属性，则设置为第一个part
    logDebug(config && config.debugMode, "Setting token prompt as first part in systemInstruction");
    newBody.systemInstruction.parts[0] = tokenPromptPart;
  } else {
    // 原请求有 systemInstruction.parts 且 parts[0].text 存在
    // 将token prompt追加到原请求的 parts[0].text 里面，加两个换行
    logDebug(config && config.debugMode, "Appending token prompt to existing systemInstruction");
    newBody.systemInstruction.parts[0].text += "\n\n---\n" + promptToInject;
  }

  // 处理 contents 数组中的每个 content
  if (Array.isArray(newBody.contents)) {
    for (const content of newBody.contents) {
      if (Array.isArray(content.parts)) {
        // 根据 injectBeginTokenPrompt 注入 BEGIN_TOKEN
        if (injectBeginTokenPrompt && content.role === "model") {
          // 找到第一个有 text 属性的 part
          let firstTextPartIndex = -1;
          for (let i = 0; i < content.parts.length; i++) {
            if (content.parts[i].text) {
              firstTextPartIndex = i;
              break;
            }
          }

          // 如果找到了，就在其开头注入 BEGIN_TOKEN 和换行
          if (firstTextPartIndex !== -1) {
            logDebug(config && config.debugMode, "Injecting BEGIN_TOKEN into model message part.");
            content.parts[firstTextPartIndex].text = BEGIN_TOKEN + "\n" + content.parts[firstTextPartIndex].text;
          }
        }

        // 根据 injectFinishTokenPrompt 并且角色为 "model" 时注入 FINISHED_TOKEN
        if (injectFinishTokenPrompt && content.role === "model") {
          // 找到最后一个有 text 属性的 part
          let lastTextPartIndex = -1;
          for (let i = content.parts.length - 1; i >= 0; i--) {
            if (content.parts[i].text) {
              lastTextPartIndex = i;
              break;
            }
          }

          // 如果找到了，就在其末尾添加换行和 FINISHED_TOKEN
          if (lastTextPartIndex !== -1) {
            logDebug(config && config.debugMode, "Injecting FINISHED_TOKEN into model message part.");
            content.parts[lastTextPartIndex].text += "\n" + FINISHED_TOKEN;
          }
        }
      }
    }
  }

  // 如果最后一个content的role为user，且parts数组非空，则在这个数组的最后一个含有非空text的对象里，把REMINDER_PROMPT加进去
  if (Array.isArray(newBody.contents) && newBody.contents.length > 0) {
    const lastContent = newBody.contents[newBody.contents.length - 1];

    // 检查最后一个content的role是否为user，且parts数组非空
    if (lastContent.role === "user" && Array.isArray(lastContent.parts) && lastContent.parts.length > 0) {
      // 找到最后一个含有非空text的对象
      let lastTextPartIndex = -1;
      for (let i = lastContent.parts.length - 1; i >= 0; i--) {
        if (lastContent.parts[i].text && lastContent.parts[i].text.trim() !== "") {
          lastTextPartIndex = i;
          break;
        }
      }

      // 如果找到了含有非空text的对象，则把REMINDER_PROMPT加进去
      if (lastTextPartIndex !== -1) {
        logDebug(config && config.debugMode, "Adding REMINDER_PROMPT to the last user message");
        lastContent.parts[lastTextPartIndex].text += "\n\n---\n" + REMINDER_PROMPT;

        // 加入真实思维链引导词
        if (injectBeginTokenPrompt) {
          logDebug(config && config.debugMode, "Injecting START_OF_THOUGHT as a new model message.");
          newBody.contents.push({ role: "model", parts: [{ text: config.startOfThought }] });
        }
      }
    }
  }

  return newBody;
}

// 这个函数会转义所有正则表达式的特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& 表示匹配到的整个字符串
}

/**
 * Checks if a response text is complete by verifying it ends with the FINISHED_TOKEN.
 * @param {string} text - The response text.
 * @returns {boolean} True if the response is complete.
 */
export function isResponseComplete(text) {
  const escapedFinishedToken = escapeRegExp(FINISHED_TOKEN);
  const regex = new RegExp(`${escapedFinishedToken}\\s*$`);
  return regex.test(text);
}

/**
 * Checks if the formal response has started by looking for the BEGIN_TOKEN.
 * This signifies the end of the 'thought' phase.
 * @param {string} text - The response text.
 * @returns {boolean} True if the formal response has started.
 */
export function isFormalResponseStarted(text) {
  const escapedBeginToken = escapeRegExp(BEGIN_TOKEN);
  const regex = new RegExp(`^${escapedBeginToken}($|[^\`\. ])`);
  return regex.test(text);
}

/**
 * Removes the BEGIN_TOKEN and the FINISHED_TOKEN from the final text.
 * @param {string} text - The complete response text.
 * @param {boolean} cleanBeginToken - Whether to clean the BEGIN_TOKEN. Defaults to true.
 * @param {boolean} cleanFinishToken - Whether to clean the FINISHED_TOKEN. Defaults to true.
 * @returns {string} The cleaned text.
 */
export function cleanFinalText(text, cleanBeginToken = true, cleanFinishToken = true) {
  let cleanedText = text;

  // 1. 清理开头的 BEGIN_TOKEN
  if (cleanBeginToken) {
    const escapedBeginToken = escapeRegExp(BEGIN_TOKEN);
    cleanedText = cleanedText.replace(new RegExp(`^\\s?${escapedBeginToken}\\s?`), "");
  }

  // 2. 清理末尾的 FINISHED_TOKEN
  if (cleanFinishToken) {
    const escapedFinishedToken = escapeRegExp(FINISHED_TOKEN);
    cleanedText = cleanedText.replace(new RegExp(`\\s?${escapedFinishedToken}\\s*$`), "");
  }

  return cleanedText;
}

/**
 * Builds a new request body for a retry attempt.
 * @param {object} currentBody - The current request body (already processed by injectSystemPrompts).
 * @param {string} accumulatedText - The text generated so far.
 * @returns {object} The new request body for the retry.
 */
export function buildRetryRequest(currentBody, newResponseText) {
  const newBody = structuredClone(currentBody);
  normalizeSystemInstruction(newBody);

  if (!Array.isArray(newBody.contents)) {
    newBody.contents = []; // Ensure contents is an array
  }

  const lastContent = newBody.contents.length > 0 ? newBody.contents[newBody.contents.length - 1] : null;

  if (lastContent && lastContent.role === "model") {
    // Last message is from the model, so append the text.
    if (!Array.isArray(lastContent.parts) || lastContent.parts.length === 0) {
      // If parts array is empty or doesn't exist, create it with the new text.
      lastContent.parts = [{ text: newResponseText }];
    } else {
      // Find the last part that has a 'text' property to append to.
      let lastTextPart = null;
      for (let i = lastContent.parts.length - 1; i >= 0; i--) {
        if (lastContent.parts[i].hasOwnProperty('text')) {
          lastTextPart = lastContent.parts[i];
          break;
        }
      }

      if (lastTextPart) {
        // Append newResponseText to the existing text, ensuring it's a string.
        lastTextPart.text = (lastTextPart.text || "") + newResponseText;
      } else {
        // If no text part exists in a non-empty parts array, add a new one.
        lastContent.parts.push({ text: newResponseText });
      }
    }
  } else {
    // Last message is not from the model (or contents is empty), so add a new model message.
    newBody.contents.push({ role: "model", parts: [{ text: newResponseText }] });
  }

  return newBody;
}

/**
 * Builds the upstream request object to be sent to the Gemini API.
 * It transparently forwards necessary headers.
 * @param {string} upstreamUrl - The target Gemini API URL.
 * @param {Request} originalRequest - The original incoming request.
 * @param {object} requestBody - The JSON body for the upstream request.
 * @returns {Request} A new Request object configured for the upstream API.
 */
export function buildUpstreamRequest(upstreamUrl, originalRequest, requestBody) {
  const headers = new Headers();
  const copyHeader = (key) => {
    if (originalRequest.headers.has(key)) {
      headers.set(key, originalRequest.headers.get(key));
    }
  };

  copyHeader("Content-Type");

  // Check if X-Goog-Api-Key is already in headers
  if (!originalRequest.headers.has("X-Goog-Api-Key")) {
    // If not, try to get it from URL params
    try {
      const urlObj = new URL(upstreamUrl);
      const keyParam = urlObj.searchParams.get("key");
      if (keyParam) {
        headers.set("X-Goog-Api-Key", keyParam);
        // Remove key from URL to avoid duplication
        urlObj.searchParams.delete("key");
        upstreamUrl = urlObj.toString();
      }
    } catch (e) {
      // If URL parsing fails, continue without modifying the URL
      console.error("Error parsing upstream URL:", e);
    }
  } else {
    copyHeader("X-Goog-Api-Key");
  }

  // Add custom User-Agent to identify requests from this script
  headers.set("User-Agent", "gemini-anti-truncate-proxy/1.0");

  return new Request(upstreamUrl, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
  });
}

/**
 * 解析 parts 数组，提取思考内容、正式响应内容和函数调用信息
 * @param {Array} parts - 响应中的 parts 数组
 * @returns {object} 包含思考内容、正式响应内容和函数调用信息的对象
 */
export function parseParts(parts) {
  const result = {
    thoughtParts: [],  // 存储完整的 thought 对象
    responseText: "",  // 正式响应文本
    functionCall: null, // 函数调用对象
    hasThought: false,  // 是否包含思考内容
    hasFunctionCall: false // 是否包含函数调用
  };

  if (!Array.isArray(parts)) {
    return result;
  }

  for (const part of parts) {
    // 处理思考内容
    if (part.thought === true && part.text) {
      result.thoughtParts.push(part); // 存储整个 part 对象
      result.hasThought = true;
    }
    // 处理正式响应内容（有text属性但没有thought属性或thought为false）
    else if (part.text && !part.thought) {
      result.responseText += part.text;
    }
    // 处理函数调用
    else if (part.functionCall) {
      result.functionCall = part.functionCall;
      result.hasFunctionCall = true;
    }
  }

  return result;
}

/**
 * 检测是否为结构化输出请求
 * @param {object} requestBody - 请求体对象
 * @returns {boolean} 如果是结构化输出请求返回true，否则返回false
 */
export function isStructuredOutputRequest(requestBody) {
  return requestBody &&
    requestBody.generationConfig &&
    requestBody.generationConfig.responseSchema !== undefined;
}

/**
 * 处理单个 SSE 数据行，解析内容并更新缓冲区
 * @param {string} line - SSE 数据行
 * @param {object} buffers - 包含 textBuffer 和 linesBuffer 的缓冲区对象
 * @param {boolean} debugMode - 是否启用调试模式
 * @param {object} flags - 包含 hasFunctionCallInStream 的标志对象
 * @returns {object} 解析后的数据或 null（如果行不是数据行）
 */
export function processSSEDataLine(line, buffers, debugMode, flags) {
  if (!line.startsWith('data:')) {
    return null;
  }

  const jsonStr = line.substring(5).trim();
  if (!jsonStr) {
    return null;
  }

  // Basic validation of JSON string before parsing
  if (jsonStr.length > 100000) { // Prevent parsing extremely large JSON strings
    if (debugMode) {
      console.log(`[DEBUG ${new Date().toISOString()}] SSE data line too large, skipping:`, line.substring(0, 100) + "...");
    }
    // Don't store malformed lines that are too large
    return null;
  }

  try {
    const data = JSON.parse(jsonStr);

    // Validate the parsed data structure
    if (!data || typeof data !== 'object') {
      throw new Error("Parsed data is not a valid object");
    }

    // Parse parts to extract thoughts, response text, and function calls
    const parts = data?.candidates[0]?.content?.parts || [];
    if (!Array.isArray(parts)) {
      throw new Error("Parts is not a valid array");
    }

    const parsedParts = parseParts(parts);

    // Validate parsedParts structure
    if (!parsedParts || typeof parsedParts !== 'object') {
      throw new Error("Parsed parts is not a valid object");
    }

    // Check if this chunk contains a function call
    if (parsedParts.hasFunctionCall) {
      flags.hasFunctionCallInStream = true;
      if (debugMode) {
        console.log(`[DEBUG ${new Date().toISOString()}] Function call detected in stream. Will continue streaming without retry.`);
      }
    }

    // Validate responseText before accumulating
    if (parsedParts.responseText && typeof parsedParts.responseText === 'string') {
      // Prevent accumulating extremely large text
      if (parsedParts.responseText.length > 50000) {
        if (debugMode) {
          console.log(`[DEBUG ${new Date().toISOString()}] Response text too large, truncating`);
        }
        buffers.textBuffer += parsedParts.responseText.substring(0, 50000);
      } else {
        buffers.textBuffer += parsedParts.responseText;
      }
    }

    // Store the original line with two newlines as separator
    buffers.linesBuffer.push(line);

    // Add a flag to indicate if this line contains only thought content (no response text or function call)
    flags.hasOnlyThoughtContent = parsedParts.hasThought && !parsedParts.responseText && !parsedParts.hasFunctionCall;

    return { data, parsedParts };
  } catch (e) {
    if (debugMode) {
      console.log(`[DEBUG ${new Date().toISOString()}] Could not parse SSE data line:`, line, e);
    }
    // Only store malformed lines if they're not too large
    if (line.length < 100) {
      buffers.linesBuffer.push(line);
    }
    return null;
  }
}
