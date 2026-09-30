import { queryOptions } from '@tanstack/react-query';
import isElectron from 'is-electron';

import { api } from '/@/renderer/api';
import { controller } from '/@/renderer/api/controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { getOptimizedListCount } from '/@/renderer/api/utils-list-count';
import { QueryHookArgs } from '/@/renderer/lib/react-query';
import {
    AlbumDetailQuery,
    AlbumListQuery,
    ListCountQuery,
    ServerType,
} from '/@/shared/types/domain-types';

interface ExternalAlbumQuery {
    artistId: string;
    artistName: string;
}

type ExternalAlbumQueryArgs = Omit<QueryHookArgs<ExternalAlbumQuery>, 'serverId'> & {
    serverId?: string;
    serverType?: ServerType;
};

export const albumQueries = {
    detail: (args: QueryHookArgs<AlbumDetailQuery>) => {
        return queryOptions({
            queryFn: ({ signal }) => {
                return api.controller.getAlbumDetail({
                    apiClientProps: { serverId: args.serverId, signal },
                    query: args.query,
                });
            },
            queryKey: queryKeys.albums.detail(args.serverId, args.query),
            ...args.options,
        });
    },
    externalAlbums: (args: ExternalAlbumQueryArgs) => {
        const serverId = args.serverId || '';

        return queryOptions({
            enabled: isElectron() && Boolean(serverId),
            queryFn: () =>
                window.api.external.getArtistAlbums({
                    ...args.query,
                    serverId,
                    serverType: args.serverType || ServerType.JELLYFIN,
                }),
            queryKey: queryKeys.albumArtists.externalAlbums(
                serverId,
                args.query.artistId,
                args.query.artistName,
            ),
            staleTime: 1000 * 60 * 60 * 24, // 24 hours
        });
    },
    list: (args: QueryHookArgs<AlbumListQuery>) => {
        return queryOptions({
            queryFn: ({ signal }) => {
                return api.controller.getAlbumList({
                    apiClientProps: { serverId: args.serverId, signal },
                    query: args.query,
                });
            },
            queryKey: queryKeys.albums.list(
                args.serverId,
                args.query,
                args.query?.artistIds?.length === 1 ? args.query?.artistIds[0] : undefined,
            ),
            ...args.options,
        });
    },
    listCount: (args: QueryHookArgs<ListCountQuery<AlbumListQuery>>) => {
        return queryOptions({
            gcTime: 1000 * 60 * 60,
            queryFn: async ({ client, signal }) => {
                const optimizedCount = await getOptimizedListCount<
                    ListCountQuery<AlbumListQuery>,
                    AlbumListQuery,
                    { totalRecordCount: null | number }
                >({
                    client,
                    listQueryFn: controller.getAlbumList,
                    listQueryKeyFn: (serverId, query) => queryKeys.albums.list(serverId, query),
                    query: args.query,
                    serverId: args.serverId,
                    signal,
                });

                if (optimizedCount !== null) {
                    return optimizedCount;
                }

                return api.controller.getAlbumListCount({
                    apiClientProps: { serverId: args.serverId, signal },
                    query: args.query,
                });
            },
            queryKey: queryKeys.albums.count(
                args.serverId,
                args.query,
                args.query?.artistIds?.length === 1 ? args.query?.artistIds[0] : undefined,
            ),
            staleTime: 1000 * 60 * 60,
            ...args.options,
        });
    },
};
