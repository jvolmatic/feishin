import { ipcMain } from 'electron';

import { getExternalAlbumCover } from './external-album-covers';
import {
    getAlbumTracks as getITunesAlbumTracks,
    getArtistAlbums as getITunesArtistAlbums,
    getPopularAlbums as getITunesPopularAlbums,
} from './providers/itunes';
import {
    getAlbumTrackPlays as getYouTubeMusicAlbumTrackPlays,
    getAlbumTracks as getYouTubeMusicAlbumTracks,
    getArtistAlbums as getYouTubeMusicArtistAlbums,
    getArtistDetail as getYouTubeMusicArtistDetail,
    searchArtists as searchYouTubeMusicArtists,
} from './providers/youtube-music';

import log from '/@/main/logger';
import {
    Album,
    ExternalAlbumTrack,
    ExternalAlbumTrackPlays,
    ExternalArtistAlbumResult,
    ExternalArtistDetail,
    ExternalArtistSearchResult,
    LibraryItem,
    ServerType,
} from '/@/shared/types/domain-types';
import { normalizeAlbumTitle } from '/@/shared/utils/album-title';

export interface ExternalArtistAlbumsQuery {
    artistId: string;
    artistName: string;
    serverId: string;
    serverType: ServerType;
}

interface ExternalAlbumProvider {
    getAlbums: (query: ExternalArtistAlbumsQuery) => Promise<ExternalArtistAlbumResult[]>;
    isAvailable: (query: ExternalArtistAlbumsQuery) => boolean;
}

// Add new providers here. Order matters as a tie-breaker: when two providers report the
// same album with no popularity signal, the first provider listed here wins.
const albumProviders: Record<string, ExternalAlbumProvider> = {
    itunes: {
        getAlbums: getITunesArtistAlbums,
        isAvailable: () => false,
    },
    youtubeMusic: {
        getAlbums: getYouTubeMusicArtistAlbums,
        isAvailable: () => true,
    },
};

const getExternalArtistAlbums = async (
    query: ExternalArtistAlbumsQuery,
): Promise<ExternalArtistAlbumResult[]> => {
    const providers = Object.entries(albumProviders)
        .filter(([, provider]) => provider.isAvailable(query))
        .map(([, provider]) => provider);

    const results = await Promise.allSettled(
        providers.map((provider) => provider.getAlbums(query)),
    );

    const albums = results
        .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
        .filter((result) => (result.album.songCount ?? 0) > 1);

    // Merge same album reported by multiple providers into one entry: prefer the
    // result with the highest popularity (falling back to provider order), and pool
    // every provider's images so a missing cover from one provider can fall back to
    // another's.
    const merged = new Map<
        string,
        { images: Set<string>; result: ExternalArtistAlbumResult; youtubeSongCount?: number }
    >();

    // Downloads come from YouTube Music, so its (filtered) track count is the one that matches
    // what will actually be downloaded, even when another provider's entry is preferred.
    const getYoutubeSongCount = (result: ExternalArtistAlbumResult) =>
        result.album.id.startsWith('external:youtube-music:')
            ? (result.album.songCount ?? undefined)
            : undefined;

    for (const result of albums) {
        const key = normalizeAlbumTitle(result.album.name);
        const existing = merged.get(key);

        if (!existing) {
            const images = new Set<string>();
            if (result.album.imageUrl) images.add(result.album.imageUrl);
            result.album.imageFallbackUrls?.forEach((imageUrl) => images.add(imageUrl));
            merged.set(key, { images, result, youtubeSongCount: getYoutubeSongCount(result) });
            continue;
        }

        existing.youtubeSongCount ??= getYoutubeSongCount(result);

        if (result.album.imageUrl) existing.images.add(result.album.imageUrl);
        result.album.imageFallbackUrls?.forEach((imageUrl) => existing.images.add(imageUrl));

        const preferResult =
            result.popularity !== null &&
            (existing.result.popularity === null || result.popularity > existing.result.popularity);
        if (preferResult) existing.result = result;
    }

    return Promise.all(
        [...merged.values()].map(async ({ images, result, youtubeSongCount }) => {
            if (images.size === 0) {
                try {
                    const cover = await getExternalAlbumCover(query.artistName, result.album.name);
                    if (cover) images.add(cover);
                } catch (error) {
                    // Keep the result without a cover if every lookup is unavailable.
                    log.warn('Failed to fetch external album cover', error);
                }
            }

            const [imageUrl, ...imageFallbackUrls] = images;

            return {
                ...result,
                album: {
                    ...result.album,
                    imageFallbackUrls,
                    imageUrl: imageUrl || result.album.imageUrl,
                    songCount: youtubeSongCount ?? result.album.songCount,
                },
            };
        }),
    );
};

