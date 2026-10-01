import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useDefaultItemListControls } from '/@/renderer/components/item-list/helpers/item-list-controls';
import { useGridRows } from '/@/renderer/components/item-list/helpers/use-grid-rows';
import { ItemGridList } from '/@/renderer/components/item-list/item-grid-list/item-grid-list';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { createExternalArtist } from '/@/renderer/features/artists/hooks/use-related-artists';
import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { useCurrentServer, useListSettings } from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import {
    AlbumArtist,
    AlbumArtistListSort,
    LibraryItem,
    SortOrder,
} from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

const normalizeName = (name: string) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Library artists first, then external matches that are not already in the library. */
export const ArtistSearchGrid = ({ searchTerm }: { searchTerm: string }) => {
    const server = useCurrentServer();
    const { grid } = useListSettings(ItemListKey.ARTIST);
    const controls = useDefaultItemListControls();
    const rows = useGridRows(LibraryItem.ALBUM_ARTIST, ItemListKey.ARTIST, grid.size);

    const localQuery = useQuery(
        artistsQueries.albumArtistList({
            query: {
                limit: 100,
                searchTerm,
                sortBy: AlbumArtistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId: server?.id,
        }),
    );
    const externalQuery = useQuery({
        ...searchQueries.externalArtists(searchTerm),
        enabled: searchTerm.length >= 2,
    });

    const data = useMemo<AlbumArtist[]>(() => {
        const local = localQuery.data?.items ?? [];
        const known = new Set(local.map((artist) => normalizeName(artist.name)));
        const external = (externalQuery.data ?? [])
            .filter((artist) => !known.has(normalizeName(artist.name)))
            .map((artist) => createExternalArtist(artist, server));
        return [...local, ...external];
    }, [localQuery.data, externalQuery.data, server]);

    if (localQuery.isLoading) return <Spinner container />;

    return (
        <ItemGridList
            data={data}
            enableDrag={false}
            enableMultiSelect={false}
            gap={grid.itemGap}
            itemsPerRow={grid.itemsPerRowEnabled ? grid.itemsPerRow : undefined}
            itemType={LibraryItem.ALBUM_ARTIST}
            overrideControls={controls}
            rows={rows}
            size={grid.size}
        />
    );
};
