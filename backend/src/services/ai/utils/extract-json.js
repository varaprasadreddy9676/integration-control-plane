/**
 * Shared JSON extraction utility for all AI providers.
 *
 * Different AI providers (OpenAI, Claude, Kimi, Z.ai/GLM) return responses with
 * varying amounts of surrounding prose, markdown formatting, and code fences.
 * This utility handles all known formats robustly and is the single source of
 * truth for JSON parsing across providers.
 *
 * Extraction order (first success wins):
 *   1. Direct JSON.parse of the whole trimmed response
 *   2. All markdown code blocks (```json, ```, etc.) – tries each one
 *   3. Bracket-matched extraction (walks the string character by character)
 *      – with trailing-comma repair on parse failure
 */

/**
 * Remove trailing commas before } or ] so that near-valid JSON from lower-
 * quality providers still parses correctly.
 */
function fixTrailingCommas(text) {
  return text
    .replace(/,(\s*[}\]])/g, '$1') // trailing comma before closing bracket
    .replace(/,\s*$/g, ''); // trailing comma at end of string
}

/**
 * Extract the outermost JSON object or array from `text` using character-level
 * bracket matching.  More reliable than a greedy regex because it respects
 * nested structures and string literals.
 *
 * @param {string} text
 * @param {boolean} arrayExpected  - look for [ ] instead of { }
 * @returns {object|Array|null}
 */
function extractByBracket(text, arrayExpected) {
  const openChar = arrayExpected ? '[' : '{';
  const closeChar = arrayExpected ? ']' : '}';

  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (_) {
          try {
            return JSON.parse(fixTrailingCommas(candidate));
          } catch (_2) {
            // Bracket extraction failed – caller will throw
            return null;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Main entry point.
 *
 * @param {string}  text           Raw text returned by the AI provider
 * @param {boolean} arrayExpected  Whether to expect a JSON array (vs object)
 * @returns {object|Array}
 * @throws {Error} with a descriptive message if no valid JSON can be found
 */
function extractJson(text, arrayExpected = false) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI returned an empty or non-string response');
  }

  const trimmed = text.trim();

  // ── 1. Try direct parse (cleanest case – provider returned pure JSON) ────────
  try {
    const parsed = JSON.parse(trimmed);
    const ok = arrayExpected ? Array.isArray(parsed) : typeof parsed === 'object' && parsed !== null;
    if (ok) return parsed;
  } catch (_) {
    /* fall through */
  }

  // ── 2. Try every markdown code block ─────────────────────────────────────────
  // Matches ```json, ```javascript, ```, etc.
  const codeBlockRe = /```(?:[a-z]*)\s*\n?([\s\S]*?)\s*```/g;
  let match;
  while ((match = codeBlockRe.exec(trimmed)) !== null) {
    const candidate = match[1].trim();
    try {
      const parsed = JSON.parse(candidate);
      const ok = arrayExpected ? Array.isArray(parsed) : typeof parsed === 'object' && parsed !== null;
      if (ok) return parsed;
    } catch (_) {
      // Try with trailing-comma repair
      try {
        const parsed = JSON.parse(fixTrailingCommas(candidate));
        const ok = arrayExpected ? Array.isArray(parsed) : typeof parsed === 'object' && parsed !== null;
        if (ok) return parsed;
      } catch (_2) {
        /* try next code block */
      }
    }
  }

  // ── 3. Character-level bracket extraction ────────────────────────────────────
  const byBracket = extractByBracket(trimmed, arrayExpected);
  if (byBracket !== null) return byBracket;

  // ── Nothing worked ───────────────────────────────────────────────────────────
  const preview = trimmed.length > 120 ? `${trimmed.substring(0, 120)}…` : trimmed;
  throw new Error(`No valid JSON found in AI response. Response: "${preview}"`);
}

module.exports = { extractJson };
