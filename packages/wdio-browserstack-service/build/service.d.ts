import type { Services, Capabilities, Options, Frameworks } from '@wdio/types';
import type { BrowserstackConfig, MultiRemoteAction } from './types.js';
import type { Pickle, Feature, ITestCaseHookParameter, CucumberHook } from './cucumber-types.js';
export default class BrowserstackService implements Services.ServiceInstance {
    private _caps;
    private _config;
    private _sessionBaseUrl;
    private _failReasons;
    private _scenariosThatRan;
    private _failureStatuses;
    private _browser?;
    private _suiteTitle?;
    private _suiteFile?;
    private _fullTitle?;
    private _options;
    private _specsRan;
    private _observability;
    private _currentTest?;
    private _insightsHandler?;
    private _accessibility;
    private _accessibilityHandler?;
    private _percy;
    private _percyCaptureMode;
    private _percyHandler?;
    private _turboScale;
    constructor(options: BrowserstackConfig & Options.Testrunner, _caps: Capabilities.RemoteCapability, _config: Options.Testrunner);
    _updateCaps(fn: (caps: WebdriverIO.Capabilities | Capabilities.DesiredCapabilities) => void): void;
    beforeSession(config: Omit<Options.Testrunner, 'capabilities'>): void;
    before(caps: Capabilities.RemoteCapability, specs: string[], browser: WebdriverIO.Browser): Promise<void>;
    /**
     * Set the default job name at the suite level to make sure we account
     * for the cases where there is a long running `before` function for a
     * suite or one that can fail.
     * Don't do this for Jasmine because `suite.title` is `Jasmine__TopLevel__Suite`
     * and `suite.fullTitle` is `undefined`, so no alternative to use for the job name.
     */
    beforeSuite(suite: Frameworks.Suite): Promise<void>;
    beforeHook(test: Frameworks.Test | CucumberHook, context: any): Promise<void>;
    afterHook(test: Frameworks.Test | CucumberHook, context: unknown, result: Frameworks.TestResult): Promise<void>;
    beforeTest(test: Frameworks.Test): Promise<void>;
    afterTest(test: Frameworks.Test, context: never, results: Frameworks.TestResult): Promise<void>;
    after(result: number): Promise<void>;
    /**
     * For CucumberJS
     */
    beforeFeature(uri: string, feature: Feature): Promise<void>;
    /**
     * Runs before a Cucumber Scenario.
     * @param world world object containing information on pickle and test step
     */
    beforeScenario(world: ITestCaseHookParameter): Promise<void>;
    afterScenario(world: ITestCaseHookParameter): Promise<void>;
    beforeStep(step: Frameworks.PickleStep, scenario: Pickle): Promise<void>;
    afterStep(step: Frameworks.PickleStep, scenario: Pickle, result: Frameworks.PickleResult): Promise<void>;
    onReload(oldSessionId: string, newSessionId: string): Promise<void>;
    _isAppAutomate(): boolean;
    _updateJob(requestBody: any): Promise<any>;
    _multiRemoteAction(action: MultiRemoteAction): Promise<any>;
    _update(sessionId: string, requestBody: any): Promise<void> | import("got").CancelableRequest<import("got").Response<string>>;
    _printSessionURL(): Promise<void>;
    private _setSessionName;
    private _setAnnotation;
    private _executeCommand;
    private saveWorkerData;
}
//# sourceMappingURL=service.d.ts.map