/**
 * Conversation Engine for Cleopatra VII Chatbot
 * Provides advanced natural language understanding, pattern matching,
 * word-boundary protection, intent scoring, conversational variety,
 * and dynamic suggestion chips.
 */

/**
 * Normalizes text for matching:
 * - Lowercases
 * - Removes apostrophes/single quotes so contractions match (e.g. "what's" -> "whats")
 * - Replaces non-alphanumeric punctuation with spaces
 * - Collapses repeated whitespace
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes characters for RegExp constructor
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a message contains a keyword or phrase matching on word boundaries.
 * Prevents substring false positives (e.g. "hi" matching inside "historians", "this", "which").
 */
export function matchesKeyword(message, rawKeyword) {
  const normMessage = normalizeText(message);
  const normKeyword = normalizeText(rawKeyword);
  if (!normKeyword || !normMessage) return false;

  const pattern = `(^|\\s)${escapeRegex(normKeyword)}(\\s|$)`;
  const regex = new RegExp(pattern, 'i');
  return regex.test(normMessage);
}

/**
 * Calculates a match score for a response entry against the user message.
 * Supports:
 * - Direct regex pattern matching (`entry.patterns`)
 * - Natural language keyword & phrase matching with word boundaries (`entry.keywords`)
 * - Priority weights and length bonuses
 * - Greeting protection against false triggers in long questions
 */
export function scoreResponseEntry(entry, rawMessage, normalizedMessage) {
  let score = 0;
  let hasPatternMatch = false;
  const msgWords = normalizedMessage.split(' ').filter(Boolean);
  const msgWordCount = msgWords.length;

  // 1. Check natural language regex patterns if present (highest confidence)
  if (Array.isArray(entry.patterns)) {
    for (const patternStr of entry.patterns) {
      try {
        const regex = new RegExp(patternStr, 'i');
        if (regex.test(rawMessage) || regex.test(normalizedMessage)) {
          hasPatternMatch = true;
          score += 35; // Strong boost for natural language pattern match
          break;
        }
      } catch {
        // Ignore invalid regex in user config
      }
    }
  }

  // 2. Check keyword and phrase matches
  let keywordMatchCount = 0;
  for (const rawKeyword of entry.keywords || []) {
    if (matchesKeyword(normalizedMessage, rawKeyword)) {
      keywordMatchCount++;
      const normKeyword = normalizeText(rawKeyword);
      const keywordWords = normKeyword.split(' ').filter(Boolean).length;

      // Multi-word phrase matches carry much higher specificity
      let weight = keywordWords * 7;

      // Exact full match bonus (e.g. user typed literally "who are you")
      if (normKeyword === normalizedMessage) {
        weight += 20;
      }

      score += weight;
    }
  }

  if (!hasPatternMatch && keywordMatchCount === 0) {
    return 0;
  }

  // Add explicit priority if defined on the entry
  if (typeof entry.priority === 'number') {
    score += entry.priority;
  }

  // Category adjustments:
  // Pure greetings (e.g., "hi", "hello there", "good morning", "yo") get a high boost when short.
  // When a message is long and asks a specific topic ("hi cleopatra, did a snake really bite you?"),
  // the specific topic keywords and patterns will naturally outscore the greeting.
  if (entry.category === 'greeting') {
    if (msgWordCount <= 3) {
      score += 25; // High confidence for pure greeting
    } else {
      score = Math.min(score, 6); // Cap greeting score if part of a long question
    }
  } else if (entry.category === 'courtesy' || entry.category === 'how_are_you' || entry.category === 'identity') {
    if (msgWordCount <= 6) {
      score += 15;
    }
  }

  return score;
}

/**
 * Selects a reply from an entry, supporting either a string `reply` or an array `replies`.
 * When an array is provided, it avoids repeating the most recent assistant message if possible.
 */
export function selectReply(entry, history = []) {
  if (Array.isArray(entry.replies) && entry.replies.length > 0) {
    const lastAssistantMsg = [...history].reverse().find((m) => m.role === 'assistant')?.content;
    const candidates = entry.replies.filter((r) => r !== lastAssistantMsg);
    const pool = candidates.length > 0 ? candidates : entry.replies;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }
  return entry.reply || '';
}

/**
 * Selects a fallback reply when no keywords match.
 */
export function selectFallback(figure, history = []) {
  if (Array.isArray(figure.fallbackReplies) && figure.fallbackReplies.length > 0) {
    const lastAssistantMsg = [...history].reverse().find((m) => m.role === 'assistant')?.content;
    const candidates = figure.fallbackReplies.filter((r) => r !== lastAssistantMsg);
    const pool = candidates.length > 0 ? candidates : figure.fallbackReplies;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }
  return (
    figure.default ||
    'You ask a question that echoes across the centuries. Tell me what aspects of my life or era you would like to explore.'
  );
}

/**
 * Resolves the best response and suggestions for a given figure, user message, and chat history.
 */
export function generateChatResponse(figure, rawMessage, history = []) {
  if (!figure) {
    throw new Error('Figure data is required');
  }

  const normalizedMessage = normalizeText(rawMessage);
  if (!normalizedMessage) {
    return {
      reply: selectFallback(figure, history),
      suggestions: figure.defaultSuggestions || figure.prompts || [],
      matchedCategory: 'fallback',
    };
  }

  let bestEntry = null;
  let highestScore = 0;

  for (const entry of figure.responses || []) {
    const score = scoreResponseEntry(entry, rawMessage, normalizedMessage);
    if (score > highestScore) {
      highestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && highestScore > 0) {
    return {
      reply: selectReply(bestEntry, history),
      suggestions: bestEntry.suggestions || figure.defaultSuggestions || figure.prompts || [],
      matchedCategory: bestEntry.category || 'topic',
    };
  }

  return {
    reply: selectFallback(figure, history),
    suggestions: figure.defaultSuggestions || figure.prompts || [],
    matchedCategory: 'fallback',
  };
}
