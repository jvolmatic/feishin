import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    GridCarousel,
    GridCarouselSkeletonFallback,
    useGridCarouselContainerQuery,
} from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import { MemoizedItemCard } from '/@/renderer/components/item-card/item-card';
import { useDefaultItemListControls } from '/@/renderer/components/item-list/helpers/item-list-controls';
import { useGridRows } from '/@/renderer/components/item-list/helpers/use-grid-rows';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { AlbumGridItem } from '/@/renderer/features/artists/components/album-artist-detail-content';
import { useCurrentServer } from '/@/renderer/store';
import { isExternalAlbum } from '/@/renderer/utils/external-album';
import { Album, AlbumListSort, LibraryItem, SortOrder } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';
import { normalizeAlbumTitle } from '/@/shared/utils/album-title';

interface ExternalPopularAlbumsProps {
    containerQuery?: ReturnType<typeof useGridCarouselContainerQuery>;
}

const ONE_DAY = 1000 * 60 * 60 * 24;

const noop = () => {};

const normalizeArtist = (name: string) => name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export const ExternalPopularAlbums = ({ containerQuery }: ExternalPopularAlbumsProps) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const rows = useGridRows(LibraryItem.ALBUM, ItemListKey.ALBUM);
    const controls = useDefaultItemListControls();

    const { data: popularAlbums, isLoading } = useQuery(
        albumQueries.externalPopular({ serverId: server?.id, serverType: server?.type }),
    );

    // Look each popular album up in the library so owned ones keep their real controls.
    const libraryMatches = useQueries({
        combine: (results) => results.map((result) => result.data?.items),
        queries: (popularAlbums || []).map((album) =>
            albumQueries.list({
                options: { gcTime: ONE_DAY, staleTime: ONE_DAY },
                query: {
                    limit: 10,
                    searchTerm: album.name,
                    sortBy: AlbumListSort.NAME,
                    sortOrder: SortOrder.ASC,
                    startIndex: 0,
                },
                serverId: server?.id,
            }),
        ),
    });

    const albums = useMemo(
        () =>
            (popularAlbums || []).map((popular, index): Album => {
                const owned = libraryMatches[index]?.find(
                    (album) =>
                        normalizeAlbumTitle(album.name) === normalizeAlbumTitle(popular.name) &&
                        normalizeArtist(album.albumArtistName) ===
                            normalizeArtist(popular.albumArtistName),
                );

                return owned || popular;
            }),
        [popularAlbums, libraryMatches],
    );

    const cards = useMemo(
        () =>
            albums.map((album) => ({
                content: isExternalAlbum(album) ? (
                    <AlbumGridItem
                        album={album}
                        controls={controls}
                        dimExternal={false}
                        releaseType="external"
                        rows={rows}
                    />
                ) : (
                    <MemoizedItemCard
                        controls={controls}
                        data={album}
                        enableExpansion={false}
                        imageFetchPriority="low"
                        itemType={LibraryItem.ALBUM}
                        rows={rows}
                        type="poster"
                        withControls
                    />
                ),
                id: album.id,
            })),
        [albums, controls, rows],
    );

    if (isLoading) {
        return (
            <GridCarouselSkeletonFallback
                containerQuery={containerQuery}
                placeholderItemType={LibraryItem.ALBUM}
                placeholderRows={rows}
                title={t('page.home.popularAlbums')}
            />
        );
    }

    if (cards.length === 0) {
        return null;
    }

    return (
        <GridCarousel
            cards={cards}
            containerQuery={containerQuery}
            onNextPage={noop}
            onPrevPage={noop}
            placeholderItemType={LibraryItem.ALBUM}
            placeholderRows={rows}
            title={t('page.home.popularAlbums')}
        />
    );
};
