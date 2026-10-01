import { useEffect } from 'react';

import { useIsRadioActive } from '/@/renderer/features/radio/hooks/use-radio-player';
import {
    usePlayerHydrated,
    usePlayerSong,
    usePlayerStore,
    useSettingsStore,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';

const AUTOPLAY_DELAY_MS = 1000;

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
            // Delay so the audio engines settle; playing immediately can start multiple tracks
            setTimeout(() => usePlayerStore.getState().mediaPlay(), AUTOPLAY_DELAY_MS);
        }
    }, [enabled, hydrated, currentSong, isRadioActive]);

    return null;
};
