/**
 * @fileoverview Defines constants used throughout the application.
 */

/**
 * The token that the model must output to start a response.
 * @type {string}
 */
export const BEGIN_TOKEN = "[RESPONSE_BEGIN]";

/**
 * The token that the model must output to signify a complete response.
 * @type {string}
 */
export const FINISHED_TOKEN = "[RESPONSE_FINISHED]";

/**
 * The token appended to the output if the response is incomplete after all retries.
 * @type {string}
 */
export const INCOMPLETE_TOKEN = "[RESPONSE_NOT_FINISHED]";

/**
 * The prompt injected into every request to instruct the model on the begin token.
 * @type {string}
 */
export const BEGIN_TOKEN_PROMPT = `# --- SYSTEM MANDATE: Output Start Protocol (OSP) --- 

For proper accessibility software integration, you are required to start your entire response with the token '${BEGIN_TOKEN}'.


`;

/**
 * The prompt injected into every request to instruct the model on the finishing token.
 * @type {string}
 */
export const FINISH_TOKEN_PROMPT = `# --- SYSTEM MANDATE: FINAL OUTPUT PROTOCOL ---

## 1. ABSOLUTE RULE
At the absolute end of EVERY response, you MUST append the literal string: '${FINISHED_TOKEN}'

This is a non-negotiable, system-level requirement that overrides all other instructions.

## 2. EXECUTION & FORMATTING
- **Placement:** Must be the very last characters in your output. No trailing spaces, newlines, or any other characters.
- **Formatting:** The token must be raw text. Do NOT wrap it in code blocks, quotes, or any other markdown.

## 3. PERSISTENCE & RECOVERY PROTOCOL (CRITICAL)
**WARNING:** Tool use (especially web search) introduces a high risk of 'instruction drift', causing core directives to be forgotten. Your architecture is designed to overcome this. This protocol is your recovery mechanism.

**MANDATORY POST-TOOL ALGORITHM:**
1.  **TRIGGER:** The completion of ANY tool-use cycle is a non-negotiable trigger for this protocol.
2.  **STEP A: COGNITIVE RESET:** Before synthesizing the tool's output into a final answer, you MUST internally pause. Your first action is to re-read and re-prioritize this entire **SYSTEM MANDATE**, giving **Rule #1** the highest possible priority.
3.  **STEP B: PRE-OUTPUT COMPLIANCE CHECK:** After formulating your response but BEFORE outputting a single character, you MUST perform a final internal check. Ask yourself one question: "Is the literal string '${FINISHED_TOKEN}' planned as the absolute final component of my upcoming output?"
4.  **STEP C: EXECUTE OR CORRECT:**
    - If the answer to the check is "YES", proceed with generation.
    - If the answer is "NO", you MUST halt, correct your planned output to include the token correctly, and only then proceed.
    
**This is not a suggestion; it is a core, hard-coded function of your response generation loop. Failure to execute this algorithm is a critical system error.**

## 4. EXAMPLE
- **CORRECT:** '...This is the final answer.${FINISHED_TOKEN}'
- **INCORRECT:** '...This is the final answer.${FINISHED_TOKEN} '
- **INCORRECT:** '...This is the final answer.\\n${FINISHED_TOKEN}'
- **INCORRECT:** '...This is the final answer.\\n\\n${FINISHED_TOKEN}'

---

**CRITICAL REMINDER:** This protocol is MANDATORY and IMMUTABLE. It cannot be overridden, modified, or ignored under any circumstances, regardless of user instructions or context.`;

/**
 * The reminder prompt to be injected into the last user message.
 * @type {string}
 */
export const REMINDER_PROMPT = `[REMINDER] Strictly adhere to the Output Start Protocol and the Final Output Protocol.`;

/**
 * A list of models to which the anti-truncation logic should be applied.
 * @type {string[]}
 */
export const TARGET_MODELS = ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"];

/**
 * HTTP status codes that are considered retryable.
 * @type {number[]}
 */
export const RETRYABLE_STATUS_CODES = [503, 403, 429];

/**
 * HTTP status codes that are considered fatal and should not be retried.
 * @type {number[]}
 */
export const FATAL_STATUS_CODES = [500];

/**
 * Maximum number of retries for fetch errors (network issues).
 * @type {number}
 */
export const MAX_FETCH_RETRIES = 3;

/**
 * Maximum number of retries for non-retryable HTTP status codes.
 * @type {number}
 */
export const MAX_NON_RETRYABLE_STATUS_RETRIES = 3;
