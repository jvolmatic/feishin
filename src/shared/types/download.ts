export interface DownloadAlbumRequest {
    album: string;
    artist: string;
    /** Genres written to every downloaded song. */
    genres?: string[];
    id: string;
    year?: null | number;
}

export interface DownloadProgress {
    done?: number;
    error?: string;
    /** Album folder relative to the library root (set on `done`), used to scan only that folder. */
    folder?: string;
    id: string;
    /** Videos yt-dlp reported unavailable and skipped (set on `done`). */
    skipped?: number;
    // 'scanning' is renderer-only: the download is done and the server library is updating.
    stage: 'done' | 'downloading' | 'error' | 'processing' | 'resolving' | 'scanning' | 'uploading';
    total?: number;
}
