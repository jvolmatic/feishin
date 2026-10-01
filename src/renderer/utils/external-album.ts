import { generatePath } from 'react-router';

import { AppRoute } from '/@/renderer/router/routes';

// Mirrors the ids built by the external album providers in the main process.
export const isExternalAlbum = ({ id }: { id: string }) => id.startsWith('external:');

// Stub artists built from external search results use ids of the form `external:<name>`.
export const getAlbumArtistPath = (id: string) =>
    id.startsWith('external:')
        ? generatePath(AppRoute.LIBRARY_EXTERNAL_ARTISTS_DETAIL, {
              artistName: id.slice('external:'.length),
          })
        : generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: id });
