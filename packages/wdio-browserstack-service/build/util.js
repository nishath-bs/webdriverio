import { hostname, platform, type, version, arch } from 'node:os';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import util from 'node:util';
import got, { HTTPError } from 'got';
import gitRepoInfo from 'git-repo-info';
import gitconfig from 'gitconfiglocal';
import { FormData } from 'formdata-node';
import logPatcher from './logPatcher.js';
import PerformanceTester from './performance-tester.js';
import { getProductMap, logBuildError, handleErrorForObservability, handleErrorForAccessibility } from './testHub/utils.js';
import { BROWSER_DESCRIPTION, DATA_ENDPOINT, UPLOAD_LOGS_ADDRESS, UPLOAD_LOGS_ENDPOINT, consoleHolder, BSTACK_A11Y_POLLING_TIMEOUT, TESTOPS_SCREENSHOT_ENV, BROWSERSTACK_TESTHUB_UUID, PERF_MEASUREMENT_ENV, RERUN_ENV, TESTOPS_BUILD_COMPLETED_ENV, BROWSERSTACK_TESTHUB_JWT, BROWSERSTACK_OBSERVABILITY, BROWSERSTACK_ACCESSIBILITY, MAX_GIT_META_DATA_SIZE_IN_BYTES, GIT_META_DATA_TRUNCATED, APP_ALLY_ENDPOINT, APP_ALLY_ISSUES_SUMMARY_ENDPOINT, APP_ALLY_ISSUES_ENDPOINT } from './constants.js';
import CrashReporter from './crash-reporter.js';
import { BStackLogger } from './bstackLogger.js';
import { FileStream } from './fileStream.js';
import AccessibilityScripts from './scripts/accessibility-scripts.js';
import UsageStats from './testOps/usageStats.js';
import TestOpsConfig from './testOps/testOpsConfig.js';
const pGitconfig = promisify(gitconfig);
export const DEFAULT_REQUEST_CONFIG = {
    agent: {
        http: new http.Agent({ keepAlive: true }),
        https: new https.Agent({ keepAlive: true }),
    },
    headers: {
        'Content-Type': 'application/json',
        'X-BSTACK-OBS': 'true'
    },
};
export const COLORS = {
    error: 'red',
    warn: 'yellow',
    info: 'cyanBright',
    debug: 'green',
    trace: 'cyan',
    progress: 'magenta'
};
/**
 * get browser description for Browserstack service
 * @param cap browser capablities
 */
export function getBrowserDescription(cap) {
    cap = cap || {};
    if (cap['bstack:options']) {
        cap = { ...cap, ...cap['bstack:options'] };
    }
    /**
     * These keys describe the browser the test was run on
     */
    return BROWSER_DESCRIPTION
        .map((k) => cap[k])
        .filter(Boolean)
        .join(' ');
}
/**
 * get correct browser capabilities object in both multiremote and normal setups
 * @param browser browser object
 * @param caps browser capbilities object. In case of multiremote, the object itself should have a property named 'capabilities'
 * @param browserName browser name in case of multiremote
 */
export function getBrowserCapabilities(browser, caps, browserName) {
    if (!browser.isMultiremote) {
        return { ...browser.capabilities, ...caps };
    }
    const multiCaps = caps;
    const globalCap = browserName && browser.getInstance(browserName) ? browser.getInstance(browserName).capabilities : {};
    const cap = browserName && multiCaps[browserName] ? multiCaps[browserName].capabilities : {};
    return { ...globalCap, ...cap };
}
/**
 * check for browserstack W3C capabilities. Does not support legacy capabilities
 * @param cap browser capabilities
 */
