import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './expanded-album-list-item.module.css';

import { useAlbumTrackPlays } from '/@/renderer/features/albums/hooks/use-album-track-plays';
import artistStyles from '/@/renderer/features/artists/components/album-artist-detail-content.module.css';
import { useExternalAlbumDownload } from '/@/renderer/features/artists/hooks/use-external-album-download';
import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { useFastAverageColor } from '/@/renderer/hooks';
import { useSetGlobalExpanded, useShowExternalPlays } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Center } from '/@/shared/components/center/center';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { Album, Song } from '/@/shared/types/domain-types';

/** The expanded panel for an album that is not in the library: its tracks and a download button. */
export const ExpandedExternalAlbumItem = ({ album }: { album: Album }) => {
    const { t } = useTranslation();
    const setGlobalExpanded = useSetGlobalExpanded();
    const showPlays = useShowExternalPlays();
    const { downloadProgress, handleDownload, isDownloading } = useExternalAlbumDownload(album);

    const color = useFastAverageColor({
        algorithm: 'sqrt',
        id: album.id,
        src: album.imageUrl,
        srcLoaded: true,
    });

    const tracksQuery = useQuery(
        searchQueries.externalAlbumTracks(album.id, album.name, album.albumArtistName),
    );

    // The plays hook works on songs; only the fields it reads are needed here.
    const songs = useMemo(
        () =>
            (tracksQuery.data || []).map(
                (track) =>
                    ({
                        album: album.name,
                        albumArtistName: album.albumArtistName,
                        artistName: album.albumArtistName,
                        name: track.title,
                    }) as Song,
            ),
        [album.albumArtistName, album.name, tracksQuery.data],
    );
    const tracks = useAlbumTrackPlays(songs);

    if (color.isLoading) {
        return <Spinner container />;
    }

    return (
        <motion.div
            animate={{ opacity: 1 }}
            className={styles.container}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            style={{ backgroundColor: color.background }}
        >
            <div className={styles.expanded}>
                <div className={styles.content}>
                    <div className={styles.header}>
                        <div className={styles.headerTitle}>
                            <TextTitle
                                className={clsx(styles.itemTitle, { [styles.dark]: color.isDark })}
                                fw={700}
                                order={4}
                            >
                                {album.name}
                            </TextTitle>
                            <ActionIcon
                                className={styles.closeButton}
                                icon="x"
                                iconProps={{ size: 'xl' }}
                                onClick={() => setGlobalExpanded(null)}
                                radius="50%"
                                size="sm"
                                variant="default"
                            />
                        </div>
                        <Text
                            className={clsx(styles.itemSubtitle, { [styles.dark]: color.isDark })}
                        >
                            {album.albumArtistName}
                        </Text>
                    </div>
                    <div className={clsx(styles.tracks, { [styles.dark]: color.isDark })}>
                        {tracksQuery.isLoading ? (
                            <Center py="md">
                                <Spinner />
                            </Center>
                        ) : (
                            <ScrollArea>
                                <div className={styles.tracksList}>
                                    {tracksQuery.data?.map((track, index) => {
                                        const plays = tracks[index]?.externalPlays;

                                        return (
                                            <Text
                                                className={clsx(styles.trackRow, {
                                                    [styles.withPlays]: showPlays,
                                                })}
                                                key={track.number}
                                                size="sm"
                                            >
                                                <span className={styles.trackNumber}>
                                                    {track.number}
                                                </span>
                                                <span className={styles.trackName}>
                                                    {track.title}
                                                </span>
                                                {showPlays && (
                                                    <span className={styles.trackPlays}>
                                                        {plays === undefined
                                                            ? '...'
                                                            : (plays?.toLocaleString() ?? '-')}
                                                    </span>
                                                )}
                                            </Text>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                </div>
                <div className={styles.imageContainer}>
                    <div
                        className={styles.backgroundImage}
                        style={{
                            ['--bg-color' as string]: color?.background,
                            backgroundImage: `url(${album.imageUrl})`,
                        }}
                    />
                    <div className={styles.playButtonGroup} style={{ opacity: 1 }}>
                        {isDownloading ? (
                            <Text size="sm">
                                {t(`download.stage_${downloadProgress?.stage}`)}
                                {downloadProgress?.total
                                    ? ` (${downloadProgress.done ?? 0}/${downloadProgress.total})`
                                    : ''}
                            </Text>
                        ) : (
                            <ActionIcon
                                className={artistStyles.externalAlbumDownloadButton}
                                icon="download"
                                iconProps={{ size: 'xl' }}
                                onClick={handleDownload}
                                tooltip={{ label: t('download.action') }}
                                variant="filled"
                            />
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
