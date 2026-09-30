import log from '/@/main/logger';
import { isSameAlbum } from '/@/shared/utils/album-title';

interface CoverProvider {
    getCover: (
        artistName: string,
        albumTitle: string,
        signal?: AbortSignal,
    ) => Promise<null | string>;
    name: string;
}

type MusicBrainzReleaseGroup = {
    id: string;
    title: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// MusicBrainz allows roughly one request per second.
const MUSICBRAINZ_REQUEST_DELAY_MS = 1100;

// Providers return null when they were reached but had no match, and throw when the
// lookup itself failed. Only the latter is worth retrying.
const getMusicBrainzCover = async (
    artistName: string,
    albumTitle: string,
    signal?: AbortSignal,
): Promise<null | string> => {
    const artistParams = new URLSearchParams({
        fmt: 'json',
        limit: '5',
        query: `artist:"${artistName}"`,
    });
    const artistResponse = await fetch(`https://musicbrainz.org/ws/2/artist/?${artistParams}`, {
        signal,
    });
    if (!artistResponse.ok) {
        throw new Error(`MusicBrainz artist search failed: ${artistResponse.status}`);
    }

    const artistResults = (await artistResponse.json()) as {
        artists?: Array<{ id: string; name: string }>;
    };
    const artist = artistResults.artists?.find((result) => isSameAlbum(result.name, artistName));
    if (!artist) return null;

    await sleep(MUSICBRAINZ_REQUEST_DELAY_MS);

    const releaseGroupParams = new URLSearchParams({
        artist: artist.id,
        fmt: 'json',
        limit: '100',
    });
    const releaseGroupResponse = await fetch(
        `https://musicbrainz.org/ws/2/release-group/?${releaseGroupParams}`,
        { signal },
    );
    if (!releaseGroupResponse.ok) {
        throw new Error(`MusicBrainz release group search failed: ${releaseGroupResponse.status}`);
    }

    const releaseGroupResult = (await releaseGroupResponse.json()) as {
        'release-groups'?: MusicBrainzReleaseGroup[];
    };
    const releaseGroup = releaseGroupResult['release-groups']?.find((group) =>
        isSameAlbum(group.title, albumTitle),
    );

    return releaseGroup
        ? `https://coverartarchive.org/release-group/${releaseGroup.id}/front-250`
        : null;
};

const getITunesCover = async (
    artistName: string,
    albumTitle: string,
    signal?: AbortSignal,
): Promise<null | string> => {
    const params = new URLSearchParams({
        entity: 'album',
        limit: '10',
        term: `${artistName} ${albumTitle}`,
    });
    const response = await fetch(`https://itunes.apple.com/search?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`iTunes album search failed: ${response.status}`);
    }

    const results = (await response.json()) as {
        results?: Array<{ artistName?: string; artworkUrl100?: string; collectionName?: string }>;
    };
    const candidates = (results.results || []).filter(
        (result) =>
            result.artworkUrl100 &&
            result.collectionName &&
            isSameAlbum(result.collectionName, albumTitle),
    );
    // The search term is artist-scoped, so prefer an artist match but accept a
    // title-only one rather than reporting no cover.
    const match =
        candidates.find(
            (candidate) => candidate.artistName && isSameAlbum(candidate.artistName, artistName),
        ) || candidates[0];

    return match?.artworkUrl100?.replace('100x100bb', '600x600bb') || null;
};

// Add new providers here. They are tried in order.
const coverProviders: CoverProvider[] = [
    { getCover: getMusicBrainzCover, name: 'musicbrainz' },
    { getCover: getITunesCover, name: 'itunes' },
];

const RETRY_DELAY_MS = 2000;

export const getExternalAlbumCover = async (
    artistName: string,
    albumTitle: string,
    signal?: AbortSignal,
): Promise<null | string> => {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            await sleep(RETRY_DELAY_MS);
        }

        let didError = false;

        for (const provider of coverProviders) {
            try {
                const cover = await provider.getCover(artistName, albumTitle, signal);
                if (cover) return cover;
            } catch (error) {
                // Another provider may still have the cover.
                didError = true;
                log.warn('Cover provider failed', {
                    albumTitle,
                    artistName,
                    error,
                    provider: provider.name,
                });
            }
        }

        // Every provider was reached and simply had nothing: retrying would ask the
        // same question and get the same answer.
        if (!didError) return null;
    }

    return null;
};
