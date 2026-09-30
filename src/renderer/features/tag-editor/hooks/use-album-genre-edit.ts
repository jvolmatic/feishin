import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { scanLibraryAndRefresh } from '/@/renderer/features/artists/store/download.store';
import {
    beginMetadataEdit,
    endMetadataEdit,
    useMetadataEditStore,
} from '/@/renderer/features/tag-editor/store/metadata-edit.store';
import { toast } from '/@/shared/components/toast/toast';
import { Album } from '/@/shared/types/domain-types';

/**
 * Adds/removes a genre on every song of an album (files resolved from the download settings).
 * `pending` drives the optimistic UI: genres being added show a loader, genres being removed
 * stay visible and dimmed until the change is written and the server has rescanned.
 */
export const useAlbumGenreEdit = (album: Album | undefined) => {
    const { t } = useTranslation();
    const pending = useMetadataEditStore((state) =>
        state.pending?.albumId === album?.id ? state.pending : null,
    );

    const modify = useCallback(
        async (add: string[], remove: string[]) => {
            if (!album || !beginMetadataEdit({ added: add, albumId: album.id, removed: remove })) {
                return;
            }

            try {
                const result = await window.api.utils.modifyAlbumGenres({
                    add,
                    album: album.name,
                    albumArtist: album.albumArtistName,
                    remove,
                });

                if (!result.success) {
                    toast.error({ message: result.error, title: t('metadataEdit.failed') });
                    return;
                }

                // In-place tag edits do not change folder mtimes, so a quick scan would skip them.
                // Scan only this album's folder.
                await scanLibraryAndRefresh({
                    folder: result.folder,
                    fullScan: true,
                    libraryId: album.songs?.[0]?.libraryId,
                });
            } catch (error) {
                toast.error({ message: String(error), title: t('metadataEdit.failed') });
            } finally {
                endMetadataEdit();
            }
        },
        [album, t],
    );

    return {
        addGenre: (name: string) => modify([name], []),
        pendingAdded: pending?.added ?? [],
        pendingRemoved: pending?.removed ?? [],
        removeGenre: (name: string) => modify([], [name]),
    };
};
