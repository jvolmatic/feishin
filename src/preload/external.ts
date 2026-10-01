import { ipcRenderer } from 'electron';

import {
    ExternalAlbumTracksQuery,
    ExternalArtistAlbumsQuery,
    ExternalPopularAlbumsQuery,
} from '../main/features/core/external';

import {
    Album,
    ExternalAlbumTrack,
    ExternalAlbumTrackPlays,
    ExternalArtistAlbumResult,
    ExternalArtistDetail,
    ExternalArtistSearchResult,
} from '/@/shared/types/domain-types';

const getArtistAlbums = (query: ExternalArtistAlbumsQuery): Promise<ExternalArtistAlbumResult[]> =>
    ipcRenderer.invoke('external-artist-albums', query);

const getAlbumTracks = (query: ExternalAlbumTracksQuery): Promise<ExternalAlbumTrack[]> =>
    ipcRenderer.invoke('external-album-tracks', query);

const getPopularAlbums = (query: ExternalPopularAlbumsQuery): Promise<Album[]> =>
    ipcRenderer.invoke('external-popular-albums', query);

const searchArtists = (query: string): Promise<ExternalArtistSearchResult[]> =>
    ipcRenderer.invoke('external-search-artists', query);

const getArtistDetail = (name: string): Promise<ExternalArtistDetail | null> =>
    ipcRenderer.invoke('external-artist-detail', name);

const getAlbumTrackPlays = (
    artistName: string,
    albumName: string,
): Promise<ExternalAlbumTrackPlays[]> =>
    ipcRenderer.invoke('external-album-track-plays', artistName, albumName);

export const external = {
    getAlbumTrackPlays,
    getAlbumTracks,
    getArtistAlbums,
    getArtistDetail,
    getPopularAlbums,
    searchArtists,
};