ipcMain.handle(
    'external-artist-albums',
    async (_event, query: ExternalArtistAlbumsQuery): Promise<ExternalArtistAlbumResult[]> => {
        try {
            return await getExternalArtistAlbums(query);
        } catch (error) {
            log.warn('Failed to fetch external artist albums', error);
            return [];
        }
    },
);

ipcMain.handle(
    'external-search-artists',
    async (_event, query: string): Promise<ExternalArtistSearchResult[]> => {
        try {
            return await searchYouTubeMusicArtists(query);
        } catch (error) {
            log.warn('Failed to search external artists', error);
            return [];
        }
    },
);

ipcMain.handle(
    'external-album-track-plays',
    async (_event, artistName: string, albumName: string): Promise<ExternalAlbumTrackPlays[]> => {
        try {
            return await getYouTubeMusicAlbumTrackPlays(artistName, albumName);
        } catch (error) {
            log.warn('Failed to fetch external album track plays', error);
            return [];
        }
    },
);

ipcMain.handle(
    'external-artist-detail',
    async (_event, name: string): Promise<ExternalArtistDetail | null> => {
        try {
            return await getYouTubeMusicArtistDetail(name);
        } catch (error) {
            log.warn('Failed to fetch external artist detail', error);
            return null;
        }
    },
);

export interface ExternalPopularAlbumsQuery {
    serverId: string;
    serverType: ServerType;
}

const POPULAR_ALBUMS_LIMIT = 100;

const getExternalPopularAlbums = async ({
    serverId,
    serverType,
}: ExternalPopularAlbumsQuery): Promise<Album[]> => {
    const albums = await getITunesPopularAlbums(POPULAR_ALBUMS_LIMIT);

    return albums.map(({ artistName, id, imageUrl, name, releaseDate, trackCount }) => {
        const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : 0;

        const artist = {
            id: `external:${artistName}`,
            imageId: null,
            imageUrl: null,
            name: artistName,
            userFavorite: false,
            userRating: null,
        };

        return {
            _itemType: LibraryItem.ALBUM,
            _serverId: serverId,
            _serverType: serverType,
            albumArtistName: artistName,
            albumArtists: [artist],
            artists: [artist],
            blurHash: null,
            comment: null,
            createdAt: '',
            discs: null,
            dominantColor: null,
            duration: null,
            explicitStatus: null,
            gain: null,
            genres: [],
            id,
            imageId: null,
            imageUrl,
            isCompilation: false,
            lastPlayedAt: null,
            mbzId: null,
            mbzReleaseGroupId: null,
            missing: true,
            name,
            originalDate: releaseDate,
            originalYear: releaseYear,
            participants: null,
            peak: null,
            playCount: null,
            ratedAt: null,
            recordLabels: [],
            releaseDate,
            releaseType: 'album',
            releaseTypes: ['album'],
            releaseYear,
            size: null,
            songCount: trackCount,
            sortName: name,
            starredAt: null,
            tags: null,
            thumbHash: null,
            trackYearRange: null,
            updatedAt: '',
            userFavorite: false,
            userRating: null,
            version: null,
        } satisfies Album;
    });
};

ipcMain.handle(
    'external-popular-albums',
    async (_event, query: ExternalPopularAlbumsQuery): Promise<Album[]> => {
        try {
            return await getExternalPopularAlbums(query);
        } catch (error) {
            log.warn('Failed to fetch external popular albums', error);
            return [];
        }
    },
);

export interface ExternalAlbumTracksQuery {
    albumId: string;
    albumName: string;
    artistName: string;
}

const ITUNES_ID_PREFIX = 'external:itunes:';

ipcMain.handle(
    'external-album-tracks',
    async (_event, query: ExternalAlbumTracksQuery): Promise<ExternalAlbumTrack[]> => {
        try {
            return query.albumId.startsWith(ITUNES_ID_PREFIX)
                ? await getITunesAlbumTracks(query.albumId.slice(ITUNES_ID_PREFIX.length))
                : await getYouTubeMusicAlbumTracks(query.artistName, query.albumName);
        } catch (error) {
            log.warn('Failed to fetch external album tracks', error);
            return [];
        }
    },
);
