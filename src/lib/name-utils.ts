/**
 * Convert Slack handles / email prefixes like "tiffanypan" into
 * proper "Firstname Lastname" format.
 *
 * Strategy:
 *   1. If the name already contains a space → return as-is (already proper)
 *   2. Check manual overrides for known tricky names
 *   3. Try to match a known first name at the start of the handle,
 *      then capitalize the remainder as the last name
 *   4. Try the same with the email prefix (often more structured)
 *   5. Fall back to the original name unchanged
 */

/** Common first names (English + Chinese-English) for splitting handles */
const FIRST_NAMES = new Set([
  // English names
  "aaron", "adam", "alex", "allen", "amanda", "amber", "amy", "andrew",
  "angela", "anna", "annie", "anthony", "archer", "arthur", "ashley",
  "austin", "ben", "benson", "betty", "brandon", "brian", "bruce",
  "carl", "carol", "charles", "charlie", "chase", "chester", "chris",
  "christian", "christina", "cindy", "claire", "daniel", "danny",
  "darwin", "davin", "david", "derek", "diana", "donald", "doris",
  "dylan", "eddie", "edward", "emily", "emma", "eric", "ester",
  "esther", "ethan", "evan", "fang", "felix", "frank", "fred",
  "gary", "george", "grace", "hank", "hannah", "harry", "henry",
  "howard", "irene", "ivan", "jack", "jacob", "james", "jamie",
  "jane", "jared", "jason", "jasmine", "jax", "jay", "jeff",
  "jennifer", "jenny", "jerry", "jessica", "jim", "jimmy", "joe",
  "joel", "john", "johnny", "jonathan", "joseph", "josh", "joyce",
  "judy", "julia", "justin", "karen", "kate", "katherine", "kathy",
  "keith", "kelly", "ken", "kevin", "kyle", "larry", "laura",
  "leo", "leon", "leslie", "lexie", "lily", "linda", "lisa",
  "luke", "lynn", "mandy", "mark", "martin", "mary", "mason",
  "matt", "matthew", "max", "megan", "melissa", "michael", "mick",
  "mike", "nancy", "nathan", "nella", "nick", "oliver", "oscar",
  "pamela", "patrick", "paul", "peggy", "peter", "phil", "rachel",
  "raku", "ralph", "randy", "raven", "ray", "raymond", "rebecca",
  "reggie", "richard", "rick", "robert", "roger", "ron", "roxie",
  "ryan", "sam", "samuel", "sandy", "sara", "sarah", "scott",
  "sean", "shefali", "sharon", "sophie", "stan", "stanly", "stanley",
  "stephanie", "stephen", "steve", "steven", "susan", "tiffany",
  "tim", "timothy", "tom", "tommy", "tony", "tyler", "victor",
  "vincent", "vivian", "walter", "wayne", "wendy", "will", "william",
  // Chinese/Taiwanese romanized names
  "chao", "chen", "chi", "chia", "chih", "chin", "ching", "chun",
  "chung", "fan", "fang", "feng", "hao", "hsiang", "hsin", "hsuan",
  "hua", "hui", "hung", "jen", "jia", "jing", "jun", "kai",
  "kaiwei", "li", "liang", "lin", "ling", "mei", "ming", "nan",
  "pei", "pin", "po", "rong", "shan", "shih", "shu", "taju",
  "tao", "ting", "tseng", "tzu", "wei", "wen", "ya", "yan",
  "yang", "yi", "yin", "yu", "yuan", "yuching", "yun", "zhi",
]);

/** Manual overrides for handles that can't be auto-split correctly */
const KNOWN_NAMES: Record<string, string | null> = {
  "jdchang": "JD Chang",
  "jd": "JD",
  "jj": "JJ",
  "joelai": "Joe Lai",
  "chihsieh": "Chih Hsieh",
};

/** Service / non-person accounts to skip */
const SKIP_ACCOUNTS = new Set([
  "calyxtwpublic", "uscal1", "uvvis", "slackbot",
]);

/** Names that look like real single names — don't try to split via email */
const SINGLE_NAMES = new Set([
  "raven", "pin", "vivi",
]);

/**
 * Format a raw name (typically a Slack handle) into "Firstname Lastname".
 *
 * @param rawName  - The current name (e.g. "tiffanypan")
 * @param email    - Optional email for fallback splitting (e.g. "tiffanypan@calyxtechs.com")
 * @returns The formatted name, or the original if it can't be improved
 */
export function formatDisplayName(rawName: string, email?: string | null): string {
  if (!rawName) return rawName;

  // Already has a space with 2+ parts → likely already "Firstname Lastname"
  const parts = rawName.trim().split(/\s+/);
  if (parts.length >= 2) return rawName.trim();

  const handle = rawName.trim().toLowerCase();

  // Skip known non-person accounts
  if (SKIP_ACCOUNTS.has(handle)) return rawName;

  // Check manual overrides
  if (KNOWN_NAMES[handle] !== undefined) {
    return KNOWN_NAMES[handle] || rawName;
  }

  // Try to split the handle (and email prefix as fallback)
  const emailPrefix = email
    ? email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "")
    : "";

  // If handle is a known single name, only use structured corporate email (firstlast@company)
  // to avoid weird splits from personal emails like shushu811@gmail.com
  const isSingleName = SINGLE_NAMES.has(handle);
  const isStructuredEmail = email ? /@(?!gmail|yahoo|hotmail|outlook|icloud|aol|proton)/.test(email) : false;
  const sources = isSingleName
    ? (isStructuredEmail ? [emailPrefix] : [])
    : [handle, emailPrefix];

  for (const source of sources) {
    if (!source || source.length < 4) continue;

    // Strip trailing digits
    const clean = source.replace(/\d+$/, "");
    if (clean.length < 4) continue;

    // Exact match = it's just a first name, no last name to extract
    if (FIRST_NAMES.has(clean)) {
      // Try the next source (email) to see if we can get a last name
      if (source === handle && emailPrefix && emailPrefix !== handle) {
        continue; // try email prefix next
      }
      // If email prefix also matches exactly, just capitalize
      return capitalize(clean);
    }

    // Find the longest matching first name
    const matches: string[] = [];
    for (const firstName of FIRST_NAMES) {
      if (clean.startsWith(firstName) && clean.length > firstName.length) {
        matches.push(firstName);
      }
    }

    if (matches.length > 0) {
      // Use longest match to avoid "Jo" matching before "Joel"
      matches.sort((a, b) => b.length - a.length);
      const firstName = matches[0];
      const lastName = clean.slice(firstName.length);

      if (lastName.length >= 2) {
        return capitalize(firstName) + " " + capitalize(lastName);
      }
    }
  }

  // Can't split — return original with first letter capitalized
  return rawName;
}

function capitalize(s: string): string {
  if (!s) return s;
  // Handle hyphenated names: "chih-hsieh" → "Chih-Hsieh"
  return s
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}
