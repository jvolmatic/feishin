import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import styles from './sidebar-download-list.module.css';

import {
    dismissDownload,
    getDownloadPercent,
    useDownloadStore,
} from '/@/renderer/features/artists/store/download.store';
import { AppRoute } from '/@/renderer/router/routes';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Icon } from '/@/shared/components/icon/icon';
import { Progress } from '/@/shared/components/progress/progress';
import { Text } from '/@/shared/components/text/text';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

/**
 * Sidebar section listing in-flight album downloads, plus failed ones until dismissed.
 * Hidden when there is nothing to show.
 */
export const SidebarDownloadList = () => {
    const { t } = useTranslation();
    const downloads = useDownloadStore(useShallow((state) => Object.entries(state.downloads)));

    if (downloads.length === 0) return null;

    return (
        <Accordion.Item value="downloads">
            <Accordion.Control component="div" role="button" style={{ userSelect: 'none' }}>
                <Text fw={500}>{t('page.sidebar.downloads')}</Text>
            </Accordion.Control>
            <Accordion.Panel>
                {downloads.map(([id, { albumName, artistId, artistName, progress }]) => {
                    const isFailed = progress.stage === 'error';

                    return (
                        <div className={styles.row} key={id}>
                            <div className={styles.header}>
                                <Text isNoSelect size="sm" truncate>
                                    {albumName}
                                </Text>
                                {isFailed && (
                                    <>
                                        <Tooltip
                                            label={
                                                progress.error ??
                                                t('download.error', { album: albumName })
                                            }
                                            multiline
                                            withinPortal
                                        >
                                            <span className={styles.errorIcon}>
                                                <Icon color="error" icon="error" />
                                            </span>
                                        </Tooltip>
                                        <ActionIcon
                                            icon="x"
                                            iconProps={{ size: 'sm' }}
                                            onClick={() => dismissDownload(id)}
                                            size="xs"
                                            tooltip={{ label: t('common.close') }}
                                            variant="subtle"
                                        />
                                    </>
                                )}
                            </div>
                            <Text isMuted isNoSelect size="xs" truncate>
                                {artistId ? (
                                    <Link
                                        className={styles.artistLink}
                                        to={generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
                                            albumArtistId: artistId,
                                        })}
                                    >
                                        {artistName}
                                    </Link>
                                ) : (
                                    artistName
                                )}
                                {artistName ? ' - ' : ''}
                                {isFailed
                                    ? t('download.failed')
                                    : t(`download.stage_${progress.stage}`)}
                                {!isFailed && progress.total
                                    ? ` (${progress.done ?? 0}/${progress.total})`
                                    : ''}
                            </Text>
                            {!isFailed && (
                                <Progress
                                    animated={!progress.total}
                                    size="xs"
                                    value={getDownloadPercent(progress)}
                                />
                            )}
                        </div>
                    );
                })}
            </Accordion.Panel>
        </Accordion.Item>
    );
};
