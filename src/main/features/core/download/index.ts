import axios from 'axios';
import { spawn } from 'child_process';
import { dialog, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Client, SFTPWrapper } from 'ssh2';
import YTMusic from 'ytmusic-api';

import { store } from '../settings';

import { getMainWindow } from '/@/main/index';
import log from '/@/main/logger';
import { DownloadAlbumRequest, DownloadProgress } from '/@/shared/types/download';
import { isSameAlbum } from '/@/shared/utils/album-title';
import { isUnwantedTrackTitle } from '/@/shared/utils/track-title';

interface DownloadConfig {
    cookiesBrowser: string;
    cookiesFile: string;
    fetchLyrics: boolean;
    ffmpegPath: string;
    localPath: string;
    mode: 'local' | 'remote';
    ssh: {
        authType: 'key' | 'password';
        host: string;
        keyPath: string;
        password: string;
        port: number;
        remotePath: string;
        user: string;
    };
    ytdlpPath: string;
}

const DEFAULT_CONFIG: DownloadConfig = {
    cookiesBrowser: '',
    cookiesFile: '',
    fetchLyrics: true,
    ffmpegPath: '',
    localPath: '',
    mode: 'local',
    ssh: {
        authType: 'key',
        host: '',
        keyPath: '',
        password: '',
        port: 22,
        remotePath: '',
        user: '',
    },
    ytdlpPath: '',
};

const getConfig = (): DownloadConfig => {
    const saved = (store.get('download') ?? {}) as Partial<DownloadConfig>;
    return { ...DEFAULT_CONFIG, ...saved, ssh: { ...DEFAULT_CONFIG.ssh, ...saved.ssh } };
};

const send = (progress: DownloadProgress) => {
    getMainWindow()?.webContents.send('download-progress', progress);
};

/** Makes a string safe to use as a single path segment on any OS / remote server. */
export const sanitizeSegment = (name: string): string => {
    // eslint-disable-next-line no-control-regex
    let clean = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ');
    clean = clean
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');
    if (clean.startsWith('.')) clean = clean.replace(/^\.+/, '').trim();
    if (clean.length > 150) clean = clean.slice(0, 150).trim();
    return clean || 'Unknown';
};

interface RunResult {
    code: null | number;
    stdout: string;
}

const run = (
    cmd: string,
    args: string[],
    onLine?: (line: string) => void,
    signal?: AbortSignal,
): Promise<RunResult> =>
    new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let buffer = '';

        child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stdout += text;
            if (onLine) {
                buffer += text;
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() ?? '';
                lines.forEach(onLine);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                reject(new Error(`Executable not found: ${cmd}. Install it or set its path.`));
            } else {
                reject(error);
            }
        });
        child.on('close', (code) => {
            if (code !== 0) {
                log.warn(`${cmd} exited with code ${code}`, stderr.slice(-2000));
                reject(
                    new Error(`${path.basename(cmd)} failed: ${stderr.trim().split('\n').pop()}`),
                );
            } else {
                resolve({ code, stdout });
            }
        });
    });

const ffprobeTag = async (ffprobe: string, file: string, tag: string) => {
    try {
        const { stdout } = await run(ffprobe, [
            '-v',
            'error',
            '-show_entries',
            `format_tags=${tag}`,
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            file,
        ]);
        return stdout.trim();
    } catch {
        return '';
    }
};

const ffprobeDuration = async (ffprobe: string, file: string) => {
    try {
        const { stdout } = await run(ffprobe, [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            file,
        ]);
        return Math.round(Number.parseFloat(stdout.trim())) || null;
    } catch {
        return null;
    }
};

