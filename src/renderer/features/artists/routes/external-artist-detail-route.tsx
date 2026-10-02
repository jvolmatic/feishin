import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';

import styles from '../components/album-artist-detail-content.module.css';

import { useDefaultItemListControls } from '/@/renderer/components/item-list/helpers/item-list-controls';
import { useGridRows } from '/@/renderer/components/item-list/helpers/use-grid-rows';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import {
    AlbumArtistMetadataExternalLinks,
    AlbumSection,
    getItemsPerRow,
} from '/@/renderer/features/artists/components/album-artist-detail-content';
import { AlbumArtistGridCarousel } from '/@/renderer/features/artists/components/album-artist-grid-carousel';
import { useRelatedArtists } from '/@/renderer/features/artists/hooks/use-related-artists';
import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import {
    LibraryBackgroundImage,
    LibraryBackgroundOverlay,
} from '/@/renderer/features/shared/components/library-background-overlay';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeader } from '/@/renderer/features/shared/components/library-header';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useContainerQuery } from '/@/renderer/hooks';
import { useFastAverageColor } from '/@/renderer/hooks';
import { AppRoute } from '/@/renderer/router/routes';
import { useArtistBackground, useCurrentServer } from '/@/renderer/store';
import { useExternalLinks } from '/@/renderer/store/settings.store';
import { sanitize } from '/@/renderer/utils/sanitize';
import { useExternalAlbumFilter } from '/@/renderer/utils/external-album';
import { Grid } from '/@/shared/components/grid/grid';
import { Spoiler } from '/@/shared/components/spoiler/spoiler';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { AlbumArtist, LibraryItem } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

