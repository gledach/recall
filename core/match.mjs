/* Deciding whether a notice is about a thing you own.
 *
 * This is the whole difficulty of the tool. A recall notice is prose written by
 * a regulator; an inventory entry is whatever a person copied off a label. The
 * two rarely share a format and often disagree about spacing, hyphens and case.
 *
 * Two failure modes, and they are not symmetrical:
 *
 *   Crying wolf. Match too loosely and every run reports a dozen things that
 *   turn out to be unrelated. People stop reading, and then miss the real one.
 *
 *   Silence. Match too tightly and the recall that mattered goes unreported,
 *   which is worse and completely invisible.
 *
 * The compromise is to report generously but grade honestly. Nothing here ever
 * says "you are affected". It says how the match was made and how much weight
 * that deserves, and the caller shows the grade next to every result.
 *
 *   exact     an identifier matched: product and version, or make, model and year
 *   strong    make and model both appear in the notice text
 *   weak      a distinctive model number appears, but the make does not
 *   mention   only the make appears. Almost always noise, reported last
 */

export const CONFIDENCE = ['exact', 'strong', 'weak', 'mention'];

/** Model numbers survive being written a dozen ways. Reduce them to one. */
export function normalise(value) {
  if (value === null || value === undefined) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Words, for make matching, where spacing is meaningful and punctuation is not. */
export function words(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/* A short alphanumeric run matches far too much prose. "A3" appears in any
   document long enough, and a four-character model would fire on half the
   register. Eight is where false positives stopped dominating in testing. */
const MIN_DISTINCTIVE_LENGTH = 6;

/* Identifiers a person copies off a pack rather than describes: a barcode on a
   consumer product, a PZN on a German medicine pack. Both are digits printed by
   the manufacturer and reprinted verbatim by the register. */
const EXACT_IDENTIFIERS = [
  ['barcode', 'barcode'],
  ['pzn', 'PZN'],
];

export function isDistinctive(model) {
  const n = normalise(model);
  if (n.length < MIN_DISTINCTIVE_LENGTH) return false;
  // Require at least one digit and one letter: pure words are not model numbers.
  return /[0-9]/.test(n) && /[A-Z]/.test(n);
}

/**
 * @param {object} item     an inventory entry
 * @param {object} notice   { title, description, make, model, ... } from a source
 * @returns {{ confidence: string, reason: string, score: number } | null}
 */
export function matchNotice(item, notice) {
  const haystackRaw = [notice.title, notice.description, notice.product, notice.make, notice.model]
    .filter(Boolean)
    .join(' ');
  const haystack = normalise(haystackRaw);
  const haystackWords = new Set(words(haystackRaw));

  const itemModel = normalise(item.model);
  const itemMakeWords = words(item.make);
  const makeAppears = itemMakeWords.length > 0 && itemMakeWords.every((w) => haystackWords.has(w));
  const modelAppears = itemModel.length > 0 && haystack.includes(itemModel);

  /* Numbers printed on the box are the best signal any of these registers
     offers. The user copies the digits and the register prints the same digits,
     so no prose is involved and nothing can be misread. Checked before
     everything else for that reason. */
  for (const [field, name] of EXACT_IDENTIFIERS) {
    const mine = normalise(item[field]);
    if (mine && normalise(notice[field]) === mine) {
      return { confidence: 'exact', reason: `${name} ${item[field]} matches exactly`, score: 100 };
    }
  }

  /* A source that matched on an identifier has already done the work, and its
     answer beats anything text matching could conclude. */
  if (notice.matchedIdentifier) {
    return {
      confidence: 'exact',
      reason: `${notice.source} matched on ${notice.matchedIdentifier}`,
      score: 100,
    };
  }

  if (makeAppears && modelAppears) {
    return {
      confidence: 'strong',
      reason: `both "${item.make}" and "${item.model}" appear in the notice`,
      score: 80,
    };
  }

  if (modelAppears && isDistinctive(item.model)) {
    return {
      confidence: 'weak',
      reason: `"${item.model}" appears, but "${item.make}" does not. Check it is the same product`,
      score: 50,
    };
  }

  /* Some kinds carry a name instead of a make and a model. A medicine is
     "Pantoprazol-Micro Labs 40 mg magensaftresistente Tabletten": one string
     doing both jobs, and the user will have written some prefix of it.
     Requiring every word the user wrote to appear lets a short entry match a
     long official name without letting a long entry match loosely. */
  const nameWords = words(item.name);
  if (nameWords.length > 0 && nameWords.every((w) => haystackWords.has(w))) {
    /* One word is usually an active ingredient rather than a product, which
       matches every pack containing it. Worth reporting, not worth trusting. */
    const specific = nameWords.length > 1;
    return {
      confidence: specific ? 'strong' : 'weak',
      reason: specific
        ? `every word of "${item.name}" appears in the notice`
        : `"${item.name}" appears, but it is one word and may name an ingredient rather than your exact product`,
      score: specific ? 75 : 45,
    };
  }

  if (makeAppears && item.make) {
    return {
      confidence: 'mention',
      reason: `only "${item.make}" appears. Probably a different product from the same maker`,
      score: 10,
    };
  }

  return null;
}

/**
 * Match one item against many notices, best first, with the noise last.
 * @param {object} item
 * @param {object[]} notices
 * @param {{ minConfidence?: string }} [opts]
 */
export function matchAll(item, notices, { minConfidence = 'weak' } = {}) {
  const floor = CONFIDENCE.indexOf(minConfidence);
  const out = [];

  for (const notice of notices) {
    const m = matchNotice(item, notice);
    if (!m) continue;
    if (CONFIDENCE.indexOf(m.confidence) > floor) continue;
    out.push({ ...m, notice });
  }

  return out.sort((a, b) => b.score - a.score || (b.notice.date ?? 0) - (a.notice.date ?? 0));
}

/** A stable id for a match, so the same notice is not reported twice. */
export function noticeKey(item, notice) {
  const id = notice.id ?? normalise(notice.title).slice(0, 40);
  return `${item.id}|${notice.source}|${id}`;
}
