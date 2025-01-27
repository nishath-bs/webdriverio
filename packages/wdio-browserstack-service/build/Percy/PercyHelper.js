// ======= Percy helper methods start =======
import { PercyLogger } from './PercyLogger.js';
import Percy from './Percy.js';
export const startPercy = async (options, config, bsConfig) => {
    PercyLogger.debug('Starting percy');
    const percy = new Percy(options, config, bsConfig);
    const response = await percy.start();
    if (response) {
        return percy;
    }
    return {};
};
export const stopPercy = async (percy) => {
    PercyLogger.debug('Stopping percy');
    return percy.stop();
};
export const getBestPlatformForPercySnapshot = (capabilities) => {
    try {
        const percyBrowserPreference = { 'chrome': 0, 'firefox': 1, 'edge': 2, 'safari': 3 };
        let bestPlatformCaps = null;
        let bestBrowser = null;
        if (Array.isArray(capabilities)) {
            capabilities
                .flatMap((c) => {
                if (Object.values(c).length > 0 && Object.values(c).every(c => typeof c === 'object' && c.capabilities)) {
                    return Object.values(c).map((o) => o.capabilities);
                }
                return c;
            }).forEach((capability) => {
                let currBrowserName = capability.browserName;
                if (capability['bstack:options']) {
                    currBrowserName = capability['bstack:options'].browserName || currBrowserName;
                }
                if (!bestBrowser || !bestPlatformCaps || (bestPlatformCaps.deviceName || bestPlatformCaps['bstack:options']?.deviceName)) {
                    bestBrowser = currBrowserName;
                    bestPlatformCaps = capability;
                }
                else if (currBrowserName && percyBrowserPreference[currBrowserName.toLowerCase()] < percyBrowserPreference[bestBrowser.toLowerCase()]) {
                    bestBrowser = currBrowserName;
                    bestPlatformCaps = capability;
                }
            });
            return bestPlatformCaps;
        }
        else if (typeof capabilities === 'object') {
            Object.entries(capabilities).forEach(([, caps]) => {
                let currBrowserName = caps.capabilities.browserName;
                if (caps.capabilities['bstack:options']) {
                    currBrowserName = caps.capabilities['bstack:options']?.browserName || currBrowserName;
                }
                if (!bestBrowser || !bestPlatformCaps || (bestPlatformCaps.deviceName || bestPlatformCaps['bstack:options']?.deviceName)) {
                    bestBrowser = currBrowserName;
                    bestPlatformCaps = caps.capabilities;
                }
                else if (currBrowserName && percyBrowserPreference[currBrowserName.toLowerCase()] < percyBrowserPreference[bestBrowser.toLowerCase()]) {
                    bestBrowser = currBrowserName;
                    bestPlatformCaps = caps.capabilities;
                }
            });
            return bestPlatformCaps;
        }
    }
    catch (err) {
        PercyLogger.error(`Error while trying to determine best platform for Percy snapshot ${err}`);
        return null;
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGVyY3lIZWxwZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvUGVyY3kvUGVyY3lIZWxwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsNkNBQTZDO0FBTzdDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxrQkFBa0IsQ0FBQTtBQUM5QyxPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFFOUIsTUFBTSxDQUFDLE1BQU0sVUFBVSxHQUFHLEtBQUssRUFBRSxPQUFnRCxFQUFFLE1BQTBCLEVBQUUsUUFBb0IsRUFBa0IsRUFBRTtJQUNuSixXQUFXLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDbkMsTUFBTSxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUNsRCxNQUFNLFFBQVEsR0FBRyxNQUFNLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUNwQyxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ1gsT0FBTyxLQUFLLENBQUE7SUFDaEIsQ0FBQztJQUNELE9BQVEsRUFBWSxDQUFBO0FBQ3hCLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLFNBQVMsR0FBRyxLQUFLLEVBQUUsS0FBWSxFQUFFLEVBQUU7SUFDNUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO0lBQ25DLE9BQU8sS0FBSyxDQUFDLElBQUksRUFBRSxDQUFBO0FBQ3ZCLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLCtCQUErQixHQUFHLENBQUMsWUFBOEMsRUFBUSxFQUFFO0lBQ3BHLElBQUksQ0FBQztRQUNELE1BQU0sc0JBQXNCLEdBQVEsRUFBRSxRQUFRLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsQ0FBQyxFQUFFLENBQUE7UUFFekYsSUFBSSxnQkFBZ0IsR0FBUSxJ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