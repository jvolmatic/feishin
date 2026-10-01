import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { useLastfmApiKey, useShowExternalPlays } from '/@/renderer/store/settings.store';
import { Song } from '/@/shared/types/domain-types';
import { normalizeTitle } from '/@/shared/utils/track-title';

export type SongWithExternalPlays = Song & { externalPlays?: null | number };

const fetchLastfmPlays = async (apiKey: string, song: Song): Promise<null | number> => {
    const response = await fetch(
        `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({
            api_key: apiKey,
            artist: song.albumArtistName || song.artistName,
            autocorrect: '1',
            format: 'json',
            method: 'track.getinfo',
            track: song.name,
        })}`,
    );
    if (!response.ok) return null;
    const plays = Number(
        ((await response.json()) as { track?: { playcount?: string } }).track?.playcount,
    );
    return Number.isFinite(plays) ? plays : null;
};

const fetchListenBrainzPlays = async (mbids: string[]): Promise<Record<string, number>> => {
    const response = await fetch('https://api.listenbrainz.org/1/popularity/recording', {
        body: JSON.stringify({ recording_mbids: mbids }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    if (!response.ok) return {};
    const items = (await response.json()) as Array<{
        recording_mbid: string;
        total_listen_count: number;
    }>;
    return Object.fromEntries(
        items
            .filter((item) => item.total_listen_count > 0)
            .map((item) => [item.recording_mbid, item.total_listen_count]),
    );
};

/** Adds YouTube Music play counts to the songs, falling back to Last.fm per song. */
export const useAlbumTrackPlays = (songs: Song[]): SongWithExternalPlays[] => {
    const enabled = useShowExternalPlays();
    const apiKey = useLastfmApiKey();
    const { album, albumArtistName } = enabled ? (songs[0] ?? {}) : {};

    const youtube = useQuery(
        searchQueries.externalAlbumTrackPlays(albumArtistName ?? '', album ?? ''),
    );
    const youtubeDone = !(youtube.isPending && youtube.fetchStatus !== 'idle');

    const youtubePlays = useMemo(
        () => new Map(youtube.data?.map((item) => [normalizeTitle(item.title), item.plays])),
        [youtube.data],
    );

    const mbids = songs.flatMap((song) =>
        enabled && song.mbzRecordingId ? [song.mbzRecordingId] : [],
    );
    const listenBrainz = useQuery({
        enabled: youtubeDone && mbids.length > 0,
        queryFn: () => fetchListenBrainzPlays(mbids),
        queryKey: ['listenbrainz', 'recordingPlays', mbids],
        staleTime: 1000 * 60 * 60,
    });
    const listenBrainzDone = !(listenBrainz.isPending && listenBrainz.fetchStatus !== 'idle');
    const getListenBrainzPlays = (song: Song) =>
        song.mbzRecordingId ? listenBrainz.data?.[song.mbzRecordingId] : undefined;

    const lastfm = useQueries({
        queries: songs.map((song) => ({
            enabled:
                youtubeDone &&
                listenBrainzDone &&
                enabled &&
                Boolean(apiKey) &&
                !youtubePlays.has(normalizeTitle(song.name)) &&
                getListenBrainzPlays(song) === undefined,
            queryFn: () => fetchLastfmPlays(apiKey, song),
            queryKey: ['lastfm', 'trackPlays', song.albumArtistName, song.name],
            staleTime: 1000 * 60 * 60,
        })),
    });

    const lastfmKey = lastfm.map((query) => (query.isPending ? '.' : (query.data ?? '-'))).join();

    return useMemo(
        () =>
            songs.map((song, index) => {
                if (!enabled) return song;
                const fromYoutube = youtubePlays.get(normalizeTitle(song.name));
                if (fromYoutube !== undefined) return { ...song, externalPlays: fromYoutube };
                if (!youtubeDone) return { ...song, externalPlays: undefined };
                const fromListenBrainz = getListenBrainzPlays(song);
                if (fromListenBrainz !== undefined) {
                    return { ...song, externalPlays: fromListenBrainz };
                }
                if (!listenBrainzDone) return { ...song, externalPlays: undefined };
                if (!apiKey) return { ...song, externalPlays: null };
                const query = lastfm[index];
                return {
                    ...song,
                    externalPlays: query.isPending ? undefined : (query.data ?? null),
                };
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            enabled,
            songs,
            youtubePlays,
            youtubeDone,
            listenBrainz.data,
            listenBrainzDone,
            apiKey,
            lastfmKey,
        ],
    );
};

const MIN_PLAYS_WEIGHT = 400;
const MAX_PLAYS_WEIGHT = 800;

/** Font weight of a play count within an album: heavier the closer it is to the most played track. */
export const getPlaysFontWeight = (
    plays: null | number | undefined,
    allPlays: Array<null | number | undefined>,
) => {
    if (typeof plays !== 'number') return MIN_PLAYS_WEIGHT;

    const known = allPlays.filter((value): value is number => typeof value === 'number');
    const min = Math.min(...known);
    const max = Math.max(...known);
    if (max === min) return MIN_PLAYS_WEIGHT;

    const weight =
        MIN_PLAYS_WEIGHT + ((plays - min) / (max - min)) * (MAX_PLAYS_WEIGHT - MIN_PLAYS_WEIGHT);
    return Math.round(weight / 100) * 100;
};
