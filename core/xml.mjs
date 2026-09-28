/* A deliberately small XML reader.
 *
 * Not a parser. It pulls flat text elements out of repeated record blocks,
 * which is exactly the shape the Safety Gate export has and nothing more. A
 * real parser would be a dependency, and this tool has none.
 *
 * What it does not do, stated plainly so nobody assumes otherwise:
 *   attributes, namespaces, nested records, CDATA sections containing markup,
 *   or anything requiring a document model. If the export shape ever changes to
 *   need those, this file gets replaced rather than extended.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** Every `<tag>...</tag>` block in a document, as raw inner text. */
export function blocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** The text of the first `<tag>` inside a block, entity-decoded and trimmed. */
export function text(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block ?? '');
  if (!m) return null;
  const value = decodeEntities(m[1])
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value === '' ? null : value;
}

/** Every occurrence of `<tag>` in a block, for repeated fields. */
export function texts(block, tag) {
  return blocks(block ?? '', tag)
    .map((b) => decodeEntities(b).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
