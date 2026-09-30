import type { ModifyAlbumGenresRequest, ModifyAlbumGenresResult } from '/@/shared/types/tag-editor';

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { connectSsh, getConfig, getSftp, sanitizeSegment } from '../download';
import { editGenres, mapWithConcurrency } from './taglib-service';

const AUDIO_EXTENSIONS = new Set(['.flac', '.m4a', '.mp3', '.ogg', '.opus']);
const LOCAL_CONCURRENCY = 8;
const REMOTE_CONCURRENCY = 2;

const isAudio = (name: string) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());

const sftpCall = <T>(fn: (cb: (error: Error | null | undefined, result?: T) => void) => void) =>
    new Promise<T>((resolve, reject) =>
        fn((error, result) => (error ? reject(error) : resolve(result as T))),
    );

/**
 * Adds/removes genres on every audio file of an album, using the download settings
 * (local folder or SFTP). Albums live at `<root>/<album artist>/<album>/`.
 */
export const modifyAlbumGenres = async ({
    add,
    album,
    albumArtist,
    remove,
}: ModifyAlbumGenresRequest): Promise<ModifyAlbumGenresResult> => {
    const config = getConfig();
    const artistDir = sanitizeSegment(albumArtist);
    const albumDir = sanitizeSegment(album);
    const failed: ModifyAlbumGenresResult['failed'] = [];
    let updated = 0;

    if (config.mode === 'local') {
        if (!config.localPath) throw new Error('Library path is not configured.');
        const dir = path.join(config.localPath, artistDir, albumDir);
        const files = (await fs.readdir(dir)).filter(isAudio);
        if (files.length === 0) throw new Error(`No audio files found in ${dir}`);

        await mapWithConcurrency(files, LOCAL_CONCURRENCY, async (name) => {
            try {
                await editGenres(path.join(dir, name), add, remove);
                updated += 1;
            } catch (error) {
                failed.push({ error: String(error), file: name });
            }
        });
        return { failed, folder: `${artistDir}/${albumDir}`, updated };
    }

    if (!config.ssh.remotePath) throw new Error('Remote library path is not configured.');
    const remoteDir = `${config.ssh.remotePath.replace(/\/+$/, '')}/${artistDir}/${albumDir}`;
    const tmp = await fs.mkdtemp(path.join(tmpdir(), 'feishin-genres-'));
    const client = await connectSsh(config.ssh);

    try {
        const sftp = await getSftp(client);
        const entries = await sftpCall<Array<{ filename: string }>>((cb) =>
            sftp.readdir(remoteDir, cb),
        );
        const files = entries.map((e) => e.filename).filter(isAudio);
        if (files.length === 0) throw new Error(`No audio files found in ${remoteDir}`);

        await mapWithConcurrency(files, REMOTE_CONCURRENCY, async (name) => {
            const local = path.join(tmp, name);
            const remote = `${remoteDir}/${name}`;
            try {
                await sftpCall<void>((cb) => sftp.fastGet(remote, local, cb));
                await editGenres(local, add, remove);
                // Upload beside the original, then swap. The original is only deleted after the
                // new file is in place, and is restored if the swap fails, so a dropped
                // connection can never lose a track.
                await sftpCall<void>((cb) => sftp.fastPut(local, `${remote}.tmp`, cb));
                await sftpCall<void>((cb) => sftp.rename(remote, `${remote}.bak`, cb));
                try {
                    await sftpCall<void>((cb) => sftp.rename(`${remote}.tmp`, remote, cb));
                } catch (error) {
                    await sftpCall<void>((cb) => sftp.rename(`${remote}.bak`, remote, cb));
                    throw error;
                }
                await sftpCall<void>((cb) => sftp.unlink(`${remote}.bak`, () => cb(null)));
                updated += 1;
            } catch (error) {
                failed.push({ error: String(error), file: name });
            }
        });
        return { failed, folder: `${artistDir}/${albumDir}`, updated };
    } finally {
        client.end();
        await fs.rm(tmp, { force: true, recursive: true });
    }
};