const squareCover = async (ffmpeg: string, ffprobe: string, file: string, dir: string) => {
    try {
        const { stdout } = await run(ffprobe, [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height,codec_name',
            '-of',
            'csv=p=0',
            file,
        ]);
        const [codec, w, h] = stdout.trim().split(',');
        if (!w || !h || w === h || Number.isNaN(Number(w)) || Number.isNaN(Number(h))) return;

        const raw = path.join(dir, `cover-raw.${codec === 'png' ? 'png' : 'jpg'}`);
        const square = path.join(dir, 'cover-square.jpg');
        const out = path.join(dir, 'squared.m4a');

        await run(ffmpeg, [
            '-y',
            '-loglevel',
            'error',
            '-i',
            file,
            '-map',
            '0:v:0',
            '-c',
            'copy',
            raw,
        ]);
        await run(ffmpeg, [
            '-y',
            '-loglevel',
            'error',
            '-i',
            raw,
            '-vf',
            'crop=min(iw\\,ih):min(iw\\,ih)',
            '-q:v',
            '2',
            square,
        ]);
        await run(ffmpeg, [
            '-y',
            '-loglevel',
            'error',
            '-i',
            file,
            '-i',
            square,
            '-map',
            '0:a',
            '-map',
            '1:v',
            '-map_metadata',
            '0',
            '-c:a',
            'copy',
            '-c:v',
            'mjpeg',
            '-disposition:v',
            'attached_pic',
            out,
        ]);
        await fs.rename(out, file);
    } catch (error) {
        log.warn('Failed to square cover art', error);
    }
};

/**
 * Album artist is forced to the artist page name so the library groups every track under one
 * artist. The track artist keeps any featured artists, separated by "; ". The page artist is
 * protected while splitting so names containing a comma (e.g. "Tyler, The Creator") survive.
 */
const writeArtistTags = async (
    ffmpeg: string,
    ffprobe: string,
    file: string,
    dir: string,
    albumArtist: string,
) => {
    try {
        const current = await ffprobeTag(ffprobe, file, 'artist');
        const artist = current
            ? current
                  .split(albumArtist)
                  .join('\u0000')
                  .replace(/\s*,\s*/g, '; ')
                  .split('\u0000')
                  .join(albumArtist)
            : albumArtist;
        const out = path.join(dir, 'tagged.m4a');

        await run(ffmpeg, [
            '-y',
            '-loglevel',
            'error',
            '-i',
            file,
            '-map',
            '0',
            '-c',
            'copy',
            '-metadata',
            `album_artist=${albumArtist}`,
            '-metadata',
            `artist=${artist}`,
            out,
        ]);
        await fs.rename(out, file);
    } catch (error) {
        log.warn('Failed to write artist tags', error);
    }
};

const fetchLyrics = async (
    title: string,
    artist: string,
    album: string,
    duration: null | number,
): Promise<null | { synced: boolean; text: string }> => {
    const headers = { 'User-Agent': 'feishin-download (personal use)' };
    const pick = (data: any) => {
        if (data?.syncedLyrics) return { synced: true, text: data.syncedLyrics as string };
        if (data?.plainLyrics) return { synced: false, text: data.plainLyrics as string };
        return null;
    };

    try {
        const { data } = await axios.get('https://lrclib.net/api/get', {
            headers,
            params: {
                album_name: album || undefined,
                artist_name: artist,
                duration: duration ?? undefined,
                track_name: title,
            },
            timeout: 10000,
        });
        const found = pick(data);
        if (found) return found;
    } catch {
        // fall through to search
    }

    try {
        const { data } = await axios.get('https://lrclib.net/api/search', {
            headers,
            params: { artist_name: artist, track_name: title },
            timeout: 10000,
        });
        if (Array.isArray(data) && data.length > 0) return pick(data[0]);
    } catch {
        // no lyrics
    }
    return null;
};

/** Finds the YouTube Music playlist url for an album. Returns null if no match. */
const resolveAlbumUrl = async (artist: string, album: string): Promise<null | string> => {
    const client = new YTMusic();
    await client.initialize();
    const results = await client.searchAlbums(`${artist} ${album}`);
    const norm = (s: string) => s.toLocaleLowerCase();
    const match =
        results.find((r) => norm(r.artist.name) === norm(artist) && isSameAlbum(r.name, album)) ??
        results.find((r) => isSameAlbum(r.name, album));
    if (!match) return null;
    const full = await client.getAlbum(match.albumId);
    return full.playlistId ? `https://music.youtube.com/playlist?list=${full.playlistId}` : null;
};

const literal = (value: string) => value.replace(/%/g, '%%').replace(/:/g, '\\:');

// --- SFTP ---

