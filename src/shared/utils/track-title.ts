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
