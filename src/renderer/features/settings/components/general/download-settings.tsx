import isElectron from 'is-electron';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { PasswordInput } from '/@/shared/components/password-input/password-input';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { toast } from '/@/shared/components/toast/toast';

const api = isElectron() ? window.api : null;

interface DownloadSettingsState {
    cookiesBrowser: string;
    cookiesFile: string;
    fetchLyrics: boolean;
    ffmpegPath: string;
    localPath: string;
    mode: 'local' | 'remote';
    ssh: SshConfig;
    ytdlpPath: string;
}

interface SshConfig {
    authType: 'key' | 'password';
    host: string;
    keyPath: string;
    password: string;
    port: number;
    remotePath: string;
    user: string;
}

const DEFAULTS: DownloadSettingsState = {
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

export const DownloadSettings = memo(() => {
    const { t } = useTranslation();
    const [state, setState] = useState<DownloadSettingsState>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        api?.localSettings.get('download').then((saved: null | Partial<DownloadSettingsState>) => {
            setState({ ...DEFAULTS, ...saved, ssh: { ...DEFAULTS.ssh, ...saved?.ssh } });
            setLoaded(true);
        });
    }, []);

    if (!api || !loaded) return null;

    const update = (patch: Partial<DownloadSettingsState>) => {
        const next = { ...state, ...patch };
        setState(next);
        api.localSettings.set('download', next as unknown as Record<string, unknown>);
    };
    const updateSsh = (patch: Partial<SshConfig>) => update({ ssh: { ...state.ssh, ...patch } });

    const text = (value: string, onChange: (value: string) => void) => (
        <TextInput defaultValue={value} onBlur={(e) => onChange(e.currentTarget.value)} />
    );

    const pickDirectory = async () => {
        const dir = await api.download.selectDirectory();
        if (dir) update({ localPath: dir });
    };

    const testConnection = async () => {
        const result = await api.download.testConnection();
        if (result.ok) {
            toast.success({ message: t('download.testOk') });
        } else {
            toast.error({ message: result.error, title: t('download.testFailed') });
        }
    };

    const isRemote = state.mode === 'remote';

    const options: SettingOption[] = [
        {
            control: (
                <Select
                    aria-label={t('download.mode')}
                    clearable={false}
                    data={[
                        { label: t('download.mode_local'), value: 'local' },
                        { label: t('download.mode_remote'), value: 'remote' },
                    ]}
                    onChange={(value) => value && update({ mode: value as 'local' | 'remote' })}
                    value={state.mode}
                />
            ),
            description: t('download.mode_description'),
            title: t('download.mode'),
        },
        {
            control: (
                <Group wrap="nowrap">
                    <TextInput
                        defaultValue={state.localPath}
                        key={state.localPath}
                        onBlur={(e) => update({ localPath: e.currentTarget.value })}
                    />
                    <Button onClick={pickDirectory} variant="default">
                        {t('download.select')}
                    </Button>
                </Group>
            ),
            description: t('download.localPath_description'),
            isHidden: isRemote,
            title: t('download.localPath'),
        },
        {
            control: text(state.ssh.host, (host) => updateSsh({ host })),
            description: '',
            isHidden: !isRemote,
            title: t('download.sshHost'),
        },
        {
            control: text(String(state.ssh.port), (port) =>
                updateSsh({ port: Number.parseInt(port, 10) || 22 }),
            ),
            description: '',
            isHidden: !isRemote,
            title: t('download.sshPort'),
        },
        {
            control: text(state.ssh.user, (user) => updateSsh({ user })),
            description: '',
            isHidden: !isRemote,
            title: t('download.sshUser'),
        },
        {
            control: (
                <Select
                    aria-label={t('download.sshAuth')}
                    clearable={false}
                    data={[
                        { label: 'Private key', value: 'key' },
                        { label: 'Password', value: 'password' },
                    ]}
                    onChange={(value) =>
                        value && updateSsh({ authType: value as 'key' | 'password' })
                    }
                    value={state.ssh.authType}
                />
            ),
            description: '',
            isHidden: !isRemote,
            title: t('download.sshAuth'),
        },
        {
            control: text(state.ssh.keyPath, (keyPath) => updateSsh({ keyPath })),
            description: '',
            isHidden: !isRemote || state.ssh.authType !== 'key',
            title: t('download.sshKeyPath'),
        },
        {
            control: (
                <PasswordInput
                    defaultValue={state.ssh.password}
                    onBlur={(e) => updateSsh({ password: e.currentTarget.value })}
                />
            ),
            description: '',
            isHidden: !isRemote || state.ssh.authType !== 'password',
            title: t('download.sshPassword'),
        },
        {
            control: (
                <Group wrap="nowrap">
                    {text(state.ssh.remotePath, (remotePath) => updateSsh({ remotePath }))}
                    <Button onClick={testConnection} variant="default">
                        {t('download.testConnection')}
                    </Button>
                </Group>
            ),
            description: '',
            isHidden: !isRemote,
            title: t('download.sshRemotePath'),
        },
        {
            control: text(state.ytdlpPath, (ytdlpPath) => update({ ytdlpPath })),
            description: t('download.ytdlpPath_description'),
            title: t('download.ytdlpPath'),
        },
        {
            control: text(state.ffmpegPath, (ffmpegPath) => update({ ffmpegPath })),
            description: t('download.ffmpegPath_description'),
            title: t('download.ffmpegPath'),
        },
        {
            control: text(state.cookiesFile, (cookiesFile) => update({ cookiesFile })),
            description: t('download.cookiesFile_description'),
            title: t('download.cookiesFile'),
        },
        {
            control: text(state.cookiesBrowser, (cookiesBrowser) => update({ cookiesBrowser })),
            description: t('download.cookiesBrowser_description'),
            title: t('download.cookiesBrowser'),
        },
        {
            control: (
                <Switch
                    checked={state.fetchLyrics}
                    onChange={(e) => update({ fetchLyrics: e.currentTarget.checked })}
                />
            ),
            description: t('download.fetchLyrics_description'),
            title: t('download.fetchLyrics'),
        },
    ];

    return <SettingsSection options={options} title={t('download.title')} />;
});
