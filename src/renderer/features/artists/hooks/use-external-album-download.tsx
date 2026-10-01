import { useTranslation } from 'react-i18next';

import {
    startAlbumDownload,
    useDownloadStore,
} from '/@/renderer/features/artists/store/download.store';
import { DownloadTagsModal } from '/@/renderer/features/tag-editor/components/download-tags-modal';
import { openModal } from '/@/shared/components/modal/modal';
import { Album } from '/@/shared/types/domain-types';

export const useExternalAlbumDownload = (album: Album) => {
    const { t } = useTranslation();
    const downloadProgress = useDownloadStore((state) => state.downloads[album.id]?.progress);
    // A failed download stays in the store as history, but the card goes back to idle.
    const isDownloading =
        downloadProgress !== undefined &&
        downloadProgress.stage !== 'error' &&
        downloadProgress.stage !== 'done';

    const handleDownload = () =>
        openModal({
            children: (
                <DownloadTagsModal
                    album={album.name}
                    artist={album.albumArtistName}
                    onSubmit={(genres) =>
                        startAlbumDownload(
                            {
                                album: album.name,
                                artist: album.albumArtistName,
                                genres,
                                id: album.id,
                                year: album.releaseYear,
                            },
                            album.albumArtists[0]?.id,
                        )
                    }
                />
            ),
            title: t('download.action'),
        });

    return { downloadProgress, handleDownload, isDownloading };
};
