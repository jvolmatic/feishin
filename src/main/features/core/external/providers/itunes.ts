import log from '/@/main/logger';
import {
    Album,
    ExternalAlbumTrack,
    ExternalArtistAlbumResult,
    ExternalPopularAlbum,
    LibraryItem,
    ServerType,
} from '/@/shared/types/domain-types';
import { isSameAlbum, isSingleOrEpTitle, normalizeAlbumTitle } from '/@/shared/utils/album-title';

interface ArtistAlbumsQuery {
    artistId: string;
    artistName: string;
    serverId: string;
    serverType: ServerType;
}

interface ITunesArtist {
    artistId: number;
    artistName: string;
}

interface ITunesCollection {
    artistId: number;
    artistName: string;
    artworkUrl100?: string;
    collectionId: number;
    collectionName: string;
    collectionType?: string;
    releaseDate?: string;
    trackCount?: number;
    wrapperType: string;
}

const getITunesArtist = async (
    artistName: string,
    signal?: AbortSignal,
): Promise<ITunesArtist | null> => {
    const params = new URLSearchParams({
        entity: 'musicArtist',
        limit: '10',
        term: artistName,
    });
    const response = await fetch(`https://itunes.apple.com/search?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`iTunes artist search failed: ${response.status}`);
    }

    const results = (await response.json()) as { results?: ITunesArtist[] };

    return results.results?.find((result) => isSameAlbum(result.artistName, artistName)) || null;
};

const getITunesCollections = async (
    artistId: number,
    signal?: AbortSignal,
): Promise<ITunesCollection[]> => {
    const params = new URLSearchParams({
        entity: 'album',
        id: String(artistId),
        limit: '200',
    });
    const response = await fetch(`https://itunes.apple.com/lookup?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`iTunes artist lookup failed: ${response.status}`);
    }

    const results = (await response.json()) as { results?: ITunesCollection[] };

    return results.results || [];
};

export const getArtistAlbums = async ({
    artistId,
    artistName,
    serverId,
    serverType,
}: ArtistAlbumsQuery): Promise<ExternalArtistAlbumResult[]> => {
    if (!artistId || !artistName || !serverId) return [];

    const artist = await getITunesArtist(artistName);
    if (!artist) {
        log.warn('No exact iTunes artist match found', { artistName });
        return [];
    }

    const collections = await getITunesCollections(artist.artistId);

    const albums = collections.filter(
        (collection) =>
            collection.wrapperType === 'collection' &&
            collection.collectionType === 'Album' &&
            collection.artistId === artist.artistId,
    );

    // Multiple editions (deluxe, remastered, anniversary...) of the same album: keep
    // the earliest release, since that's the one users are missing.
    const dedupedByTitle = new Map<string, ITunesCollection>();
    for (const album of albums) {
        const key = normalizeAlbumTitle(album.collectionName);
        const existing = dedupedByTitle.get(key);
        if (!existing || (album.releaseDate || '') < (existing.releaseDate || '')) {
            dedupedByTitle.set(key, album);
        }
    }

    const relatedArtist = {
        id: artistId,
        imageId: null,
        imageUrl: null,
        name: artistName,
        userFavorite: false,
        userRating: null,
    };

    const result = [...dedupedByTitle.values()].map((collection) => {
        const releaseYear = collection.releaseDate
            ? new Date(collection.releaseDate).getFullYear()
            : 0;

        return {
            album: {
                _itemType: LibraryItem.ALBUM,
                _serverId: serverId,
                _serverType: serverType,
                albumArtistName: artistName,
                albumArtists: [relatedArtist],
                artists: [relatedArtist],
                blurHash: null,
                comment: null,
                createdAt: '',
                discs: null,
                dominantColor: null,
                duration: null,
                explicitStatus: null,
                gain: null,
                genres: [],
                id: `external:itunes:${collection.collectionId}`,
                imageId: null,
                imageUrl: collection.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
                isCompilation: false,
                lastPlayedAt: null,
                mbzId: null,
                mbzReleaseGroupId: null,
                missing: true,
                name: collection.collectionName,
                originalDate: collection.releaseDate || null,
                originalYear: releaseYear,
                participants: null,
                peak: null,
                playCount: null,
                ratedAt: null,
                recordLabels: [],
                releaseDate: collection.releaseDate || null,
                releaseType: 'album',
                releaseTypes: ['album'],
                releaseYear,
                size: null,
                songCount: collection.trackCount || 0,
                sortName: collection.collectionName,
                starredAt: null,
                tags: null,
                thumbHash: null,
                trackYearRange: null,
                updatedAt: '',
                userFavorite: false,
                userRating: null,
                version: null,
            } satisfies Album,
            popularity: null,
        };
    });

    log.debug('iTunes artist album discovery completed', {
        artistId: artist.artistId,
        artistName,
        available: result.length,
        duplicates: albums.length - result.length,
        skipped:
            collections.filter((collection) => collection.wrapperType === 'collection').length -
            albums.length,
    });

    return result;
};

