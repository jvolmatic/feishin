import log from '/@/main/logger';

const cache = new Map<string, null | string>();

const normalize = (name: string) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Artist photo from Deezer's keyless API, used when YouTube Music has none or its CDN fails.
export const getArtistImage = async (name: string): Promise<null | string> => {
    const key = normalize(name);
    if (cache.has(key)) return cache.get(key) ?? null;

    try {
        const response = await fetch(
            `https://api.deezer.com/search/artist?${new URLSearchParams({ limit: '5', q: name })}`,
            { signal: AbortSignal.timeout(8000) },
        );
        if (!response.ok) throw new Error(`Deezer search failed: ${response.status}`);

        const { data } = (await response.json()) as {
            data?: Array<{ name: string; picture_xl?: string }>;
        };
        const image = data?.find((artist) => normalize(artist.name) === key)?.picture_xl ?? null;
        // Deezer serves a generic placeholder (no artist hash in the path) for missing photos.
        const result = image && !/\/images\/artist\/\/\d/.test(image) ? image : null;
        cache.set(key, result);
        return result;
    } catch (error) {
        log.warn('Failed to fetch Deezer artist image', error);
        return null;
    }
};
