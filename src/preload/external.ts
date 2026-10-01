import { ipcRenderer } from 'electron';

import { ExternalArtistAlbumsQuery } from '../main/features/core/external';

import {
    ExternalAlbumTrackPlays,
    ExternalArtistAlbumResult,
    ExternalArtistDetail,
    ExternalArtistSearchResult,
} from '/@/shared/types/domain-types';

const getArtistAlbums = (query: ExternalArtistAlbumsQuery): Promise<ExternalArtistAlbumResult[]> =>
    ipcRenderer.invoke('external-artist-albums', query);

const searchArtists = (query: string): Promise<ExternalArtistSearchResult[]> =>
    ipcRenderer.invoke('external-search-artists', query);

const getArtistDetail = (name: string): Promise<ExternalArtistDetail | null> =>
    ipcRenderer.invoke('external-artist-detail', name);

const getAlbumTrackPlays = (
    artistName: string,
    albumName: string,
): Promise<ExternalAlbumTrackPlays[]> =>
    ipcRenderer.invoke('external-album-track-plays', artistName, albumName);

export const external = { getAlbumTrackPlays, getArtistAlbums, getArtistDetail, searchArtists };
