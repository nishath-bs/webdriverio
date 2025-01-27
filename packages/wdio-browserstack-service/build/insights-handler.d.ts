import type { Frameworks, Options } from '@wdio/types';
import type { BeforeCommandArgs, AfterCommandArgs } from '@wdio/reporter';
import type { Feature, Scenario, CucumberHook, CucumberHookParams, Pickle, ITestCaseHookParameter } from './cucumber-types.js';
import type { BrowserstackConfig } from './types.js';
import type { TestData, TestMeta, CurrentRunInfo, StdLog, CBTData } from './types.js';
import type { Capabilities } from '@wdio/types';
declare class _InsightsHandler {
    private _browser;
    private _framework?;
    private _tests;
    private _hooks;
    private _platformMeta;
    private _commands;
    private _gitConfigPath?;
    private _suiteFile?;
    static currentTest: CurrentRunInfo;
    private _currentHook;
    private _cucumberData;
    private _userCaps?;
    private listener;
    currentTestId: string | undefined;
    cbtQueue: Array<CBTData>;
    constructor(_browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser, _framework?: string | undefined, _userCaps?: Capabilities.RemoteCapability, _options?: BrowserstackConfig & Options.Testrunner);
    _isAppAutomate(): boolean;
    registerListeners(): void;
    setSuiteFile(filename: string): void;
    before(): Promise<void>;
    getCucumberHookType(test: CucumberHook | undefined): string | null;
    getCucumberHookName(hookType: string | undefined): string;
    getCucumberHookUniqueId(hookType: string, hook: CucumberHook | undefined): string | null;
    getCucumberFeatureUniqueId(): string;
    setCurrentHook(hookDetails: CurrentRunInfo): void;
    sendScenarioObjectSkipped(scenario: Scenario, feature: Feature, uri: string): Promise<void>;
    processCucumberHook(test: CucumberHook | undefined, params: CucumberHookParams, result?: Frameworks.TestResult): Promise<void>;
    beforeHook(test: Frameworks.Test | CucumberHook | undefined, context: any): Promise<void>;
    afterHook(test: Frameworks.Test | CucumberHook | undefined, result: Frameworks.TestResult): Promise<void>;
    getHookRunDataForCucumber(hookData: TestMeta, eventType: string, result?: Frameworks.TestResult): TestData;
    beforeTest(test: Frameworks.Test): Promise<void>;
    afterTest(test: Frameworks.Test, result: Frameworks.TestResult): Promise<void>;
    /**
      * Cucumber Only
      */
    beforeFeature(uri: string, feature: Feature): Promise<void>;
    beforeScenario(world: ITestCaseHookParameter): Promise<void>;
    afterScenario(world: ITestCaseHookParameter): Promise<void>;
    beforeStep(step: Frameworks.PickleStep, scenario: Pickle): Promise<void>;
    afterStep(step: Frameworks.PickleStep, scenario: Pickle, result: Frameworks.PickleResult): Promise<void>;
    /**
     * misc methods
     */
    appendTestItemLog: (stdLog: StdLog) => Promise<void>;
    browserCommand(commandType: string, args: BeforeCommandArgs | AfterCommandArgs, test?: Frameworks.Test | ITestCaseHookParameter): Promise<void>;
    private attachHookData;
    private setHooksFromSuite;
    private getHierarchy;
    private getRunData;
    private getTestRunId;
    private getTestRunIdFromSuite;
    private getTestRunDataForCucumber;
    flushCBTDataQueue(): Promise<void>;
    sendCBTInfo(): Promise<void>;
    private getIntegrationsObject;
    private getIdentifier;
}
declare const InsightsHandler: typeof _InsightsHandler;
type InsightsHandler = _InsightsHandler;
export default InsightsHandler;
//# sourceMappingURL=insights-handler.d.ts.map