const connectSsh = (config: DownloadConfig['ssh']): Promise<Client> =>
    new Promise((resolve, reject) => {
        const client = new Client();
        Promise.resolve(config.authType === 'key' ? fs.readFile(config.keyPath) : undefined)
            .then((privateKey) => {
                client
                    .on('ready', () => resolve(client))
                    .on('error', reject)
                    .connect({
                        host: config.host,
                        password: config.authType === 'password' ? config.password : undefined,
                        port: config.port || 22,
                        privateKey,
                        readyTimeout: 15000,
                        username: config.user,
                    });
            })
            .catch(reject);
    });

const getSftp = (client: Client): Promise<SFTPWrapper> =>
    new Promise((resolve, reject) =>
        client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))),
    );

const sftpMkdirp = async (sftp: SFTPWrapper, dir: string) => {
    const parts = dir.split('/').filter(Boolean);
    let current = dir.startsWith('/') ? '' : '.';
    for (const part of parts) {
        current = `${current}/${part}`;
        await new Promise<void>((resolve) => {
            // Errors are ignored here: the directory most likely already exists,
            // and a real failure surfaces on the upload.
            sftp.mkdir(current, () => resolve());
        });
    }
};

const sftpPut = (sftp: SFTPWrapper, local: string, remote: string) =>
    new Promise<void>((resolve, reject) =>
        sftp.fastPut(local, remote, (error) => (error ? reject(error) : resolve())),
    );

const uploadRemote = async (
    config: DownloadConfig['ssh'],
    files: string[],
    remoteDir: string,
    onFile: (done: number) => void,
) => {
    const client = await connectSsh(config);
    try {
        const sftp = await getSftp(client);
        await sftpMkdirp(sftp, remoteDir);
        let done = 0;
        for (const file of files) {
            await sftpPut(sftp, file, `${remoteDir}/${path.basename(file)}`);
            done += 1;
            onFile(done);
        }
    } finally {
        client.end();
    }
};

const moveFile = async (from: string, to: string) => {
    try {
        await fs.rename(from, to);
    } catch {
        await fs.copyFile(from, to);
        await fs.rm(from);
    }
};

// --- Pipeline ---

const active = new Map<string, AbortController>();

