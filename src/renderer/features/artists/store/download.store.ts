import { createWithEqualityFn } from 'zustand/traditional';

import i18n from '/@/i18n/i18n';
import { api } from '/@/renderer/api';
import { invalidateLibraryQueriesAfterScan } from '/@/renderer/features/shared/hooks/use-scan-status';
import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { logger } from '/@/renderer/utils/logger';
import { toast } from '/@/shared/components/toast/toast';
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
 * After a download finishes: keep the entry in a "scanning" state (so the album card shows a
 * loader), ask the server to scan, wait at least 5 seconds, wait for the scan to end, then
 * refetch library queries. That moves the album from "available albums" into "albums".
 */
const refreshLibraryAfterDownload = async (id: string, entry: DownloadEntry | undefined) => {
    const server = useAuthStore.getState().currentServer;
    const serverId = server?.id;
    if (!serverId) {
        setEntry(id, null);
        return;
    }
    // Starting a scan needs admin rights; for other users the API layer would show an
    // "not authorized" error toast, so skip it and rely on the server noticing new files.
    const canScan = Boolean(server.isAdmin);

    setEntry(id, {
        albumName: entry?.albumName ?? '',
        artistId: entry?.artistId,
        artistName: entry?.artistName ?? '',
        progress: { id, stage: 'scanning' },
    });

    if (canScan) {
        try {
            await api.controller.startLibraryScan({ apiClientProps: { serverId } });
        } catch (error) {
            logger.warn('Failed to start library scan after download', { error });
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
    setEntry(id, null);
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
    }
};

/** Subscribes to main-process progress events. Call once at app startup (Electron only). */
export const initDownloadListener = () =>
    window.api.download.onProgress((progress) => {
        const entry = useDownloadStore.getState().downloads[progress.id];
        const album = entry?.albumName ?? '';

        if (progress.stage === 'done') {
            void refreshLibraryAfterDownload(progress.id, entry);
            toast.success({ message: i18n.t('download.done', { album }) as string });
        } else if (progress.stage === 'error') {
            // Kept so the sidebar can show failed downloads until dismissed.
            setEntry(progress.id, {
                albumName: album,
                artistId: entry?.artistId,
                artistName: entry?.artistName ?? '',
                progress,
            });
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
