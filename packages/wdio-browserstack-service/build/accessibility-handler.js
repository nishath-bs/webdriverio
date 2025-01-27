import util from 'node:util';
import Listener from './testOps/listener.js';
import { getA11yResultsSummary, getAppA11yResultsSummary, getA11yResults, performA11yScan, getUniqueIdentifier, getUniqueIdentifierForCucumber, isAccessibilityAutomationSession, isAppAccessibilityAutomationSession, isBrowserstackSession, o11yClassErrorHandler, shouldScanTestForAccessibility, validateCapsWithA11y, isTrue, validateCapsWithAppA11y, getAppA11yResults } from './util.js';
import accessibilityScripts from './scripts/accessibility-scripts.js';
import { BStackLogger } from './bstackLogger.js';
class _AccessibilityHandler {
    _browser;
    _capabilities;
    isAppAutomate;
    _framework;
    _accessibilityAutomation;
    _accessibilityOpts;
    _platformA11yMeta;
    _caps;
    _suiteFile;
    _accessibility;
    _accessibilityOptions;
    _testMetadata = {};
    static _a11yScanSessionMap = {};
    _sessionId = null;
    listener = Listener.getInstance();
    constructor(_browser, _capabilities, isAppAutomate, _framework, _accessibilityAutomation, _accessibilityOpts) {
        this._browser = _browser;
        this._capabilities = _capabilities;
        this.isAppAutomate = isAppAutomate;
        this._framework = _framework;
        this._accessibilityAutomation = _accessibilityAutomation;
        this._accessibilityOpts = _accessibilityOpts;
        const caps = this._browser.capabilities;
        this._platformA11yMeta = {
            browser_name: caps.browserName,
            browser_version: caps?.browserVersion || caps?.version || 'latest',
            platform_name: caps?.platformName,
            platform_version: this._getCapabilityValue(caps, 'appium:platformVersion', 'platformVersion'),
            os_name: this._getCapabilityValue(_capabilities, 'os', 'os'),
            os_version: this._getCapabilityValue(_capabilities, 'osVersion', 'os_version')
        };
        this._caps = _capabilities;
        this._accessibility = isTrue(_accessibilityAutomation);
        this._accessibilityOptions = _accessibilityOpts;
    }
    setSuiteFile(filename) {
        this._suiteFile = filename;
    }
    _getCapabilityValue(caps, capType, legacyCapType) {
        if (caps) {
            if (capType === 'accessibility') {
                if (caps['bstack:options'] && (isTrue(caps['bstack:options']?.accessibility))) {
                    return caps['bstack:options']?.accessibility;
                }
                else if (isTrue(caps['browserstack.accessibility'])) {
                    return caps['browserstack.accessibility'];
                }
            }
            else if (capType === 'deviceName') {
                if (caps['bstack:options'] && caps['bstack:options']?.deviceName) {
                    return caps['bstack:options']?.deviceName;
                }
                else if (caps['bstack:options'] && caps['bstack:options']?.device) {
                    return caps['bstack:options']?.device;
                }
                else if (caps['appium:deviceName']) {
                    return caps['appium:deviceName'];
                }
            }
            else if (capType === 'goog:chromeOptions' && caps['goog:chromeOptions']) {
                return caps['goog:chromeOptions'];
            }
            else {
                const bstackOptions = caps['bstack:options'];
                if (bstackOptions && bstackOptions?.[capType]) {
                    return bstackOptions?.[capType];
                }
                else if (caps[legacyCapType]) {
                    return caps[legacyCapType];
                }
            }
        }
    }
    async before(sessionId) {
        this._sessionId = sessionId;
        this._accessibility = isTrue(this._getCapabilityValue(this._caps, 'accessibility', 'browserstack.accessibility'));
        if (isBrowserstackSession(this._browser)) {
            if (isAccessibilityAutomationSession(this._accessibility) && !this.isAppAutomate) {
                const deviceName = this._getCapabilityValue(this._caps, 'deviceName', 'device');
                const chromeOptions = this._getCapabilityValue(this._caps, 'goog:chromeOptions', '');
                this._accessibility = validateCapsWithA11y(deviceName, this._platformA11yMeta, chromeOptions);
            }
            if (isAppAccessibilityAutomationSession(this._accessibility, this.isAppAutomate)) {
                this._accessibility = validateCapsWithAppA11y(this._platformA11yMeta);
            }
        }
        this._browser.getAccessibilityResultsSummary = async () => {
            if (isAppAccessibilityAutomationSession(this._accessibility, this.isAppAutomate)) {
                return await getAppA11yResultsSummary(this.isAppAutomate, this._browser, isBrowserstackSession(this._browser), this._accessibility, this._sessionId);
            }
            return await getA11yResultsSummary(this.isAppAutomate, this._browser, isBrowserstackSession(this._browser), this._accessibility);
        };
        this._browser.getAccessibilityResults = async () => {
            if (isAppAccessibilityAutomationSession(this._accessibility, this.isAppAutomate)) {
                return await getAppA11yResults(this.isAppAutomate, this._browser, isBrowserstackSession(this._browser), this._accessibility, this._sessionId);
            }
            return await getA11yResults(this.isAppAutomate, this._browser, isBrowserstackSession(this._browser), this._accessibility);
        };
        this._browser.performScan = async () => {
            return await performA11yScan(this.isAppAutomate, this._browser, isBrowserstackSession(this._browser), this._accessibility);
        };
        if (!this._accessibility) {
            return;
        }
        if (!('overwriteCommand' in this._browser && Array.isArray(accessibilityScripts.commandsToWrap))) {
            return;
        }
        accessibilityScripts.commandsToWrap
            .filter((command) => command.name && command.class)
            .forEach((command) => {
            const browser = this._browser;
            browser.overwriteCommand(command.name, this.commandWrapper.bind(this, command), command.class === 'Element');
        });
    }
    async beforeTest(suiteTitle, test) {
        try {
            if (this._framework !== 'mocha' ||
                !this.shouldRunTestHooks(this._browser, this._accessibility)) {
                /* This is to be used when test events are sent */
                Listener.setTestRunAccessibilityVar(false);
                return;
            }
            const shouldScanTest = shouldScanTestForAccessibility(suiteTitle, test.title, this._accessibilityOptions);
            const testIdentifier = this.getIdentifier(test);
            if (this._sessionId) {
                /* For case with multiple tests under one browser, before hook of 2nd test should change this map value */
                AccessibilityHandler._a11yScanSessionMap[this._sessionId] = shouldScanTest;
            }
            /* This is to be used when test events are sent */
            Listener.setTestRunAccessibilityVar(this._accessibility && shouldScanTest);
            this._testMetadata[testIdentifier] = {
                scanTestForAccessibility: shouldScanTest,
                accessibilityScanStarted: true
            };
            this._testMetadata[testIdentifier].accessibilityScanStarted = shouldScanTest;
            if (shouldScanTest) {
                BStackLogger.info('Automate test case execution has started.');
            }
        }
        catch (error) {
            BStackLogger.error(`Exception in starting accessibility automation scan for this test case ${error}`);
        }
    }
    async afterTest(suiteTitle, test) {
        BStackLogger.debug('Accessibility after test hook. Before sending test stop event');
        if (this._framework !== 'mocha' ||
            !this.shouldRunTestHooks(this._browser, this._accessibility)) {
            return;
        }
        try {
            const testIdentifier = this.getIdentifier(test);
            const accessibilityScanStarted = this._testMetadata[testIdentifier]?.accessibilityScanStarted;
            const shouldScanTestForAccessibility = this._testMetadata[testIdentifier]?.scanTestForAccessibility;
            if (!accessibilityScanStarted) {
                return;
            }
            if (shouldScanTestForAccessibility) {
                BStackLogger.info('Automate test case execution has ended. Processing for accessibility testing is underway. ');
                const dataForExtension = {
                    'thTestRunUuid': process.env.TEST_ANALYTICS_ID,
                    'thBuildUuid': process.env.BROWSERSTACK_TESTHUB_UUID,
                    'thJwtToken': process.env.BROWSERSTACK_TESTHUB_JWT
                };
                await this.sendTestStopEvent(this._browser, dataForExtension);
                BStackLogger.info('Accessibility testing for this test case has ended.');
            }
        }
        catch (error) {
            BStackLogger.error(`Accessibility results could not be processed for the test case ${test.title}. Error : ${error}`);
        }
    }
    /**
      * Cucumber Only
    */
    async beforeScenario(world) {
        const pickleData = world.pickle;
        const gherkinDocument = world.gherkinDocument;
        const featureData = gherkinDocument.feature;
        const uniqueId = getUniqueIdentifierForCucumber(world);
        if (!this.shouldRunTestHooks(this._browser, this._accessibility)) {
            /* This is to be used when test events are sent */
            Listener.setTestRunAccessibilityVar(false);
            return;
        }
        try {
            const shouldScanScenario = shouldScanTestForAccessibility(featureData?.name, pickleData.name, this._accessibilityOptions, world, true);
            this._testMetadata[uniqueId] = {
                scanTestForAccessibility: shouldScanScenario,
                accessibilityScanStarted: true
            };
            this._testMetadata[uniqueId].accessibilityScanStarted = shouldScanScenario;
            if (this._sessionId) {
                /* For case with multiple tests under one browser, before hook of 2nd test should change this map value */
                AccessibilityHandler._a11yScanSessionMap[this._sessionId] = shouldScanScenario;
            }
            /* This is to be used when test events are sent */
            Listener.setTestRunAccessibilityVar(this._accessibility && shouldScanScenario);
            if (shouldScanScenario) {
                BStackLogger.info('Automate test case execution has started.');
            }
        }
        catch (error) {
            BStackLogger.error(`Exception in starting accessibility automation scan for this test case ${error}`);
        }
    }
    async afterScenario(world) {
        BStackLogger.debug('Accessibility after scenario hook. Before sending test stop event');
        if (!this.shouldRunTestHooks(this._browser, this._accessibility)) {
            return;
        }
        const pickleData = world.pickle;
        try {
            const uniqueId = getUniqueIdentifierForCucumber(world);
            const accessibilityScanStarted = this._testMetadata[uniqueId]?.accessibilityScanStarted;
            const shouldScanTestForAccessibility = this._testMetadata[uniqueId]?.scanTestForAccessibility;
            if (!accessibilityScanStarted) {
                return;
            }
            if (shouldScanTestForAccessibility) {
                BStackLogger.info('Automate test case execution has ended. Processing for accessibility testing is underway. ');
                const dataForExtension = {
                    'thTestRunUuid': process.env.TEST_ANALYTICS_ID,
                    'thBuildUuid': process.env.BROWSERSTACK_TESTHUB_UUID,
                    'thJwtToken': process.env.BROWSERSTACK_TESTHUB_JWT
                };
                await this.sendTestStopEvent(this._browser, dataForExtension);
                BStackLogger.info('Accessibility testing for this test case has ended.');
            }
        }
        catch (error) {
            BStackLogger.error(`Accessibility results could not be processed for the test case ${pickleData.name}. Error : ${error}`);
        }
    }
    /*
     * private methods
     */
    async commandWrapper(command, origFunction, ...args) {
        if (this._sessionId && AccessibilityHandler._a11yScanSessionMap[this._sessionId] &&
            (!command.name.includes('execute') ||
                !AccessibilityHandler.shouldPatchExecuteScript(args.length ? args[0] : null))) {
            BStackLogger.debug(`Performing scan for ${command.class} ${command.name}`);
            await performA11yScan(this.isAppAutomate, this._browser, true, true, command.name);
        }
        return origFunction(...args);
    }
    async sendTestStopEvent(browser, dataForExtension) {
        BStackLogger.debug('Performing scan before saving results');
        await performA11yScan(this.isAppAutomate, browser, true, true);
        if (isAppAccessibilityAutomationSession(this._accessibility, this.isAppAutomate)) {
            return;
        }
        const results = await browser.executeAsync(accessibilityScripts.saveTestResults, dataForExtension);
        BStackLogger.debug(util.format(results));
    }
    getIdentifier(test) {
        if ('pickle' in test) {
            return getUniqueIdentifierForCucumber(test);
        }
        return getUniqueIdentifier(test, this._framework);
    }
    shouldRunTestHooks(browser, isAccessibility) {
        if (!browser) {
            return false;
        }
        return isBrowserstackSession(browser) && isAccessibilityAutomationSession(isAccessibility);
    }
    async checkIfPageOpened(browser, testIdentifier, shouldScanTest) {
        let pageOpen = false;
        this._testMetadata[testIdentifier] = {
            scanTestForAccessibility: shouldScanTest,
            accessibilityScanStarted: true
        };
        try {
            const currentURL = await browser.getUrl();
            const url = new URL(currentURL);
            pageOpen = url?.protocol === 'http:' || url?.protocol === 'https:';
        }
        catch (e) {
            pageOpen = false;
        }
        return pageOpen;
    }
    static shouldPatchExecuteScript(script) {
        if (!script || typeof script !== 'string') {
            return true;
        }
        return (script.toLowerCase().indexOf('browserstack_executor') !== -1 ||
            script.toLowerCase().indexOf('browserstack_accessibility_automation_script') !== -1);
    }
}
// https://github.com/microsoft/TypeScript/issues/6543
const AccessibilityHandler = o11yClassErrorHandler(_AccessibilityHandler);
export default AccessibilityHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjZXNzaWJpbGl0eS1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2FjY2Vzc2liaWxpdHktaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFNNUIsT0FBTyxRQUFRLE1BQU0sdUJBQXVCLENBQUE7QUFFNUMsT0FBTyxFQUNILHFCQUFxQixFQUNyQix3QkFBd0IsRUFDeEIsY0FBYyxFQUNkLGVBQWUsRUFDZixtQkFBbUIsRUFDbkIsOEJBQThCLEVBQzlCLGdDQUFnQyxFQUNoQyxtQ0FBbUMsRUFDbkMscUJBQXFCLEVBQ3JCLHFCQUFxQixFQUNyQiw4QkFBOEIsRUFDOUIsb0JBQW9CLEVBQ3BCLE1BQU0sRUFDTix1QkFBdUIsRUFDdkIsaUJBQWlCLEVBQ3BCLE1BQU0sV0FBVyxDQUFBO0FBQ2xCLE9BQU8sb0JBQW9CLE1BQU0sb0NBQW9DLENBQUE7QUFFckUsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBRWhELE1BQU0scUJBQXFCO0lBWVg7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBaEJKLGlCQUFpQixDQUF5QjtJQUMxQyxLQUFLLENBQStCO0lBQ3BDLFVBQVUsQ0FBUztJQUNuQixjQUFjLENBQVU7SUFDeEIscUJBQXFCLENBQTBCO0lBQy9DLGFBQWEsR0FBNEIsRUFBRSxDQUFBO0lBQzNDLE1BQU0sQ0FBQyxtQkFBbUIsR0FBNEIsRUFBRSxDQUFBO0lBQ3hELFVBQVUsR0FBa0IsSUFBSSxDQUFBO0lBQ2hDLFFBQVEsR0FBRyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUE7SUFFekMsWUFDWSxRQUE4RCxFQUM5RCxhQUE0QyxFQUM1QyxhQUFzQixFQUN0QixVQUFtQixFQUNuQix3QkFBMkMsRUFDM0Msa0JBQTRDO1FBTDVDLGFBQVEsR0FBUixRQUFRLENBQXNEO1FBQzlELGtCQUFhLEdBQWIsYUFBYSxDQUErQjtRQUM1QyxrQkFBYSxHQUFiLGFBQWEsQ0FBUztRQUN0QixlQUFVLEdBQVYsVUFBVSxDQUFTO1FBQ25CLDZCQUF3QixHQUF4Qix3QkFBd0IsQ0FBbUI7UUFDM0MsdUJBQWtCLEdBQWxCLGtCQUFrQixDQUEwQjtRQUVwRCxNQUFNLElBQUksR0FBSSxJQUFJLENBQUMsUUFBZ0MsQ0FBQyxZQUF3QyxDQUFBO1FBRTVGLElBQUksQ0FBQyxpQkFBaUIsR0FBRztZQUNyQixZQUFZLEVBQUUsSUFBSSxDQUFDLFdBQVc7WUFDOUIsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLElBQUssSUFBeUMsRUFBRSxPQUFPLElBQUksUUFBUTtZQUN4RyxhQUFhLEVBQUUsSUFBSSxFQUFFLFlBQVk7WUFDakMsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRSxpQkFBaUIsQ0FBQztZQUM3RixPQUFPLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDO1lBQzVELFVBQVUsRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsYUFBYSxFQUFFLFdBQVcsRUFBRSxZQUFZLENBQUM7U0FDakYsQ0FBQTtRQUVELElBQUksQ0FBQyxLQUFLLEdBQUcsYUFBYSxDQUFBO1FBQzFCLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFDdEQsSUFBSSxDQUFDLHFCQUFxQixHQUFHLGtCQUFrQixDQUFBO0lBQ25ELENBQUM7SUFFRCxZQUFZLENBQUMsUUFBZ0I7UUFDekIsSUFBSSxDQUFDLFVBQVUsR0FBRyxRQUFRLENBQUE7SUFDOUIsQ0FBQztJQUVELG1CQUFtQixDQUFDLElBQW1DLEVBQUUsT0FBZSxFQUFFLGFBQXFCO1FBQzNGLElBQUksSUFBSSxFQUFFLENBQUM7WUFDUCxJQUFJLE9BQU8sS0FBSyxlQUFlLEVBQUUsQ0FBQztnQkFDOUIsSUFBSyxJQUFpQyxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUUsSUFBaUMsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxDQUFDLEVBQUUsQ0FBQztvQkFDeEksT0FBUSxJQUFpQyxDQUFDLGdCQUFnQixDQUFDLEVBQUUsYUFBYSxDQUFBO2dCQUM5RSxDQUFDO3FCQUFNLElBQUksTUFBTSxDQUFFLElBQWlDLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxFQUFFLENBQUM7b0JBQ2xGLE9BQVEsSUFBaUMsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO2dCQUMzRSxDQUFDO1lBQ0wsQ0FBQztpQkFBTSxJQUFJLE9BQU8sS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDbEMsSUFBSyxJQUFpQyxDQUFDLGdCQUFnQixDQUFDLElBQUssSUFBaUMsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLFVBQVUsRUFBRSxDQUFDO29CQUMzSCxPQUFRLElBQWlDLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxVQUFVLENBQUE7Z0JBQzNFLENBQUM7cUJBQU0sSUFBSyxJQUFpQyxDQUFDLGdCQUFnQixDQUFDLElBQUssSUFBaUMsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDO29CQUM5SCxPQUFRLElBQWlDLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxNQUFNLENBQUE7Z0JBQ3ZFLENBQUM7cUJBQU0sSUFBSyxJQUFpQyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztvQkFDakUsT0FBUSxJQUFpQyxDQUFDLG1CQUFtQixDQUFDLENBQUE7Z0JBQ2xFLENBQUM7WUFDTCxDQUFDO2lCQUFNLElBQUksT0FBTyxLQUFLLG9CQUFvQixJQUFLLElBQWlDLENBQUMsb0JBQW9CLENBQUMsRUFBRSxDQUFDO2dCQUN0RyxPQUFRLElBQWlDLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtZQUNuRSxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osTUFBTSxhQUFhLEdBQUksSUFBaUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO2dCQUMxRSxJQUFLLGFBQWEsSUFBSSxhQUFhLEVBQUUsQ0FBQyxPQUFzRCxDQUFDLEVBQUUsQ0FBQztvQkFDNUYsT0FBTyxhQUFhLEVBQUUsQ0FBQyxPQUFzRCxDQUFDLENBQUE7Z0JBQ2xGLENBQUM7cUJBQU0sSUFBSyxJQUFpQyxDQUFDLGFBQStDLENBQUMsRUFBRSxDQUFDO29CQUM3RixPQUFRLElBQWlDLENBQUMsYUFBK0MsQ0FBQyxDQUFBO2dCQUM5RixDQUFDO1lBQ0wsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBRSxTQUFpQjtRQUMzQixJQUFJLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtRQUMzQixJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxlQUFlLEVBQUUsNEJBQTRCLENBQUMsQ0FBQyxDQUFBO1FBRWpILElBQUkscUJBQXFCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDdkMsSUFBSSxnQ0FBZ0MsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBQy9FLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLFlBQVksRUFBRSxRQUFRLENBQUMsQ0FBQTtnQkFDL0UsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsb0JBQW9CLEVBQUUsRUFBRSxDQUFDLENBQUE7Z0JBRXBGLElBQUksQ0FBQyxjQUFjLEdBQUcsb0JBQW9CLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxhQUFhLENBQUMsQ0FBQTtZQUNqRyxDQUFDO1lBQ0QsSUFBSSxtQ0FBbUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUMvRSxJQUFJLENBQUMsY0FBYyxHQUFHLHVCQUF1QixDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1lBQ3pFLENBQUM7UUFDTCxDQUFDO1FBRUEsSUFBSSxDQUFDLFFBQWdDLENBQUMsOEJBQThCLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDL0UsSUFBSSxtQ0FBbUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUMvRSxPQUFPLE1BQU0sd0JBQXdCLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRyxJQUFJLENBQUMsUUFBZ0MsRUFBRSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDakwsQ0FBQztZQUNELE9BQU8sTUFBTSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFHLElBQUksQ0FBQyxRQUFnQyxFQUFFLHFCQUFxQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDN0osQ0FBQyxDQUFBO1FBRUEsSUFBSSxDQUFDLFFBQWdDLENBQUMsdUJBQXVCLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDeEUsSUFBSSxtQ0FBbUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUMvRSxPQUFPLE1BQU0saUJBQWlCLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRyxJQUFJLENBQUMsUUFBZ0MsRUFBRSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDMUssQ0FBQztZQUNELE9BQU8sTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRyxJQUFJLENBQUMsUUFBZ0MsRUFBRSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQ3RKLENBQUMsQ0FBQTtRQUVBLElBQUksQ0FBQyxRQUFnQyxDQUFDLFdBQVcsR0FBRyxLQUFLLElBQUksRUFBRTtZQUM1RCxPQUFPLE1BQU0sZUFBZSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUcsSUFBSSxDQUFDLFFBQWdDLEVBQUUscUJBQXFCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUN2SixDQUFDLENBQUE7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3ZCLE9BQU07UUFDVixDQUFDO1FBQ0QsSUFBSSxDQUFDLENBQUMsa0JBQWtCLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLG9CQUFvQixDQUFDLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUMvRixPQUFNO1FBQ1YsQ0FBQztRQUVELG9CQUFvQixDQUFDLGNBQWM7YUFDOUIsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxJQUFJLE9BQU8sQ0FBQyxLQUFLLENBQUM7YUFDbEQsT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDakIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQStCLENBQUE7WUFDcEQsT0FBTyxDQUFDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEtBQUssU0FBUyxDQUFDLENBQUE7UUFDaEgsQ0FBQyxDQUFDLENBQUE7SUFDVixDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBRSxVQUE4QixFQUFFLElBQXFCO1FBQ25FLElBQUksQ0FBQztZQUNELElBQ0ksSUFBSSxDQUFDLFVBQVUsS0FBSyxPQUFPO2dCQUMzQixDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsRUFDOUQsQ0FBQztnQkFDQyxrREFBa0Q7Z0JBQ2xELFFBQVEsQ0FBQywwQkFBMEIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDMUMsT0FBTTtZQUNWLENBQUM7WUFFRCxNQUFNLGNBQWMsR0FBRyw4QkFBOEIsQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQTtZQUN6RyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBRS9DLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNsQiwwR0FBMEc7Z0JBQzFHLG9CQUFvQixDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxjQUFjLENBQUE7WUFDOUUsQ0FBQztZQUVELGtEQUFrRDtZQUNsRCxRQUFRLENBQUMsMEJBQTBCLENBQUMsSUFBSSxDQUFDLGNBQWMsSUFBSSxjQUFjLENBQUMsQ0FBQTtZQUMxRSxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxHQUFHO2dCQUNqQyx3QkFBd0IsRUFBRyxjQUFjO2dCQUN6Qyx3QkFBd0IsRUFBRyxJQUFJO2FBQ2xDLENBQUE7WUFDRCxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxDQUFDLHdCQUF3QixHQUFHLGNBQWMsQ0FBQTtZQUU1RSxJQUFJLGNBQWMsRUFBRSxDQUFDO2dCQUNqQixZQUFZLENBQUMsSUFBSSxDQUFDLDJDQUEyQyxDQUFDLENBQUE7WUFDbEUsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsWUFBWSxDQUFDLEtBQUssQ0FBQywwRUFBMEUsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUN6RyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxTQUFTLENBQUUsVUFBOEIsRUFBRSxJQUFxQjtRQUNsRSxZQUFZLENBQUMsS0FBSyxDQUFDLCtEQUErRCxDQUFDLENBQUE7UUFDbkYsSUFDSSxJQUFJLENBQUMsVUFBVSxLQUFLLE9BQU87WUFDM0IsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQzlELENBQUM7WUFDQyxPQUFNO1FBQ1YsQ0FBQztRQUVELElBQUksQ0FBQztZQUNELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDL0MsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxFQUFFLHdCQUF3QixDQUFBO1lBQzdGLE1BQU0sOEJBQThCLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsRUFBRSx3QkFBd0IsQ0FBQTtZQUVuRyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztnQkFDNUIsT0FBTTtZQUNWLENBQUM7WUFFRCxJQUFJLDhCQUE4QixFQUFFLENBQUM7Z0JBQ2pDLFlBQVksQ0FBQyxJQUFJLENBQUMsNEZBQTRGLENBQUMsQ0FBQTtnQkFFL0csTUFBTSxnQkFBZ0IsR0FBRztvQkFDckIsZUFBZSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCO29CQUM5QyxhQUFhLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUI7b0JBQ3BELFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QjtpQkFDckQsQ0FBQTtnQkFFRCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBRSxJQUFJLENBQUMsUUFBZ0MsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO2dCQUV0RixZQUFZLENBQUMsSUFBSSxDQUFDLHFEQUFxRCxDQUFDLENBQUE7WUFDNUUsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsWUFBWSxDQUFDLEtBQUssQ0FBQyxrRUFBa0UsSUFBSSxDQUFDLEtBQUssYUFBYSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQ3hILENBQUM7SUFDTCxDQUFDO0lBRUQ7O01BRUU7SUFDRixLQUFLLENBQUMsY0FBYyxDQUFFLEtBQTZCO1FBQy9DLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUE7UUFDL0IsTUFBTSxlQUFlLEdBQUcsS0FBSyxDQUFDLGVBQWUsQ0FBQTtRQUM3QyxNQUFNLFdBQVcsR0FBRyxlQUFlLENBQUMsT0FBTyxDQUFBO1FBQzNDLE1BQU0sUUFBUSxHQUFHLDhCQUE4QixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3RELElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztZQUMvRCxrREFBa0Q7WUFDbEQsUUFBUSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzFDLE9BQU07UUFDVixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0QsTUFBTSxrQkFBa0IsR0FBRyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLFVBQVUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUN0SSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxHQUFHO2dCQUMzQix3QkFBd0IsRUFBRyxrQkFBa0I7Z0JBQzdDLHdCQUF3QixFQUFHLElBQUk7YUFDbEMsQ0FBQTtZQUNELElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUMsd0JBQXdCLEdBQUcsa0JBQWtCLENBQUE7WUFDMUUsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ2xCLDBHQUEwRztnQkFDMUcsb0JBQW9CLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLGtCQUFrQixDQUFBO1lBQ2xGLENBQUM7WUFFRCxrREFBa0Q7WUFDbEQsUUFBUSxDQUFDLDBCQUEwQixDQUFDLElBQUksQ0FBQyxjQUFjLElBQUksa0JBQWtCLENBQUMsQ0FBQTtZQUU5RSxJQUFJLGtCQUFrQixFQUFFLENBQUM7Z0JBQ3JCLFlBQVksQ0FBQyxJQUFJLENBQUMsMkNBQTJDLENBQUMsQ0FBQTtZQUNsRSxDQUFDO1FBQ0wsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixZQUFZLENBQUMsS0FBSyxDQUFDLDBFQUEwRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQ3pHLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWEsQ0FBRSxLQUE2QjtRQUM5QyxZQUFZLENBQUMsS0FBSyxDQUFDLG1FQUFtRSxDQUFDLENBQUE7UUFDdkYsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQy9ELE9BQU07UUFDVixDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQTtRQUMvQixJQUFJLENBQUM7WUFDRCxNQUFNLFFBQVEsR0FBRyw4QkFBOEIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUN0RCxNQUFNLHdCQUF3QixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLEVBQUUsd0JBQXdCLENBQUE7WUFDdkYsTUFBTSw4QkFBOEIsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxFQUFFLHdCQUF3QixDQUFBO1lBRTdGLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFDO2dCQUM1QixPQUFNO1lBQ1YsQ0FBQztZQUVELElBQUksOEJBQThCLEVBQUUsQ0FBQztnQkFDakMsWUFBWSxDQUFDLElBQUksQ0FBQyw0RkFBNEYsQ0FBQyxDQUFBO2dCQUUvRyxNQUFNLGdCQUFnQixHQUFHO29CQUNyQixlQUFlLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUI7b0JBQzlDLGFBQWEsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QjtvQkFDcEQsWUFBWSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCO2lCQUNyRCxDQUFBO2dCQUVELE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFHLElBQUksQ0FBQyxRQUFnQyxFQUFFLGdCQUFnQixDQUFDLENBQUE7Z0JBRXZGLFlBQVksQ0FBQyxJQUFJLENBQUMscURBQXFELENBQUMsQ0FBQTtZQUM1RSxDQUFDO1FBQ0wsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixZQUFZLENBQUMsS0FBSyxDQUFDLGtFQUFrRSxVQUFVLENBQUMsSUFBSSxhQUFhLEtBQUssRUFBRSxDQUFDLENBQUE7UUFDN0gsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUVLLEtBQUssQ0FBQyxjQUFjLENBQUUsT0FBWSxFQUFFLFlBQXNCLEVBQUUsR0FBRyxJQUFXO1FBQzlFLElBQ0ksSUFBSSxDQUFDLFVBQVUsSUFBSSxvQkFBb0IsQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO1lBQ3hFLENBQ0ksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUM7Z0JBQ2pDLENBQUMsb0JBQW9CLENBQUMsd0JBQXdCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FDL0UsRUFDUCxDQUFDO1lBQ0MsWUFBWSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsT0FBTyxDQUFDLEtBQUssSUFBSSxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtZQUMxRSxNQUFNLGVBQWUsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDdEYsQ0FBQztRQUNELE9BQU8sWUFBWSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUE7SUFDaEMsQ0FBQztJQUVPLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxPQUE0QixFQUFFLGdCQUFxQjtRQUMvRSxZQUFZLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7UUFDM0QsTUFBTSxlQUFlLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQzlELElBQUksbUNBQW1DLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUMvRSxPQUFNO1FBQ1YsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFZLE1BQU8sT0FBK0IsQ0FBQyxZQUFZLENBQUMsb0JBQW9CLENBQUMsZUFBeUIsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1FBQzlJLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFpQixDQUFDLENBQUMsQ0FBQTtJQUN0RCxDQUFDO0lBRU8sYUFBYSxDQUFFLElBQThDO1FBQ2pFLElBQUksUUFBUSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ25CLE9BQU8sOEJBQThCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDL0MsQ0FBQztRQUNELE9BQU8sbUJBQW1CLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUNyRCxDQUFDO0lBRU8sa0JBQWtCLENBQUMsT0FBWSxFQUFFLGVBQWtDO1FBQ3ZFLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNYLE9BQU8sS0FBSyxDQUFBO1FBQ2hCLENBQUM7UUFDRCxPQUFPLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxJQUFJLGdDQUFnQyxDQUFDLGVBQWUsQ0FBQyxDQUFBO0lBQzlGLENBQUM7SUFFTyxLQUFLLENBQUMsaUJBQWlCLENBQUMsT0FBNkQsRUFBRSxjQUFzQixFQUFFLGNBQXdCO1FBQzNJLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNwQixJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxHQUFHO1lBQ2pDLHdCQUF3QixFQUFHLGNBQWM7WUFDekMsd0JBQXdCLEVBQUcsSUFBSTtTQUNsQyxDQUFBO1FBRUQsSUFBSSxDQUFDO1lBQ0QsTUFBTSxVQUFVLEdBQUcsTUFBTyxPQUErQixDQUFDLE1BQU0sRUFBRSxDQUFBO1lBQ2xFLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQy9CLFFBQVEsR0FBRyxHQUFHLEVBQUUsUUFBUSxLQUFLLE9BQU8sSUFBSSxHQUFHLEVBQUUsUUFBUSxLQUFLLFFBQVEsQ0FBQTtRQUN0RSxDQUFDO1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNULFFBQVEsR0FBRyxLQUFLLENBQUE7UUFDcEIsQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ25CLENBQUM7SUFFTyxNQUFNLENBQUMsd0JBQXdCLENBQUMsTUFBcUI7UUFDekQsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN4QyxPQUFPLElBQUksQ0FBQTtRQUNmLENBQUM7UUFFRCxPQUFPLENBQ0gsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUM1RCxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsT0FBTyxDQUFDLDhDQUE4QyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQ3RGLENBQUE7SUFDTCxDQUFDOztBQUdMLHNEQUFzRDtBQUN0RCxNQUFNLG9CQUFvQixHQUFpQyxxQkFBcUIsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO0FBR3ZHLGVBQWUsb0JBQW9CLENBQUEifQ==