const ExternalArtistDetailRoute = () => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const { artistName = '' } = useParams() as { artistName?: string };
    const location = useLocation();
    const headerRef = useRef<HTMLDivElement>(null);
    const { artistBackground, artistBackgroundBlur } = useArtistBackground();
    const stateImageUrl: null | string | undefined =
        location.state?.imageUrl ?? location.state?.item?.imageUrl;
    const controls = useDefaultItemListControls();
    const rows = useGridRows(LibraryItem.ALBUM, ItemListKey.ALBUM);
    const cq = useContainerQuery({
        '2xl': 1280,
        '3xl': 1440,
        lg: 960,
        md: 720,
        sm: 520,
        xl: 1152,
        xs: 360,
    });

    const { externalLinks, lastFM, listenBrainz, musicBrainz, nativeSpotify, qobuz, spotify } =
        useExternalLinks();
    const detailQuery = useQuery(searchQueries.externalArtistDetail(artistName));
    const detail = detailQuery.data;
    // Prefer the image of the card that was clicked (a URL or a server image id) so the page matches it.
    const stateItem: AlbumArtist | undefined = location.state?.item;
    const hasStateImage = Boolean(stateImageUrl || stateItem?.imageId);
    const imageUrl = stateImageUrl || (stateItem?.imageId ? undefined : detail?.imageUrl);
    const imageFallbackUrls = hasStateImage ? stateItem?.imageFallbackUrls : detail?.imageFallbackUrls;
    const { background } = useFastAverageColor({ id: artistName, src: imageUrl, srcLoaded: true });

    const { artists: similarArtists, isLoading: isRelatedLoading } = useRelatedArtists(artistName);

    const albumsQuery = useQuery(
        albumQueries.externalAlbums({
            query: { artistId: `external:${artistName}`, artistName },
            serverId: server?.id,
            serverType: server?.type,
        }),
    );

    const externalAlbumFilter = useExternalAlbumFilter();

    // Same ranking as the regular artist page: popularity first, then newest.
    const rankedAlbums = useMemo(
        () =>
            (albumsQuery.data || [])
                .filter(({ album }) => externalAlbumFilter(album))
                .sort((a, b) => {
                    if (a.popularity !== b.popularity) {
                        if (a.popularity === null) return 1;
                        if (b.popularity === null) return -1;
                        return b.popularity - a.popularity;
                    }

                    const yearA = a.album.releaseYear || a.album.originalYear || 0;
                    const yearB = b.album.releaseYear || b.album.originalYear || 0;
                    return yearB - yearA;
                })
                .map(({ album }) => album),
        [albumsQuery.data, externalAlbumFilter],
    );

    return (
        <AnimatedPage>
            <NativeScrollArea>
                {artistBackground ? (
                    <LibraryBackgroundImage
                        blur={artistBackgroundBlur}
                        headerRef={headerRef}
                        imageUrl={imageUrl || ''}
                    />
                ) : (
                    <LibraryBackgroundOverlay backgroundColor={background} headerRef={headerRef} />
                )}
                <LibraryContainer>
                    <LibraryHeader
                        imageFallbackUrls={imageFallbackUrls}
                        imageUrl={imageUrl}
                        item={{
                            imageId: stateItem?.imageId,
                            imageUrl,
                            route: AppRoute.LIBRARY_ALBUM_ARTISTS,
                            type: LibraryItem.ALBUM_ARTIST,
                        }}
                        ref={headerRef}
                        title={artistName}
                    >
                        <Stack gap="md" w="100%">
                            <Text
                                isMuted
                            >{`${rankedAlbums.length} ${t('entity.album', { count: rankedAlbums.length }).toLowerCase()}`}</Text>
                            <div style={{ height: '2.5rem' }} />
                        </Stack>
                    </LibraryHeader>
                    <div className={styles.contentContainer}>
                        <div className={styles.detailContainer}>
                            {/* Takes the place of the action row on the regular artist page. */}
                            <div style={{ height: '2.5rem' }} />
                            <Grid gap="2xl">
                                <AlbumArtistMetadataExternalLinks
                                    artistName={artistName}
                                    externalLinks={externalLinks}
                                    lastFM={lastFM}
                                    listenBrainz={listenBrainz}
                                    mbzId={detail?.mbzId}
                                    musicBrainz={musicBrainz}
                                    nativeSpotify={nativeSpotify}
                                    order={0}
                                    qobuz={qobuz}
                                    spotify={spotify}
                                />
                                {detail?.biography && (
                                    <Grid.Col order={1} span={12}>
                                        <section style={{ maxWidth: '1280px' }}>
                                            <TextTitle fw={700} order={3}>
                                                {t('page.albumArtistDetail.about', {
                                                    artist: artistName,
                                                })}
                                            </TextTitle>
                                            <Spoiler>
                                                <Text
                                                    dangerouslySetInnerHTML={{
                                                        __html: sanitize(detail.biography),
                                                    }}
                                                />
                                            </Spoiler>
                                        </section>
                                    </Grid.Col>
                                )}
                                <Grid.Col order={2} span={12}>
                                    <div ref={cq.ref}>
                                        {cq.isCalculated && (
                                            <AlbumSection
                                                albums={rankedAlbums}
                                                controls={controls}
                                                isLoading={albumsQuery.isLoading}
                                                itemsPerRow={getItemsPerRow(cq)}
                                                releaseType="external"
                                                rows={rows}
                                                title={t('page.albumArtistDetail.availableAlbums')}
                                            />
                                        )}
                                    </div>
                                </Grid.Col>
                                <Grid.Col order={3} span={12}>
                                    <AlbumArtistGridCarousel
                                        data={similarArtists}
                                        excludeIds={[`external:${artistName}`]}
                                        isLoading={isRelatedLoading}
                                        title={t('page.albumArtistDetail.relatedArtists')}
                                    />
                                </Grid.Col>
                            </Grid>
                        </div>
                    </div>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const ExternalArtistDetailRouteWithBoundary = () => {
    const { artistName } = useParams() as { artistName?: string };

    return (
        <PageErrorBoundary>
            <ExternalArtistDetailRoute key={artistName} />
        </PageErrorBoundary>
    );
};

export default ExternalArtistDetailRouteWithBoundary;
