import { generatePath } from 'react-router';
import { createWithEqualityFn } from 'zustand/traditional';

import i18n from '/@/i18n/i18n';
import { api } from '/@/renderer/api';
import { invalidateLibraryQueriesAfterScan } from '/@/renderer/features/shared/hooks/use-scan-status';
import { queryClient } from '/@/renderer/lib/react-query';
import { AppRoute } from '/@/renderer/router/routes';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { logger } from '/@/renderer/utils/logger';
import { toast } from '/@/shared/components/toast/toast';
import { AlbumArtistListSort, SongListSort, SortOrder } from '/@/shared/types/domain-types';
import { DownloadAlbumRequest, DownloadProgress } from '/@/shared/types/download';

interface DownloadEntry {
    albumName: string;
    artistId?: string;
    artistName: string;
    progress: DownloadProgress;
}

interface DownloadStore {
    downloads: Record<string, DownloadEntry>;
}

/**
 * Tracks in-flight album downloads. The download itself runs in the main process, so this
 * store (fed by a single app-wide listener) lets any component show progress even after
 * the component that started the download has unmounted.
 */
export const useDownloadStore = createWithEqualityFn<DownloadStore>()(() => ({ downloads: {} }));

// Overall percentage: resolving 0-5, downloading 5-70, processing 70-80, uploading 80-100.
export const getDownloadPercent = ({ done = 0, stage, total }: DownloadProgress) => {
    const fraction = total ? done / total : 0;
    switch (stage) {
        case 'downloading':
            return 5 + fraction * 65;
        case 'processing':
            return 75;
        case 'scanning':
            return 100;
        case 'uploading':
            return 80 + fraction * 20;
        default:
            return 5;
    }
};

const setEntry = (id: string, entry: DownloadEntry | null) =>
    useDownloadStore.setState((state) => {
        const downloads = { ...state.downloads };
        if (entry) downloads[id] = entry;
        else delete downloads[id];
        return { downloads };
    });

const MIN_SCAN_WAIT_MS = 5000;
const SCAN_POLL_MS = 2000;
const SCAN_MAX_POLLS = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the server to scan, waits at least 5 seconds, waits for the scan to end, then refetches
 * library queries. Starting a scan needs admin rights; for other users the API layer would show
 * a "not authorized" error toast, so it is skipped and we rely on the server noticing changes.
 */
export const scanLibraryAndRefresh = async ({
    artistId,
    folder,
    fullScan = false,
    libraryId,
}: {
    artistId?: string;
    folder?: string;
    fullScan?: boolean;
    libraryId?: null | number;
} = {}) => {
    const server = useAuthStore.getState().currentServer;
    const serverId = server?.id;
    if (!serverId) return;
    const canScan = Boolean(server.isAdmin);

    // Navidrome scans a single folder with `target` = "<libraryId>:<folder>". The library id is
    // the song's, or the server's only library; if it is ambiguous, scan everything instead.
    let targets: (string | undefined)[] = [undefined];
    if (canScan && folder) {
        let id = libraryId ?? undefined;
        // A song by the same album artist tells us which library the artist lives in.
        if (id === undefined && artistId) {
            try {
                const songs = await api.controller.getSongList({
                    apiClientProps: { serverId },
                    query: {
                        albumArtistIds: [artistId],
                        limit: 1,
                        sortBy: SongListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                });
                id = songs?.items[0]?.libraryId ?? undefined;
            } catch (error) {
                logger.warn('Failed to look up the artist library', { error });
            }
        }
        if (id === undefined) {
            try {
                const folders = await api.controller.getMusicFolderList({
                    apiClientProps: { serverId },
                    query: null,
                });
                if (folders?.items.length === 1) id = Number(folders.items[0].id);
                // Still ambiguous: scan the folder in each library (a missing folder is a no-op).
                else if (folders?.items.length) {
                    targets = folders.items.map((f) => `${f.id}:${folder}`);
                }
            } catch (error) {
                logger.warn('Failed to list libraries for targeted scan', { error });
            }
        }
        if (id !== undefined && !Number.isNaN(id)) targets = [`${id}:${folder}`];
    }

    if (canScan) {
        for (const target of targets) {
            try {
                await api.controller.startLibraryScan({
                    apiClientProps: { serverId },
                    query: { fullScan, target },
                });
            } catch (error) {
                logger.warn('Failed to start library scan', { error, target });
            }
        }
    }

    await sleep(MIN_SCAN_WAIT_MS);

    for (let i = 0; canScan && i < SCAN_MAX_POLLS; i += 1) {
        try {
            const status = await api.controller.getScanStatus({ apiClientProps: { serverId } });
            if (!status?.scanning) break;
        } catch {
            break;
        }
        await sleep(SCAN_POLL_MS);
    }

    await invalidateLibraryQueriesAfterScan(queryClient, serverId);
};

/**
 * An album downloaded from an external (not yet in the library) artist page creates that artist
 * on the server. If the user is still on that page, swap it for the new artist page.
 */
const openNewArtist = async (name: string) => {
    const serverId = useAuthStore.getState().currentServer?.id;
    if (!serverId) return;

    const externalPath = generatePath(AppRoute.LIBRARY_EXTERNAL_ARTISTS_DETAIL, {
        artistName: name,
    });
    const isOnExternalPage = () =>
        decodeURIComponent(window.location.hash.slice(1)) === decodeURIComponent(externalPath);
    if (!isOnExternalPage()) return;

    try {
        const { items } = await api.controller.getAlbumArtistList({
            apiClientProps: { serverId },
            query: {
                limit: 10,
                searchTerm: name,
                sortBy: AlbumArtistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
        });
        const normalize = (value: string) =>
            value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const artist = items.find((item) => normalize(item.name) === normalize(name));
        if (artist && isOnExternalPage()) {
            window.location.hash = generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
                albumArtistId: artist.id,
            });
        }
    } catch (error) {
        logger.warn('Failed to open the new artist page', { error });
    }
};

