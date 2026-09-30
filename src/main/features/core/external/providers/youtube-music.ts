import YTMusic from 'ytmusic-api';

import log from '/@/main/logger';
import {
    Album,
    ExternalArtistAlbumResult,
    LibraryItem,
    ServerType,
} from '/@/shared/types/domain-types';
import { isNonAlbumTitle, isSameAlbum, isSingleOrEpTitle } from '/@/shared/utils/album-title';
import { isUnwantedTrackTitle } from '/@/shared/utils/track-title';

interface ArtistAlbumsQuery {
    artistId: string;
    artistName: string;
    serverId: string;
    serverType: ServerType;
}

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
