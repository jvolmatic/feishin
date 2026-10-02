const UNWANTED_TRACK_KEYWORDS = [
    '(skit)',
    'live_from',
    'live from',
    'radio version',
    'radio_version',
    'instrumental',
    'clean version',
    'remix version',
    '(live)',
    'a cappella',
    'acappella',
];

/**
 * Tracks skipped by album downloads. Also used when counting an external album's tracks so
 * the displayed count matches what actually gets downloaded.
 */
export const isUnwantedTrackTitle = (title: string) => {
    const lower = title.toLowerCase();
    return UNWANTED_TRACK_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const REMASTER_SUFFIX =
    /\s*[([][^)\]]*remaster(?:ed)?[^)\]]*[)\]]|\s+-\s+[^-]*remaster(?:ed)?[^-]*$/gi;

/** Strips provider noise from a title, e.g. "(2005 Remaster)", "[The Remaster]", "- Remastered 2011". */
export const cleanTitle = (title: string) => title.replace(REMASTER_SUFFIX, '').trim();

/** Lowercased title without diacritics, punctuation or remaster suffixes, for comparing titles across sources. */
export const normalizeTitle = (title: string) =>
    cleanTitle(title)
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '')
        .toLocaleLowerCase();

const FEATURE_CREDIT = /\s*[([]\s*(?:feat\b|ft\b|featuring\b|with\b)[^)\]]*[)\]]/gi;
const TRAILING_FEATURE_CREDIT = /\s+(?:feat\.?|ft\.?|featuring)\s.*$/i;

/** Like `normalizeTitle`, but ignores featured artists so "(feat. A & B)" equals "(feat. B & A)". */
export const normalizeTrackKey = (title: string) =>
    normalizeTitle(title.replace(FEATURE_CREDIT, '').replace(TRAILING_FEATURE_CREDIT, ''));
