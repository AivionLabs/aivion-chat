/**
 * Deterministic edit-intent parsing for article_review regenerate chips.
 */

const EDIT_INTENT =
  /\b(regenerat|revis|rewrit|updat|edit|improv|chang|reword|tweak|polish|fix|emphasiz|shorten|lengthen)\w*\b/i;

const ORDINAL_WORDS = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  '1st': 0,
  '2nd': 1,
  '3rd': 2,
  '4th': 3,
  '5th': 4,
};

function recordIdFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.record_id || row.cluster_id || row.id || '').trim();
}

function titleFromRow(row, schema) {
  const field = schema?.title_field || 'title';
  const parts = String(field).split('.');
  let value = row;
  for (const part of parts) {
    if (!value || typeof value !== 'object') return '';
    value = value[part];
  }
  return String(value || row.title || '').trim();
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string | undefined | null} userMessage
 * @param {Record<string, unknown> | null | undefined} schema
 * @returns {{ record_id: string, instructions: string } | null}
 */
function parseRegenerateIntent(userMessage, schema) {
  if (!userMessage || typeof userMessage !== 'string') return null;
  if (!schema || schema.type !== 'article_review') return null;
  if (!schema.source_step_id) return null;
  if (!EDIT_INTENT.test(userMessage)) return null;

  const items = Array.isArray(schema.items) ? schema.items : [];
  if (!items.length) return null;

  const message = userMessage.trim();
  const messageNorm = normalizeText(message);

  for (const item of items) {
    const recordId = recordIdFromRow(item);
    if (recordId && message.includes(recordId)) {
      return { record_id: recordId, instructions: message };
    }
  }

  const ordinalMatch = messageNorm.match(
    /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b(?:\s+article)?/,
  );
  if (ordinalMatch) {
    const index = ORDINAL_WORDS[ordinalMatch[1]];
    if (index != null && items[index]) {
      const recordId = recordIdFromRow(items[index]);
      if (recordId) {
        return { record_id: recordId, instructions: message };
      }
    }
  }

  const numberedMatch = messageNorm.match(/\b(?:article|story|draft|item)\s*#?(\d+)\b/);
  if (numberedMatch) {
    const index = Number(numberedMatch[1]) - 1;
    if (index >= 0 && items[index]) {
      const recordId = recordIdFromRow(items[index]);
      if (recordId) {
        return { record_id: recordId, instructions: message };
      }
    }
  }

  let bestMatch = null;
  let bestLen = 0;
  for (const item of items) {
    const title = titleFromRow(item, schema);
    const titleNorm = normalizeText(title);
    if (titleNorm.length < 4) continue;
    if (messageNorm.includes(titleNorm) && titleNorm.length > bestLen) {
      bestMatch = item;
      bestLen = titleNorm.length;
    }
  }
  if (bestMatch) {
    const recordId = recordIdFromRow(bestMatch);
    if (recordId) {
      return { record_id: recordId, instructions: message };
    }
  }

  if (items.length === 1) {
    const recordId = recordIdFromRow(items[0]);
    if (recordId) {
      return { record_id: recordId, instructions: message };
    }
  }

  return null;
}

module.exports = {
  parseRegenerateIntent,
  recordIdFromRow,
  titleFromRow,
};
