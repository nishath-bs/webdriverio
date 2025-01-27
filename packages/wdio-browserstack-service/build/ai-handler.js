import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import aiSDK from '@browserstack/ai-sdk-node';
import { BStackLogger } from './bstackLogger.js';
import { TCG_URL, TCG_INFO, SUPPORTED_BROWSERS_FOR_AI, BSTACK_SERVICE_VERSION, BSTACK_TCG_AUTH_RESULT } from './constants.js';
import { handleHealingInstrumentation } from './instrumentation/funnelInstrumentation.js';
import { getBrowserStackUserAndKey, isBrowserstackInfra } from './util.js';
class AiHandler {
    authResult;
    wdioBstackVersion;
    constructor() {
        this.authResult = JSON.parse(process.env[BSTACK_TCG_AUTH_RESULT] || '{}');
        this.wdioBstackVersion = BSTACK_SERVICE_VERSION;
    }
    async authenticateUser(user, key) {
        return await aiSDK.BrowserstackHealing.init(key, user, TCG_URL, this.wdioBstackVersion);
    }
    updateCaps(authResult, options, caps) {
        const installExtCondition = authResult.isAuthenticated === true && (authResult.defaultLogDataEnabled === true || options.selfHeal === true);
        if (installExtCondition) {
            if (Array.isArray(caps)) {
                const newCaps = aiSDK.BrowserstackHealing.initializeCapabilities(caps[0]);
                caps[0] = newCaps;
            }
            else if (typeof caps === 'object') {
                caps = aiSDK.BrowserstackHealing.initializeCapabilities(caps);
            }
        }
        else if (options.selfHeal === true) {
            const healingWarnMessage = authResult.message;
            BStackLogger.warn(`Healing Auth failed. Disabling healing for this session. Reason: ${healingWarnMessage}`);
        }
        return caps;
    }
    async setToken(sessionId, sessionToken) {
        await aiSDK.BrowserstackHealing.setToken(sessionId, sessionToken, TCG_URL);
    }
    async installFirefoxExtension(browser) {
        const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
        const extensionPath = path.resolve(__dirname, aiSDK.BrowserstackHealing.getFirefoxAddonPath());
        const extFile = fs.readFileSync(extensionPath);
        await browser.installAddOn(extFile.toString('base64'), true);
    }
    async handleHealing(orginalFunc, using, value, browser, options) {
        const sessionId = browser.sessionId;
        // a utility function to escape single and double quotes
        const escapeString = (str) => str.replace(/'/g, "\\'").replace(/"/g, '\\"');
        const tcgDetails = escapeString(JSON.stringify({
            region: TCG_INFO.tcgRegion,
            tcgUrls: {
                [TCG_INFO.tcgRegion]: {
                    endpoint: TCG_INFO.tcgUrl.split('://')[1]
                }
            }
        }));
        const locatorType = escapeString(using);
        const locatorValue = escapeString(value);
        this.authResult = this.authResult;
        try {
            const result = await orginalFunc(using, value);
            if (!result.error) {
                const script = await aiSDK.BrowserstackHealing.logData(locatorType, locatorValue, undefined, undefined, this.authResult.groupId, sessionId, undefined, tcgDetails);
                if (script) {
                    await browser.execute(script);
                }
                return result;
            }
            if (options.selfHeal === true && this.authResult.isHealingEnabled) {
                BStackLogger.info('findElement failed, trying to heal');
                const script = await aiSDK.BrowserstackHealing.healFailure(locatorType, locatorValue, undefined, undefined, this.authResult.userId, this.authResult.groupId, sessionId, undefined, undefined, this.authResult.isGroupAIEnabled, tcgDetails);
                if (script) {
                    await browser.execute(script);
                    const tcgData = await aiSDK.BrowserstackHealing.pollResult(TCG_URL, sessionId, this.authResult.sessionToken);
                    if (tcgData && tcgData.selector && tcgData.value) {
                        const healedResult = await orginalFunc(tcgData.selector, tcgData.value);
                        BStackLogger.info('Healing worked, element found: ' + tcgData.selector + ': ' + tcgData.value);
                        return healedResult.error ? result : healedResult;
                    }
                }
            }
        }
        catch (err) {
            if (options.selfHeal === true) {
                BStackLogger.warn('Something went wrong while healing. Disabling healing for this command');
            }
            else {
                BStackLogger.warn('Error in findElement: ' + err + 'using: ' + using + 'value: ' + value);
            }
        }
        return await orginalFunc(using, value);
    }
    addMultiRemoteCaps(authResult, config, browserStackConfig, options, caps, browser) {
        if (caps[browser].capabilities &&
            !(isBrowserstackInfra(caps[browser])) &&
            SUPPORTED_BROWSERS_FOR_AI.includes(caps[browser]?.capabilities?.browserName?.toLowerCase())) {
            const innerConfig = getBrowserStackUserAndKey(config, options);
            if (innerConfig?.user && innerConfig.key) {
                handleHealingInstrumentation(authResult, browserStackConfig, options.selfHeal);
                caps[browser].capabilities = this.updateCaps(authResult, options, caps[browser].capabilities);
            }
        }
    }
    handleMultiRemoteSetup(authResult, config, browserStackConfig, options, caps) {
        const browserNames = Object.keys(caps);
        for (let i = 0; i < browserNames.length; i++) {
            const browser = browserNames[i];
            this.addMultiRemoteCaps(authResult, config, browserStackConfig, options, caps, browser);
        }
    }
    async setup(config, browserStackConfig, options, caps, isMultiremote) {
        try {
            const innerConfig = getBrowserStackUserAndKey(config, options);
            if (innerConfig?.user && innerConfig.key) {
                const authResult = await this.authenticateUser(innerConfig.user, innerConfig.key);
                process.env[BSTACK_TCG_AUTH_RESULT] = JSON.stringify(authResult);
                if (!isMultiremote && SUPPORTED_BROWSERS_FOR_AI.includes(caps?.browserName?.toLowerCase())) {
                    handleHealingInstrumentation(authResult, browserStackConfig, options.selfHeal);
                    this.updateCaps(authResult, options, caps);
                }
                else if (isMultiremote) {
                    this.handleMultiRemoteSetup(authResult, config, browserStackConfig, options, caps);
                }
            }
        }
        catch (err) {
            if (options.selfHeal === true) {
                BStackLogger.warn(`Error while initiliazing Browserstack healing Extension ${err}`);
            }
        }
        return caps;
    }
    async handleSelfHeal(options, browser) {
        if (SUPPORTED_BROWSERS_FOR_AI.includes(browser.capabilities?.browserName?.toLowerCase())) {
            const authInfo = this.authResult;
            if (Object.keys(authInfo).length === 0 && options.selfHeal === true) {
                BStackLogger.debug('TCG Auth result is empty');
                return;
            }
            const { isAuthenticated, sessionToken, defaultLogDataEnabled } = authInfo;
            if (isAuthenticated && (defaultLogDataEnabled === true || options.selfHeal === true)) {
                await this.setToken(browser.sessionId, sessionToken);
                if (browser.capabilities.browserName === 'firefox') {
                    await this.installFirefoxExtension(browser);
                }
                browser.overwriteCommand('findElement', async (orginalFunc, using, value) => {
                    return await this.handleHealing(orginalFunc, using, value, browser, options);
                });
            }
        }
    }
    async selfHeal(options, caps, browser) {
        try {
            const multiRemoteBrowsers = Object.keys(caps).filter(e => Object.keys(browser).includes(e));
            if (multiRemoteBrowsers.length > 0) {
                for (let i = 0; i < multiRemoteBrowsers.length; i++) {
                    const remoteBrowser = browser[multiRemoteBrowsers[i]];
                    await this.handleSelfHeal(options, remoteBrowser);
                }
            }
            else {
                await this.handleSelfHeal(options, browser);
            }
        }
        catch (err) {
            if (options.selfHeal === true) {
                BStackLogger.warn(`Error while setting up self-healing: ${err}. Disabling healing for this session.`);
            }
        }
    }
}
export default new AiHandler();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWktaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9haS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFDeEIsT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFBO0FBQzFCLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBQzdDLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQTtBQUNoRCxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSx5QkFBeUIsRUFBRSxzQkFBc0IsRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGdCQUFnQixDQUFBO0FBQzdILE9BQU8sRUFBRSw0QkFBNEIsRUFBRSxNQUFNLDRDQUE0QyxDQUFBO0FBTXpGLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUcxRSxNQUFNLFNBQVM7SUFDWCxVQUFVLENBQWlGO0lBQzNGLGlCQUFpQixDQUFRO0lBQ3pCO1FBQ0ksSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQTtRQUN6RSxJQUFJLENBQUMsaUJBQWlCLEdBQUcsc0JBQXNCLENBQUE7SUFDbkQsQ0FBQztJQUVELEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFZLEVBQUUsR0FBVztRQUM1QyxPQUFPLE1BQU0sS0FBSyxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtJQUMzRixDQUFDO0lBRUQsVUFBVSxDQUNOLFVBQTJGLEVBQzNGLE9BQTRCLEVBQzVCLElBQTBFO1FBRTFFLE1BQU0sbUJBQW1CLEdBQUcsVUFB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