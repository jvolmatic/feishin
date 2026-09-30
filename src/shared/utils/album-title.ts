export const normalizeAlbumTitle = (title: string) =>
    title
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/[^\p{L}\p{N}]/gu, '')
        .toLocaleLowerCase();

export const isSameAlbum = (titleA: string, titleB: string) =>
    normalizeAlbumTitle(titleA) === normalizeAlbumTitle(titleB);

// Catches "<title> - Single" / "<title> - EP" and the no-dash "<title> EP" form some
// providers also return (e.g. "Drill EP").
export const isSingleOrEpTitle = (title: string) => /(-\s*)?\b(single|ep)$/i.test(title.trim());

// Best-effort filter for live albums, remixes, bonus discs and compilations/"greatest
// hits"-style repackages that providers report alongside real studio albums.
export const isNonAlbumTitle = (title: string) =>
    /\b(live|remix(es)?|rmx|disc \d+|disk \d+|instrumental|karaoke|tribute|greatest hits|best of|the collection|anthology|essentials)\b/i.test(
        title,
    );
