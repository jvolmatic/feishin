import { useQueries, useQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useMemo } from 'react';

import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { useCurrentServer } from '/@/renderer/store';
import { useShowExternalArtists } from '/@/renderer/store/settings.store';
import {
    AlbumArtist,
    AlbumListSort,
    ExternalArtistSearchResult,
    LibraryItem,
    ServerType,
    SortOrder,
} from '/@/shared/types/domain-types';

const normalizeName = (name: string) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A stub artist for an external search result; it opens the external artist page. */
export const createExternalArtist = (
    artist: ExternalArtistSearchResult,
    server?: null | { id: string; type: ServerType },
): AlbumArtist => ({
    _itemType: LibraryItem.ALBUM_ARTIST,
    _serverId: server?.id || '',
    _serverType: server?.type || ServerType.JELLYFIN,
    albumCount: null,
    biography: null,
    blurHash: null,
    dominantColor: null,
    duration: null,
    genres: [],
    id: `external:${artist.name}`,
    imageFallbackUrls: artist.imageFallbackUrls,
    imageId: null,
    imageUrl: artist.imageUrl,
    lastPlayedAt: null,
    mbz: null,
    missing: null,
    name: artist.name,
    playCount: null,
    ratedAt: null,
    similarArtists: null,
    songCount: null,
    starredAt: null,
    thumbHash: null,
    userFavorite: false,
    userRating: null,
});

/**
 * Related artists for the artist `artistName`: the server's own suggestions (if any) plus the
 * external ones. External artists that exist on the server resolve to the real artist, the
 * rest become `external:<name>` stubs that open the external artist page.
 */
export const useRelatedArtists = (artistName: string, serverRelated: AlbumArtist[] = []) => {
    const server = useCurrentServer();
    const showExternalArtists = useShowExternalArtists();
    const detailQuery = useQuery({
        ...searchQueries.externalArtistDetail(artistName),
        enabled: showExternalArtists && Boolean(artistName) && isElectron(),
    });
    const similar = useMemo(
        () => (showExternalArtists ? (detailQuery.data?.similarArtists ?? []) : []),
        [detailQuery.data, showExternalArtists],
    );

    const lookups = useQueries({
        queries: similar.map((artist) => ({
            ...searchQueries.search({
                query: {
                    albumArtistLimit: 5,
                    albumLimit: 0,
                    query: artist.name,
                    songLimit: 0,
                },
                serverId: server?.id,
            }),
            staleTime: 1000 * 60 * 10,
        })),
    });

    // Search counts include featured appearances, so confirm the match owns albums.
    const matchIds = similar.map(
        (artist, index) =>
            lookups[index]?.data?.albumArtists.find(
                (candidate) => normalizeName(candidate.name) === normalizeName(artist.name),
            )?.id,
    );
    const details = useQueries({
        queries: matchIds.map((id) => ({
            ...albumQueries.list({
                query: {
                    artistIds: [id || ''],
                    limit: -1,
                    sortBy: AlbumListSort.NAME,
                    sortOrder: SortOrder.ASC,
                    startIndex: 0,
                },
                serverId: server?.id,
            }),
            enabled: Boolean(id),
        })),
    });
    const detailCounts = details.map((detail, index) =>
        detail.data?.items.filter((album) =>
            album.albumArtists?.some((artist) => artist.id === matchIds[index]),
        ).length,
    );

    const isLoading =
        (showExternalArtists && detailQuery.isLoading) ||
        (similar.length > 0 &&
            (lookups.some((lookup) => lookup.isLoading) ||
                details.some((detail) => detail.isLoading)));
    const lookupData = lookups.map((lookup) => lookup.data);
    const lookupKey = [...lookups, ...details].map((lookup) => lookup.dataUpdatedAt).join(',');

    const artists = useMemo(() => {
        const result = [...serverRelated];
        const seenNames = new Set([normalizeName(artistName)]);
        result.forEach((artist) => seenNames.add(normalizeName(artist.name)));

        similar.forEach((artist, index) => {
            const key = normalizeName(artist.name);
            if (seenNames.has(key)) return;
            seenNames.add(key);

            const match = lookupData[index]?.albumArtists.find(
                (candidate) => normalizeName(candidate.name) === key,
            );
            if (match) {
                const ownCount = detailCounts[index];
                result.push(ownCount === undefined ? match : { ...match, albumCount: ownCount });
                return;
            }

            result.push(createExternalArtist(artist, server));
        });

        return result;
        // lookupData is covered by lookupKey, which changes whenever any lookup resolves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artistName, serverRelated, similar, server?.id, server?.type, lookupKey]);

    return { artists, isLoading };
};
