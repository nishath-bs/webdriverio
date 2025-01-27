import http from 'node:http';
import https from 'node:https';
import type { Capabilities, Frameworks, Options } from '@wdio/types';
import type { BeforeCommandArgs, AfterCommandArgs } from '@wdio/reporter';
import type { Method } from 'got';
import type { ColorName } from 'chalk';
import type { UploadType, LaunchResponse, BrowserstackConfig } from './types.js';
import type { ITestCaseHookParameter } from './cucumber-types.js';
export type GitMetaData = {
    name: string;
    sha: string;
    short_sha: string;
    branch: string;
    tag: string | null;
    committer: string;
    committer_date: string;
    author: string;
    author_date: string;
    commit_message: string;
    root: string;
    common_git_dir: string;
    worktree_git_dir: string;
    last_tag: string | null;
    commits_since_last_tag: number;
    remotes: Array<{
        name: string;
        url: string;
    }>;
};
export declare const DEFAULT_REQUEST_CONFIG: {
    agent: {
        http: http.Agent;
        https: https.Agent;
    };
    headers: {
        'Content-Type': string;
        'X-BSTACK-OBS': string;
    };
};
export declare const COLORS: Record<string, ColorName>;
/**
 * get browser description for Browserstack service
 * @param cap browser capablities
 */
export declare function getBrowserDescription(cap: Capabilities.DesiredCapabilities): string;
/**
 * get correct browser capabilities object in both multiremote and normal setups
 * @param browser browser object
 * @param caps browser capbilities object. In case of multiremote, the object itself should have a property named 'capabilities'
 * @param browserName browser name in case of multiremote
 */
export declare function getBrowserCapabilities(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser, caps?: Capabilities.RemoteCapability, browserName?: string): WebdriverIO.Capabilities;
/**
 * check for browserstack W3C capabilities. Does not support legacy capabilities
 * @param cap browser capabilities
 */
