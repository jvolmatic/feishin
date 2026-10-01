import { useMemo } from 'react';

import {
    ColumnNullFallback,
    ColumnSkeletonFixed,
    ItemTableListInnerColumn,
    TableColumnTextContainer,
} from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { getPlaysFontWeight } from '/@/renderer/features/albums/hooks/use-album-track-plays';
import { TableColumn } from '/@/shared/types/types';

export const CountColumn = (props: ItemTableListInnerColumn) => {
    const rowItem = props.getRowItem?.(props.rowIndex) ?? (props.data as any[])[props.rowIndex];
    const columnId = props.columns[props.columnIndex].id;
    const row: number | undefined = (rowItem as any)?.[columnId];

    // External plays get heavier the closer they are to the album's most played track.
    const isExternalPlays = props.type === TableColumn.EXTERNAL_PLAYS;
    const allPlays = useMemo(
        () => (isExternalPlays ? (props.data as any[]).map((item) => item?.[columnId]) : []),
        [columnId, isExternalPlays, props.data],
    );

    if (typeof row === 'number') {
        return (
            <TableColumnTextContainer {...props}>
                {isExternalPlays ? (
                    <span style={{ fontWeight: getPlaysFontWeight(row, allPlays) }}>
                        {row.toLocaleString()}
                    </span>
                ) : (
                    row.toLocaleString()
                )}
            </TableColumnTextContainer>
        );
    }

    if (row === null) {
        return <ColumnNullFallback {...props} />;
    }

    return <ColumnSkeletonFixed {...props} />;
};
