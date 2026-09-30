import { ipcRenderer } from 'electron';

import { ExternalArtistAlbumsQuery } from '../main/features/core/external';

import { ExternalArtistAlbumResult } from '/@/shared/types/domain-types';

const getArtistAlbums = (query: ExternalArtistAlbumsQuery): Promise<ExternalArtistAlbumResult[]> =>
    ipcRenderer.invoke('external-artist-albums', query);

export const external = { getArtistAlbums };