// Finished downloads waiting for the scan that runs once every download has ended.
const pendingScans: {
    entry: DownloadEntry | undefined;
    folder?: string;
    id: string;
    skipped: number;
}[] = [];

const ENDED_STAGES: DownloadProgress['stage'][] = ['done', 'error', 'scanning'];

/**
 * Scans once no download is still running (failed ones do not block). A lone download gets a
 * scan of just its folder; several get a single quick scan instead of one scan each.
 */
const flushPendingScans = async () => {
    const downloads = Object.values(useDownloadStore.getState().downloads);
    if (downloads.some(({ progress }) => !ENDED_STAGES.includes(progress.stage))) return;
    if (pendingScans.length === 0) return;

    const batch = pendingScans.splice(0);
    await scanLibraryAndRefresh(
        batch.length === 1 ? { artistId: batch[0].entry?.artistId, folder: batch[0].folder } : {},
    );

    for (const { entry, id, skipped } of batch) {
        if (entry?.artistId?.startsWith('external:')) void openNewArtist(entry.artistName);
        // Kept so the sidebar can show the warning until dismissed.
        setEntry(
            id,
            skipped > 0
                ? {
                      albumName: entry?.albumName ?? '',
                      artistId: entry?.artistId,
                      artistName: entry?.artistName ?? '',
                      progress: { id, skipped, stage: 'done' },
                  }
                : null,
        );
    }
};

/**
 * After a download finishes: keep the entry in a "scanning" state (so the album card shows a
 * loader) until the scan has run. That moves the album from "available albums" into "albums".
 */
const queueScanAfterDownload = (
    id: string,
    entry: DownloadEntry | undefined,
    folder?: string,
    skipped = 0,
) => {
    if (!useAuthStore.getState().currentServer?.id) {
        setEntry(id, skipped > 0 ? { ...entry!, progress: { id, skipped, stage: 'done' } } : null);
        return;
    }

    setEntry(id, {
        albumName: entry?.albumName ?? '',
        artistId: entry?.artistId,
        artistName: entry?.artistName ?? '',
        progress: { id, stage: 'scanning' },
    });

    pendingScans.push({ entry, folder, id, skipped });
    void flushPendingScans();
};

export const dismissDownload = (id: string) => setEntry(id, null);

export const startAlbumDownload = async (request: DownloadAlbumRequest, artistId?: string) => {
    setEntry(request.id, {
        albumName: request.album,
        artistId,
        artistName: request.artist,
        progress: { id: request.id, stage: 'resolving' },
    });
    const started = await window.api.download.start(request);
    if (started) {
        toast.info({ message: i18n.t('download.started', { album: request.album }) as string });
    } else {
        setEntry(request.id, null);
        void flushPendingScans();
    }
};

/** Subscribes to main-process progress events. Call once at app startup (Electron only). */
export const initDownloadListener = () =>
    window.api.download.onProgress((progress) => {
        const entry = useDownloadStore.getState().downloads[progress.id];
        const album = entry?.albumName ?? '';

        if (progress.stage === 'done') {
            queueScanAfterDownload(progress.id, entry, progress.folder, progress.skipped);
            toast.success({ message: i18n.t('download.done', { album }) as string });
        } else if (progress.stage === 'error') {
            // Kept so the sidebar can show failed downloads until dismissed.
            setEntry(progress.id, {
                albumName: album,
                artistId: entry?.artistId,
                artistName: entry?.artistName ?? '',
                progress,
            });
            void flushPendingScans();
            toast.error({
                message: progress.error,
                title: i18n.t('download.error', { album }) as string,
            });
        } else {
            setEntry(progress.id, {
                albumName: album,
                artistId: entry?.artistId,
                artistName: entry?.artistName ?? '',
                progress,
            });
        }
    });
