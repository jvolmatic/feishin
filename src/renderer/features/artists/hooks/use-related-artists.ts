import { useQueries, useQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useMemo } from 'react';

import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { useCurrentServer } from '/@/renderer/store';
import { useShowExternalArtists } from '/@/renderer/store/settings.store';
import {
    AlbumArtist,
    AlbumArtistListSort,
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

    // The server's own suggestions can include artists that are not album artists, so verify too
    const candidates = useMemo(() => [...serverRelated, ...similar], [serverRelated, similar]);

    const lookups = useQueries({
        queries: candidates.map((artist) => ({
            ...artistsQueries.albumArtistList({
                query: {
                    limit: 5,
                    searchTerm: artist.name,
                    sortBy: AlbumArtistListSort.NAME,
                    sortOrder: SortOrder.ASC,
                    startIndex: 0,
                },
                serverId: server?.id,
            }),
            staleTime: 1000 * 60 * 10,
        })),
    });

    const isLoading =
        (showExternalArtists && detailQuery.isLoading) ||
        (candidates.length > 0 && lookups.some((lookup) => lookup.isLoading));
    const lookupData = lookups.map((lookup) => lookup.data);
    const lookupKey = lookups.map((lookup) => lookup.dataUpdatedAt).join(',');

    const artists = useMemo(() => {
        const result: AlbumArtist[] = [];
        const seenNames = new Set([normalizeName(artistName)]);

        candidates.forEach((artist, index) => {
            const key = normalizeName(artist.name);
            if (seenNames.has(key)) return;
            seenNames.add(key);

            const match = lookupData[index]?.items.find(
                (candidate) => normalizeName(candidate.name) === key,
            );
            if (match) {
                result.push(match);
                return;
            }

            // Server suggestions keep their own image; only the id changes so it opens the stub page.
            if ('_itemType' in artist) {
                result.push({
                    ...artist,
                    albumCount: null,
                    id: `external:${artist.name}`,
                    songCount: null,
                });
                return;
            }

            result.push(createExternalArtist(artist, server));
        });

        return result;
        // lookupData is covered by lookupKey, which changes whenever any lookup resolves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artistName, candidates, server?.id, server?.type, lookupKey]);

    return { artists, isLoading };
};
