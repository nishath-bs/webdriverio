import type { Capabilities, Frameworks } from '@wdio/types';
import type { ITestCaseHookParameter } from './cucumber-types.js';
declare class _AccessibilityHandler {
    private _browser;
    private _capabilities;
    private isAppAutomate;
    private _framework?;
    private _accessibilityAutomation?;
    private _accessibilityOpts?;
    private _platformA11yMeta;
    private _caps;
    private _suiteFile?;
    private _accessibility?;
    private _accessibilityOptions?;
    private _testMetadata;
    private static _a11yScanSessionMap;
    private _sessionId;
    private listener;
    constructor(_browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser, _capabilities: Capabilities.RemoteCapability, isAppAutomate: boolean, _framework?: string | undefined, _accessibilityAutomation?: (boolean | string) | undefined, _accessibilityOpts?: {
        [key: string]: any;
    } | undefined);
    setSuiteFile(filename: string): void;
    _getCapabilityValue(caps: Capabilities.RemoteCapability, capType: string, legacyCapType: string): WebdriverIO.SafaridriverOptions | undefined;
    before(sessionId: string): Promise<void>;
    beforeTest(suiteTitle: string | undefined, test: Frameworks.Test): Promise<void>;
    afterTest(suiteTitle: string | undefined, test: Frameworks.Test): Promise<void>;
    /**
      * Cucumber Only
    */
    beforeScenario(world: ITestCaseHookParameter): Promise<void>;
    afterScenario(world: ITestCaseHookParameter): Promise<void>;
    private commandWrapper;
    private sendTestStopEvent;
    private getIdentifier;
    private shouldRunTestHooks;
    private checkIfPageOpened;
    private static shouldPatchExecuteScript;
}
declare const AccessibilityHandler: typeof _AccessibilityHandler;
type AccessibilityHandler = _AccessibilityHandler;
export default AccessibilityHandler;
//# sourceMappingURL=accessibility-handler.d.ts.map