export interface DownloadAlbumRequest {
    album: string;
    artist: string;
    id: string;
    year?: null | number;
}

export interface DownloadProgress {
    done?: number;
    error?: string;
    id: string;
    // 'scanning' is renderer-only: the download is done and the server library is updating.
    stage: 'done' | 'downloading' | 'error' | 'processing' | 'resolving' | 'scanning' | 'uploading';
    total?: number;
}
