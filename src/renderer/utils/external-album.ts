import { useCallback } from 'react';
import { generatePath } from 'react-router';

import { AppRoute } from '/@/renderer/router/routes';
import { useExternalAlbumFilterSettings, useSettingsStore } from '/@/renderer/store/settings.store';
import { Album } from '/@/shared/types/domain-types';
import {
    isNonAlbumTitle,
    isSingleOrEpTitle,
    normalizeAlbumTitle,
} from '/@/shared/utils/album-title';

// Mirrors the ids built by the external album providers in the main process.
export const isExternalAlbum = ({ id }: { id: string }) => id.startsWith('external:');

// Stub artists built from external search results use ids of the form `external:<name>`.
export const getAlbumArtistPath = (id: string) =>
    id.startsWith('external:')
        ? generatePath(AppRoute.LIBRARY_EXTERNAL_ARTISTS_DETAIL, {
              artistName: id.slice('external:'.length),
          })
        : generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: id });

const getHiddenKey = (album: Album) =>
    `${album.albumArtistName.toLowerCase()}:${normalizeAlbumTitle(album.name)}`;

export const hideExternalAlbum = (album: Album) => {
    const { actions, general } = useSettingsStore.getState();
    actions.setSettings({
        general: {
            ...general,
            hiddenExternalAlbums: [...general.hiddenExternalAlbums, getHiddenKey(album)],
        },
    });
};

// Returns a filter for external album results that applies the user's single/EP, live/remix
// and hidden-album settings.
export const useExternalAlbumFilter = () => {
    const { hidden, showNonAlbums, showSingles } = useExternalAlbumFilterSettings();

    return useCallback(
        (album: Album) => {
            const isSingle = isSingleOrEpTitle(album.name) || album.songCount === 1;
            if (isSingle && !showSingles) return false;
            if (isNonAlbumTitle(album.name) && !showNonAlbums) return false;
            return !hidden.includes(getHiddenKey(album));
        },
        [hidden, showNonAlbums, showSingles],
    );
};
