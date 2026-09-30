import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import { useCurrentServerId } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { TagsInput } from '/@/shared/components/tags-input/tags-input';
import { GenreListSort, SortOrder } from '/@/shared/types/domain-types';

interface DownloadTagsModalProps {
    initialGenres?: string[];
    onSubmit: (genres: string[]) => void;
}

/** Asks for the tags to write on every song of an album before its download starts. */
export const DownloadTagsModal = ({ initialGenres, onSubmit }: DownloadTagsModalProps) => {
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
            <Group justify="flex-end">
                <Button onClick={submit} variant="filled">
                    {t('download.action')}
                </Button>
            </Group>
        </Stack>
    );
};
