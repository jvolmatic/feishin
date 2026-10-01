import { useEffect } from 'react';

import { useIsRadioActive } from '/@/renderer/features/radio/hooks/use-radio-player';
import {
    usePlayerHydrated,
    usePlayerSong,
    usePlayerStore,
    useSettingsStore,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';

let autoplayOnStartupHandled = false;

export const AutoplayOnStartupHook = () => {
    const enabled = useSettingsStore((state) => state.general.autoplayOnStartup);
    const hydrated = usePlayerHydrated();
    const currentSong = usePlayerSong();
    const isRadioActive = useIsRadioActive();

    useEffect(() => {
        if (autoplayOnStartupHandled || !hydrated) return;
        autoplayOnStartupHandled = true;

        if (enabled && currentSong && !isRadioActive) {
            logger.info('Autoplay on startup');
            usePlayerStore.getState().mediaPlay();
        }
    }, [enabled, hydrated, currentSong, isRadioActive]);

    return null;
};
