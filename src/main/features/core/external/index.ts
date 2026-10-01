import { ipcMain } from 'electron';

import { getExternalAlbumCover } from './external-album-covers';
import { getArtistAlbums as getITunesArtistAlbums } from './providers/itunes';
import {
    getArtistAlbums as getYouTubeMusicArtistAlbums,
    getArtistDetail as getYouTubeMusicArtistDetail,
    searchArtists as searchYouTubeMusicArtists,
} from './providers/youtube-music';

import log from '/@/main/logger';
import {
    ExternalArtistAlbumResult,
    ExternalArtistDetail,
    ExternalArtistSearchResult,
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
        isAvailable: () => true,
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
