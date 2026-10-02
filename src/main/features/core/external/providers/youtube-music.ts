import YTMusic from 'ytmusic-api';

import { getArtistImage as getDeezerArtistImage } from './deezer';

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
import { isNonAlbumTitle, isSameAlbum, isSingleOrEpTitle } from '/@/shared/utils/album-title';
import { cleanTitle, isUnwantedTrackTitle } from '/@/shared/utils/track-title';

interface ArtistAlbumsQuery {
    artistId: string;
    artistName: string;
    serverId: string;
    serverType: ServerType;
}

// YouTube Music thumbnails encode their size as `=w60-h60...`; ask for a larger version instead.
// Cards only need a small one: many 1200px loads at once get the page rate limited (429).
const upscaleImage = (url?: null | string, size = 400): null | string =>
    url ? url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`) : null;

// Primary image plus any other source as fallbacks, so one failing CDN doesn't blank the artist.
const withFallbackImages = async (name: string, image: null | string) => {
    const [imageUrl = null, ...imageFallbackUrls] = [
        image,
        await getDeezerArtistImage(name),
    ].filter((url): url is string => Boolean(url));
    return { imageFallbackUrls, imageUrl };
};

const normalizeName = (name: string) =>
    name
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '')
        .toLocaleLowerCase();

/** Runs `fn` over `items` with at most `concurrency` tasks in flight at once. */
const mapWithConcurrency = async <T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
): Promise<void> => {
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
};

export const searchArtists = async (query: string): Promise<ExternalArtistSearchResult[]> => {
    const client = new YTMusic();
    await client.initialize();

    const artists = await client.searchArtists(query);
    return Promise.all(
        artists.map(async (artist) => ({
            ...(await withFallbackImages(artist.name, upscaleImage(artist.thumbnails.at(-1)?.url))),
            name: artist.name,
        })),
    );
};

const fetchJson = async <T>(url: string): Promise<null | T> => {
    const response = await fetch(url, { headers: { 'User-Agent': 'Feishin' } });
    return response.ok ? ((await response.json()) as T) : null;
};

type YtNode = { [key: string]: unknown };

// ytmusic-api reads similar artists from a fixed carousel position, which often holds
// playlists instead. Pick the carousel whose entries link to artist channels (UC...).
const findCarousels = (node: unknown, found: YtNode[] = []): YtNode[] => {
    if (Array.isArray(node)) {
        node.forEach((child) => findCarousels(child, found));
    } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
            if (key === 'musicCarouselShelfRenderer') found.push(value as YtNode);
            else findCarousels(value, found);
        }
    }
    return found;
};

const getSimilarArtists = async (
    client: YTMusic,
    artistId: string,
): Promise<ExternalArtistSearchResult[]> => {
    try {
        const data = await (
            client as unknown as {
                constructRequest: (endpoint: string, body: object) => Promise<unknown>;
            }
        ).constructRequest('browse', { browseId: artistId });

        for (const carousel of findCarousels(data)) {
            const items = ((carousel.contents as YtNode[]) || [])
                .map((item) => item.musicTwoRowItemRenderer as undefined | YtNode)
                .filter((item): item is YtNode => Boolean(item));
            const artists = items.flatMap((item): Array<[string, null | string]> => {
                const endpoint = (item.navigationEndpoint as undefined | YtNode)?.browseEndpoint as
                    | undefined
                    | YtNode;
                const title = (item.title as { runs?: Array<{ text: string }> })?.runs?.[0]?.text;
                const thumbs = (
                    item.thumbnailRenderer as {
                        musicThumbnailRenderer?: {
                            thumbnail?: { thumbnails?: Array<{ url: string }> };
                        };
                    }
                )?.musicThumbnailRenderer?.thumbnail?.thumbnails;
                if (!title || !String(endpoint?.browseId).startsWith('UC')) return [];
                return [[title, upscaleImage(thumbs?.at(-1)?.url)]];
            });
            if (artists.length > 0 && artists.length === items.length) {
                return Promise.all(
                    artists.map(async ([name, image]) => ({
                        ...(await withFallbackImages(name, image)),
                        name,
                    })),
                );
            }
        }
    } catch (error) {
        log.warn('Failed to fetch similar YouTube Music artists', error);
    }
    return [];
};

export const getArtistDetail = async (name: string): Promise<ExternalArtistDetail> => {
    const client = new YTMusic();
    await client.initialize();

    const [artist, wikipedia, musicBrainz] = await Promise.all([
        client
            .searchArtists(name)
            .then((results) =>
                results.find((result) => normalizeName(result.name) === normalizeName(name)),
            )
            .then((match) => (match ? client.getArtist(match.artistId) : null))
            .catch(() => null),
        fetchJson<{ extract?: string; type?: string }>(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
        ).catch(() => null),
        fetchJson<{ artists?: Array<{ id: string; name: string }> }>(
            `https://musicbrainz.org/ws/2/artist/?${new URLSearchParams({
                fmt: 'json',
                limit: '5',
                query: `artist:"${name}"`,
            })}`,
        ).catch(() => null),
    ]);

    return {
        biography: wikipedia?.type === 'standard' ? (wikipedia.extract ?? null) : null,
        ...(await withFallbackImages(name, upscaleImage(artist?.thumbnails.at(-1)?.url, 1200))),
        mbzId:
            musicBrainz?.artists?.find(
                (result) => normalizeName(result.name) === normalizeName(name),
            )?.id ?? null,
        name,
        similarArtists: artist ? await getSimilarArtists(client, artist.artistId) : [],
    };
};

/** View counts per track of an album, read from each track's video details. */
export const getAlbumTrackPlays = async (
    artistName: string,
    albumName: string,
): Promise<ExternalAlbumTrackPlays[]> => {
    if (!artistName || !albumName) return [];

    const client = new YTMusic();
    await client.initialize();

    const match = (await client.searchAlbums(`${artistName} ${cleanTitle(albumName)}`)).find(
        (result) =>
            normalizeName(result.artist.name) === normalizeName(artistName) &&
            isSameAlbum(result.name, albumName),
    );
    if (!match) return [];

    const request = (
        client as unknown as {
            constructRequest: (endpoint: string, body: object) => Promise<unknown>;
        }
    ).constructRequest;

    const results: ExternalAlbumTrackPlays[] = [];
    await mapWithConcurrency((await client.getAlbum(match.albumId)).songs, 4, async (song) => {
        try {
            const data = (await request.call(client, 'player', { videoId: song.videoId })) as {
                videoDetails?: { viewCount?: string };
            };
            const plays = Number(data.videoDetails?.viewCount);
            if (Number.isFinite(plays)) results.push({ plays, title: song.name });
        } catch (error) {
            log.warn('Failed to fetch YouTube Music track plays', error);
        }
    });

    return results;
};

export const getArtistAlbums = async ({
    artistId,
    artistName,
    serverId,
    serverType,
}: ArtistAlbumsQuery): Promise<ExternalArtistAlbumResult[]> => {
    if (!artistId || !artistName || !serverId) return [];

    const client = new YTMusic();
    await client.initialize();

    const artist = (await client.searchArtists(artistName)).find(
        (result) => normalizeName(result.name) === normalizeName(artistName),
    );
    if (!artist) {
        log.warn('No exact YouTube Music artist match found', { artistName });
        return [];
    }

    const relatedArtist = {
        id: artistId,
        imageId: null,
        imageUrl: null,
        name: artistName,
        userFavorite: false,
        userRating: null,
    };
    const [allAlbums] = await Promise.all([
        client.getArtistAlbums(artist.artistId).catch((error) => {
            log.warn('Failed to fetch all YouTube Music artist albums', error);
            return [];
        }),
    ]);

    const uniqueAlbums = Array.from(
        new Map(allAlbums.map((album) => [album.name, album] as const)).values(),
    );

    // getArtistAlbums() lists everything on the artist's "Albums" shelf, which mixes in
    // live albums, remixes and bonus discs alongside real studio albums.
    const relevantAlbums = uniqueAlbums.filter((listedAlbum) => {
        if (
            listedAlbum.artist.artistId !== artist.artistId ||
            listedAlbum.artist.name != artist.name
        ) {
            log.debug('Skipping the album with id {albumId}! Probably not a relevant album.', {
                recvArtistId: listedAlbum.artist.artistId,
                recvArtistName: listedAlbum.artist.name,
                wantedArtistId: artist.artistId,
                wantedArtistName: artist.name,
            });
            return false;
        }

        return !isSingleOrEpTitle(listedAlbum.name) && !isNonAlbumTitle(listedAlbum.name);
    });

    // getArtistAlbums() reports the wrong albumId for every entry (it's the artist's own
    // channel id, not a real album id), so track counts can't be read directly off these
    // results. Re-resolve each album's real id via search, then fetch its track count.
    const resolvedAlbums: Array<{
        listedAlbum: (typeof relevantAlbums)[number];
        songCount: number;
    }> = [];

    await mapWithConcurrency(relevantAlbums, 4, async (listedAlbum) => {
        try {
            const searchResults = await client.searchAlbums(`${artist.name} ${listedAlbum.name}`);
            const match = searchResults.find(
                (result) =>
                    result.artist.artistId === artist.artistId &&
                    isSameAlbum(result.name, listedAlbum.name),
            );
            if (!match) {
                log.debug('No YouTube Music album match found for track count lookup', {
                    albumName: listedAlbum.name,
                    artistName,
                });
                return;
            }

            const full = await client.getAlbum(match.albumId);
            // Count only tracks the download keeps (skits, live versions etc. are skipped).
            const songCount = full.songs.filter((song) => !isUnwantedTrackTitle(song.name)).length;
            if (songCount <= 1) return;

            resolvedAlbums.push({ listedAlbum, songCount });
        } catch (error) {
            log.warn('Failed to resolve YouTube Music album track count', error);
        }
    });

    const result = resolvedAlbums.map(({ listedAlbum, songCount }) => {
        const releaseYear = listedAlbum.year;
        const imageUrl = [...listedAlbum.thumbnails].sort((a, b) => b.width - a.width)[0]?.url;

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
                id: `external:youtube-music:${encodeURIComponent(listedAlbum.albumId)}`,
                imageId: null,
                imageUrl: imageUrl || null,
                isCompilation: false,
                lastPlayedAt: null,
                mbzId: null,
                mbzReleaseGroupId: null,
                missing: true,
                name: listedAlbum.name,
                originalDate: releaseYear ? String(releaseYear) : null,
                originalYear: releaseYear || 0,
                participants: null,
                peak: null,
                playCount: null,
                ratedAt: null,
                recordLabels: [],
                releaseDate: releaseYear ? String(releaseYear) : null,
                releaseType: 'album',
                releaseTypes: ['album'],
                releaseYear,
                size: null,
                songCount,
                sortName: listedAlbum.name,
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

    log.debug('YouTube Music artist album discovery completed', {
        artistId: artist.artistId,
        artistName,
        available: result.length,
        skipped: uniqueAlbums.length - relevantAlbums.length,
        unresolved: relevantAlbums.length - resolvedAlbums.length,
    });

    return result;
};

export const getAlbumTracks = async (
    artistName: string,
    albumName: string,
): Promise<ExternalAlbumTrack[]> => {
    if (!artistName || !albumName) return [];

    const client = new YTMusic();
    await client.initialize();

    const match = (await client.searchAlbums(`${artistName} ${cleanTitle(albumName)}`)).find(
        (result) =>
            normalizeName(result.artist.name) === normalizeName(artistName) &&
            isSameAlbum(result.name, albumName),
    );
    if (!match) return [];

    return (await client.getAlbum(match.albumId)).songs.map((song, index) => ({
        number: index + 1,
        title: song.name,
    }));
};
