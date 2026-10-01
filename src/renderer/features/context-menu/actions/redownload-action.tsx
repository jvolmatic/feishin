import isElectron from 'is-electron';
import { useTranslation } from 'react-i18next';

import { startAlbumDownload } from '/@/renderer/features/artists/store/download.store';
import { DownloadTagsModal } from '/@/renderer/features/tag-editor/components/download-tags-modal';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { openModal } from '/@/shared/components/modal/modal';
import { Album } from '/@/shared/types/domain-types';

interface RedownloadActionProps {
    album?: Album;
    disabled?: boolean;
}

/** Downloads the album again from the external source into the configured library. */
export const RedownloadAction = ({ album, disabled }: RedownloadActionProps) => {
    const { t } = useTranslation();

    if (!isElectron() || !album) return null;

    const onSelect = () =>
        openModal({
            children: (
                <DownloadTagsModal
                    album={album.name}
                    artist={album.albumArtistName}
                    initialGenres={album.genres?.map((g) => g.name)}
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
            title: t('page.contextMenu.redownloadExternal'),
        });

    return (
        <ContextMenu.Item disabled={disabled} leftIcon="download" onSelect={onSelect}>
            {t('page.contextMenu.redownloadExternal')}
        </ContextMenu.Item>
    );
};