interface AppleTopAlbumsFeed {
    feed?: {
        results?: Array<{
            artistName: string;
            artworkUrl100?: string;
            id: string;
            name: string;
            releaseDate?: string;
        }>;
    };
}

/** Apple Music's "Top Albums" chart (the same one as music.apple.com/new/top-charts/albums). */
export const getPopularAlbums = async (limit: number): Promise<ExternalPopularAlbum[]> => {
    const response = await fetch(
        `https://rss.marketingtools.apple.com/api/v2/us/music/most-played/${limit}/albums.json`,
    );
    if (!response.ok) {
        throw new Error(`Apple top albums failed: ${response.status}`);
    }

    const feed = (await response.json()) as AppleTopAlbumsFeed;

    const results = (feed.feed?.results || []).filter((album) => !isSingleOrEpTitle(album.name));

    // The chart doesn't include track counts; one batch lookup fills them in (best effort).
    const trackCounts = new Map<string, number>();
    try {
        const lookup = await fetch(
            `https://itunes.apple.com/lookup?id=${results.map((album) => album.id).join(',')}`,
        );
        if (lookup.ok) {
            const { results: collections = [] } = (await lookup.json()) as {
                results?: ITunesCollection[];
            };
            collections.forEach((collection) =>
                trackCounts.set(String(collection.collectionId), collection.trackCount || 0),
            );
        }
    } catch (error) {
        log.warn('Failed to fetch Apple chart track counts', error);
    }

    return results.map((album) => ({
        artistName: album.artistName,
        id: `external:itunes:${album.id}`,
        imageUrl: album.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
        name: album.name,
        releaseDate: album.releaseDate || null,
        trackCount: trackCounts.get(album.id) ?? 0,
    }));
};

export const getAlbumTracks = async (collectionId: string): Promise<ExternalAlbumTrack[]> => {
    const response = await fetch(`https://itunes.apple.com/lookup?id=${collectionId}&entity=song`);
    if (!response.ok) {
        throw new Error(`iTunes album lookup failed: ${response.status}`);
    }

    const { results = [] } = (await response.json()) as {
        results?: Array<{
            discNumber?: number;
            trackName?: string;
            trackNumber?: number;
            wrapperType: string;
        }>;
    };

    const tracks = results.filter((result) => result.wrapperType === 'track' && result.trackName);
    const isMultiDisc = tracks.some((track) => (track.discNumber ?? 1) > 1);

    // Multi-disc albums restart numbering per disc; number them in order across the album.
    return tracks
        .sort(
            (a, b) =>
                (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
                (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
        )
        .map((track, index) => ({
            number: isMultiDisc ? index + 1 : (track.trackNumber ?? index + 1),
            title: track.trackName as string,
        }));
};