export function isBrowserstackCapability(cap) {
    return Boolean(cap &&
        cap['bstack:options'] &&
        // return false if the only cap in bstack:options is wdioService,
        // as that is added by the service and not present in user passed caps
        !(Object.keys(cap['bstack:options']).length === 1 &&
            cap['bstack:options'].wdioService));
}
export function getParentSuiteName(fullTitle, testSuiteTitle) {
    const fullTitleWords = fullTitle.split(' ');
    const testSuiteTitleWords = testSuiteTitle.split(' ');
    const shortestLength = Math.min(fullTitleWords.length, testSuiteTitleWords.length);
    let c = 0;
    let parentSuiteName = '';
    while (c < shortestLength && fullTitleWords[c] === testSuiteTitleWords[c]) {
        parentSuiteName += fullTitleWords[c++] + ' ';
    }
    return parentSuiteName.trim();
}
function processError(error, fn, args) {
    BStackLogger.error(`Error in executing ${fn.name} with args ${args}: ${error}`);
    let argsString;
    try {
        argsString = JSON.stringify(args);
    }
    catch (e) {
        argsString = util.inspect(args, { depth: 2 });
    }
    CrashReporter.uploadCrashReport(`Error in executing ${fn.name} with args ${argsString} : ${error}`, error && error.stack);
}
export function o11yErrorHandler(fn) {
    return function (...args) {
        try {
            let functionToHandle = fn;
            if (process.env[PERF_MEASUREMENT_ENV]) {
                functionToHandle = PerformanceTester.getPerformance().timerify(functionToHandle);
            }
            const result = functionToHandle(...args);
            if (result instanceof Promise) {
                return result.catch(error => processError(error, fn, args));
            }
            return result;
        }
        catch (error) {
            processError(error, fn, args);
        }
    };
}
export function errorHandler(fn) {
    return function (...args) {
        try {
            const functionToHandle = fn;
            const result = functionToHandle(...args);
            if (result instanceof Promise) {
                return result.catch(error => BStackLogger.error(`Error in executing ${fn.name} with args ${args}: ${error}`));
            }
            return result;
        }
        catch (error) {
            BStackLogger.error(`Error in executing ${fn.name} with args ${args}: ${error}`);
        }
    };
}
export async function nodeRequest(requestType, apiEndpoint, options, apiUrl, timeout = 120000) {
    try {
        const response = await got(`${apiUrl}/${apiEndpoint}`, {
            method: requestType,
            timeout: {
                request: timeout
            },
            ...options
        }).json();
        return response;
    }
    catch (error) {
        const isLogUpload = apiEndpoint === UPLOAD_LOGS_ENDPOINT;
        if (error instanceof HTTPError && error.response) {
            const errorMessageJson = error.response.body ? JSON.parse(error.response.body.toString()) : null;
            const errorMessage = errorMessageJson ? errorMessageJson.message : null;
            if (errorMessage) {
                isLogUpload ? BStackLogger.debug(`${errorMessage} - ${error.stack}`) : BStackLogger.error(`${errorMessage} - ${error.stack}`);
            }
            else {
                isLogUpload ? BStackLogger.debug(`${error.stack}`) : BStackLogger.error(`${error.stack}`);
            }
            if (isLogUpload) {
                return;
            }
            throw error;
        }
        else {
            if (isLogUpload) {
                BStackLogger.debug(`Failed to fire api request due to ${error} - ${error.stack}`);
                return;
            }
            BStackLogger.debug(`Failed to fire api request due to ${error} - ${error.stack}`);
            throw error;
        }
    }
}
export function o11yClassErrorHandler(errorClass) {
    const prototype = errorClass.prototype;
    if (Object.getOwnPropertyNames(prototype).length < 2) {
        return errorClass;
    }
    Object.getOwnPropertyNames(prototype).forEach((methodName) => {
        const method = prototype[methodName];
        if (typeof method === 'function' && methodName !== 'constructor') {
            // In order to preserve this context, need to define like this
            Object.defineProperty(prototype, methodName, {
                writable: true,
                value: function (...args) {
                    try {
                        const result = (process.env[PERF_MEASUREMENT_ENV] ? PerformanceTester.getPerformance().timerify(method) : method).call(this, ...args);
                        if (result instanceof Promise) {
                            return result.catch(error => processError(error, method, args));
                        }
                        return result;
                    }
                    catch (err) {
                        processError(err, method, args);
                    }
                }
            });
        }
    });
    return errorClass;
}
export const processTestObservabilityResponse = (response) => {
    if (!response.observability) {
        handleErrorForObservability(null);
        return;
    }
    if (!response.observability.success) {
        handleErrorForObservability(response.observability);
        return;
    }
    process.env[BROWSERSTACK_OBSERVABILITY] = 'true';
    if (response.observability.options.allow_screenshots) {
        process.env[TESTOPS_SCREENSHOT_ENV] = response.observability.options.allow_screenshots.toString();
    }
};
export const jsonifyAccessibilityArray = (dataArray, keyName, valueName) => {
    const result = {};
    dataArray.forEach((element) => {
        result[element[keyName]] = element[valueName];
    });
    return result;
};
export const processAccessibilityResponse = (response) => {
    if (!response.accessibility) {
        handleErrorForAccessibility(null);
        return;
    }
    if (!response.accessibility.success) {
        handleErrorForAccessibility(response.accessibility);
        return;
    }
    if (response.accessibility.options) {
        const { accessibilityToken, pollingTimeout, scannerVersion } = jsonifyAccessibilityArray(response.accessibility.options.capabilities, 'name', 'value');
        const scriptsJson = {
            'scripts': jsonifyAccessibilityArray(response.accessibility.options.scripts, 'name', 'command'),
            'commands': response.accessibility.options.commandsToWrap.commands
        };
        if (scannerVersion) {
            process.env.BSTACK_A11Y_SCANNER_VERSION = scannerVersion;
            BStackLogger.debug(`Accessibility scannerVersion ${scannerVersion}`);
        }
        if (accessibilityToken) {
            process.env.BSTACK_A11Y_JWT = accessibilityToken;
            process.env[BROWSERSTACK_ACCESSIBILITY] = 'true';
        }
        if (pollingTimeout) {
            process.env.BSTACK_A11Y_POLLING_TIMEOUT = pollingTimeout;
        }
        if (scriptsJson) {
            AccessibilityScripts.update(scriptsJson);
            AccessibilityScripts.store();
        }
    }
};
export const processLaunchBuildResponse = (response, options) => {
    if (options.testObservability) {
        processTestObservabilityResponse(response);
    }
    if (options.accessibility) {
        processAccessibilityResponse(response);
    }
};
export const launchTestSession = o11yErrorHandler(async function launchTestSession(options, config, bsConfig, bStackConfig) {
    const launchBuildUsage = UsageStats.getInstance().launchBuildUsage;
    launchBuildUsage.triggered();
    const data = {
        format: 'json',
        project_name: getObservabilityProject(options, bsConfig.projectName),
        name: getObservabilityBuild(options, bsConfig.buildName),
        build_identifier: bsConfig.buildIdentifier,
        started_at: (new Date()).toISOString(),
        tags: getObservabilityBuildTags(options, bsConfig.buildTag),
        host_info: {
            hostname: hostname(),
            platform: platform(),
            type: type(),
            version: version(),
            arch: arch()
        },
        ci_info: getCiInfo(),
        build_run_identifier: process.env.BROWSERSTACK_BUILD_RUN_IDENTIFIER,
        failed_tests_rerun: process.env[RERUN_ENV] || false,
        version_control: await getGitMetaData(),
        accessibility: {
            settings: options.accessibilityOptions
        },
        browserstackAutomation: shouldAddServiceVersion(config, options.testObservability),
        framework_details: {
            frameworkName: 'WebdriverIO-' + config.framework,
            frameworkVersion: bsConfig.bstackServiceVersion,
            sdkVersion: bsConfig.bstackServiceVersion,
            language: 'ECMAScript',
            testFramework: {
                name: 'WebdriverIO',
                version: bsConfig.bstackServiceVersion
            }
        },
        product_map: getProductMap(bStackConfig),
        config: {}
    };
    try {
        if (Object.keys(CrashReporter.userConfigForReporting).length === 0) {
            CrashReporter.userConfigForReporting = process.env.USER_CONFIG_FOR_REPORTING !== undefined ? JSON.parse(process.env.USER_CONFIG_FOR_REPORTING) : {};
        }
    }
    catch (error) {
        return BStackLogger.error(`[Crash_Report_Upload] Failed to parse user config while sending build start event due to ${error}`);
    }
    data.config = CrashReporter.userConfigForReporting;
    try {
        const url = `${DATA_ENDPOINT}/api/v2/builds`;
        const response = await got.post(url, {
            ...DEFAULT_REQUEST_CONFIG,
            username: getObservabilityUser(options, config),
            password: getObservabilityKey(options, config),
            json: data
        }).json();
        BStackLogger.debug(`[Start_Build] Success response: ${JSON.stringify(response)}`);
        process.env[TESTOPS_BUILD_COMPLETED_ENV] = 'true';
        if (response.jwt) {
            process.env[BROWSERSTACK_TESTHUB_JWT] = response.jwt;
        }
        if (response.build_hashed_id) {
            process.env[BROWSERSTACK_TESTHUB_UUID] = response.build_hashed_id;
            TestOpsConfig.getInstance().buildHashedId = response.build_hashed_id;
        }
        processLaunchBuildResponse(response, options);
        launchBuildUsage.success();
    }
    catch (error) {
        if (!error.success) {
            launchBuildUsage.failed(error);
            logBuildError(error);
            return;
        }
    }
});
export const validateCapsWithAppA11y = (platformMeta) => {
    /* Check if the current driver platform is eligible for AppAccessibility scan */
    BStackLogger.debug(`platformMeta ${JSON.stringify(platformMeta)}`);
    if (platformMeta?.platform_name &&
        String(platformMeta?.platform_name).toLowerCase() === 'android' &&
        platformMeta?.platform_version &&
        parseInt(platformMeta?.platform_version?.toString()) < 11) {
        BStackLogger.warn('App Accessibility Automation tests are supported on OS version 11 and above for Android devices.');
        return false;
    }
    return true;
};
export const validateCapsWithA11y = (deviceName, platformMeta, chromeOptions) => {
    /* Check if the current driver platform is eligible for Accessibility scan */
    try {
        if (deviceName) {
            BStackLogger.warn('Accessibility Automation will run only on Desktop browsers.');
            return false;
        }
        if (platformMeta?.browser_name?.toLowerCase() !== 'chrome') {
            BStackLogger.warn('Accessibility Automation will run only on Chrome browsers.');
            return false;
        }
        const browserVersion = platformMeta?.browser_version;
        if (!isUndefined(browserVersion) && !(browserVersion === 'latest' || parseFloat(browserVersion + '') > 94)) {
            BStackLogger.warn('Accessibility Automation will run only on Chrome browser version greater than 94.');
            return false;
        }
        if (chromeOptions?.args?.includes('--headless')) {
            BStackLogger.warn('Accessibility Automation will not run on legacy headless mode. Switch to new headless mode or avoid using headless mode.');
            return false;
        }
        return true;
    }
    catch (error) {
        BStackLogger.debug(`Exception in checking capabilities compatibility with Accessibility. Error: ${error}`);
    }
    return false;
};
export const shouldScanTestForAccessibility = (suiteTitle, testTitle, accessibilityOptions, world, isCucumber) => {
    try {
        const includeTags = Array.isArray(accessibilityOptions?.includeTagsInTestingScope) ? accessibilityOptions?.includeTagsInTestingScope : [];
        const excludeTags = Array.isArray(accessibilityOptions?.excludeTagsInTestingScope) ? accessibilityOptions?.excludeTagsInTestingScope : [];
        if (isCucumber) {
            const tagsList = [];
            world?.pickle?.tags.map((tag) => tagsList.push(tag.name));
            const excluded = excludeTags?.some((exclude) => tagsList.includes(exclude));
            const included = includeTags?.length === 0 || includeTags?.some((include) => tagsList.includes(include));
            return !excluded && included;
        }
        const fullTestName = suiteTitle + ' ' + testTitle;
        const excluded = excludeTags?.some((exclude) => fullTestName.includes(exclude));
        const included = includeTags?.length === 0 || includeTags?.some((include) => fullTestName.includes(include));
        return !excluded && included;
    }
    catch (error) {
        BStackLogger.debug(`Error while validating test case for accessibility before scanning. Error : ${error}`);
    }
    return false;
};
export const isAccessibilityAutomationSession = (accessibilityFlag) => {
    try {
        const hasA11yJwtToken = typeof process.env.BSTACK_A11Y_JWT === 'string' && process.env.BSTACK_A11Y_JWT.length > 0 && process.env.BSTACK_A11Y_JWT !== 'null' && process.env.BSTACK_A11Y_JWT !== 'undefined';
        return accessibilityFlag && hasA11yJwtToken;
    }
    catch (error) {
        BStackLogger.debug(`Exception in verifying the Accessibility session with error : ${error}`);
    }
    return false;
};
export const isAppAccessibilityAutomationSession = (accessibilityFlag, isAppAutomate) => {
    const accessibilityAutomation = isAccessibilityAutomationSession(accessibilityFlag);
    return accessibilityAutomation && isAppAutomate;
};
export const formatString = (template, ...values) => {
    let i = 0;
    if (template === null) {
        return '';
    }
    return template.replace(/%s/g, () => {
        const value = values[i++];
        return value !== null && value !== undefined ? value : '';
    });
};
export const _getParamsForAppAccessibility = (commandName) => {
    return {
        'thTestRunUuid': process.env.TEST_ANALYTICS_ID,
        'thBuildUuid': process.env.BROWSERSTACK_TESTHUB_UUID,
        'thJwtToken': process.env.BROWSERSTACK_TESTHUB_JWT,
        'authHeader': process.env.BSTACK_A11Y_JWT,
        'scanTimestamp': Date.now(),
        'method': commandName
    };
};
export const performA11yScan = async (isAppAutomate, browser, isBrowserStackSession, isAccessibility, commandName) => {
    if (!isBrowserStackSession) {
        BStackLogger.warn('Not a BrowserStack Automate session, cannot perform Accessibility scan.');
        return; // since we are running only on Automate as of now
    }
    if (!isAccessibilityAutomationSession(isAccessibility)) {
        BStackLogger.warn('Not an Accessibility Automation session, cannot perform Accessibility scan.');
        return;
    }
    try {
        if (isAppAccessibilityAutomationSession(isAccessibility, isAppAutomate)) {
            const results = await browser.execute(formatString(AccessibilityScripts.performScan, JSON.stringify(_getParamsForAppAccessibility(commandName))), {});
            BStackLogger.debug(util.format(results));
            return results;
        }
        const results = await browser.executeAsync(AccessibilityScripts.performScan, { 'method': commandName || '' });
        BStackLogger.debug(util.format(results));
        return results;
    }
    catch (err) {
        BStackLogger.error('Accessibility Scan could not be performed : ' + err);
        return;
    }
};
export const getA11yResults = async (isAppAutomate, browser, isBrowserStackSession, isAccessibility) => {
    if (!isBrowserStackSession) {
        BStackLogger.warn('Not a BrowserStack Automate session, cannot retrieve Accessibility results.');
        return []; // since we are running only on Automate as of now
    }
    if (!isAccessibilityAutomationSession(isAccessibility)) {
        BStackLogger.warn('Not an Accessibility Automation session, cannot retrieve Accessibility results.');
        return [];
    }
    try {
        BStackLogger.debug('Performing scan before getting results');
        await performA11yScan(isAppAutomate, browser, isBrowserStackSession, isAccessibility);
        const results = await browser.executeAsync(AccessibilityScripts.getResults);
        return results;
    }
    catch (error) {
        BStackLogger.error('No accessibility results were found.');
        BStackLogger.debug(`getA11yResults Failed. Error: ${error}`);
        return [];
    }
};
export const getAppA11yResults = async (isAppAutomate, browser, isBrowserStackSession, isAccessibility, sessionId) => {
    if (!isBrowserStackSession) {
        return []; // since we are running only on Automate as of now
    }
    if (!isAppAccessibilityAutomationSession(isAccessibility, isAppAutomate)) {
        BStackLogger.warn('Not an Accessibility Automation session, cannot retrieve Accessibility results summary.');
        return [];
    }
    try {
        const apiUrl = `${APP_ALLY_ENDPOINT}/${APP_ALLY_ISSUES_ENDPOINT}`;
        const apiRespone = await getAppA11yResultResponse(apiUrl, isAppAutomate, browser, isBrowserStackSession, isAccessibility, sessionId);
        const result = apiRespone?.data?.data?.issues;
        BStackLogger.debug(`Polling Result: ${JSON.stringify(result)}`);
        return result;
    }
    catch (error) {
        BStackLogger.error('No accessibility summary was found.');
        BStackLogger.debug(`getAppA11yResults Failed. Error: ${error}`);
        return [];
    }
};
export const getAppA11yResultsSummary = async (isAppAutomate, browser, isBrowserStackSession, isAccessibility, sessionId) => {
    if (!isBrowserStackSession) {
        return {}; // since we are running only on Automate as of now
    }
    if (!isAppAccessibilityAutomationSession(isAccessibility, isAppAutomate)) {
        BStackLogger.warn('Not an Accessibility Automation session, cannot retrieve Accessibility results summary.');
        return {};
    }
    try {
        const apiUrl = `${APP_ALLY_ENDPOINT}/${APP_ALLY_ISSUES_SUMMARY_ENDPOINT}`;
        const apiRespone = await getAppA11yResultResponse(apiUrl, isAppAutomate, browser, isBrowserStackSession, isAccessibility, sessionId);
        const result = apiRespone?.data?.data?.summary;
        BStackLogger.debug(`Polling Result: ${JSON.stringify(result)}`);
        return result;
    }
    catch {
        BStackLogger.error('No accessibility summary was found.');
        return {};
    }
};
const getAppA11yResultResponse = async (apiUrl, isAppAutomate, browser, isBrowserStackSession, isAccessibility, sessionId) => {
    BStackLogger.debug('Performing scan before getting results summary');
    await performA11yScan(isAppAutomate, browser, isBrowserStackSession, isAccessibility);
    const upperTimeLimit = process.env[BSTACK_A11Y_POLLING_TIMEOUT] ? Date.now() + parseInt(process.env[BSTACK_A11Y_POLLING_TIMEOUT]) * 1000 : Date.now() + 30000;
    const params = { test_run_uuid: process.env.TEST_ANALYTICS_ID, session_id: sessionId, timestamp: Date.now() }; // Query params to pass
    const header = { Authorization: `Bearer ${process.env.BSTACK_A11Y_JWT}` };
    const apiRespone = await pollApi(apiUrl, params, header, upperTimeLimit);
    BStackLogger.debug(`Polling Result: ${JSON.stringify(apiRespone)}`);
    return apiRespone;
};
export const getA11yResultsSummary = async (isAppAutomate, browser, isBrowserStackSession, isAccessibility) => {
    if (!isBrowserStackSession) {
        return {}; // since we are running only on Automate as of now
    }
    if (!isAccessibilityAutomationSession(isAccessibility)) {
        BStackLogger.warn('Not an Accessibility Automation session, cannot retrieve Accessibility results summary.');
        return {};
    }
    try {
        BStackLogger.debug('Performing scan before getting results summary');
        await performA11yScan(isAppAutomate, browser, isBrowserStackSession, isAccessibility);
        const summaryResults = await browser.executeAsync(AccessibilityScripts.getResultsSummary);
        return summaryResults;
    }
    catch {
        BStackLogger.error('No accessibility summary was found.');
        return {};
    }
};
export const stopBuildUpstream = o11yErrorHandler(async function stopBuildUpstream(killSignal = null) {
    const stopBuildUsage = UsageStats.getInstance().stopBuildUsage;
    stopBuildUsage.triggered();
    if (!process.env[TESTOPS_BUILD_COMPLETED_ENV]) {
        stopBuildUsage.failed('Build is not completed yet');
        return {
            status: 'error',
            message: 'Build is not completed yet'
        };
    }
    const jwtToken = process.env[BROWSERSTACK_TESTHUB_JWT];
    if (!jwtToken) {
        stopBuildUsage.failed('Token/buildID is undefined, build creation might have failed');
        BStackLogger.debug('[STOP_BUILD] Missing Authentication Token/ Build ID');
        return {
            status: 'error',
            message: 'Token/buildID is undefined, build creation might have failed'
        };
    }
    const data = {
        'finished_at': (new Date()).toISOString(),
        'finished_metadata': [],
    };
    if (killSignal) {
        data.finished_metadata.push({
            reason: 'user_killed',
            signal: killSignal
        });
    }
    try {
        const url = `${DATA_ENDPOINT}/api/v1/builds/${process.env[BROWSERSTACK_TESTHUB_UUID]}/stop`;
        const response = await got.put(url, {
            agent: DEFAULT_REQUEST_CONFIG.agent,
            headers: {
                ...DEFAULT_REQUEST_CONFIG.headers,
                'Authorization': `Bearer ${jwtToken}`
            },
            json: data,
            retry: {
                limit: 3,
                methods: ['GET', 'POST']
            }
        }).json();
        BStackLogger.debug(`[STOP_BUILD] Success response: ${JSON.stringify(response)}`);
        stopBuildUsage.success();
        return {
            status: 'success',
            message: ''
        };
    }
    catch (error) {
        stopBuildUsage.failed(error);
        BStackLogger.debug(`[STOP_BUILD] Failed. Error: ${error}`);
        return {
            status: 'error',
            message: error.message
        };
    }
});
export function getCiInfo() {
    const env = process.env;
    // Jenkins
    if ((typeof env.JENKINS_URL === 'string' && env.JENKINS_URL.length > 0) || (typeof env.JENKINS_HOME === 'string' && env.JENKINS_HOME.length > 0)) {
        return {
            name: 'Jenkins',
            build_url: env.BUILD_URL,
            job_name: env.JOB_NAME,
            build_number: env.BUILD_NUMBER
        };
    }
    // CircleCI
    if (isTrue(env.CI) && isTrue(env.CIRCLECI)) {
        return {
            name: 'CircleCI',
            build_url: env.CIRCLE_BUILD_URL,
            job_name: env.CIRCLE_JOB,
            build_number: env.CIRCLE_BUILD_NUM
        };
    }
    // Travis CI
    if (isTrue(env.CI) && isTrue(env.TRAVIS)) {
        return {
            name: 'Travis CI',
            build_url: env.TRAVIS_BUILD_WEB_URL,
            job_name: env.TRAVIS_JOB_NAME,
            build_number: env.TRAVIS_BUILD_NUMBER
        };
    }
    // Codeship
    if (isTrue(env.CI) && env.CI_NAME === 'codeship') {
        return {
            name: 'Codeship',
            build_url: null,
            job_name: null,
            build_number: null
        };
    }
    // Bitbucket
    if (env.BITBUCKET_BRANCH && env.BITBUCKET_COMMIT) {
        return {
            name: 'Bitbucket',
            build_url: env.BITBUCKET_GIT_HTTP_ORIGIN,
            job_name: null,
            build_number: env.BITBUCKET_BUILD_NUMBER
        };
    }
    // Drone
    if (isTrue(env.CI) && isTrue(env.DRONE)) {
        return {
            name: 'Drone',
            build_url: env.DRONE_BUILD_LINK,
            job_name: null,
            build_number: env.DRONE_BUILD_NUMBER
        };
    }
    // Semaphore
    if (isTrue(env.CI) && isTrue(env.SEMAPHORE)) {
        return {
            name: 'Semaphore',
            build_url: env.SEMAPHORE_ORGANIZATION_URL,
            job_name: env.SEMAPHORE_JOB_NAME,
            build_number: env.SEMAPHORE_JOB_ID
        };
    }
    // GitLab
    if (isTrue(env.CI) && isTrue(env.GITLAB_CI)) {
        return {
            name: 'GitLab',
            build_url: env.CI_JOB_URL,
            job_name: env.CI_JOB_NAME,
            build_number: env.CI_JOB_ID
        };
    }
    // Buildkite
    if (isTrue(env.CI) && isTrue(env.BUILDKITE)) {
        return {
            name: 'Buildkite',
            build_url: env.BUILDKITE_BUILD_URL,
            job_name: env.BUILDKITE_LABEL || env.BUILDKITE_PIPELINE_NAME,
            build_number: env.BUILDKITE_BUILD_NUMBER
        };
    }
    // Visual Studio Team Services
    if (isTrue(env.TF_BUILD) && env.TF_BUILD_BUILDNUMBER) {
        return {
            name: 'Visual Studio Team Services',
            build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECTID}`,
            job_name: env.SYSTEM_DEFINITIONID,
            build_number: env.BUILD_BUILDID
        };
    }
    // Appveyor
    if (isTrue(env.APPVEYOR)) {
        return {
            name: 'Appveyor',
            build_url: `${env.APPVEYOR_URL}/project/${env.APPVEYOR_ACCOUNT_NAME}/${env.APPVEYOR_PROJECT_SLUG}/builds/${env.APPVEYOR_BUILD_ID}`,
            job_name: env.APPVEYOR_JOB_NAME,
            build_number: env.APPVEYOR_BUILD_NUMBER
        };
    }
    // Azure CI
    if (env.AZURE_HTTP_USER_AGENT && env.TF_BUILD) {
        return {
            name: 'Azure CI',
            build_url: `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`,
            job_name: env.BUILD_BUILDID,
            build_number: env.BUILD_BUILDID
        };
    }
    // AWS CodeBuild
    if (env.CODEBUILD_BUILD_ID || env.CODEBUILD_RESOLVED_SOURCE_VERSION || env.CODEBUILD_SOURCE_VERSION) {
        return {
            name: 'AWS CodeBuild',
            build_url: env.CODEBUILD_PUBLIC_BUILD_URL,
            job_name: env.CODEBUILD_BUILD_ID,
            build_number: env.CODEBUILD_BUILD_ID
        };
    }
    // Bamboo
    if (env.bamboo_buildNumber) {
        return {
            name: 'Bamboo',
            build_url: env.bamboo_buildResultsUrl,
            job_name: env.bamboo_shortJobName,
            build_number: env.bamboo_buildNumber
        };
    }
    // Wercker
    if (env.WERCKER || env.WERCKER_MAIN_PIPELINE_STARTED) {
        return {
            name: 'Wercker',
            build_url: env.WERCKER_BUILD_URL,
            job_name: env.WERCKER_MAIN_PIPELINE_STARTED ? 'Main Pipeline' : null,
            build_number: env.WERCKER_GIT_COMMIT
        };
    }
    // Google Cloud
    if (env.GCP_PROJECT || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT) {
        return {
            name: 'Google Cloud',
            build_url: null,
            job_name: env.PROJECT_ID,
            build_number: env.BUILD_ID,
        };
    }
    // Shippable
    if (env.SHIPPABLE) {
        return {
            name: 'Shippable',
            build_url: env.SHIPPABLE_BUILD_URL,
            job_name: env.SHIPPABLE_JOB_ID ? `Job #${env.SHIPPABLE_JOB_ID}` : null,
            build_number: env.SHIPPABLE_BUILD_NUMBER
        };
    }
    // Netlify
    if (isTrue(env.NETLIFY)) {
        return {
            name: 'Netlify',
            build_url: env.DEPLOY_URL,
            job_name: env.SITE_NAME,
            build_number: env.BUILD_ID
        };
    }
    // Github Actions
    if (isTrue(env.GITHUB_ACTIONS)) {
        return {
            name: 'GitHub Actions',
            build_url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
            job_name: env.GITHUB_WORKFLOW,
            build_number: env.GITHUB_RUN_ID,
        };
    }
    // Vercel
    if (isTrue(env.CI) && env.VERCEL === '1') {
        return {
            name: 'Vercel',
            build_url: `http://${env.VERCEL_URL}`,
            job_name: null,
            build_number: null,
        };
    }
    // Teamcity
    if (env.TEAMCITY_VERSION) {
        return {
            name: 'Teamcity',
            build_url: null,
            job_name: null,
            build_number: env.BUILD_NUMBER,
        };
    }
    // Concourse
    if (env.CONCOURSE || env.CONCOURSE_URL || env.CONCOURSE_USERNAME || env.CONCOURSE_TEAM) {
        return {
            name: 'Concourse',
            build_url: null,
            job_name: env.BUILD_JOB_NAME || null,
            build_number: env.BUILD_ID || null,
        };
    }
    // GoCD
    if (env.GO_JOB_NAME) {
        return {
            name: 'GoCD',
            build_url: null,
            job_name: env.GO_JOB_NAME,
            build_number: env.GO_PIPELINE_COUNTER,
        };
    }
    // CodeFresh
    if (env.CF_BUILD_ID) {
        return {
            name: 'CodeFresh',
            build_url: env.CF_BUILD_URL,
            job_name: env.CF_PIPELINE_NAME,
            build_number: env.CF_BUILD_ID,
        };
    }
    // if no matches, return null
    return null;
}
export async function getGitMetaData() {
    const info = gitRepoInfo();
    if (!info.commonGitDir) {
        return;
    }
    const { remote } = await pGitconfig(info.commonGitDir);
    const remotes = remote ? Object.keys(remote).map(remoteName => ({ name: remoteName, url: remote[remoteName].url })) : [];
    let gitMetaData = {
        name: 'git',
        sha: info.sha,
        short_sha: info.abbreviatedSha,
        branch: info.branch,
        tag: info.tag,
        committer: info.committer,
        committer_date: info.committerDate,
        author: info.author,
        author_date: info.authorDate,
        commit_message: info.commitMessage,
        root: info.root,
        common_git_dir: info.commonGitDir,
        worktree_git_dir: info.worktreeGitDir,
        last_tag: info.lastTag,
        commits_since_last_tag: info.commitsSinceLastTag,
        remotes: remotes
    };
    gitMetaData = checkAndTruncateVCSInfo(gitMetaData);
    return gitMetaData;
}
export function getUniqueIdentifier(test, framework) {
    if (framework === 'jasmine') {
        return test.fullName;
    }
    let parentTitle = test.parent;
    // Sometimes parent will be an object instead of a string
    if (typeof parentTitle === 'object') {
        parentTitle = parentTitle.title;
    }
    return `${parentTitle} - ${test.title}`;
}
export function getUniqueIdentifierForCucumber(world) {
    return world.pickle.uri + '_' + world.pickle.astNodeIds.join(',');
}
export function getCloudProvider(browser) {
    if (browser.options && browser.options.hostname && browser.options.hostname.includes('browserstack')) {
        return 'browserstack';
    }
    return 'unknown_grid';
}
export function isBrowserstackSession(browser) {
    return browser && getCloudProvider(browser).toLowerCase() === 'browserstack';
}
export function getScenarioExamples(world) {
    const scenario = world.pickle;
    // no examples present
    if ((scenario.astNodeIds && scenario.astNodeIds.length <= 1) || scenario.astNodeIds === undefined) {
        return;
    }
    const pickleId = scenario.astNodeIds[0];
    const examplesId = scenario.astNodeIds[1];
    const gherkinDocumentChildren = world.gherkinDocument.feature?.children;
    let examples = [];
    gherkinDocumentChildren?.forEach(child => {
        if (child.rule) {
            // handle if rule is present
            child.rule.children.forEach(childLevel2 => {
                if (childLevel2.scenario && childLevel2.scenario.id === pickleId && childLevel2.scenario.examples) {
                    const passedExamples = childLevel2.scenario.examples.flatMap((val) => (val.tableBody)).find((item) => item.id === examplesId)?.cells.map((val) => (val.value));
                    if (passedExamples) {
                        examples = passedExamples;
                    }
                }
            });
        }
        else if (child.scenario && child.scenario.id === pickleId && child.scenario.examples) {
            // handle if scenario outside rule
            const passedExamples = child.scenario.examples.flatMap((val) => (val.tableBody)).find((item) => item.id === examplesId)?.cells.map((val) => (val.value));
            if (passedExamples) {
                examples = passedExamples;
            }
        }
    });
    if (examples.length) {
        return examples;
    }
    return;
}
export function removeAnsiColors(message) {
    if (!message) {
        return '';
    }
    // https://stackoverflow.com/a/29497680
    // eslint-disable-next-line no-control-regex
    return message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}
