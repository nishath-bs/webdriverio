import got from 'got';
import PerformanceTester from './performance-tester.js';
import { getBrowserDescription, getBrowserCapabilities, isBrowserstackCapability, getParentSuiteName, isBrowserstackSession, patchConsoleLogs, shouldAddServiceVersion, isTrue } from './util.js';
import InsightsHandler from './insights-handler.js';
import TestReporter from './reporter.js';
import { DEFAULT_OPTIONS, PERF_MEASUREMENT_ENV } from './constants.js';
import CrashReporter from './crash-reporter.js';
import AccessibilityHandler from './accessibility-handler.js';
import { BStackLogger } from './bstackLogger.js';
import PercyHandler from './Percy/Percy-Handler.js';
import Listener from './testOps/listener.js';
import { saveWorkerData } from './data-store.js';
import UsageStats from './testOps/usageStats.js';
import { shouldProcessEventForTesthub } from './testHub/utils.js';
import AiHandler from './ai-handler.js';
export default class BrowserstackService {
    _caps;
    _config;
    _sessionBaseUrl = 'https://api.browserstack.com/automate/sessions';
    _failReasons = [];
    _scenariosThatRan = [];
    _failureStatuses = ['failed', 'ambiguous', 'undefined', 'unknown'];
    _browser;
    _suiteTitle;
    _suiteFile;
    _fullTitle;
    _options;
    _specsRan = false;
    _observability;
    _currentTest;
    _insightsHandler;
    _accessibility;
    _accessibilityHandler;
    _percy;
    _percyCaptureMode = undefined;
    _percyHandler;
    _turboScale;
    constructor(options, _caps, _config) {
        this._caps = _caps;
        this._config = _config;
        this._options = { ...DEFAULT_OPTIONS, ...options };
        // added to maintain backward compatibility with webdriverIO v5
        this._config || (this._config = this._options);
        this._observability = this._options.testObservability;
        this._accessibility = this._options.accessibility;
        this._percy = isTrue(process.env.BROWSERSTACK_PERCY);
        this._percyCaptureMode = process.env.BROWSERSTACK_PERCY_CAPTURE_MODE;
        this._turboScale = this._options.turboScale;
        if (shouldProcessEventForTesthub('')) {
            this._config.reporters?.push(TestReporter);
            if (process.env[PERF_MEASUREMENT_ENV]) {
                PerformanceTester.startMonitoring('performance-report-service.csv');
            }
        }
        if (process.env.BROWSERSTACK_TURBOSCALE) {
            this._turboScale = process.env.BROWSERSTACK_TURBOSCALE === 'true';
        }
        process.env.BROWSERSTACK_TURBOSCALE_INTERNAL = String(this._turboScale);
        // Cucumber specific
        const strict = Boolean(this._config.cucumberOpts && this._config.cucumberOpts.strict);
        // See https://github.com/cucumber/cucumber-js/blob/master/src/runtime/index.ts#L136
        if (strict) {
            this._failureStatuses.push('pending');
        }
        if (process.env.WDIO_WORKER_ID === process.env.BEST_PLATFORM_CID) {
            process.env.PERCY_SNAPSHOT = 'true';
        }
    }
    _updateCaps(fn) {
        const multiRemoteCap = this._caps;
        if (multiRemoteCap.capabilities) {
            return Object.entries(multiRemoteCap).forEach(([, caps]) => fn(caps.capabilities));
        }
        return fn(this._caps);
    }
    beforeSession(config) {
        // if no user and key is specified even though a browserstack service was
        // provided set user and key with values so that the session request
        // will fail
        const testObservabilityOptions = this._options.testObservabilityOptions;
        if (!config.user && !(testObservabilityOptions && testObservabilityOptions.user)) {
            config.user = 'NotSetUser';
        }
        if (!config.key && !(testObservabilityOptions && testObservabilityOptions.key)) {
            config.key = 'NotSetKey';
        }
        this._config.user = config.user;
        this._config.key = config.key;
    }
    async before(caps, specs, browser) {
        // added to maintain backward compatibility with webdriverIO v5
        this._browser = browser ? browser : globalThis.browser;
        // Healing Support:
        if (!shouldAddServiceVersion(this._config, this._options.testObservability, caps)) {
            try {
                await AiHandler.selfHeal(this._options, caps, this._browser);
            }
            catch (err) {
                if (this._options.selfHeal === true) {
                    BStackLogger.warn(`Error while setting up self-healing: ${err}. Disabling healing for this session.`);
                }
            }
        }
        // Ensure capabilities are not null in case of multiremote
        if (this._isAppAutomate()) {
            this._sessionBaseUrl = 'https://api-cloud.browserstack.com/app-automate/sessions';
        }
        if (this._turboScale) {
            this._sessionBaseUrl = 'https://api.browserstack.com/automate-turboscale/v1/sessions';
        }
        this._scenariosThatRan = [];
        if (this._browser) {
            try {
                const sessionId = this._browser.sessionId;
                if (isBrowserstackSession(this._browser)) {
                    try {
                        this._accessibilityHandler = new AccessibilityHandler(this._browser, this._caps, this._isAppAutomate(), this._config.framework, this._accessibility, this._options.accessibilityOptions);
                        await this._accessibilityHandler.before(sessionId);
                        Listener.setAccessibilityOptions(this._options.accessibilityOptions);
                    }
                    catch (err) {
                        BStackLogger.error(`[Accessibility Test Run] Error in service class before function: ${err}`);
                    }
                }
                if (shouldProcessEventForTesthub('')) {
                    patchConsoleLogs();
                    this._insightsHandler = new InsightsHandler(this._browser, this._config.framework, this._caps, this._options);
                    await this._insightsHandler.before();
                }
                /**
                 * register command event
                 */
                this._browser.on('command', async (command) => {
                    if (shouldProcessEventForTesthub('')) {
                        this._insightsHandler?.browserCommand('client:beforeCommand', Object.assign(command, { sessionId }), this._currentTest);
                    }
                    await this._percyHandler?.browserBeforeCommand(Object.assign(command, { sessionId }));
                });
                /**
                 * register result event
                 */
                this._browser.on('result', (result) => {
                    if (shouldProcessEventForTesthub('')) {
                        this._insightsHandler?.browserCommand('client:afterCommand', Object.assign(result, { sessionId }), this._currentTest);
                    }
                    this._percyHandler?.browserAfterCommand(Object.assign(result, { sessionId }));
                });
            }
            catch (err) {
                BStackLogger.error(`Error in service class before function: ${err}`);
                if (shouldProcessEventForTesthub('')) {
                    CrashReporter.uploadCrashReport(`Error in service class before function: ${err}`, err && err.stack);
                }
            }
            if (this._percy) {
                this._percyHandler = new PercyHandler(this._percyCaptureMode, this._browser, this._caps, this._isAppAutomate(), this._config.framework);
                this._percyHandler.before();
            }
        }
        return await this._printSessionURL();
    }
    /**
     * Set the default job name at the suite level to make sure we account
     * for the cases where there is a long running `before` function for a
     * suite or one that can fail.
     * Don't do this for Jasmine because `suite.title` is `Jasmine__TopLevel__Suite`
     * and `suite.fullTitle` is `undefined`, so no alternative to use for the job name.
     */
    async beforeSuite(suite) {
        this._suiteTitle = suite.title;
        this._insightsHandler?.setSuiteFile(suite.file);
        this._accessibilityHandler?.setSuiteFile(suite.file);
        if (suite.title && suite.title !== 'Jasmine__TopLevel__Suite') {
            await this._setSessionName(suite.title);
        }
    }
    async beforeHook(test, context) {
        if (this._config.framework !== 'cucumber') {
            this._currentTest = test; // not update currentTest when this is called for cucumber step
        }
        await this._insightsHandler?.beforeHook(test, context);
    }
    async afterHook(test, context, result) {
        await this._insightsHandler?.afterHook(test, result);
    }
    async beforeTest(test) {
        this._currentTest = test;
        let suiteTitle = this._suiteTitle;
        if (test.fullName) {
            // For Jasmine, `suite.title` is `Jasmine__TopLevel__Suite`.
            // This tweak allows us to set the real suite name.
            const testSuiteName = test.fullName.slice(0, test.fullName.indexOf(test.description || '') - 1);
            if (this._suiteTitle === 'Jasmine__TopLevel__Suite') {
                suiteTitle = testSuiteName;
            }
            else if (this._suiteTitle) {
                suiteTitle = getParentSuiteName(this._suiteTitle, testSuiteName);
            }
        }
        await this._setSessionName(suiteTitle, test);
        await this._setAnnotation(`Test: ${test.fullName ?? test.title}`);
        await this._accessibilityHandler?.beforeTest(suiteTitle, test);
        await this._insightsHandler?.beforeTest(test);
    }
    async afterTest(test, context, results) {
        this._specsRan = true;
        const { error, passed } = results;
        if (!passed) {
            this._failReasons.push((error && error.message) || 'Unknown Error');
        }
        await this._accessibilityHandler?.afterTest(this._suiteTitle, test);
        await this._insightsHandler?.afterTest(test, results);
        await this._percyHandler?.afterTest();
    }
    async after(result) {
        const { preferScenarioName, setSessionName, setSessionStatus } = this._options;
        // For Cucumber: Checks scenarios that ran (i.e. not skipped) on the session
        // Only 1 Scenario ran and option enabled => Redefine session name to Scenario's name
        if (preferScenarioName && this._scenariosThatRan.length === 1) {
            this._fullTitle = this._scenariosThatRan.pop();
        }
        if (setSessionStatus) {
            const hasReasons = this._failReasons.length > 0;
            await this._updateJob({
                status: result === 0 && this._specsRan ? 'passed' : 'failed',
                ...(setSessionName ? { name: this._fullTitle } : {}),
                ...(result === 0 && this._specsRan ?
                    {} : hasReasons ? { reason: this._failReasons.join('\n') } : {})
            });
        }
        await Listener.getInstance().onWorkerEnd();
        await this._percyHandler?.teardown();
        this.saveWorkerData();
        if (process.env[PERF_MEASUREMENT_ENV]) {
            await PerformanceTester.stopAndGenerate('performance-service.html');
            PerformanceTester.calculateTimes([
                'onRunnerStart', 'onSuiteStart', 'onSuiteEnd',
                'onTestStart', 'onTestEnd', 'onTestSkip', 'before',
                'beforeHook', 'afterHook', 'beforeTest', 'afterTest',
                'uploadPending', 'teardown', 'browserCommand'
            ]);
        }
    }
    /**
     * For CucumberJS
     */
    async beforeFeature(uri, feature) {
        this._suiteTitle = feature.name;
        await this._setSessionName(feature.name);
        await this._setAnnotation(`Feature: ${feature.name}`);
        await this._insightsHandler?.beforeFeature(uri, feature);
    }
    /**
     * Runs before a Cucumber Scenario.
     * @param world world object containing information on pickle and test step
     */
    async beforeScenario(world) {
        this._currentTest = world;
        await this._accessibilityHandler?.beforeScenario(world);
        await this._insightsHandler?.beforeScenario(world);
        const scenarioName = world.pickle.name || 'unknown scenario';
        await this._setAnnotation(`Scenario: ${scenarioName}`);
    }
    async afterScenario(world) {
        this._specsRan = true;
        const status = world.result?.status.toLowerCase();
        if (status !== 'skipped') {
            this._scenariosThatRan.push(world.pickle.name || 'unknown pickle name');
        }
        if (status && this._failureStatuses.includes(status)) {
            const exception = ((world.result && world.result.message) ||
                (status === 'pending'
                    ? `Some steps/hooks are pending for scenario "${world.pickle.name}"`
                    : 'Unknown Error'));
            this._failReasons.push(exception);
        }
        await this._accessibilityHandler?.afterScenario(world);
        await this._insightsHandler?.afterScenario(world);
        await this._percyHandler?.afterScenario();
    }
    async beforeStep(step, scenario) {
        await this._insightsHandler?.beforeStep(step, scenario);
        await this._setAnnotation(`Step: ${step.keyword}${step.text}`);
    }
    async afterStep(step, scenario, result) {
        await this._insightsHandler?.afterStep(step, scenario, result);
    }
    async onReload(oldSessionId, newSessionId) {
        if (!this._browser) {
            return Promise.resolve();
        }
        const { setSessionName, setSessionStatus } = this._options;
        const hasReasons = this._failReasons.length > 0;
        const status = hasReasons ? 'failed' : 'passed';
        if (!this._browser.isMultiremote) {
            BStackLogger.info(`Update (reloaded) job with sessionId ${oldSessionId}, ${status}`);
        }
        else {
            const browserName = this._browser.instances.filter((browserName) => this._browser && this._browser.getInstance(browserName).sessionId === newSessionId)[0];
            BStackLogger.info(`Update (reloaded) multiremote job for browser "${browserName}" and sessionId ${oldSessionId}, ${status}`);
        }
        if (setSessionStatus) {
            await this._update(oldSessionId, {
                status,
                ...(setSessionName ? { name: this._fullTitle } : {}),
                ...(hasReasons ? { reason: this._failReasons.join('\n') } : {})
            });
        }
        BStackLogger.warn(`Session Reloaded: Old Session Id: ${oldSessionId}, New Session Id: ${newSessionId}`);
        await this._insightsHandler?.sendCBTInfo();
        this._scenariosThatRan = [];
        delete this._fullTitle;
        delete this._suiteFile;
        this._failReasons = [];
        await this._printSessionURL();
    }
    _isAppAutomate() {
        const browserDesiredCapabilities = (this._browser?.capabilities ?? {});
        const desiredCapabilities = (this._caps ?? {});
        return !!browserDesiredCapabilities['appium:app'] || !!desiredCapabilities['appium:app'] || !!(desiredCapabilities['appium:options']?.app);
    }
    _updateJob(requestBody) {
        return this._multiRemoteAction((sessionId, browserName) => {
            BStackLogger.info(browserName
                ? `Update multiremote job for browser "${browserName}" and sessionId ${sessionId}`
                : `Update job with sessionId ${sessionId}`);
            return this._update(sessionId, requestBody);
        });
    }
    _multiRemoteAction(action) {
        if (!this._browser) {
            return Promise.resolve();
        }
        if (!this._browser.isMultiremote) {
            return action(this._browser.sessionId);
        }
        const multiremotebrowser = this._browser;
        return Promise.all(multiremotebrowser.instances
            .filter((browserName) => {
            const cap = getBrowserCapabilities(multiremotebrowser, this._caps, browserName);
            return isBrowserstackCapability(cap);
        })
            .map((browserName) => (action(multiremotebrowser.getInstance(browserName).sessionId, browserName))));
    }
    _update(sessionId, requestBody) {
        if (!isBrowserstackSession(this._browser)) {
            return Promise.resolve();
        }
        const sessionUrl = `${this._sessionBaseUrl}/${sessionId}.json`;
        BStackLogger.debug(`Updating Browserstack session at ${sessionUrl} with request body: `, requestBody);
        if (this._turboScale) {
            return got.patch(sessionUrl, {
                json: requestBody,
                username: this._config.user,
                password: this._config.key
            });
        }
        return got.put(sessionUrl, {
            json: requestBody,
            username: this._config.user,
            password: this._config.key
        });
    }
    async _printSessionURL() {
        if (!this._browser || !isBrowserstackSession(this._browser)) {
            return Promise.resolve();
        }
        await this._multiRemoteAction(async (sessionId, browserName) => {
            const sessionUrl = `${this._sessionBaseUrl}/${sessionId}.json`;
            BStackLogger.debug(`Requesting Browserstack session URL at ${sessionUrl}`);
            let browserUrl;
            const reqOpts = {
                username: this._config.user,
                password: this._config.key,
                responseType: 'json'
            };
            if (this._turboScale) {
                const response = await got(sessionUrl, reqOpts);
                browserUrl = response.body.url;
            }
            else {
                const response = await got(sessionUrl, reqOpts);
                browserUrl = response.body.automation_session.browser_url;
            }
            if (!this._browser) {
                return;
            }
            const capabilities = getBrowserCapabilities(this._browser, this._caps, browserName);
            const browserString = getBrowserDescription(capabilities);
            BStackLogger.info(`${browserString} session: ${browserUrl}`);
        });
    }
    async _setSessionName(suiteTitle, test) {
        if (!this._options.setSessionName || !suiteTitle) {
            return;
        }
        let name = suiteTitle;
        if (this._options.sessionNameFormat) {
            name = this._options.sessionNameFormat(this._config, this._caps, suiteTitle, test?.title);
        }
        else if (test && !test.fullName) {
            // Mocha
            const pre = this._options.sessionNamePrependTopLevelSuiteTitle ? `${suiteTitle} - ` : '';
            const post = !this._options.sessionNameOmitTestTitle ? ` - ${test.title}` : '';
            name = `${pre}${test.parent}${post}`;
        }
        this._percyHandler?._setSessionName(name);
        if (name !== this._fullTitle) {
            this._fullTitle = name;
            await this._updateJob({ name });
        }
    }
    _setAnnotation(data) {
        return this._executeCommand('annotate', { data, level: 'info' });
    }
    async _executeCommand(action, args) {
        if (!this._browser || !isBrowserstackSession(this._browser)) {
            return Promise.resolve();
        }
        const cmd = { action, ...(args ? { arguments: args } : {}) };
        const script = `browserstack_executor: ${JSON.stringify(cmd)}`;
        if (this._browser.isMultiremote) {
            const multiRemoteBrowser = this._browser;
            return Promise.all(Object.keys(this._caps).map(async (browserName) => {
                const browser = multiRemoteBrowser.getInstance(browserName);
                return (await browser.execute(script));
            }));
        }
        return (await this._browser.execute(script));
    }
    saveWorkerData() {
        saveWorkerData({
            usageStats: UsageStats.getInstance().getDataToSave()
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9zZXJ2aWNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUdyQixPQUFPLGlCQUFpQixNQUFNLHlCQUF5QixDQUFBO0FBRXZELE9BQU8sRUFDSCxxQkFBcUIsRUFDckIsc0JBQXNCLEVBQ3RCLHdCQUF3QixFQUN4QixrQkFBa0IsRUFDbEIscUJBQXFCLEVBQ3JCLGdCQUFnQixFQUNoQix1QkFBdUIsRUFDdkIsTUFBTSxFQUNULE1BQU0sV0FBVyxDQUFBO0FBR2xCLE9BQU8sZUFBZSxNQUFNLHVCQUF1QixDQUFBO0FBQ25ELE9BQU8sWUFBWSxNQUFNLGVBQWUsQ0FBQTtBQUN4QyxPQUFPLEVBQUUsZUFBZSxFQUFFLG9CQUFvQixFQUFFLE1BQU0sZ0JBQWdCLENBQUE7QUFDdEUsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxvQkFBb0IsTUFBTSw0QkFBNEIsQ0FBQTtBQUM3RCxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDaEQsT0FBTyxZQUFZLE1BQU0sMEJBQTBCLENBQUE7QUFDbkQsT0FBTyxRQUFRLE1BQU0sdUJBQXVCLENBQUE7QUFDNUMsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLHlCQUF5QixDQUFBO0FBQ2hELE9BQU8sRUFBRSw0QkFBNEIsRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2pFLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBRXZDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUJBQW1CO0lBdUJ4QjtJQUNBO0lBdkJKLGVBQWUsR0FBRyxnREFBZ0QsQ0FBQTtJQUNsRSxZQUFZLEdBQWEsRUFBRSxDQUFBO0lBQzNCLGlCQUFpQixHQUFhLEVBQUUsQ0FBQTtJQUNoQyxnQkFBZ0IsR0FBYSxDQUFD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