const downloadAlbum = async (request: DownloadAlbumRequest) => {
    const { id } = request;
    const config = getConfig();
    const controller = new AbortController();
    active.set(id, controller);
    let tmp = '';

    try {
        if (config.mode === 'local' && !config.localPath) {
            throw new Error('Local library path is not configured.');
        }
        if (
            config.mode === 'remote' &&
            !(config.ssh.host && config.ssh.user && config.ssh.remotePath)
        ) {
            throw new Error('SSH host, user and remote path are not configured.');
        }

        const ytdlp = config.ytdlpPath || 'yt-dlp';
        const ffmpeg = config.ffmpegPath || 'ffmpeg';
        const ffprobe = config.ffmpegPath
            ? path.join(path.dirname(config.ffmpegPath), 'ffprobe')
            : 'ffprobe';

        send({ id, stage: 'resolving' });
        const url = await resolveAlbumUrl(request.artist, request.album);
        if (!url) throw new Error('Album not found on YouTube Music.');

        tmp = await fs.mkdtemp(path.join(tmpdir(), 'feishin_dl_'));

        const cookieArgs = config.cookiesFile
            ? ['--cookies', config.cookiesFile]
            : config.cookiesBrowser
              ? ['--cookies-from-browser', config.cookiesBrowser]
              : [];
        const parse = (value: string, field: string) => [
            '--parse-metadata',
            `${literal(value)}%(autowrap_bypass|)s:%(${field})s`,
        ];

        send({ id, stage: 'downloading' });
        await run(
            ytdlp,
            [
                '-x',
                '-f',
                'ba[ext=m4a]',
                ...cookieArgs,
                '--embed-metadata',
                '--embed-thumbnail',
                '--parse-metadata',
                '%(artist,uploader,channel|)s:%(artist)s',
                ...parse(request.artist, 'album_artist'),
                ...parse(request.album, 'album'),
                '--parse-metadata',
                '%(track_number,playlist_index|)s:%(track_number)s',
                ...(request.year ? parse(String(request.year), 'meta_date') : []),
                '-o',
                path.join(tmp, '%(playlist_index)03d-%(id)s.%(ext)s'),
                url,
            ],
            (line) => {
                const match = line.match(/Downloading item (\d+) of (\d+)/);
                if (match) {
                    send({
                        done: Number(match[1]) - 1,
                        id,
                        stage: 'downloading',
                        total: Number(match[2]),
                    });
                }
            },
            controller.signal,
        );

        send({ id, stage: 'processing' });
        const artistDir = sanitizeSegment(request.artist);
        const albumDir = sanitizeSegment(request.album);
        const names = (await fs.readdir(tmp)).filter((f) => f.endsWith('.m4a')).sort();
        const outputs: string[] = [];
        const usedNames = new Set<string>();

        for (const name of names) {
            const file = path.join(tmp, name);
            const title = await ffprobeTag(ffprobe, file, 'title');

            if (isUnwantedTrackTitle(title)) {
                await fs.rm(file);
                continue;
            }

            await squareCover(ffmpeg, ffprobe, file, tmp);
            await writeArtistTags(ffmpeg, ffprobe, file, tmp, request.artist);

            let base = sanitizeSegment(title || path.basename(name, '.m4a'));
            if (usedNames.has(base.toLowerCase())) base = `${base} (${outputs.length + 1})`;
            usedNames.add(base.toLowerCase());

            const final = path.join(tmp, `${base}.m4a`);
            if (final !== file) {
                await fs.rename(file, final);
            }
            outputs.push(final);

            if (config.fetchLyrics && title) {
                const artistTag = (await ffprobeTag(ffprobe, final, 'artist')) || request.artist;
                const duration = await ffprobeDuration(ffprobe, final);
                const lyrics = await fetchLyrics(title, artistTag, request.album, duration);
                if (lyrics) {
                    const lyricsPath = path.join(tmp, `${base}${lyrics.synced ? '.lrc' : '.txt'}`);
                    await fs.writeFile(lyricsPath, lyrics.text, 'utf8');
                    outputs.push(lyricsPath);
                    const embedded = path.join(tmp, 'lyrics-embed.m4a');
                    try {
                        await run(ffmpeg, [
                            '-y',
                            '-loglevel',
                            'error',
                            '-i',
                            final,
                            '-c',
                            'copy',
                            '-metadata',
                            `lyrics=${lyrics.text}`,
                            embedded,
                        ]);
                        await fs.rename(embedded, final);
                    } catch (error) {
                        log.warn('Failed to embed lyrics', error);
                    }
                }
            }
        }

        if (!outputs.some((f) => f.endsWith('.m4a'))) {
            throw new Error('No tracks left to deliver after filtering.');
        }

        if (config.mode === 'local') {
            const dest = path.join(config.localPath, artistDir, albumDir);
            await fs.mkdir(dest, { recursive: true });
            for (const file of outputs) {
                await moveFile(file, path.join(dest, path.basename(file)));
            }
        } else {
            const remoteDir = `${config.ssh.remotePath.replace(/\/+$/, '')}/${artistDir}/${albumDir}`;
            send({ done: 0, id, stage: 'uploading', total: outputs.length });
            await uploadRemote(config.ssh, outputs, remoteDir, (done) =>
                send({ done, id, stage: 'uploading', total: outputs.length }),
            );
        }

        await fs.rm(tmp, { force: true, recursive: true });
        send({ id, stage: 'done' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Album download failed', error);
        send({
            error: tmp ? `${message} (files kept in ${tmp})` : message,
            id,
            stage: 'error',
        });
    } finally {
        active.delete(id);
    }
};

ipcMain.handle('download-album', (_event, request: DownloadAlbumRequest) => {
    if (active.has(request.id)) return false;
    // Fire and forget: progress and result are reported via `download-progress`.
    void downloadAlbum(request);
    return true;
});

ipcMain.on('download-cancel', (_event, id: string) => {
    active.get(id)?.abort();
});

ipcMain.handle('download-test-connection', async () => {
    const { ssh } = getConfig();
    try {
        const client = await connectSsh(ssh);
        const sftp = await getSftp(client);
        const ok = await new Promise<boolean>((resolve) =>
            sftp.stat(ssh.remotePath || '.', (error) => resolve(!error)),
        );
        client.end();
        return ok ? { ok: true } : { error: 'Remote path does not exist.', ok: false };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error), ok: false };
    }
});

ipcMain.handle('open-directory-selector', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
    });
    return result.filePaths[0] || null;
});
