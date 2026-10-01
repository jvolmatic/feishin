import { useTranslation } from 'react-i18next';

import {
    startAlbumDownload,
    useDownloadStore,
} from '/@/renderer/features/artists/store/download.store';
import { DownloadTagsModal } from '/@/renderer/features/tag-editor/components/download-tags-modal';
import { openModal } from '/@/shared/components/modal/modal';
import { Album } from '/@/shared/types/domain-types';
import { DownloadAlbumRequest } from '/@/shared/types/download';

export interface ExternalDownloadTarget {
    album: string;
    artist: string;
    artistId?: string;
    id: string;
    year?: null | number;
}

export const albumToDownloadTarget = (album: Album): ExternalDownloadTarget => ({
    album: album.name,
    artist: album.albumArtistName,
    artistId: album.albumArtists[0]?.id,
    id: album.id,
    year: album.releaseYear,
});

export const trackDownloadId = (albumId: string, trackNumber: number) =>
    `${albumId}:track:${trackNumber}`;

/** Opens the tag modal, then starts the download. `extra` narrows it to some of the album's tracks. */
export const openDownloadModal = (
    target: ExternalDownloadTarget,
    title: string,
    extra: Pick<DownloadAlbumRequest, 'items' | 'onlyTitles' | 'skipTitles'> & { id?: string } = {},
) =>
    openModal({
        children: (
            <DownloadTagsModal
                album={target.album}
                artist={target.artist}
                onSubmit={(genres) =>
                    startAlbumDownload(
                        {
                            album: target.album,
                            artist: target.artist,
                            genres,
                            year: target.year,
                            ...extra,
                            id: extra.id ?? target.id,
                        },
                        target.artistId,
                    )
                }
                submitLabel={title}
            />
        ),
        title,
    });

export const isDownloadActive = (stage?: string) =>
    stage !== undefined && stage !== 'error' && stage !== 'done';

export const useExternalAlbumDownload = (target: ExternalDownloadTarget) => {
    const { t } = useTranslation();
    const downloadProgress = useDownloadStore((state) => state.downloads[target.id]?.progress);
    // A failed download stays in the store as history, but the card goes back to idle.
    const isDownloading = isDownloadActive(downloadProgress?.stage);

    const handleDownload = (extra?: Parameters<typeof openDownloadModal>[2]) =>
        openDownloadModal(
            target,
            t(extra?.items ? 'download.missingAction' : 'download.action'),
            extra,
        );

    const handleDownloadTrack = (track: { number: number; title: string }) => {
        const id = trackDownloadId(target.id, track.number);
        if (isDownloadActive(useDownloadStore.getState().downloads[id]?.progress.stage)) return;
        openDownloadModal(target, t('download.trackAction'), {
            id,
            items: [track.number],
            onlyTitles: [track.title],
        });
    };

    return { downloadProgress, handleDownload, handleDownloadTrack, isDownloading };
};
