import { ipcRenderer, IpcRendererEvent } from 'electron';

import type { DownloadAlbumRequest, DownloadProgress } from '../shared/types/download';

const start = (request: DownloadAlbumRequest): Promise<boolean> =>
    ipcRenderer.invoke('download-album', request);

const cancel = (id: string) => ipcRenderer.send('download-cancel', id);

const testConnection = (): Promise<{ error?: string; ok: boolean }> =>
    ipcRenderer.invoke('download-test-connection');

const selectDirectory = (): Promise<null | string> => ipcRenderer.invoke('open-directory-selector');

const onProgress = (cb: (progress: DownloadProgress) => void) => {
    const listener = (_event: IpcRendererEvent, progress: DownloadProgress) => cb(progress);
    ipcRenderer.on('download-progress', listener);
    return () => {
        ipcRenderer.removeListener('download-progress', listener);
    };
};

export const download = { cancel, onProgress, selectDirectory, start, testConnection };
