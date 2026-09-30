import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import { useCurrentServerId } from '/@/renderer/store';
import { Autocomplete } from '/@/shared/components/autocomplete/autocomplete';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { GenreListSort, SortOrder } from '/@/shared/types/domain-types';

interface AddGenreModalProps {
    existing: string[];
    onSubmit: (name: string) => void;
}

export const AddGenreModal = ({ existing, onSubmit }: AddGenreModalProps) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const [value, setValue] = useState('');

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

    const taken = new Set(existing.map((name) => name.toLowerCase()));
    const options = (data?.items ?? [])
        .map((genre) => genre.name)
        .filter((n) => !taken.has(n.toLowerCase()));
    const name = value.trim();
    const canSubmit = name !== '' && !taken.has(name.toLowerCase());

    const submit = () => {
        if (!canSubmit) return;
        closeAllModals();
        onSubmit(name);
    };

    return (
        <Stack gap="md">
            <Autocomplete
                autoFocus
                data={options}
                limit={50}
                onChange={setValue}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={t('metadataEdit.genrePlaceholder')}
                value={value}
            />
            <Group justify="flex-end">
                <Button disabled={!canSubmit} onClick={submit} variant="filled">
                    {t('metadataEdit.addGenre')}
                </Button>
            </Group>
        </Stack>
    );
};