export function getLogTag(eventType) {
    if (eventType === 'TestRunStarted' || eventType === 'TestRunFinished') {
        return 'Test_Upload';
    }
    else if (eventType === 'HookRunStarted' || eventType === 'HookRunFinished') {
        return 'Hook_Upload';
    }
    else if (eventType === 'ScreenshotCreated') {
        return 'Screenshot_Upload';
    }
    else if (eventType === 'LogCreated') {
        return 'Log_Upload';
    }
    return 'undefined';
}
// get hierarchy for a particular test (called by reporter for skipped tests)
export function getHierarchy(fullTitle) {
    if (!fullTitle) {
        return [];
    }
    return fullTitle.split('.').slice(0, -1);
}
export function getHookType(hookName) {
    if (hookName.startsWith('"before each"')) {
        return 'BEFORE_EACH';
    }
    else if (hookName.startsWith('"before all"')) {
        return 'BEFORE_ALL';
    }
    else if (hookName.startsWith('"after each"')) {
        return 'AFTER_EACH';
    }
    else if (hookName.startsWith('"after all"')) {
        return 'AFTER_ALL';
    }
    return 'unknown';
}
export function isScreenshotCommand(args) {
    return args.endpoint && args.endpoint.includes('/screenshot');
}
export function isBStackSession(config) {
    if (typeof config.user === 'string' && typeof config.key === 'string' && config.key.length === 20) {
        return true;
    }
    return false;
}
export function isBrowserstackInfra(config, caps) {
    // a utility function to check if the hostname is browserstack
    const isBrowserstack = (str) => {
        return str.includes('browserstack.com');
    };
    if ((config.hostname) && !isBrowserstack(config.hostname)) {
        return false;
    }
    if (caps && typeof caps === 'object') {
        if (Array.isArray(caps)) {
            for (const capability of caps) {
                if ((capability.hostname) && !isBrowserstack(capability.hostname)) {
                    return false;
                }
            }
        }
        else {
            for (const key in caps) {
                const capability = caps[key];
                if ((capability.hostname) && !isBrowserstack(capability.hostname)) {
                    return false;
                }
            }
        }
    }
    if (!isBStackSession(config)) {
        return false;
    }
    return true;
}
export function getBrowserStackUserAndKey(config, options) {
    // Fallback 1: Env variables
    // Fallback 2: Service variables in wdio.conf.js (that are received inside options object)
    const envOrServiceVariables = {
        user: getBrowserStackUser(options),
        key: getBrowserStackKey(options)
    };
    if (isBStackSession(envOrServiceVariables)) {
        return envOrServiceVariables;
    }
    // Fallback 3: Service variables in testObservabilityOptions object
    // Fallback 4: Service variables in the top level config object
    const o11yVariables = {
        user: getObservabilityUser(options, config),
        key: getObservabilityKey(options, config)
    };
    if (isBStackSession(o11yVariables)) {
        return o11yVariables;
    }
}
export function shouldAddServiceVersion(config, testObservability, caps) {
    if ((config.services && config.services.toString().includes('chromedriver') && testObservability !== false) || !isBrowserstackInfra(config, caps)) {
        return false;
    }
    return true;
}
export async function batchAndPostEvents(eventUrl, kind, data) {
    if (!process.env[TESTOPS_BUILD_COMPLETED_ENV]) {
        throw new Error('Build not completed yet');
    }
    const jwtToken = process.env[BROWSERSTACK_TESTHUB_JWT];
    if (!jwtToken) {
        throw new Error('Missing authentication Token');
    }
    try {
        const url = `${DATA_ENDPOINT}/${eventUrl}`;
        const response = await got.post(url, {
            agent: DEFAULT_REQUEST_CONFIG.agent,
            headers: {
                ...DEFAULT_REQUEST_CONFIG.headers,
                'Authorization': `Bearer ${jwtToken}`
            },
            json: data,
            retry: {
                limit: 3,
                methods: ['GET', 'POST']
            }
        }).json();
        BStackLogger.debug(`[${kind}] Success response: ${JSON.stringify(response)}`);
    }
    catch (error) {
        BStackLogger.debug(`[${kind}] EXCEPTION IN ${kind} REQUEST TO TEST OBSERVABILITY : ${error}`);
        throw new Error('Exception in request ' + error);
    }
}
export function getObservabilityUser(options, config) {
    if (process.env.BROWSERSTACK_USERNAME) {
        return process.env.BROWSERSTACK_USERNAME;
    }
    if (options.testObservabilityOptions && options.testObservabilityOptions.user) {
        return options.testObservabilityOptions.user;
    }
    return config.user;
}
export function getObservabilityKey(options, config) {
    if (process.env.BROWSERSTACK_ACCESS_KEY) {
        return process.env.BROWSERSTACK_ACCESS_KEY;
    }
    if (options.testObservabilityOptions && options.testObservabilityOptions.key) {
        return options.testObservabilityOptions.key;
    }
    return config.key;
}
export function getObservabilityProject(options, bstackProjectName) {
    if (process.env.TEST_OBSERVABILITY_PROJECT_NAME) {
        return process.env.TEST_OBSERVABILITY_PROJECT_NAME;
    }
    if (options.testObservabilityOptions && options.testObservabilityOptions.projectName) {
        return options.testObservabilityOptions.projectName;
    }
    return bstackProjectName;
}
export function getObservabilityBuild(options, bstackBuildName) {
    if (process.env.TEST_OBSERVABILITY_BUILD_NAME) {
        return process.env.TEST_OBSERVABILITY_BUILD_NAME;
    }
    if (options.testObservabilityOptions && options.testObservabilityOptions.buildName) {
        return options.testObservabilityOptions.buildName;
    }
    return bstackBuildName || path.basename(path.resolve(process.cwd()));
}
export function getObservabilityBuildTags(options, bstackBuildTag) {
    if (process.env.TEST_OBSERVABILITY_BUILD_TAG) {
        return process.env.TEST_OBSERVABILITY_BUILD_TAG.split(',');
    }
    if (options.testObservabilityOptions && options.testObservabilityOptions.buildTag) {
        return options.testObservabilityOptions.buildTag;
    }
    if (bstackBuildTag) {
        return [bstackBuildTag];
    }
    return [];
}
export function getBrowserStackUser(config) {
    if (process.env.BROWSERSTACK_USERNAME) {
        return process.env.BROWSERSTACK_USERNAME;
    }
    return config.user;
}
export function getBrowserStackKey(config) {
    if (process.env.BROWSERSTACK_ACCESS_KEY) {
        return process.env.BROWSERSTACK_ACCESS_KEY;
    }
    return config.key;
}
export function isUndefined(value) {
    let res = (value === undefined || value === null);
    if (typeof value === 'string') {
        res = res || value === '';
    }
    return res;
}
export function isTrue(value) {
    return (value + '').toLowerCase() === 'true';
}
export function isFalse(value) {
    return (value + '').toLowerCase() === 'false';
}
export function frameworkSupportsHook(hook, framework) {
    if (framework === 'mocha' && (hook === 'before' || hook === 'after' || hook === 'beforeEach' || hook === 'afterEach')) {
        return true;
    }
    if (framework === 'cucumber') {
        return true;
    }
    return false;
}
export const patchConsoleLogs = o11yErrorHandler(() => {
    const BSTestOpsPatcher = new logPatcher({});
    Object.keys(consoleHolder).forEach((method) => {
        const origMethod = console[method].bind(console);
        // Make sure we don't override Constructors
        // Arrow functions are not construable
        if (typeof console[method] === 'function'
            && method !== 'Console') {
            console[method] = (...args) => {
                origMethod(...args);
                BSTestOpsPatcher[method](...args);
            };
        }
    });
});
export function getFailureObject(error) {
    const stack = error.stack;
    const message = typeof error === 'string' ? error : error.message;
    const backtrace = stack ? removeAnsiColors(stack.toString()) : '';
    return {
        failure: [{ backtrace: [backtrace] }],
        failure_reason: removeAnsiColors(message.toString()),
        failure_type: message ? (message.toString().match(/AssertionError/) ? 'AssertionError' : 'UnhandledError') : null
    };
}
export function truncateString(field, truncateSizeInBytes) {
    try {
        const bufferSizeInBytes = Buffer.from(GIT_META_DATA_TRUNCATED).length;
        const fieldBufferObj = Buffer.from(field);
        const lenOfFieldBufferObj = fieldBufferObj.length;
        const finalLen = Math.ceil(lenOfFieldBufferObj - truncateSizeInBytes - bufferSizeInBytes);
        if (finalLen > 0) {
            const truncatedString = fieldBufferObj.subarray(0, finalLen).toString() + GIT_META_DATA_TRUNCATED;
            return truncatedString;
        }
    }
    catch (error) {
        BStackLogger.debug(`Error while truncating field, nothing was truncated here: ${error}`);
    }
    return field;
}
export function getSizeOfJsonObjectInBytes(jsonData) {
    try {
        const buffer = Buffer.from(JSON.stringify(jsonData));
        return buffer.length;
    }
    catch (error) {
        BStackLogger.debug(`Something went wrong while calculating size of JSON object: ${error}`);
    }
    return -1;
}
export function checkAndTruncateVCSInfo(gitMetaData) {
    const gitMetaDataSizeInBytes = getSizeOfJsonObjectInBytes(gitMetaData);
    if (gitMetaDataSizeInBytes && gitMetaDataSizeInBytes > MAX_GIT_META_DATA_SIZE_IN_BYTES) {
        const truncateSize = gitMetaDataSizeInBytes - MAX_GIT_META_DATA_SIZE_IN_BYTES;
        const truncatedCommitMessage = truncateString(gitMetaData.commit_message, truncateSize);
        gitMetaData.commit_message = truncatedCommitMessage;
        BStackLogger.info(`The commit has been truncated. Size of commit after truncation is ${getSizeOfJsonObjectInBytes(gitMetaData) / 1024} KB`);
    }
    return gitMetaData;
}
export const sleep = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
export async function uploadLogs(user, key, clientBuildUuid) {
    if (!user || !key) {
        BStackLogger.debug('Uploading logs failed due to no credentials');
        return;
    }
    const fileStream = fs.createReadStream(BStackLogger.logFilePath);
    const uploadAddress = UPLOAD_LOGS_ADDRESS;
    const zip = zlib.createGzip({ level: 1 });
    fileStream.pipe(zip);
    const formData = new FormData();
    formData.append('data', new FileStream(zip), 'logs.gz');
    formData.append('clientBuildUuid', clientBuildUuid);
    const requestOptions = {
        body: formData,
        username: user,
        password: key
    };
    const response = await nodeRequest('POST', UPLOAD_LOGS_ENDPOINT, requestOptions, uploadAddress);
    return response;
}
export const isObject = (object) => {
    return object !== null && typeof object === 'object' && !Array.isArray(object);
};
export const ObjectsAreEqual = (object1, object2) => {
    const objectKeys1 = Object.keys(object1);
    const objectKeys2 = Object.keys(object2);
    if (objectKeys1.length !== objectKeys2.length) {
        return false;
    }
    for (const key of objectKeys1) {
        const value1 = object1[key];
        const value2 = object2[key];
        const isBothAreObjects = isObject(value1) && isObject(value2);
        if ((isBothAreObjects && !ObjectsAreEqual(value1, value2)) || (!isBothAreObjects && value1 !== value2)) {
            return false;
        }
    }
    return true;
};
export const getPlatformVersion = o11yErrorHandler(function getPlatformVersion(caps) {
    if (!caps) {
        return undefined;
    }
    const bstackOptions = (caps)?.['bstack:options'];
    const keys = ['platformVersion', 'platform_version', 'osVersion', 'os_version'];
    for (const key of keys) {
        if (bstackOptions && bstackOptions?.[key]) {
            return String(bstackOptions?.[key]);
        }
        else if (caps[key]) {
            return String(caps[key]);
        }
    }
    return undefined;
});
export const isObjectEmpty = (objectName) => {
    return (objectName &&
        Object.keys(objectName).length === 0 &&
        objectName.constructor === Object);
};
export const getErrorString = (err) => {
    if (!err) {
        return undefined;
    }
    if (typeof err === 'string') {
        return err; // works, `e` narrowed to string
    }
    else if (err instanceof Error) {
        return err.message; // works, `e` narrowed to Error
    }
};
export function isTurboScale(options) {
    return Boolean(options?.turboScale);
}
export function getObservabilityProduct(options, isAppAutomate) {
    return isAppAutomate
        ? 'app-automate'
        : (isTurboScale(options) ? 'turboscale' : 'automate');
}
export const hasBrowserName = (cap) => {
    if (!cap || !cap.capabilities) {
        return false;
    }
    const browserStackCapabilities = cap.capabilities;
    return browserStackCapabilities.browserName !== undefined;
};
export const isValidCapsForHealing = (caps) => {
    // Get all capability values
    const capValues = Object.values(caps);
    // Check if there are any capabilities and if at least one has a browser name
    return capValues.length > 0 && capValues.some(hasBrowserName);
};
export async function pollApi(url, params, headers, upperLimit, startTime = Date.now()) {
    params.timestamp = Math.round(Date.now() / 1000);
    BStackLogger.debug(`current timestamp ${params.timestamp}`);
    try {
        const response = await got(url, {
            searchParams: params,
            headers,
        });
        const responseData = JSON.parse(response.body);
        return {
            data: responseData,
            headers: response.headers,
            message: 'Polling succeeded.',
        };
    }
    catch (error) {
        if (error.response && error.response.statusCode === 404) {
            const nextPollTime = parseInt(error.response.headers.next_poll_time, 10) * 1000;
            BStackLogger.debug(`timeInMillis ${nextPollTime}`);
            if (isNaN(nextPollTime)) {
                BStackLogger.warn('Invalid or missing `nextPollTime` header. Stopping polling.');
                return {
                    data: {},
                    headers: error.response.headers,
                    message: 'Invalid nextPollTime header value. Polling stopped.',
                };
            }
            const elapsedTime = nextPollTime - Date.now();
            BStackLogger.debug(`elapsedTime ${elapsedTime} timeInMillis ${nextPollTime} upperLimit ${upperLimit}`);
            // Stop polling if the upper time limit is reached
            if (nextPollTime > upperLimit) {
                BStackLogger.warn('Polling stopped due to upper time limit.');
                return {
                    data: {},
                    headers: error.response.headers,
                    message: 'Polling stopped due to upper time limit.',
                };
            }
            BStackLogger.debug(`Polling again in ${elapsedTime}ms with params:`, params);
            // Wait for the specified time and poll again
            await new Promise((resolve) => setTimeout(resolve, elapsedTime));
            return pollApi(url, params, headers, upperLimit, startTime);
        }
        else if (error.response) {
            throw {
                data: {},
                headers: {},
                message: error.response.body ? JSON.parse(error.response.body).message : 'Unknown error',
            };
        }
        else {
            BStackLogger.error(`Unexpected error occurred: ${error}`);
            return { data: {}, headers: {}, message: 'Unexpected error occurred.' };
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ2pFLE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUNyQyxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFLNUIsT0FBTyxHQUFHLEVBQUUsRUFBRSxTQUFTLEVBQUUsTUFBTSxLQUFLLENBQUE7QUFHcEMsT0FBTyxXQUFXLE1BQU0sZUFBZSxDQUFBO0FBQ3ZDLE9BQU8sU0FBUyxNQUFNLGdCQUFnQixDQUFBO0FBRXRDLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxlQUFlLENBQUE7QUFDeEMsT0FBTyxVQUFVLE1BQU0saUJBQWlCLENBQUE7QUFDeEMsT0FBTyxpQkFBaUIsTUFBTSx5QkFBeUIsQ0FBQTtBQUN2RCxPQUFPLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBSzNILE9BQU8sRUFDSCxtQkFBbUIsRUFDbkIsYUFBYSxFQUNiLG1CQUFtQixFQUNuQixvQkFBb0IsRUFDcEIsYUFBYSxFQUNiLDJCQUEyQixFQUMzQixzQkFBc0IsRUFDdEIseUJBQXlCLEVBQ3pCLG9CQUFvQixFQUNwQixTQUFTLEVBQ1QsMkJBQTJCLEVBQzNCLHdCQUF3QixFQUN4QiwwQkFBMEIsRUFDMUIsMEJBQTBCLEVBQzFCLCtCQUErQixFQUMvQix1QkFBdUIsRUFDdkIsaUJBQWlCLEVBQ2pCLGdDQUFnQyxFQUNoQyx3QkFBd0IsRUFDM0IsTUFBTSxnQkFBZ0IsQ0FBQTtBQUN2QixPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDaEQsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBQzVDLE9BQU8sb0JBQW9CLE1BQU0sb0NBQW9DLENBQUE7QUFDckUsT0FBTyxVQUFVLE1BQU0seUJBQXlCLENBQUE7QUFDaEQsT0FBTyxhQUFhLE1BQU0sNEJBQTRCLENBQUE7QUFFdEQsTUFBTSxVQUFVLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0FBcUJ2QyxNQUFNLENBQUMsTUFBTSxzQkFBc0IsR0FBRztJQUNsQyxLQUFLLEVBQUU7UUFDSCxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDO1FBQ3pDLEtBQUssRUFBRSxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUM7S0FDOUM7SUFDRCxPQUFPLEVBQUU7UUFDTCxjQUFjLEVBQUUsa0JBQWtCO1FBQ2xDLGNBQWMsRUFBRSxNQUFNO0tBQ3pCO0NBQ0osQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLE1BQU0sR0FBOEI7SUFDN0MsS0FBSyxFQUFFLEtBQUs7SUFDWixJQUFJLEVBQUUsUUFBUTtJQUNkLElBQUksRUFBRSxZQUFZO0lBQ2xCLEtBQUssRUFBRSxPQUFPO0lBQ2QsS0FBSyxFQUFFLE1BQU07SUFDYixRQUFRLEVBQUUsU0FBUztDQUN0QixDQUFBO0FBRUQ7OztHQUdHO0FBQ0gsTUFBTSxVQUFVLHFCQUFxQixDQUFDLEdBQXFDO0lBQ3ZFLEdBQUcsR0FBRyxHQUFHLElBQUksRUFBRSxDQUFBO0lBQ2YsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO1FBQ3hCLEdBQUcsR0FBRyxFQUFFLEdBQUcsR0FBRyxFQUFFLEdBQUcsR0FBRyxDQUFDLGdCQUFnQixDQUFDLEVBQXNDLENBQUE7SUFDbEYsQ0FBQztJQUVEOztPQUVHO0lBQ0gsT0FBTyxtQkFBbUI7U0FDckIsR0FBRyxDQUFDLENBQUMsQ0FBeUMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQzFELE1BQU0sQ0FBQyxPQUFPLENBQUM7U0FDZixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7QUFDbEIsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLHNCQUFzQixDQUFDLE9BQTZELEVBQUUsSUFBb0MsRUFBRSxXQUFvQjtJQUM1SixJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3pCLE9BQU8sRUFBRSxHQUFHLE9BQU8sQ0FBQyxZQUFZLEVBQUUsR0FBRyxJQUFJLEVBQThCLENBQUE7SUFDM0UsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFHLElBQTRDLENBQUE7SUFDOUQsTUFBTSxTQUFTLEdBQUcsV0FBVyxJQUFJLE9BQU8sQ0FBQyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7SUFDdEgsTUFBTSxHQUFHLEdBQUcsV0FBVyxJQUFJLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQzVGLE9BQU8sRUFBRSxHQUFHLFNBQVMsRUFBRSxHQUFHLEdBQUcsRUFBOEIsQ0FBQTtBQUMvRCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsTUFBTSxVQUFVLHdCQUF3QixDQUFDLEdBQThCO0lBQ25FLE9BQU8sT0FBTyxDQUNWLEdBQUc7UUFDQyxHQUFHLENBQUMsZ0JBQWdCLENBQUM7UUFDckIsaUVBQWlFO1FBQ2pFLHNFQUFzRTtRQUN0RSxDQUFDLENBQ0csTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQy9DLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLFdBQVcsQ0FDcEMsQ0FDUixDQUFBO0FBQ0wsQ0FBQztBQUVELE1BQU0sVUFBVSxrQkFBa0IsQ0FBQyxTQUFpQixFQUFFLGNBQXNCO0lBQ3hFLE1BQU0sY0FBYyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDM0MsTUFBTSxtQkFBbUIsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ3JELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsRixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDVCxJQUFJLGVBQWUsR0FBRyxFQUFFLENBQUE7SUFDeEIsT0FBTyxDQUFDLEdBQUcsY0FBYyxJQUFJLGNBQWMsQ0FBQyxDQUFDLENBQUMsS0FBSyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3hFLGVBQWUsSUFBSSxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUE7SUFDaEQsQ0FBQztJQUNELE9BQU8sZUFBZSxDQUFDLElBQUksRUFBRSxDQUFBO0FBQ2pDLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxLQUFVLEVBQUUsRUFBWSxFQUFFLElBQVc7SUFDdkQsWUFBWSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLElBQUksY0FBYyxJQUFJLEtBQUssS0FBSyxFQUFFLENBQUMsQ0FBQTtJQUMvRSxJQUFJLFVBQWtCLENBQUE7SUFDdEIsSUFBSSxDQUFDO1FBQ0QsVUFBVSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDVCxVQUFVLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBQ0QsYUFBYSxDQUFDLGlCQUFpQixDQUFDLHNCQUFzQixFQUFFLENBQUMsSUFBSSxjQUFjLFVBQVUsTUFBTSxLQUFLLEVBQUUsRUFBRSxLQUFLLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQzdILENBQUM7QUFFRCxNQUFNLFVBQVUsZ0JBQWdCLENBQUMsRUFBWTtJQUN6QyxPQUFPLFVBQVUsR0FBRyxJQUFTO1FBQ3pCLElBQUksQ0FBQztZQUNELElBQUksZ0JBQWdCLEdBQUcsRUFBRSxDQUFBO1lBQ3pCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3BDLGdCQUFnQixHQUFHLGlCQUFpQixDQUFDLGNBQWMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxnQkFBdUIsQ0FBQyxDQUFBO1lBQzNGLENBQUM7WUFDRCxNQUFNLE1BQU0sR0FBRyxnQkFBZ0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFBO1lBQ3hDLElBQUksTUFBTSxZQUFZLE9BQU8sRUFBRSxDQUFDO2dCQUM1QixPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFBO1lBQy9ELENBQUM7WUFDRCxPQUFPLE1BQU0sQ0FBQTtRQUNqQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLFlBQVksQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ2pDLENBQUM7SUFDTCxDQUFDLENBQUE7QUFDTCxDQUFDO0FBRUQsTUFBTSxVQUFVLFlBQVksQ0FBQyxFQUFZO0lBQ3JDLE9BQU8sVUFBVSxHQUFHLElBQVM7UUFDekIsSUFBSSxDQUFDO1lBQ0QsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7WUFDM0IsTUFBTSxNQUFNLEdBQUcsZ0JBQWdCLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQTtZQUN4QyxJQUFJLE1BQU0sWUFBWSxPQUFPLEVBQUUsQ0FBQztnQkFDNUIsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLElBQUksY0FBYyxJQUFJLEtBQUssS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFBO1lBQ2pILENBQUM7WUFDRCxPQUFPLE1BQU0sQ0FBQTtRQUNqQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLFlBQVksQ0FBQyxLQUFLLENBQUMsc0JBQXNCLEVBQUUsQ0FBQyxJQUFJLGNBQWMsSUFBSSxLQUFLLEtBQUssRUFBRSxDQUFDLENBQUE7UUFDbkYsQ0FBQztJQUNMLENBQUMsQ0FBQTtBQUNMLENBQUM7QUFFRCxNQUFNLENBQUMsS0FBSyxVQUFVLFdBQVcsQ0FBQyxXQUFtQixFQUFFLFdBQW1CLEVBQUUsT0FBWSxFQUFFLE1BQWMsRUFBRSxVQUFrQixNQUFNO0lBQzlILElBQUksQ0FBQztRQUNELE1BQU0sUUFBUSxHQUFRLE1BQU0sR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLFdBQVcsRUFBRSxFQUFFO1lBQ3hELE1BQU0sRUFBRSxXQUFXO1lBQ25CLE9BQU8sRUFBRTtnQkFDTCxPQUFPLEVBQUUsT0FBTzthQUNuQjtZQUNELEdBQUcsT0FBTztTQUNiLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNULE9BQU8sUUFBUSxDQUFBO0lBQ25CLENBQUM7SUFBQyxPQUFPLEtBQVcsRUFBRSxDQUFDO1FBQ25CLE1BQU0sV0FBVyxHQUFHLFdBQVcsS0FBSyxvQkFBb0IsQ0FBQTtRQUN4RCxJQUFJLEtBQUssWUFBWSxTQUFTLElBQUksS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQy9DLE1BQU0sZ0JBQWdCLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1lBQ2hHLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUN2RSxJQUFJLFlBQVksRUFBRSxDQUFDO2dCQUNmLFdBQVcsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksTUFBTSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksTUFBTSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtZQUNqSSxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osV0FBVyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtZQUM3RixDQUFDO1lBQ0QsSUFBSSxXQUFXLEVBQUUsQ0FBQztnQkFDZCxPQUFNO1lBQ1YsQ0FBQztZQUNELE1BQU0sS0FBSyxDQUFBO1FBQ2YsQ0FBQzthQUFNLENBQUM7WUFDSixJQUFJLFdBQVcsRUFBRSxDQUFDO2dCQUNkLFlBQVksQ0FBQyxLQUFLLENBQUMscUNBQXFDLEtBQUssTUFBTSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtnQkFDakYsT0FBTTtZQUNWLENBQUM7WUFDRCxZQUFZLENBQUMsS0FBSyxDQUFDLHFDQUFxQyxLQUFLLE1BQU0sS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUE7WUFDakYsTUFBTSxLQUFLLENBQUE7UUFDZixDQUFDO0lBQ0wsQ0FBQztBQUNMLENBQUM7QUFRRCxNQUFNLFVBQVUscUJBQXFCLENBQXNCLFVBQWE7SUFDcEUsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQTtJQUV0QyxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbkQsT0FBTyxVQUFVLENBQUE7SUFDckIsQ0FBQztJQUVELE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRTtRQUN6RCxNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDcEMsSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLElBQUksVUFBVSxLQUFLLGFBQWEsRUFBRSxDQUFDO1lBQy9ELDhEQUE4RDtZQUM5RCxNQUFNLENBQUMsY0FBYyxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUU7Z0JBQ3pDLFFBQVEsRUFBRSxJQUFJO2dCQUNkLEtBQUssRUFBRSxVQUFTLEdBQUcsSUFBUztvQkFDeEIsSUFBSSxDQUFDO3dCQUNELE1BQU0sTUFBTSxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQTt3QkFDckksSUFBSSxNQUFNLFlBQVksT0FBTyxFQUFFLENBQUM7NEJBQzVCLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUE7d0JBQ25FLENBQUM7d0JBQ0QsT0FBTyxNQUFNLENBQUE7b0JBRWpCLENBQUM7b0JBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQzt3QkFDWCxZQUFZLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQTtvQkFDbkMsQ0FBQztnQkFDTCxDQUFDO2FBQ0osQ0FBQyxDQUFBO1FBQ04sQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFBO0lBRUYsT0FBTyxVQUFVLENBQUE7QUFDckIsQ0FBQztBQUVELE1BQU0sQ0FBQyxNQUFNLGdDQUFnQyxHQUFHLENBQUMsUUFBd0IsRUFBRSxFQUFFO0lBQ3pFLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDMUIsMkJBQTJCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDakMsT0FBTTtJQUNWLENBQUM7SUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNsQywyQkFBMkIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDbkQsT0FBTTtJQUNWLENBQUM7SUFDRCxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixDQUFDLEdBQUcsTUFBTSxDQUFBO0lBQ2hELElBQUksUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUNuRCxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQixDQUFDLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsUUFBUSxFQUFFLENBQUE7SUFDckcsQ0FBQztBQUNMLENBQUMsQ0FBQTtBQU1ELE1BQU0sQ0FBQyxNQUFNLHlCQUF5QixHQUFHLENBQ3JDLFNBQXdCLEVBQ3hCLE9BQTBCLEVBQzFCLFNBQTRCLEVBQ1QsRUFBRTtJQUNyQixNQUFNLE1BQU0sR0FBd0IsRUFBRSxDQUFBO0lBQ3RDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFvQixFQUFFLEVBQUU7UUFDdkMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUNqRCxDQUFDLENBQUMsQ0FBQTtJQUNGLE9BQU8sTUFBTSxDQUFBO0FBQ2pCLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFPLDRCQUE0QixHQUFHLENBQUMsUUFBd0IsRUFBRSxFQUFFO0lBQ3RFLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDMUIsMkJBQTJCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDakMsT0FBTTtJQUNWLENBQUM7SUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNsQywyQkFBMkIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDbkQsT0FBTTtJQUNWLENBQUM7SUFFRCxJQUFJLFFBQVEsQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDakMsTUFBTSxFQUFFLGtCQUFrQixFQUFFLGNBQWMsRUFBRSxjQUFjLEVBQUUsR0FBRyx5QkFBeUIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ3RKLE1BQU0sV0FBVyxHQUFHO1lBQ2hCLFNBQVMsRUFBRSx5QkFBeUIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLFNBQVMsQ0FBQztZQUMvRixVQUFVLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLFFBQVE7U0FDckUsQ0FBQTtRQUNELElBQUksY0FBYyxFQUFFLENBQUM7WUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsR0FBRyxjQUFjLENBQUE7WUFDeEQsWUFBWSxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsY0FBYyxFQUFFLENBQUMsQ0FBQTtRQUN4RSxDQUFDO1FBQ0QsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxHQUFHLGtCQUFrQixDQUFBO1lBQ2hELE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLENBQUMsR0FBRyxNQUFNLENBQUE7UUFDcEQsQ0FBQztRQUNELElBQUksY0FBYyxFQUFFLENBQUM7WUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsR0FBRyxjQUFjLENBQUE7UUFDNUQsQ0FBQztRQUNELElBQUksV0FBVyxFQUFFLENBQUM7WUFDZCxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUE7WUFDeEMsb0JBQW9CLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDaEMsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFFBQXdCLEVBQUUsT0FBZ0QsRUFBRSxFQUFFO0lBQ3JILElBQUksT0FBTyxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDNUIsZ0NBQWdDLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDOUMsQ0FBQztJQUNELElBQUksT0FBTyxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3hCLDRCQUE0QixDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQzFDLENBQUM7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxpQkFBaUIsR0FBRyxnQkFBZ0IsQ0FBQyxLQUFLLFVBQVUsaUJBQWlCLENBQUMsT0FBZ0QsRUFBRSxNQUEwQixFQUFFLFFBQW9CLEVBQUUsWUFBZ0M7SUFDbk4sTUFBTSxnQkFBZ0IsR0FBRyxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUMsZ0JBQWdCLENBQUE7SUFDbEUsZ0JBQWdCLENBQUMsU0FBUyxFQUFFLENBQUE7SUFFNUIsTUFBTSxJQUFJLEdBQUc7UUFDVCxNQUFNLEVBQUUsTUFBTTtRQUNkLFlBQVksRUFBRSx1QkFBdUIsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQztRQUNwRSxJQUFJLEVBQUUscUJBQXFCLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxTQUFTLENBQUM7UUFDeEQsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLGVBQWU7UUFDMUMsVUFBVSxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRTtRQUN0QyxJQUFJLEVBQUUseUJBQXlCLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxRQUFRLENBQUM7UUFDM0QsU0FBUyxFQUFFO1lBQ1AsUUFBUSxFQUFFLFFBQVEsRUFBRTtZQUNwQixRQUFRLEVBQUUsUUFBUSxFQUFFO1lBQ3BCLElBQUksRUFBRSxJQUFJLEVBQUU7WUFDWixPQUFPLEVBQUUsT0FBTyxFQUFFO1lBQ2xCLElBQUksRUFBRSxJQUFJLEVBQUU7U0FDZjtRQUNELE9BQU8sRUFBRSxTQUFTLEVBQUU7UUFDcEIsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUM7UUFDbkUsa0JBQWtCLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxLQUFLO1FBQ25ELGVBQWUsRUFBRSxNQUFNLGNBQWMsRUFBRTtRQUN2QyxhQUFhLEVBQUU7WUFDWCxRQUFRLEVBQUUsT0FBTyxDQUFDLG9CQUFvQjtTQUN6QztRQUNELHNCQUFzQixFQUFFLHVCQUF1QixDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsaUJBQWlCLENBQUM7UUFDbEYsaUJBQWlCLEVBQUU7WUFDZixhQUFhLEVBQUUsY0FBYyxHQUFHLE1BQU0sQ0FBQyxTQUFTO1lBQ2hELGdCQUFnQixFQUFFLFFBQVEsQ0FBQyxvQkFBb0I7WUFDL0MsVUFBVSxFQUFFLFFBQVEsQ0FBQyxvQkFBb0I7WUFDekMsUUFBUSxFQUFFLFlBQVk7WUFDdEIsYUFBYSxFQUFFO2dCQUNYLElBQUksRUFBRSxhQUFhO2dCQUNuQixPQUFPLEVBQUUsUUFBUSxDQUFDLG9CQUFvQjthQUN6QztTQUNKO1FBQ0QsV0FBVyxFQUFFLGFBQWEsQ0FBQyxZQUFZLENBQUM7UUFDeEMsTUFBTSxFQUFFLEVBQUU7S0FDYixDQUFBO0lBRUQsSUFBSSxDQUFDO1FBQ0QsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNqRSxhQUFhLENBQUMsc0JBQXNCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDdkosQ0FBQztJQUNMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxZQUFZLENBQUMsS0FBSyxDQUFDLDRGQUE0RixLQUFLLEVBQUUsQ0FBQyxDQUFBO0lBQ2xJLENBQUM7SUFDRCxJQUFJLENBQUMsTUFBTSxHQUFHLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQTtJQUVsRCxJQUFJLENBQUM7UUFDRCxNQUFNLEdBQUcsR0FBRyxHQUFHLGFBQWEsZ0JBQWdCLENBQUE7UUFDNUMsTUFBTSxRQUFRLEdBQW1CLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDakQsR0FBRyxzQkFBc0I7WUFDekIsUUFBUSxFQUFFLG9CQUFvQixDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUM7WUFDL0MsUUFBUSxFQUFFLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUM7WUFDOUMsSUFBSSxFQUFFLElBQUk7U0FDYixDQUFDLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDVCxZQUFZLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqRixPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixDQUFDLEdBQUcsTUFBTSxDQUFBO1FBQ2pELElBQUksUUFBUSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxHQUFHLENBQUE7UUFDeEQsQ0FBQztRQUNELElBQUksUUFBUSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQzNCLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLENBQUMsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFBO1lBQ2pFLGFBQWEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxhQUFhLEdBQUcsUUFBUSxDQUFDLGVBQWUsQ0FBQTtRQUN4RSxDQUFDO1FBQ0QsMEJBQTBCLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzdDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzlCLENBQUM7SUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1FBQ2xCLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDakIsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzlCLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNwQixPQUFNO1FBQ1YsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQTtBQUVGLE1BQU0sQ0FBQyxNQUFNLHVCQUF1QixHQUFHLENBQUMsWUFBc0MsRUFBRSxFQUFFO0lBQzlFLGdGQUFnRjtJQUNoRixZQUFZLENBQUMsS0FBSyxDQUFDLGdCQUFnQixJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUNsRSxJQUNJLFlBQVksRUFBRSxhQUFhO1FBQzNCLE1BQU0sQ0FBQyxZQUFZLEVBQUUsYUFBYSxDQUFDLENBQUMsV0FBVyxFQUFFLEtBQUssU0FBUztRQUMvRCxZQUFZLEVBQUUsZ0JBQWdCO1FBQzlCLFFBQVEsQ0FBQyxZQUFZLEVBQUUsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQzNELENBQUM7UUFDQyxZQUFZLENBQUMsSUFBSSxDQUNiLGtHQUFrRyxDQUNyRyxDQUFBO1FBQ0QsT0FBTyxLQUFLLENBQUE7SUFDaEIsQ0FBQztJQUNELE9BQU8sSUFBSSxDQUFBO0FBQ2YsQ0FBQyxDQUFBO0FBRUQsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLEdBQUcsQ0FBQyxVQUFnQixFQUFFLFlBQXNDLEVBQUUsYUFBbUIsRUFBRSxFQUFFO0lBQ2xILDZFQUE2RTtJQUM3RSxJQUFJLENBQUM7UUFDRCxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2IsWUFBWSxDQUFDLElBQUksQ0FBQyw2REFBNkQsQ0FBQyxDQUFBO1lBQ2hGLE9BQU8sS0FBSyxDQUFBO1FBQ2hCLENBQUM7UUFFRCxJQUFJLFlBQVksRUFBRSxZQUFZLEVBQUUsV0FBVyxFQUFFLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDekQsWUFBWSxDQUFDLElBQUksQ0FBQyw0REFBNEQsQ0FBQyxDQUFBO1lBQy9FLE9BQU8sS0FBSyxDQUFBO1FBQ2hCLENBQUM7UUFDRCxNQUFNLGNBQWMsR0FBRyxZQUFZLEVBQUUsZUFBZSxDQUFBO1FBQ3BELElBQUssQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksVUFBVSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQzFHLFlBQVksQ0FBQyxJQUFJLENBQUMsbUZBQW1GLENBQUMsQ0FBQTtZQUN0RyxPQUFPLEtBQUssQ0FBQTtRQUNoQixDQUFDO1FBRUQsSUFBSSxhQUFhLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1lBQzlDLFlBQVksQ0FBQyxJQUFJLENBQUMsMEhBQTBILENBQUMsQ0FBQTtZQUM3SSxPQUFPLEtBQUssQ0FBQTtRQUNoQixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUE7SUFDZixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLFlBQVksQ0FBQyxLQUFLLENBQUMsK0VBQStFLEtBQUssRUFBRSxDQUFDLENBQUE7SUFDOUcsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFBO0FBQ2hCLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLDhCQUE4QixHQUFHLENBQUMsVUFBOEIsRUFBRSxTQUFpQixFQUFFLG9CQUE4QyxFQUFFLEtBQStCLEVBQUUsVUFBb0IsRUFBRyxFQUFFO0lBQ3hNLElBQUksQ0FBQztRQUNELE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsb0JBQW9CLEVBQUUseUJBQXlCLENBQUMsQ0FBQyxDQUFDLENBQUMsb0JBQW9CLEVBQUUseUJBQXlCLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUN6SSxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLG9CQUFvQixFQUFFLHlCQUF5QixDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixFQUFFLHlCQUF5QixDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFekksSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNiLE1BQU0sUUFBUSxHQUFhLEVBQUUsQ0FBQTtZQUM3QixLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUE0QixFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO1lBQ2xGLE1BQU0sUUFBUSxHQUFHLFdBQVcsRUFBRSxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQTtZQUMzRSxNQUFNLFFBQVEsR0FBRyxXQUFXLEVBQUUsTUFBTSxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUE7WUFFeEcsT0FBTyxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUE7UUFDaEMsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLFVBQVUsR0FBRyxHQUFHLEdBQUcsU0FBUyxDQUFBO1FBQ2pELE1BQU0sUUFBUSxHQUFHLFdBQVcsRUFBRSxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFlBQVksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQTtRQUMvRSxNQUFNLFFBQVEsR0FBRyxXQUFXLEVBQUUsTUFBTSxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUE7UUFFNUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUE7SUFDaEMsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixZQUFZLENBQUMsS0FBSyxDQUFDLCtFQUErRSxLQUFLLEVBQUUsQ0FBQyxDQUFBO0lBQzlHLENBQUM7SUFDRCxPQUFPLEtBQUssQ0FBQTtBQUNoQixDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxnQ0FBZ0MsR0FBRyxDQUFDLGlCQUFvQyxFQUFFLEVBQUU7SUFDckYsSUFBSSxDQUFDO1FBQ0QsTUFBTSxlQUFlLEdBQUcsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsS0FBSyxRQUFRLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsS0FBSyxNQUFNLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLEtBQUssV0FBVyxDQUFBO1FBQzFNLE9BQU8saUJBQWlCLElBQUksZUFBZSxDQUFBO0lBQy9DLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsWUFBWSxDQUFDLEtBQUssQ0FBQyxpRUFBaUUsS0FBSyxFQUFFLENBQUMsQ0FBQTtJQUNoRyxDQUFDO0lBQ0QsT0FBTyxLQUFLLENBQUE7QUFDaEIsQ0FBQyxDQUFBO0FBRUQsTUFBTSxDQUFDLE1BQU0sbUNBQW1DLEdBQUcsQ0FBQyxpQkFBb0MsRUFBRSxhQUF1QixFQUFFLEVBQUU7SUFDakgsTUFBTSx1QkFBdUIsR0FBRyxnQ0FBZ0MsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO0lBQ25GLE9BQU8sdUJBQXVCLElBQUksYUFBYSxDQUFBO0FBQ25ELENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLFlBQVksR0FBRyxDQUFDLFFBQXlCLEVBQUUsR0FBRyxNQUF5QixFQUFVLEVBQUU7SUFDNUYsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBQ1QsSUFBSSxRQUFRLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDcEIsT0FBTyxFQUFFLENBQUE7SUFDYixDQUFDO0lBQ0QsT0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUU7UUFDaEMsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDekIsT0FBTyxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQzdELENBQUMsQ0FBQyxDQUFBO0FBQ04sQ0FBQyxDQUFBO0FBRUQsTUFBTSxDQUFDLE1BQU0sNkJBQTZCLEdBQUcsQ0FBRSxXQUFvQixFQUFtSSxFQUFFO0lBQ3BNLE9BQU87UUFDSCxlQUFlLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUI7UUFDOUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCO1FBQ3BELFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QjtRQUNsRCxZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlO1FBQ3pDLGVBQWUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1FBQzNCLFFBQVEsRUFBRSxXQUFXO0tBQ3hCLENBQUE7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxlQUFlLEdBQUcsS0FBSyxFQUFFLGFBQXNCLEVBQUUsT0FBNkQsRUFBRSxxQkFBK0IsRUFBRSxlQUFrQyxFQUFFLFdBQW9CLEVBQWlELEVBQUU7SUFDclEsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFDekIsWUFBWSxDQUFDLElBQUksQ0FBQyx5RUFBeUUsQ0FBQyxDQUFBO1FBQzVGLE9BQU0sQ0FBQyxrREFBa0Q7SUFDN0QsQ0FBQztJQUVELElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1FBQ3JELFlBQVksQ0FBQyxJQUFJLENBQUMsNkVBQTZFLENBQUMsQ0FBQTtRQUNoRyxPQUFNO0lBQ1YsQ0FBQztJQUVELElBQUksQ0FBQztRQUNELElBQUksbUNBQW1DLENBQUMsZUFBZSxFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDdEUsTUFBTSxPQUFPLEdBQVksTUFBTyxPQUErQixDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsb0JBQW9CLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsNkJBQTZCLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1lBQ2pNLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFpQixDQUFDLENBQUMsQ0FBQTtZQUNsRCxPQUFTLE9BQWdELENBQUE7UUFDN0QsQ0FBQztRQUNELE1BQU0sT0FBTyxHQUFZLE1BQU8sT0FBK0IsQ0FBQyxZQUFZLENBQUMsb0JBQW9CLENBQUMsV0FBcUIsRUFBRSxFQUFFLFFBQVEsRUFBRSxXQUFXLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQTtRQUN6SixZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBaUIsQ0FBQyxDQUFDLENBQUE7UUFDbEQsT0FBUyxPQUFnRCxDQUFBO0lBQzdELENBQUM7SUFBQyxPQUFPLEdBQVMsRUFBRSxDQUFDO1FBQ2pCLFlBQVksQ0FBQyxLQUFLLENBQUMsOENBQThDLEdBQUcsR0FBRyxDQUFDLENBQUE7UUFDeEUsT0FBTTtJQUNWLENBQUM7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxjQUFjLEdBQUcsS0FBSyxFQUFFLGFBQXNCLEVBQUUsT0FBNEIsRUFBRSxxQkFBK0IsRUFBRSxlQUFrQyxFQUE0QyxFQUFFO0lBQ3hNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQ3pCLFlBQVksQ0FBQyxJQUFJLENBQUMsNkVBQTZFLENBQUMsQ0FBQTtRQUNoRyxPQUFPLEVBQUUsQ0FBQSxDQUFDLGtEQUFrRDtJQUNoRSxDQUFDO0lBRUQsSUFBSSxDQUFDLGdDQUFnQyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7UUFDckQsWUFBWSxDQUFDLElBQUksQ0FBQyxpRkFBaUYsQ0FBQyxDQUFBO1FBQ3BHLE9BQU8sRUFBRSxDQUFBO0lBQ2IsQ0FBQztJQUVELElBQUksQ0FBQztRQUNELFlBQVksQ0FBQyxLQUFLLENBQUMsd0NBQXdDLENBQUMsQ0FBQTtRQUM1RCxNQUFNLGVBQWUsQ0FBQyxhQUFhLEVBQUUsT0FBTyxFQUFFLHFCQUFxQixFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBQ3JGLE1BQU0sT0FBTyxHQUFtQyxNQUFPLE9BQStCLENBQUMsWUFBWSxDQUFDLG9CQUFvQixDQUFDLFVBQW9CLENBQUMsQ0FBQTtRQUM5SSxPQUFPLE9BQU8sQ0FBQTtJQUNsQixDQUFDO0lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztRQUNsQixZQUFZLENBQUMsS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUE7UUFDMUQsWUFBWSxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUM1RCxPQUFPLEVBQUUsQ0FBQTtJQUNiLENBQUM7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLEVBQUUsYUFBc0IsRUFBRSxPQUE0QixFQUFFLHFCQUErQixFQUFFLGVBQWtDLEVBQUUsU0FBeUIsRUFBNEMsRUFBRTtJQUN0TyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUN6QixPQUFPLEVBQUUsQ0FBQSxDQUFDLGtEQUFrRDtJQUNoRSxDQUFDO0lBRUQsSUFBSSxDQUFDLG1DQUFtQyxDQUFDLGVBQWUsRUFBRSxhQUFhLENBQUMsRUFBRSxDQUFDO1FBQ3ZFLFlBQVksQ0FBQyxJQUFJLENBQUMseUZBQXlGLENBQUMsQ0FBQTtRQUM1RyxPQUFPLEVBQUUsQ0FBQTtJQUNiLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDRCxNQUFNLE1BQU0sR0FBRyxHQUFHLGlCQUFpQixJQUFJLHdCQUF3QixFQUFFLENBQUE7UUFDakUsTUFBTSxVQUFVLEdBQUcsTUFBTSx3QkFBd0IsQ0FBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxlQUFlLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDcEksTUFBTSxNQUFNLEdBQUcsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFBO1FBQzdDLFlBQVksQ0FBQyxLQUFLLENBQUMsbUJBQW1CLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQy9ELE9BQU8sTUFBTSxDQUFBO0lBQ2pCLENBQUM7SUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1FBQ2xCLFlBQVksQ0FBQyxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUN6RCxZQUFZLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQy9ELE9BQU8sRUFBRSxDQUFBO0lBQ2IsQ0FBQztBQUNMLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLHdCQUF3QixHQUFHLEtBQUssRUFBRSxhQUFzQixFQUFFLE9BQTRCLEVBQUUscUJBQStCLEVBQUUsZUFBa0MsRUFBRSxTQUF5QixFQUFxQyxFQUFFO0lBQ3RPLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQ3pCLE9BQU8sRUFBRSxDQUFBLENBQUMsa0RBQWtEO0lBQ2hFLENBQUM7SUFFRCxJQUFJLENBQUMsbUNBQW1DLENBQUMsZUFBZSxFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7UUFDdkUsWUFBWSxDQUFDLElBQUksQ0FBQyx5RkFBeUYsQ0FBQyxDQUFBO1FBQzVHLE9BQU8sRUFBRSxDQUFBO0lBQ2IsQ0FBQztJQUVELElBQUksQ0FBQztRQUNELE1BQU0sTUFBTSxHQUFHLEdBQUcsaUJBQWlCLElBQUksZ0NBQWdDLEVBQUUsQ0FBQTtRQUN6RSxNQUFNLFVBQVUsR0FBRyxNQUFNLHdCQUF3QixDQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLHFCQUFxQixFQUFFLGVBQWUsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUNwSSxNQUFNLE1BQU0sR0FBRyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLENBQUE7UUFDOUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDL0QsT0FBTyxNQUFNLENBQUE7SUFDakIsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNMLFlBQVksQ0FBQyxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUN6RCxPQUFPLEVBQUUsQ0FBQTtJQUNiLENBQUM7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLHdCQUF3QixHQUFHLEtBQUssRUFBRSxNQUFjLEVBQUUsYUFBc0IsRUFBRSxPQUE0QixFQUFFLHFCQUErQixFQUFFLGVBQWtDLEVBQUUsU0FBeUIsRUFBMkIsRUFBRTtJQUNyTyxZQUFZLENBQUMsS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUE7SUFDcEUsTUFBTSxlQUFlLENBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxlQUFlLENBQUMsQ0FBQTtJQUNyRixNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsS0FBSyxDQUFBO0lBQzdKLE1BQU0sTUFBTSxHQUFHLEVBQUUsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUEsQ0FBQyx1QkFBdUI7SUFDckksTUFBTSxNQUFNLEdBQUcsRUFBRSxhQUFhLEVBQUUsVUFBVSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUE7SUFDekUsTUFBTSxVQUFVLEdBQUcsTUFBTSxPQUFPLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsY0FBYyxDQUFDLENBQUE7SUFDeEUsWUFBWSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUE7SUFDbkUsT0FBTyxVQUFVLENBQUE7QUFDckIsQ0FBQyxDQUFBO0FBRUQsTUFBTSxDQUFDLE1BQU0scUJBQXFCLEdBQUcsS0FBSyxFQUFFLGFBQXNCLEVBQUUsT0FBNEIsRUFBRSxxQkFBK0IsRUFBRSxlQUFrQyxFQUFxQyxFQUFFO0lBQ3hNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQ3pCLE9BQU8sRUFBRSxDQUFBLENBQUMsa0RBQWtEO0lBQ2hFLENBQUM7SUFFRCxJQUFJLENBQUMsZ0NBQWdDLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztRQUNyRCxZQUFZLENBQUMsSUFBSSxDQUFDLHlGQUF5RixDQUFDLENBQUE7UUFDNUcsT0FBTyxFQUFFLENBQUE7SUFDYixDQUFDO0lBRUQsSUFBSSxDQUFDO1FBQ0QsWUFBWSxDQUFDLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQyxDQUFBO1FBQ3BFLE1BQU0sZUFBZSxDQUFDLGFBQWEsRUFBRSxPQUFPLEVBQUUscUJBQXFCLEVBQUUsZUFBZSxDQUFDLENBQUE7UUFDckYsTUFBTSxjQUFjLEdBQTRCLE1BQU8sT0FBK0IsQ0FBQyxZQUFZLENBQUMsb0JBQW9CLENBQUMsaUJBQTJCLENBQUMsQ0FBQTtRQUNySixPQUFPLGNBQWMsQ0FBQTtJQUN6QixDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ0wsWUFBWSxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFBO1FBQ3pELE9BQU8sRUFBRSxDQUFBO0lBQ2IsQ0FBQztBQUNMLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLGlCQUFpQixHQUFHLGdCQUFnQixDQUFDLEtBQUssVUFBVSxpQkFBaUIsQ0FBQyxhQUEwQixJQUFJO0lBQzdHLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxjQUFjLENBQUE7SUFDOUQsY0FBYyxDQUFDLFNBQVMsRUFBRSxDQUFBO0lBQzFCLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixDQUFDLEVBQUUsQ0FBQztRQUM1QyxjQUFjLENBQUMsTUFBTSxDQUFDLDRCQUE0QixDQUFDLENBQUE7UUFDbkQsT0FBTztZQUNILE1BQU0sRUFBRSxPQUFPO1lBQ2YsT0FBTyxFQUFFLDRCQUE0QjtTQUN4QyxDQUFBO0lBQ0wsQ0FBQztJQUVELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtJQUN0RCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDWixjQUFjLENBQUMsTUFBTSxDQUFDLDhEQUE4RCxDQUFDLENBQUE7UUFDckYsWUFBWSxDQUFDLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFBO1FBQ3pFLE9BQU87WUFDSCxNQUFNLEVBQUUsT0FBTztZQUNmLE9BQU8sRUFBRSw4REFBOEQ7U0FDMUUsQ0FBQTtJQUNMLENBQUM7SUFDRCxNQUFNLElBQUksR0FBYztRQUNwQixhQUFhLEVBQUUsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFO1FBQ3pDLG1CQUFtQixFQUFFLEVBQUU7S0FDMUIsQ0FBQTtJQUNELElBQUksVUFBVSxFQUFFLENBQUM7UUFDYixJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDO1lBQ3hCLE1BQU0sRUFBRSxhQUFhO1lBQ3JCLE1BQU0sRUFBRSxVQUFVO1NBQ3JCLENBQUMsQ0FBQTtJQUNOLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDRCxNQUFNLEdBQUcsR0FBRyxHQUFHLGFBQWEsa0JBQWtCLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLENBQUMsT0FBTyxDQUFBO1FBQzNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUU7WUFDaEMsS0FBSyxFQUFFLHNCQUFzQixDQUFDLEtBQUs7WUFDbkMsT0FBTyxFQUFFO2dCQUNMLEdBQUcsc0JBQXNCLENBQUMsT0FBTztnQkFDakMsZUFBZSxFQUFFLFVBQVUsUUFBUSxFQUFFO2FBQ3hDO1lBQ0QsSUFBSSxFQUFFLElBQUk7WUFDVixLQUFLLEVBQUU7Z0JBQ0gsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQzthQUMzQjtTQUNKLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNULFlBQVksQ0FBQyxLQUFLLENBQUMsa0NBQWtDLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ2hGLGNBQWMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN4QixPQUFPO1lBQ0gsTUFBTSxFQUFFLFNBQVM7WUFDakIsT0FBTyxFQUFFLEVBQUU7U0FDZCxDQUFBO0lBQ0wsQ0FBQztJQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7UUFDbEIsY0FBYyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUM1QixZQUFZLENBQUMsS0FBSyxDQUFDLCtCQUErQixLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQzFELE9BQU87WUFDSCxNQUFNLEVBQUUsT0FBTztZQUNmLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztTQUN6QixDQUFBO0lBQ0wsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFBO0FBRUYsTUFBTSxVQUFVLFNBQVM7SUFDckIsTUFBTSxHQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQTtJQUN2QixVQUFVO0lBQ1YsSUFBSSxDQUFDLE9BQU8sR0FBRyxDQUFDLFdBQVcsS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQyxZQUFZLEtBQUssUUFBUSxJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDL0ksT0FBTztZQUNILElBQUksRUFBRSxTQUFTO1lBQ2YsU0FBUyxFQUFFLEdBQUcsQ0FBQyxTQUFTO1lBQ3hCLFFBQVEsRUFBRSxHQUFHLENBQUMsUUFBUTtZQUN0QixZQUFZLEVBQUUsR0FBRyxDQUFDLFlBQVk7U0FDakMsQ0FBQTtJQUNMLENBQUM7SUFDRCxXQUFXO0lBQ1gsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztRQUN6QyxPQUFPO1lBQ0gsSUFBSSxFQUFFLFVBQVU7WUFDaEIsU0FBUyxFQUFFLEdBQUcsQ0FBQyxnQkFBZ0I7WUFDL0IsUUFBUSxFQUFFLEdBQUcsQ0FBQyxVQUFVO1lBQ3hCLFlBQVksRUFBRSxHQUFHLENBQUMsZ0JBQWdCO1NBQ3JDLENBQUE7SUFDTCxDQUFDO0lBQ0QsWUFBWTtJQUNaLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDdkMsT0FBTztZQUNILElBQUksRUFBRSxXQUFXO1lBQ2pCLFNBQVMsRUFBRSxHQUFHLENBQUMsb0JBQW9CO1lBQ25DLFFBQVEsRUFBRSxHQUFHLENBQUMsZUFBZTtZQUM3QixZQUFZLEVBQUUsR0FBRyxDQUFDLG1CQUFtQjtTQUN4QyxDQUFBO0lBQ0wsQ0FBQztJQUNELFdBQVc7SUFDWCxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxVQUFVLEVBQUUsQ0FBQztRQUMvQyxPQUFPO1lBQ0gsSUFBSSxFQUFFLFVBQVU7WUFDaEIsU0FBUyxFQUFFLElBQUk7WUFDZixRQUFRLEVBQUUsSUFBSTtZQUNkLFlBQVksRUFBRSxJQUFJO1NBQ3JCLENBQUE7SUFDTCxDQUFDO0lBQ0QsWUFBWTtJQUNaLElBQUksR0FBRyxDQUFDLGdCQUFnQixJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQy9DLE9BQU87WUFDSCxJQUFJLEVBQUUsV0FBVztZQUNqQixTQUFTLEVBQUUsR0FBRyxDQUFDLHlCQUF5QjtZQUN4QyxRQUFRLEVBQUUsSUFBSTtZQUNkLFlBQVksRUFBRSxHQUFHLENBQUMsc0JBQXNCO1NBQzNDLENBQUE7SUFDTCxDQUFDO0lBQ0QsUUFBUTtJQUNSLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDdEMsT0FBTztZQUNILElBQUksRUFBRSxPQUFPO1lBQ2IsU0FBUyxFQUFFLEdBQUcsQ0FBQyxnQkFBZ0I7WUFDL0IsUUFBUSxFQUFFLElBQUk7WUFDZCxZQUFZLEVBQUUsR0FBRyxDQUFDLGtCQUFrQjtTQUN2QyxDQUFBO0lBQ0wsQ0FBQztJQUNELFlBQVk7SUFDWixJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQzFDLE9BQU87WUFDSCxJQUFJLEVBQUUsV0FBVztZQUNqQixTQUFTLEVBQUUsR0FBRyxDQUFDLDBCQUEwQjtZQUN6QyxRQUFRLEVBQUUsR0FBRyxDQUFDLGtCQUFrQjtZQUNoQyxZQUFZLEVBQUUsR0FBRyxDQUFDLGdCQUFnQjtTQUNyQyxDQUFBO0lBQ0wsQ0FBQztJQUNELFNBQVM7SUFDVCxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQzFDLE9BQU87WUFDSCxJQUFJLEVBQUUsUUFBUTtZQUNkLFNBQVMsRUFBRSxHQUFHLENBQUMsVUFBVTtZQUN6QixRQUFRLEVBQUUsR0FBRyxDQUFDLFdBQVc7WUFDekIsWUFBWSxFQUFFLEdBQUcsQ0FBQyxTQUFTO1NBQzlCLENBQUE7SUFDTCxDQUFDO0lBQ0QsWUFBWTtJQUNaLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDMUMsT0FBTztZQUNILElBQUksRUFBRSxXQUFXO1lBQ2pCLFNBQVMsRUFBRSxHQUFHLENBQUMsbUJBQW1CO1lBQ2xDLFFBQVEsRUFBRSxHQUFHLENBQUMsZUFBZSxJQUFJLEdBQUcsQ0FBQyx1QkFBdUI7WUFDNUQsWUFBWSxFQUFFLEdBQUcsQ0FBQyxzQkFBc0I7U0FDM0MsQ0FBQTtJQUNMLENBQUM7SUFDRCw4QkFBOEI7SUFDOUIsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQ25ELE9BQU87WUFDSCxJQUFJLEVBQUUsNkJBQTZCO1lBQ25DLFNBQVMsRUFBRSxHQUFHLEdBQUcsQ0FBQyw4QkFBOEIsR0FBRyxHQUFHLENBQUMsb0JBQW9CLEVBQUU7WUFDN0UsUUFBUSxFQUFFLEdBQUcsQ0FBQyxtQkFBbUI7WUFDakMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxhQUFhO1NBQ2xDLENBQUE7SUFDTCxDQUFDO0lBQ0QsV0FBVztJQUNYLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1FBQ3ZCLE9BQU87WUFDSCxJQUFJLEVBQUUsVUFBVTtZQUNoQixTQUFTLEVBQUUsR0FBRyxHQUFHLENBQUMsWUFBWSxZQUFZLEdBQUcsQ0FBQyxxQkFBcUIsSUFBSSxHQUFHLENBQUMscUJBQXFCLFdBQVcsR0FBRyxDQUFDLGlCQUFpQixFQUFFO1lBQ2xJLFFBQVEsRUFBRSxHQUFHLENBQUMsaUJBQWlCO1lBQy9CLFlBQVksRUFBRSxHQUFHLENBQUMscUJBQXFCO1NBQzFDLENBQUE7SUFDTCxDQUFDO0lBQ0QsV0FBVztJQUNYLElBQUksR0FBRyxDQUFDLHFCQUFxQixJQUFJLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM1QyxPQUFPO1lBQ0gsSUFBSSxFQUFFLFVBQVU7WUFDaEIsU0FBUyxFQUFFLEdBQUcsR0FBRyxDQUFDLDhCQUE4QixHQUFHLEdBQUcsQ0FBQyxrQkFBa0IsMkJBQTJCLEdBQUcsQ0FBQyxhQUFhLEVBQUU7WUFDdkgsUUFBUSxFQUFFLEdBQUcsQ0FBQyxhQUFhO1lBQzNCLFlBQVksRUFBRSxHQUFHLENBQUMsYUFBYTtTQUNsQyxDQUFBO0lBQ0wsQ0FBQztJQUNELGdCQUFnQjtJQUNoQixJQUFJLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxHQUFHLENBQUMsaUNBQWlDLElBQUksR0FBRyxDQUFDLHdCQUF3QixFQUFFLENBQUM7UUFDbEcsT0FBTztZQUNILElBQUksRUFBRSxlQUFlO1lBQ3JCLFNBQVMsRUFBRSxHQUFHLENBQUMsMEJBQTBCO1lBQ3pDLFFBQVEsRUFBRSxHQUFHLENBQUMsa0JBQWtCO1lBQ2hDLFlBQVksRUFBRSxHQUFHLENBQUMsa0JBQWtCO1NBQ3ZDLENBQUE7SUFDTCxDQUFDO0lBQ0QsU0FBUztJQUNULElBQUksR0FBRyxDQUFDLGtCQUFrQixFQUFFLENBQUM7UUFDekIsT0FBTztZQUNILElBQUksRUFBRSxRQUFRO1lBQ2QsU0FBUyxFQUFFLEdBQUcsQ0FBQyxzQkFBc0I7WUFDckMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxtQkFBbUI7WUFDakMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxrQkFBa0I7U0FDdkMsQ0FBQTtJQUNMLENBQUM7SUFDRCxVQUFVO0lBQ1YsSUFBSSxHQUFHLENBQUMsT0FBTyxJQUFJLEdBQUcsQ0FBQyw2QkFBNkIsRUFBRSxDQUFDO1FBQ25ELE9BQU87WUFDSCxJQUFJLEVBQUUsU0FBUztZQUNmLFNBQVMsRUFBRSxHQUFHLENBQUMsaUJBQWlCO1lBQ2hDLFFBQVEsRUFBRSxHQUFHLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsSUFBSTtZQUNwRSxZQUFZLEVBQUUsR0FBRyxDQUFDLGtCQUFrQjtTQUN2QyxDQUFBO0lBQ0wsQ0FBQztJQUNELGVBQWU7SUFDZixJQUFJLEdBQUcsQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDLGNBQWMsSUFBSSxHQUFHLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUNwRSxPQUFPO1lBQ0gsSUFBSSxFQUFFLGNBQWM7WUFDcEIsU0FBUyxFQUFFLElBQUk7WUFDZixRQUFRLEVBQUUsR0FBRyxDQUFDLFVBQVU7WUFDeEIsWUFBWSxFQUFFLEdBQUcsQ0FBQyxRQUFRO1NBQzdCLENBQUE7SUFDTCxDQUFDO0lBQ0QsWUFBWTtJQUNaLElBQUksR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2hCLE9BQU87WUFDSCxJQUFJLEVBQUUsV0FBVztZQUNqQixTQUFTLEVBQUUsR0FBRyxDQUFDLG1CQUFtQjtZQUNsQyxRQUFRLEVBQUUsR0FBRyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxRQUFRLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJO1lBQ3RFLFlBQVksRUFBRSxHQUFHLENBQUMsc0JBQXNCO1NBQzNDLENBQUE7SUFDTCxDQUFDO0lBQ0QsVUFBVTtJQUNWLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ3RCLE9BQU87WUFDSCxJQUFJLEVBQUUsU0FBUztZQUNmLFNBQVMsRUFBRSxHQUFHLENBQUMsVUFBVTtZQUN6QixRQUFRLEVBQUUsR0FBRyxDQUFDLFNBQVM7WUFDdkIsWUFBWSxFQUFFLEdBQUcsQ0FBQyxRQUFRO1NBQzdCLENBQUE7SUFDTCxDQUFDO0lBQ0QsaUJBQWlCO0lBQ2pCLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1FBQzdCLE9BQU87WUFDSCxJQUFJLEVBQUUsZ0JBQWdCO1lBQ3RCLFNBQVMsRUFBRSxHQUFHLEdBQUcsQ0FBQyxpQkFBaUIsSUFBSSxHQUFHLENBQUMsaUJBQWlCLGlCQUFpQixHQUFHLENBQUMsYUFBYSxFQUFFO1lBQ2hHLFFBQVEsRUFBRSxHQUFHLENBQUMsZUFBZTtZQUM3QixZQUFZLEVBQUUsR0FBRyxDQUFDLGFBQWE7U0FDbEMsQ0FBQTtJQUNMLENBQUM7SUFDRCxTQUFTO0lBQ1QsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUM7UUFDdkMsT0FBTztZQUNILElBQUksRUFBRSxRQUFRO1lBQ2QsU0FBUyxFQUFFLFVBQVUsR0FBRyxDQUFDLFVBQVUsRUFBRTtZQUNyQyxRQUFRLEVBQUUsSUFBSTtZQUNkLFlBQVksRUFBRSxJQUFJO1NBQ3JCLENBQUE7SUFDTCxDQUFDO0lBQ0QsV0FBVztJQUNYLElBQUksR0FBRyxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFDdkIsT0FBTztZQUNILElBQUksRUFBRSxVQUFVO1lBQ2hCLFNBQVMsRUFBRSxJQUFJO1lBQ2YsUUFBUSxFQUFFLElBQUk7WUFDZCxZQUFZLEVBQUUsR0FBRyxDQUFDLFlBQVk7U0FDakMsQ0FBQTtJQUNMLENBQUM7SUFDRCxZQUFZO0lBQ1osSUFBSSxHQUFHLENBQUMsU0FBUyxJQUFJLEdBQUcsQ0FBQyxhQUFhLElBQUksR0FBRyxDQUFDLGtCQUFrQixJQUFJLEdBQUcsQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUNyRixPQUFPO1lBQ0gsSUFBSSxFQUFFLFdBQVc7WUFDakIsU0FBUyxFQUFFLElBQUk7WUFDZixRQUFRLEVBQUUsR0FBRyxDQUFDLGNBQWMsSUFBSSxJQUFJO1lBQ3BDLFlBQVksRUFBRSxHQUFHLENBQUMsUUFBUSxJQUFJLElBQUk7U0FDckMsQ0FBQTtJQUNMLENBQUM7SUFDRCxPQUFPO0lBQ1AsSUFBSSxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDbEIsT0FBTztZQUNILElBQUksRUFBRSxNQUFNO1lBQ1osU0FBUyxFQUFFLElBQUk7WUFDZixRQUFRLEVBQUUsR0FBRyxDQUFDLFdBQVc7WUFDekIsWUFBWSxFQUFFLEdBQUcsQ0FBQyxtQkFBbUI7U0FDeEMsQ0FBQTtJQUNMLENBQUM7SUFDRCxZQUFZO0lBQ1osSUFBSSxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDbEIsT0FBTztZQUNILElBQUksRUFBRSxXQUFXO1lBQ2pCLFNBQVMsRUFBRSxHQUFHLENBQUMsWUFBWTtZQUMzQixRQUFRLEVBQUUsR0FBRyxDQUFDLGdCQUFnQjtZQUM5QixZQUFZLEVBQUUsR0FBRyxDQUFDLFdBQVc7U0FDaEMsQ0FBQTtJQUNMLENBQUM7SUFDRCw2QkFBNkI7SUFDN0IsT0FBTyxJQUFJLENBQUE7QUFDZixDQUFDO0FBRUQsTUFBTSxDQUFDLEtBQUssVUFBVSxjQUFjO0lBQ2hDLE1BQU0sSUFBSSxHQUFnQixXQUFXLEVBQUUsQ0FBQTtJQUN2QyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ3JCLE9BQU07SUFDVixDQUFDO0lBQ0QsTUFBTSxFQUFFLE1BQU0sRUFBRSxHQUFHLE1BQU0sVUFBVSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtJQUN0RCxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUN6SCxJQUFJLFdBQVcsR0FBaUI7UUFDNUIsSUFBSSxFQUFFLEtBQUs7UUFDWCxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUc7UUFDYixTQUFTLEVBQUUsSUFBSSxDQUFDLGNBQWM7UUFDOUIsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1FBQ25CLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztRQUNiLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztRQUN6QixjQUFjLEVBQUUsSUFBSSxDQUFDLGFBQWE7UUFDbEMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1FBQ25CLFdBQVcsRUFBRSxJQUFJLENBQUMsVUFBVTtRQUM1QixjQUFjLEVBQUUsSUFBSSxDQUFDLGFBQWE7UUFDbEMsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO1FBQ2YsY0FBYyxFQUFFLElBQUksQ0FBQyxZQUFZO1FBQ2pDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxjQUFjO1FBQ3JDLFFBQVEsRUFBRSxJQUFJLENBQUMsT0FBTztRQUN0QixzQkFBc0IsRUFBRSxJQUFJLENBQUMsbUJBQW1CO1FBQ2hELE9BQU8sRUFBRSxPQUFPO0tBQ25CLENBQUE7SUFFRCxXQUFXLEdBQUcsdUJBQXVCLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDbEQsT0FBTyxXQUFXLENBQUE7QUFDdEIsQ0FBQztBQUVELE1BQU0sVUFBVSxtQkFBbUIsQ0FBQyxJQUFxQixFQUFFLFNBQWtCO0lBQ3pFLElBQUksU0FBUyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzFCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQTtJQUN4QixDQUFDO0lBRUQsSUFBSSxXQUFXLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQTtJQUM3Qix5REFBeUQ7SUFDekQsSUFBSSxPQUFPLFdBQVcsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxXQUFXLEdBQUksV0FBbUIsQ0FBQyxLQUFLLENBQUE7SUFDNUMsQ0FBQztJQUNELE9BQU8sR0FBRyxXQUFXLE1BQU0sSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFBO0FBQzNDLENBQUM7QUFFRCxNQUFNLFVBQVUsOEJBQThCLENBQUMsS0FBNkI7SUFDeEUsT0FBTyxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO0FBQ3JFLENBQUM7QUFFRCxNQUFNLFVBQVUsZ0JBQWdCLENBQUMsT0FBNkQ7SUFDMUYsSUFBSSxPQUFPLENBQUMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1FBQ25HLE9BQU8sY0FBYyxDQUFBO0lBQ3pCLENBQUM7SUFDRCxPQUFPLGNBQWMsQ0FBQTtBQUN6QixDQUFDO0FBRUQsTUFBTSxVQUFVLHFCQUFxQixDQUFDLE9BQThEO0lBQ2hHLE9BQU8sT0FBTyxJQUFJLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxLQUFLLGNBQWMsQ0FBQTtBQUNoRixDQUFDO0FBRUQsTUFBTSxVQUFVLG1CQUFtQixDQUFDLEtBQTZCO0lBQzdELE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUE7SUFFN0Isc0JBQXNCO0lBQ3RCLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxJQUFJLFFBQVEsQ0FBQyxVQUFVLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDaEcsT0FBTTtJQUNWLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBVyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQy9DLE1BQU0sVUFBVSxHQUFXLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDakQsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLENBQUMsZUFBZSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUE7SUFFdkUsSUFBSSxRQUFRLEdBQWEsRUFBRSxDQUFBO0lBRTNCLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRTtRQUNyQyxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNiLDRCQUE0QjtZQUM1QixLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEVBQUU7Z0JBQ3RDLElBQUksV0FBVyxDQUFDLFFBQVEsSUFBSSxXQUFXLENBQUMsUUFBUSxDQUFDLEVBQUUsS0FBSyxRQUFRLElBQUksV0FBVyxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsQ0FBQztvQkFDaEcsTUFBTSxjQUFjLEdBQUcsV0FBVyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxVQUFVLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO29CQUM5SixJQUFJLGNBQWMsRUFBRSxDQUFDO3dCQUNqQixRQUFRLEdBQUcsY0FBYyxDQUFBO29CQUM3QixDQUFDO2dCQUNMLENBQUM7WUFDTCxDQUFDLENBQUMsQ0FBQTtRQUNOLENBQUM7YUFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFFLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDckYsa0NBQWtDO1lBQ2xDLE1BQU0sY0FBYyxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssVUFBVSxDQUFDLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUN4SixJQUFJLGNBQWMsRUFBRSxDQUFDO2dCQUNqQixRQUFRLEdBQUcsY0FBYyxDQUFBO1lBQzdCLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUE7SUFFRixJQUFJLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNsQixPQUFPLFFBQVEsQ0FBQTtJQUNuQixDQUFDO0lBQ0QsT0FBTTtBQUNWLENBQUM7QUFFRCxNQUFNLFVBQVUsZ0JBQWdCLENBQUMsT0FBZTtJQUM1QyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDWCxPQUFPLEVBQUUsQ0FBQTtJQUNiLENBQUM7SUFDRCx1Q0FBdUM7SUFDdkMsNENBQTRDO0lBQzVDLE9BQU8sT0FBTyxDQUFDLE9BQU8sQ0FBQyw2RUFBNkUsRUFBRSxFQUFFLENBQUMsQ0FBQTtBQUM3RyxDQUFDO0FBRUQsTUFBTSxVQUFVLFNBQVMsQ0FBQyxTQUFpQjtJQUN2QyxJQUFJLFNBQVMsS0FBSyxnQkFBZ0IsSUFBSSxTQUFTLEtBQUssaUJBQWlCLEVBQUUsQ0FBQztRQUNwRSxPQUFPLGFBQWEsQ0FBQTtJQUN4QixDQUFDO1NBQU0sSUFBSSxTQUFTLEtBQUssZ0JBQWdCLElBQUksU0FBUyxLQUFLLGlCQUFpQixFQUFFLENBQUM7UUFDM0UsT0FBTyxhQUFhLENBQUE7SUFDeEIsQ0FBQztTQUFNLElBQUksU0FBUyxLQUFLLG1CQUFtQixFQUFFLENBQUM7UUFDM0MsT0FBTyxtQkFBbUIsQ0FBQTtJQUM5QixDQUFDO1NBQU0sSUFBSSxTQUFTLEtBQUssWUFBWSxFQUFFLENBQUM7UUFDcEMsT0FBTyxZQUFZLENBQUE7SUFDdkIsQ0FBQztJQUNELE9BQU8sV0FBVyxDQUFBO0FBQ3RCLENBQUM7QUFFRCw2RUFBNkU7QUFDN0UsTUFBTSxVQUFVLFlBQVksQ0FBQyxTQUFrQjtJQUMzQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDYixPQUFPLEVBQUUsQ0FBQTtJQUNiLENBQUM7SUFDRCxPQUFPLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFBO0FBQzVDLENBQUM7QUFFRCxNQUFNLFVBQVUsV0FBVyxDQUFFLFFBQWdCO0lBQ3pDLElBQUksUUFBUSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1FBQ3ZDLE9BQU8sYUFBYSxDQUFBO0lBQ3hCLENBQUM7U0FBTSxJQUFJLFFBQVEsQ0FBQyxVQUFVLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztRQUM3QyxPQUFPLFlBQVksQ0FBQTtJQUN2QixDQUFDO1NBQU0sSUFBSSxRQUFRLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7UUFDN0MsT0FBTyxZQUFZLENBQUE7SUFDdkIsQ0FBQztTQUFNLElBQUksUUFBUSxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1FBQzVDLE9BQU8sV0FBVyxDQUFBO0lBQ3RCLENBQUM7SUFDRCxPQUFPLFNBQVMsQ0FBQTtBQUNwQixDQUFDO0FBRUQsTUFBTSxVQUFVLG1CQUFtQixDQUFFLElBQTBDO0lBQzNFLE9BQU8sSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsQ0FBQTtBQUNqRSxDQUFDO0FBRUQsTUFBTSxVQUFVLGVBQWUsQ0FBQyxNQUEwQjtJQUN0RCxJQUFJLE9BQU8sTUFBTSxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksT0FBTyxNQUFNLENBQUMsR0FBRyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUNoRyxPQUFPLElBQUksQ0FBQTtJQUNmLENBQUM7SUFDRCxPQUFPLEtBQUssQ0FBQTtBQUNoQixDQUFDO0FBRUQsTUFBTSxVQUFVLG1CQUFtQixDQUFDLE1BQStDLEVBQUUsSUFBNEM7SUFDN0gsOERBQThEO0lBRTlELE1BQU0sY0FBYyxHQUFHLENBQUMsR0FBVyxFQUFZLEVBQUU7UUFDN0MsT0FBTyxHQUFHLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLENBQUE7SUFDM0MsQ0FBQyxDQUFBO0lBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztRQUN4RCxPQUFPLEtBQUssQ0FBQTtJQUNoQixDQUFDO0lBRUQsSUFBSSxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDbkMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDdEIsS0FBSyxNQUFNLFVBQVUsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDNUIsSUFBSSxDQUFFLFVBQWlDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUUsVUFBaUMsQ0FBQyxRQUFrQixDQUFDLEVBQUUsQ0FBQztvQkFDMUgsT0FBTyxLQUFLLENBQUE7Z0JBQ2hCLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDSixLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO2dCQUNyQixNQUFNLFVBQVUsR0FBSSxJQUFZLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBQ3JDLElBQUksQ0FBRSxVQUFpQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFFLFVBQWlDLENBQUMsUUFBa0IsQ0FBQyxFQUFFLENBQUM7b0JBQzFILE9BQU8sS0FBSyxDQUFBO2dCQUNoQixDQUFDO1lBQ0wsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1FBQzNCLE9BQU8sS0FBSyxDQUFBO0lBQ2hCLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNmLENBQUM7QUFFRCxNQUFNLFVBQVUseUJBQXlCLENBQUMsTUFBMEIsRUFBRSxPQUEyQjtJQUU3Riw0QkFBNEI7SUFDNUIsMEZBQTBGO0lBQzFGLE1BQU0scUJBQXFCLEdBQUc7UUFDMUIsSUFBSSxFQUFFLG1CQUFtQixDQUFDLE9BQU8sQ0FBQztRQUNsQyxHQUFHLEVBQUUsa0JBQWtCLENBQUMsT0FBTyxDQUFDO0tBQ25DLENBQUE7SUFDRCxJQUFJLGVBQWUsQ0FBQyxxQkFBNEIsQ0FBQyxFQUFFLENBQUM7UUFDaEQsT0FBTyxxQkFBcUIsQ0FBQTtJQUNoQyxDQUFDO0lBRUQsbUVBQW1FO0lBQ25FLCtEQUErRDtJQUMvRCxNQUFNLGFBQWEsR0FBRztRQUNsQixJQUFJLEVBQUUsb0JBQW9CLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQztRQUMzQyxHQUFHLEVBQUUsbUJBQW1CLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQztLQUM1QyxDQUFBO0lBQ0QsSUFBSSxlQUFlLENBQUMsYUFBb0IsQ0FBQyxFQUFFLENBQUM7UUFDeEMsT0FBTyxhQUFhLENBQUE7SUFDeEIsQ0FBQztBQUVMLENBQUM7QUFFRCxNQUFNLFVBQVUsdUJBQXVCLENBQUMsTUFBMEIsRUFBRSxpQkFBMkIsRUFBRSxJQUE0QztJQUN6SSxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsSUFBSSxpQkFBaUIsS0FBSyxLQUFLLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ2hKLE9BQU8sS0FBSyxDQUFBO0lBQ2hCLENBQUM7SUFDRCxPQUFPLElBQUksQ0FBQTtBQUNmLENBQUM7QUFFRCxNQUFNLENBQUMsS0FBSyxVQUFVLGtCQUFrQixDQUFFLFFBQWdCLEVBQUUsSUFBWSxFQUFFLElBQWtCO0lBQ3hGLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixDQUFDLEVBQUUsQ0FBQztRQUM1QyxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7SUFDOUMsQ0FBQztJQUVELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtJQUN0RCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDWixNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUE7SUFDbkQsQ0FBQztJQUVELElBQUksQ0FBQztRQUNELE1BQU0sR0FBRyxHQUFHLEdBQUcsYUFBYSxJQUFJLFFBQVEsRUFBRSxDQUFBO1FBQzFDLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDakMsS0FBSyxFQUFFLHNCQUFzQixDQUFDLEtBQUs7WUFDbkMsT0FBTyxFQUFFO2dCQUNMLEdBQUcsc0JBQXNCLENBQUMsT0FBTztnQkFDakMsZUFBZSxFQUFFLFVBQVUsUUFBUSxFQUFFO2FBQ3hDO1lBQ0QsSUFBSSxFQUFFLElBQUk7WUFDVixLQUFLLEVBQUU7Z0JBQ0gsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQzthQUMzQjtTQUNKLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNULFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLHVCQUF1QixJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUNqRixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLFlBQVksQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLGtCQUFrQixJQUFJLG9DQUFvQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQzdGLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLEdBQUcsS0FBSyxDQUFDLENBQUE7SUFDcEQsQ0FBQztBQUNMLENBQUM7QUFFRCxNQUFNLFVBQVUsb0JBQW9CLENBQUMsT0FBZ0QsRUFBRSxNQUEwQjtJQUM3RyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUNwQyxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLENBQUE7SUFDNUMsQ0FBQztJQUNELElBQUksT0FBTyxDQUFDLHdCQUF3QixJQUFJLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM1RSxPQUFPLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLENBQUE7SUFDaEQsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQTtBQUN0QixDQUFDO0FBRUQsTUFBTSxVQUFVLG1CQUFtQixDQUFDLE9BQWdELEVBQUUsTUFBMEI7SUFDNUcsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFDdEMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixDQUFBO0lBQzlDLENBQUM7SUFDRCxJQUFJLE9BQU8sQ0FBQyx3QkFBd0IsSUFBSSxPQUFPLENBQUMsd0JBQXdCLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDM0UsT0FBTyxPQUFPLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFBO0lBQy9DLENBQUM7SUFDRCxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUE7QUFDckIsQ0FBQztBQUVELE1BQU0sVUFBVSx1QkFBdUIsQ0FBQyxPQUFnRCxFQUFFLGlCQUEwQjtJQUNoSCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLEVBQUUsQ0FBQztRQUM5QyxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLENBQUE7SUFDdEQsQ0FBQztJQUNELElBQUksT0FBTyxDQUFDLHdCQUF3QixJQUFJLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNuRixPQUFPLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxXQUFXLENBQUE7SUFDdkQsQ0FBQztJQUNELE9BQU8saUJBQWlCLENBQUE7QUFDNUIsQ0FBQztBQUVELE1BQU0sVUFBVSxxQkFBcUIsQ0FBQyxPQUFnRCxFQUFFLGVBQXdCO0lBQzVHLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsRUFBRSxDQUFDO1FBQzVDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsQ0FBQTtJQUNwRCxDQUFDO0lBQ0QsSUFBSSxPQUFPLENBQUMsd0JBQXdCLElBQUksT0FBTyxDQUFDLHdCQUF3QixDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2pGLE9BQU8sT0FBTyxDQUFDLHdCQUF3QixDQUFDLFNBQVMsQ0FBQTtJQUNyRCxDQUFDO0lBQ0QsT0FBTyxlQUFlLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUE7QUFDeEUsQ0FBQztBQUVELE1BQU0sVUFBVSx5QkFBeUIsQ0FBQyxPQUFnRCxFQUFFLGNBQXVCO0lBQy9HLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO1FBQzNDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDOUQsQ0FBQztJQUNELElBQUksT0FBTyxDQUFDLHdCQUF3QixJQUFJLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNoRixPQUFPLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLENBQUE7SUFDcEQsQ0FBQztJQUNELElBQUksY0FBYyxFQUFFLENBQUM7UUFDakIsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQzNCLENBQUM7SUFDRCxPQUFPLEVBQUUsQ0FBQTtBQUNiLENBQUM7QUFFRCxNQUFNLFVBQVUsbUJBQW1CLENBQUMsTUFBMEI7SUFDMUQsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFDcEMsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixDQUFBO0lBQzVDLENBQUM7SUFDRCxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUE7QUFDdEIsQ0FBQztBQUVELE1BQU0sVUFBVSxrQkFBa0IsQ0FBQyxNQUEwQjtJQUN6RCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztRQUN0QyxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLENBQUE7SUFDOUMsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQTtBQUNyQixDQUFDO0FBRUQsTUFBTSxVQUFVLFdBQVcsQ0FBQyxLQUFVO0lBQ2xDLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDLENBQUE7SUFDakQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM1QixHQUFHLEdBQUcsR0FBRyxJQUFJLEtBQUssS0FBSyxFQUFFLENBQUE7SUFDN0IsQ0FBQztJQUNELE9BQU8sR0FBRyxDQUFBO0FBQ2QsQ0FBQztBQUVELE1BQU0sVUFBVSxNQUFNLENBQUMsS0FBVztJQUM5QixPQUFPLENBQUMsS0FBSyxHQUFHLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxLQUFLLE1BQU0sQ0FBQTtBQUNoRCxDQUFDO0FBRUQsTUFBTSxVQUFVLE9BQU8sQ0FBQyxLQUFXO0lBQy9CLE9BQU8sQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLEtBQUssT0FBTyxDQUFBO0FBQ2pELENBQUM7QUFFRCxNQUFNLFVBQVUscUJBQXFCLENBQUMsSUFBWSxFQUFFLFNBQWtCO0lBQ2xFLElBQUksU0FBUyxLQUFLLE9BQU8sSUFBSSxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksSUFBSSxLQUFLLE9BQU8sSUFBSSxJQUFJLEtBQUssWUFBWSxJQUFJLElBQUksS0FBSyxXQUFXLENBQUMsRUFBRSxDQUFDO1FBQ3BILE9BQU8sSUFBSSxDQUFBO0lBQ2YsQ0FBQztJQUVELElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxDQUFDO1FBQzNCLE9BQU8sSUFBSSxDQUFBO0lBQ2YsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFBO0FBQ2hCLENBQUM7QUFFRCxNQUFNLENBQUMsTUFBTSxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQyxHQUFHLEVBQUU7SUFDbEQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLFVBQVUsQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUUzQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQTRCLEVBQUUsRUFBRTtRQUNoRSxNQUFNLFVBQVUsR0FBSSxPQUFPLENBQUMsTUFBTSxDQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRXpELDJDQUEyQztRQUMzQyxzQ0FBc0M7UUFDdEMsSUFBSSxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxVQUFVO2VBQ2xDLE1BQU0sS0FBSyxTQUFTLEVBQ3pCLENBQUM7WUFDRSxPQUFlLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQWUsRUFBRSxFQUFFO2dCQUM5QyxVQUFVLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztnQkFDbkIsZ0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQTtZQUM5QyxDQUFDLENBQUE7UUFDTCxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUE7QUFDTixDQUFDLENBQUMsQ0FBQTtBQUVGLE1BQU0sVUFBVSxnQkFBZ0IsQ0FBQyxLQUFtQjtJQUNoRCxNQUFNLEtBQUssR0FBSSxLQUFlLENBQUMsS0FBSyxDQUFBO0lBQ3BDLE1BQU0sT0FBTyxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFBO0lBQ2pFLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUVqRSxPQUFPO1FBQ0gsT0FBTyxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3JDLGNBQWMsRUFBRSxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDcEQsWUFBWSxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJO0tBQ3BILENBQUE7QUFDTCxDQUFDO0FBRUQsTUFBTSxVQUFVLGNBQWMsQ0FBQyxLQUFhLEVBQUUsbUJBQTJCO0lBQ3JFLElBQUksQ0FBQztRQUNELE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLE1BQU0sQ0FBQTtRQUVyRSxNQUFNLGNBQWMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3pDLE1BQU0sbUJBQW1CLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQTtRQUNqRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixHQUFHLG1CQUFtQixHQUFHLGlCQUFpQixDQUFDLENBQUE7UUFDekYsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDZixNQUFNLGVBQWUsR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxRQUFRLENBQUMsQ0FBQyxRQUFRLEVBQUUsR0FBRyx1QkFBdUIsQ0FBQTtZQUNqRyxPQUFPLGVBQWUsQ0FBQTtRQUMxQixDQUFDO0lBQ0wsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixZQUFZLENBQUMsS0FBSyxDQUFDLDZEQUE2RCxLQUFLLEVBQUUsQ0FBQyxDQUFBO0lBQzVGLENBQUM7SUFDRCxPQUFPLEtBQUssQ0FBQTtBQUNoQixDQUFDO0FBRUQsTUFBTSxVQUFVLDBCQUEwQixDQUFDLFFBQXFCO0lBQzVELElBQUksQ0FBQztRQUNELE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFBO1FBRXBELE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQTtJQUN4QixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLFlBQVksQ0FBQyxLQUFLLENBQUMsK0RBQStELEtBQUssRUFBRSxDQUFDLENBQUE7SUFDOUYsQ0FBQztJQUVELE9BQU8sQ0FBQyxDQUFDLENBQUE7QUFDYixDQUFDO0FBRUQsTUFBTSxVQUFVLHVCQUF1QixDQUFDLFdBQXdCO0lBQzVELE1BQU0sc0JBQXNCLEdBQUcsMEJBQTBCLENBQUMsV0FBVyxDQUFDLENBQUE7SUFFdEUsSUFBSSxzQkFBc0IsSUFBSSxzQkFBc0IsR0FBRywrQkFBK0IsRUFBRSxDQUFDO1FBQ3JGLE1BQU0sWUFBWSxHQUFHLHNCQUFzQixHQUFHLCtCQUErQixDQUFBO1FBQzdFLE1BQU0sc0JBQXNCLEdBQUcsY0FBYyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFDdkYsV0FBVyxDQUFDLGNBQWMsR0FBRyxzQkFBc0IsQ0FBQTtRQUNuRCxZQUFZLENBQUMsSUFBSSxDQUFDLHFFQUFzRSwwQkFBMEIsQ0FBQyxXQUFXLENBQUMsR0FBRSxJQUFLLEtBQUssQ0FBQyxDQUFBO0lBQ2hKLENBQUM7SUFFRCxPQUFPLFdBQVcsQ0FBQTtBQUN0QixDQUFDO0FBRUQsTUFBTSxDQUFDLE1BQU0sS0FBSyxHQUFHLENBQUMsRUFBRSxHQUFHLEdBQUcsRUFBRSxFQUFFLENBQUMsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQTtBQUVwRixNQUFNLENBQUMsS0FBSyxVQUFVLFVBQVUsQ0FBQyxJQUF3QixFQUFFLEdBQXVCLEVBQUUsZUFBdUI7SUFDdkcsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2hCLFlBQVksQ0FBQyxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQTtRQUNqRSxPQUFNO0lBQ1YsQ0FBQztJQUNELE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDaEUsTUFBTSxhQUFhLEdBQUcsbUJBQW1CLENBQUE7SUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ3pDLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7SUFFcEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxRQUFRLEVBQUUsQ0FBQTtJQUMvQixRQUFRLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxJQUFJLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQTtJQUN2RCxRQUFRLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLGVBQWUsQ0FBQyxDQUFBO0lBRW5ELE1BQU0sY0FBYyxHQUFHO1FBQ25CLElBQUksRUFBRSxRQUFRO1FBQ2QsUUFBUSxFQUFFLElBQUk7UUFDZCxRQUFRLEVBQUUsR0FBRztLQUNoQixDQUFBO0lBRUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxXQUFXLENBQzlCLE1BQU0sRUFBRSxvQkFBb0IsRUFBRSxjQUFjLEVBQUUsYUFBYSxDQUM5RCxDQUFBO0lBRUQsT0FBTyxRQUFRLENBQUE7QUFDbkIsQ0FBQztBQUVELE1BQU0sQ0FBQyxNQUFNLFFBQVEsR0FBRyxDQUFDLE1BQVcsRUFBRSxFQUFFO0lBQ3BDLE9BQU8sTUFBTSxLQUFLLElBQUksSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0FBQ2xGLENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLGVBQWUsR0FBRyxDQUFDLE9BQVksRUFBRSxPQUFZLEVBQUUsRUFBRTtJQUMxRCxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ3hDLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDeEMsSUFBSSxXQUFXLENBQUMsTUFBTSxLQUFLLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUM1QyxPQUFPLEtBQUssQ0FBQTtJQUNoQixDQUFDO0lBQ0QsS0FBSyxNQUFNLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUM1QixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDM0IsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQzNCLE1BQU0sZ0JBQWdCLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUM3RCxJQUFJLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLGdCQUFnQixJQUFJLE1BQU0sS0FBSyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQ3JHLE9BQU8sS0FBSyxDQUFBO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0lBQ0QsT0FBTyxJQUFJLENBQUE7QUFDZixDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxrQkFBa0IsR0FBRyxnQkFBZ0IsQ0FBQyxTQUFTLGtCQUFrQixDQUFDLElBQThCO0lBQ3pHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNSLE9BQU8sU0FBUyxDQUFBO0lBQ3BCLENBQUM7SUFDRCxNQUFNLGFBQWEsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtJQUNoRCxNQUFNLElBQUksR0FBRyxDQUFDLGlCQUFpQixFQUFFLGtCQUFrQixFQUFFLFdBQVcsRUFBRSxZQUFZLENBQUMsQ0FBQTtJQUUvRSxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3JCLElBQUksYUFBYSxJQUFJLGFBQWEsRUFBRSxDQUFDLEdBQWtELENBQUMsRUFBRSxDQUFDO1lBQ3ZGLE9BQU8sTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFDLEdBQWtELENBQUMsQ0FBQyxDQUFBO1FBQ3RGLENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxHQUFxQyxDQUFDLEVBQUUsQ0FBQztZQUNyRCxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBcUMsQ0FBQyxDQUFDLENBQUE7UUFDOUQsQ0FBQztJQUNMLENBQUM7SUFDRCxPQUFPLFNBQVMsQ0FBQTtBQUNwQixDQUFDLENBQUMsQ0FBQTtBQUVGLE1BQU0sQ0FBQyxNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQW1CLEVBQUUsRUFBRTtJQUNqRCxPQUFPLENBQ0gsVUFBVTtRQUNWLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUM7UUFDcEMsVUFBVSxDQUFDLFdBQVcsS0FBSyxNQUFNLENBQ3BDLENBQUE7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLENBQUMsTUFBTSxjQUFjLEdBQUcsQ0FBQyxHQUFZLEVBQUUsRUFBRTtJQUMzQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDUCxPQUFPLFNBQVMsQ0FBQTtJQUNwQixDQUFDO0lBQ0QsSUFBSSxPQUFPLEdBQUcsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUMxQixPQUFRLEdBQUcsQ0FBQSxDQUFDLGdDQUFnQztJQUNoRCxDQUFDO1NBQU0sSUFBSSxHQUFHLFlBQVksS0FBSyxFQUFFLENBQUM7UUFDOUIsT0FBTyxHQUFHLENBQUMsT0FBTyxDQUFBLENBQUMsK0JBQStCO0lBQ3RELENBQUM7QUFDTCxDQUFDLENBQUE7QUFFRCxNQUFNLFVBQVUsWUFBWSxDQUFDLE9BQThEO0lBQ3ZGLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FBQTtBQUN2QyxDQUFDO0FBRUQsTUFBTSxVQUFVLHVCQUF1QixDQUFDLE9BQThELEVBQUUsYUFBa0M7SUFDdEksT0FBTyxhQUFhO1FBQ2hCLENBQUMsQ0FBQyxjQUFjO1FBQ2hCLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtBQUM3RCxDQUFDO0FBRUQsTUFBTSxDQUFDLE1BQU0sY0FBYyxHQUFHLENBQUMsR0FBdUIsRUFBVyxFQUFFO0lBQy9ELElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDNUIsT0FBTyxLQUFLLENBQUE7SUFDaEIsQ0FBQztJQUNELE1BQU0sd0JBQXdCLEdBQUcsR0FBRyxDQUFDLFlBQXFELENBQUE7SUFDMUYsT0FBTyx3QkFBd0IsQ0FBQyxXQUFXLEtBQUssU0FBUyxDQUFBO0FBQzdELENBQUMsQ0FBQTtBQUVELE1BQU0sQ0FBQyxNQUFNLHFCQUFxQixHQUFHLENBQUMsSUFBMkMsRUFBVyxFQUFFO0lBRTFGLDRCQUE0QjtJQUM1QixNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBRXJDLDZFQUE2RTtJQUM3RSxPQUFPLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7QUFDakUsQ0FBQyxDQUFBO0FBUUQsTUFBTSxDQUFDLEtBQUssVUFBVSxPQUFPLENBQ3pCLEdBQVcsRUFDWCxNQUEyQixFQUMzQixPQUErQixFQUMvQixVQUFrQixFQUNsQixTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRTtJQUV0QixNQUFNLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFBO0lBQ2hELFlBQVksQ0FBQyxLQUFLLENBQUMscUJBQXFCLE1BQU0sQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFBO0lBRTNELElBQUksQ0FBQztRQUNELE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxDQUFDLEdBQUcsRUFBRTtZQUM1QixZQUFZLEVBQUUsTUFBTTtZQUNwQixPQUFPO1NBQ1YsQ0FBQyxDQUFBO1FBRUYsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUMsT0FBTztZQUNILElBQUksRUFBRSxZQUFZO1lBQ2xCLE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTztZQUN6QixPQUFPLEVBQUUsb0JBQW9CO1NBQ2hDLENBQUE7SUFDTCxDQUFDO0lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztRQUNsQixJQUFJLEtBQUssQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEtBQUssR0FBRyxFQUFFLENBQUM7WUFDdEQsTUFBTSxZQUFZLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLGNBQXdCLEVBQUUsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFBO1lBQ3pGLFlBQVksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLFlBQVksRUFBRSxDQUFDLENBQUE7WUFFbEQsSUFBSSxLQUFLLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDdEIsWUFBWSxDQUFDLElBQUksQ0FBQyw2REFBNkQsQ0FBQyxDQUFBO2dCQUNoRixPQUFPO29CQUNILElBQUksRUFBRSxFQUFFO29CQUNSLE9BQU8sRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU87b0JBQy9CLE9BQU8sRUFBRSxxREFBcUQ7aUJBQ2pFLENBQUE7WUFDTCxDQUFDO1lBRUQsTUFBTSxXQUFXLEdBQUcsWUFBWSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQTtZQUM3QyxZQUFZLENBQUMsS0FBSyxDQUNkLGVBQWUsV0FBVyxpQkFBaUIsWUFBWSxlQUFlLFVBQVUsRUFBRSxDQUNyRixDQUFBO1lBRUQsa0RBQWtEO1lBQ2xELElBQUksWUFBWSxHQUFHLFVBQVUsRUFBRSxDQUFDO2dCQUM1QixZQUFZLENBQUMsSUFBSSxDQUFDLDBDQUEwQyxDQUFDLENBQUE7Z0JBQzdELE9BQU87b0JBQ0gsSUFBSSxFQUFFLEVBQUU7b0JBQ1IsT0FBTyxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTztvQkFDL0IsT0FBTyxFQUFFLDBDQUEwQztpQkFDdEQsQ0FBQTtZQUNMLENBQUM7WUFFRCxZQUFZLENBQUMsS0FBSyxDQUFDLG9CQUFvQixXQUFXLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxDQUFBO1lBRTVFLDZDQUE2QztZQUM3QyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUE7WUFDaEUsT0FBTyxPQUFPLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBQyxDQUFBO1FBQy9ELENBQUM7YUFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUN4QixNQUFNO2dCQUNGLElBQUksRUFBRSxFQUFFO2dCQUNSLE9BQU8sRUFBRSxFQUFFO2dCQUNYLE9BQU8sRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTthQUMzRixDQUFBO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDSixZQUFZLENBQUMsS0FBSyxDQUFDLDhCQUE4QixLQUFLLEVBQUUsQ0FBQyxDQUFBO1lBQ3pELE9BQU8sRUFBRSxJQUFJLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLDRCQUE0QixFQUFFLENBQUE7UUFDM0UsQ0FBQztJQUNMLENBQUM7QUFDTCxDQUFDIn0=