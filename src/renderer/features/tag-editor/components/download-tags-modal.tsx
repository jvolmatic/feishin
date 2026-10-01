import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import { useCurrentServerId } from '/@/renderer/store';
import { useLastfmApiKey } from '/@/renderer/store/settings.store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Pill } from '/@/shared/components/pill/pill';
import { Stack } from '/@/shared/components/stack/stack';
import { TagsInput } from '/@/shared/components/tags-input/tags-input';
import { Text } from '/@/shared/components/text/text';
import { GenreListSort, SortOrder } from '/@/shared/types/domain-types';

const MUSICBRAINZ = 'https://musicbrainz.org/ws/2/release-group';

const getMusicBrainz = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MusicBrainz request failed: ${res.status}`);
    return res.json();
};

/** Community tags of the best matching release group, most voted first. */
const fetchMusicBrainzTags = async (artist: string, album: string) => {
    const search = new URLSearchParams({
        fmt: 'json',
        limit: '1',
        query: `releasegroup:"${album}" AND artist:"${artist}"`,
    });
    const found = await getMusicBrainz(`${MUSICBRAINZ}?${search}`);
    const id = found['release-groups']?.[0]?.id;
    if (!id) return [];

    // MusicBrainz allows one request per second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const group = await getMusicBrainz(`${MUSICBRAINZ}/${id}?inc=tags&fmt=json`);
    return ((group.tags ?? []) as { count: number; name: string }[])
        .sort((a, b) => b.count - a.count)
        .map((tag) => tag.name);
};

// Personal or dated tags (years, "best of", "seen live", ...) are not genres.
const NON_GENRE_TAG = /\b(19|20)\d{2}s?\b|best of|seen live|albums? i own|favou?rite|owned|my /i;

/** Top tags of the album and its artist from Last.fm, most voted first. */
const fetchLastfmTags = async (apiKey: string, artist: string, album: string) => {
    const get = async (method: string, params: Record<string, string>) => {
        const query = new URLSearchParams({ api_key: apiKey, format: 'json', method, ...params });
        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`);
        if (!res.ok) throw new Error(`Last.fm request failed: ${res.status}`);
        const json = await res.json();
        return ((json.toptags?.tag ?? []) as { count: number | string; name: string }[]).map(
            (tag) => ({ count: Number(tag.count), name: tag.name }),
        );
    };

    const [albumTags, artistTags] = await Promise.all([
        get('album.gettoptags', { album, artist }),
        get('artist.gettoptags', { artist }),
    ]);
    return [...albumTags, ...artistTags].sort((a, b) => b.count - a.count).map((tag) => tag.name);
};

// "hip hop" and "Hip-Hop" are the same tag.
const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9]/g, '');

interface DownloadTagsModalProps {
    album?: string;
    artist?: string;
    initialGenres?: string[];
    onSubmit: (genres: string[]) => void;
    submitLabel?: string;
}

/** Asks for the tags to write on every song of an album before its download starts. */
export const DownloadTagsModal = ({
    album,
    artist,
    initialGenres,
    onSubmit,
    submitLabel,
}: DownloadTagsModalProps) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const [genres, setGenres] = useState<string[]>(initialGenres ?? []);

    const { data } = useQuery(
        genresQueries.list({
            query: {
                limit: -1,
                sortBy: GenreListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId,
        }),
    );

    const lastfmApiKey = useLastfmApiKey();
    const { data: suggestedTags } = useQuery({
        enabled: Boolean(artist && album),
        queryFn: async () => {
            const tags = await fetchMusicBrainzTags(artist!, album!).catch(() => []);
            if (tags.length > 1 || !lastfmApiKey) return tags;
            const lastfmTags = await fetchLastfmTags(lastfmApiKey, artist!, album!).catch(() => []);
            return [...tags, ...lastfmTags.filter((tag) => !NON_GENRE_TAG.test(tag))];
        },
        queryKey: ['tags', artist, album, Boolean(lastfmApiKey)],
        retry: false,
        staleTime: Infinity,
    });

    const suggestions = (suggestedTags ?? [])
        .map((tag) => tag.charAt(0).toUpperCase() + tag.slice(1))
        .filter((tag) => !genres.some((g) => normalizeTag(g) === normalizeTag(tag)))
        .filter((tag, i, all) => all.findIndex((o) => normalizeTag(o) === normalizeTag(tag)) === i)
        .slice(0, 12);

    const submit = () => {
        closeAllModals();
        onSubmit(genres);
    };

    return (
        <Stack gap="md">
            <TagsInput
                data={(data?.items ?? []).map((genre) => genre.name)}
                label={t('entity.genre', { count: 2 })}
                onChange={setGenres}
                placeholder={t('metadataEdit.genrePlaceholder')}
                value={genres}
            />
            {suggestions.length > 0 && (
                <Stack gap="xs">
                    <Text isMuted size="sm">
                        {t('metadataEdit.recommendedTags')}
                    </Text>
                    <Pill.Group>
                        {suggestions.map((tag) => (
                            <Pill
                                key={tag}
                                onClick={() => setGenres((prev) => [...prev, tag])}
                                style={{ cursor: 'pointer' }}
                            >
                                {tag}
                            </Pill>
                        ))}
                    </Pill.Group>
                </Stack>
            )}
            <Group justify="flex-end">
                <Button onClick={submit} variant="filled">
                    {submitLabel ?? t('download.action')}
                </Button>
            </Group>
        </Stack>
    );
};