export declare function isBrowserstackCapability(cap?: WebdriverIO.Capabilities): boolean;
export declare function getParentSuiteName(fullTitle: string, testSuiteTitle: string): string;
export declare function o11yErrorHandler(fn: Function): (...args: any) => any;
export declare function errorHandler(fn: Function): (...args: any) => any;
export declare function nodeRequest(requestType: Method, apiEndpoint: string, options: any, apiUrl: string, timeout?: number): Promise<any>;
type ClassType = {
    new (...args: any[]): any;
};
export declare function o11yClassErrorHandler<T extends ClassType>(errorClass: T): T;
export declare const processTestObservabilityResponse: (response: LaunchResponse) => void;
interface DataElement {
    [key: string]: any;
}
export declare const jsonifyAccessibilityArray: (dataArray: DataElement[], keyName: keyof DataElement, valueName: keyof DataElement) => Record<string, any>;
export declare const processAccessibilityResponse: (response: LaunchResponse) => void;
export declare const processLaunchBuildResponse: (response: LaunchResponse, options: BrowserstackConfig & Options.Testrunner) => void;
export declare const launchTestSession: (...args: any) => any;
export declare const validateCapsWithAppA11y: (platformMeta?: {
    [key: string]: any;
}) => boolean;
export declare const validateCapsWithA11y: (deviceName?: any, platformMeta?: {
    [key: string]: any;
}, chromeOptions?: any) => boolean;
export declare const shouldScanTestForAccessibility: (suiteTitle: string | undefined, testTitle: string, accessibilityOptions?: {
    [key: string]: any;
}, world?: {
    [key: string]: any;
}, isCucumber?: boolean) => boolean;
export declare const isAccessibilityAutomationSession: (accessibilityFlag?: boolean | string) => boolean | "" | undefined;
export declare const isAppAccessibilityAutomationSession: (accessibilityFlag?: boolean | string, isAppAutomate?: boolean) => boolean | "" | undefined;
export declare const formatString: (template: (string | null), ...values: (string | null)[]) => string;
export declare const _getParamsForAppAccessibility: (commandName?: string) => {
    thTestRunUuid: any;
    thBuildUuid: any;
    thJwtToken: any;
    authHeader: any;
    scanTimestamp: Number;
    method: string | undefined;
};
export declare const performA11yScan: (isAppAutomate: boolean, browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser, isBrowserStackSession?: boolean, isAccessibility?: boolean | string, commandName?: string) => Promise<{
    [key: string]: any;
} | undefined>;
export declare const getA11yResults: (isAppAutomate: boolean, browser: WebdriverIO.Browser, isBrowserStackSession?: boolean, isAccessibility?: boolean | string) => Promise<Array<{
    [key: string]: any;
}>>;
export declare const getAppA11yResults: (isAppAutomate: boolean, browser: WebdriverIO.Browser, isBrowserStackSession?: boolean, isAccessibility?: boolean | string, sessionId?: string | null) => Promise<Array<{
    [key: string]: any;
}>>;
export declare const getAppA11yResultsSummary: (isAppAutomate: boolean, browser: WebdriverIO.Browser, isBrowserStackSession?: boolean, isAccessibility?: boolean | string, sessionId?: string | null) => Promise<{
    [key: string]: any;
}>;
export declare const getA11yResultsSummary: (isAppAutomate: boolean, browser: WebdriverIO.Browser, isBrowserStackSession?: boolean, isAccessibility?: boolean | string) => Promise<{
    [key: string]: any;
}>;
export declare const stopBuildUpstream: (...args: any) => any;
export declare function getCiInfo(): {
    name: string;
    build_url: string | undefined;
    job_name: string | undefined;
    build_number: string | undefined;
} | {
    name: string;
    build_url: string | undefined;
    job_name: string | null;
    build_number: string | undefined;
} | {
    name: string;
    build_url: null;
    job_name: string | undefined;
    build_number: string | undefined;
} | {
    name: string;
    build_url: string;
    job_name: null;
    build_number: null;
} | {
    name: string;
    build_url: null;
    job_name: null;
    build_number: string | undefined;
} | {
    name: string;
    build_url: null;
    job_name: string | null;
    build_number: string | null;
} | null;
export declare function getGitMetaData(): Promise<GitMetaData | undefined>;
export declare function getUniqueIdentifier(test: Frameworks.Test, framework?: string): string;
export declare function getUniqueIdentifierForCucumber(world: ITestCaseHookParameter): string;
export declare function getCloudProvider(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser): string;
export declare function isBrowserstackSession(browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser): boolean | undefined;
export declare function getScenarioExamples(world: ITestCaseHookParameter): string[] | undefined;
export declare function removeAnsiColors(message: string): string;
export declare function getLogTag(eventType: string): string;
export declare function getHierarchy(fullTitle?: string): string[];
export declare function getHookType(hookName: string): string;
export declare function isScreenshotCommand(args: BeforeCommandArgs | AfterCommandArgs): boolean | "" | undefined;
export declare function isBStackSession(config: Options.Testrunner): boolean;
export declare function isBrowserstackInfra(config: BrowserstackConfig & Options.Testrunner, caps?: Capabilities.BrowserStackCapabilities): boolean;
export declare function getBrowserStackUserAndKey(config: Options.Testrunner, options: Options.Testrunner): {
    user: string | undefined;
    key: string | undefined;
} | undefined;
export declare function shouldAddServiceVersion(config: Options.Testrunner, testObservability?: boolean, caps?: Capabilities.BrowserStackCapabilities): boolean;
export declare function batchAndPostEvents(eventUrl: string, kind: string, data: UploadType[]): Promise<void>;
export declare function getObservabilityUser(options: BrowserstackConfig & Options.Testrunner, config: Options.Testrunner): string | undefined;
export declare function getObservabilityKey(options: BrowserstackConfig & Options.Testrunner, config: Options.Testrunner): string | undefined;
export declare function getObservabilityProject(options: BrowserstackConfig & Options.Testrunner, bstackProjectName?: string): string | undefined;
export declare function getObservabilityBuild(options: BrowserstackConfig & Options.Testrunner, bstackBuildName?: string): string;
export declare function getObservabilityBuildTags(options: BrowserstackConfig & Options.Testrunner, bstackBuildTag?: string): string[];
export declare function getBrowserStackUser(config: Options.Testrunner): string | undefined;
export declare function getBrowserStackKey(config: Options.Testrunner): string | undefined;
export declare function isUndefined(value: any): boolean;
export declare function isTrue(value?: any): boolean;
export declare function isFalse(value?: any): boolean;
export declare function frameworkSupportsHook(hook: string, framework?: string): boolean;
export declare const patchConsoleLogs: (...args: any) => any;
export declare function getFailureObject(error: string | Error): {
    failure: {
        backtrace: string[];
    }[];
    failure_reason: string;
    failure_type: string | null;
};
export declare function truncateString(field: string, truncateSizeInBytes: number): string;
export declare function getSizeOfJsonObjectInBytes(jsonData: GitMetaData): number;
export declare function checkAndTruncateVCSInfo(gitMetaData: GitMetaData): GitMetaData;
export declare const sleep: (ms?: number) => Promise<unknown>;
export declare function uploadLogs(user: string | undefined, key: string | undefined, clientBuildUuid: string): Promise<any>;
export declare const isObject: (object: any) => boolean;
export declare const ObjectsAreEqual: (object1: any, object2: any) => boolean;
export declare const getPlatformVersion: (...args: any) => any;
export declare const isObjectEmpty: (objectName: unknown) => unknown;
export declare const getErrorString: (err: unknown) => string | undefined;
export declare function isTurboScale(options: (BrowserstackConfig & Options.Testrunner) | undefined): boolean;
export declare function getObservabilityProduct(options: (BrowserstackConfig & Options.Testrunner) | undefined, isAppAutomate: boolean | undefined): string;
export declare const hasBrowserName: (cap: Options.Testrunner) => boolean;
export declare const isValidCapsForHealing: (caps: {
    [key: string]: Options.Testrunner;
}) => boolean;
type PollingResult = {
    data: any;
    headers: Record<string, any>;
    message?: string;
};
export declare function pollApi(url: string, params: Record<string, any>, headers: Record<string, string>, upperLimit: number, startTime?: number): Promise<PollingResult>;
export {};
//# sourceMappingURL=util.d.ts.map