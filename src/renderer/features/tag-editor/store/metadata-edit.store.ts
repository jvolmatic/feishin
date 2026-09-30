import { createWithEqualityFn } from 'zustand/traditional';

import i18n from '/@/i18n/i18n';
import { toast } from '/@/shared/components/toast/toast';

interface PendingMetadataEdit {
    added: string[];
    albumId: string;
    removed: string[];
}

/**
 * Only one metadata edit may run at a time: the library can live on a very slow drive or
 * server, so overlapping writes to the same files are not safe.
 */
export const useMetadataEditStore = createWithEqualityFn<{ pending: null | PendingMetadataEdit }>()(
    () => ({ pending: null }),
);

/** Takes the edit lock. Shows a toast and returns false when another edit is running. */
export const beginMetadataEdit = (edit: PendingMetadataEdit): boolean => {
    if (useMetadataEditStore.getState().pending) {
        toast.info({ message: i18n.t('metadataEdit.busy') as string });
        return false;
    }
    useMetadataEditStore.setState({ pending: edit });
    return true;
};

export const endMetadataEdit = () => useMetadataEditStore.setState({ pending: null });
