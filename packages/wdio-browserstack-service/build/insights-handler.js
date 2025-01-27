import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import TestReporter from './reporter.js';
import { frameworkSupportsHook, getCloudProvider, getFailureObject, getGitMetaData, getHookType, getPlatformVersion, getScenarioExamples, getUniqueIdentifier, getUniqueIdentifierForCucumber, isBrowserstackSession, isScreenshotCommand, isUndefined, o11yClassErrorHandler, removeAnsiColors, getObservabilityProduct } from './util.js';
import { BStackLogger } from './bstackLogger.js';
import Listener from './testOps/listener.js';
import { TESTOPS_SCREENSHOT_ENV } from './constants.js';
class _InsightsHandler {
    _browser;
    _framework;
    _tests = {};
    _hooks = {};
    _platformMeta;
    _commands = {};
    _gitConfigPath;
    _suiteFile;
    static currentTest = {};
    _currentHook = {};
    _cucumberData = {
        stepsStarted: false,
        scenariosStarted: false,
        steps: []
    };
    _userCaps = {};
    listener = Listener.getInstance();
    currentTestId;
    cbtQueue = [];
    constructor(_browser, _framework, _userCaps, _options) {
        this._browser = _browser;
        this._framework = _framework;
        const caps = this._browser.capabilities;
        const sessionId = this._browser.sessionId;
        this._userCaps = _userCaps;
        this._platformMeta = {
            browserName: caps.browserName,
            browserVersion: caps?.browserVersion,
            platformName: caps?.platformName,
            caps: caps,
            sessionId,
            product: getObservabilityProduct(_options, this._isAppAutomate())
        };
        this.registerListeners();
    }
    _isAppAutomate() {
        const browserDesiredCapabilities = (this._browser?.capabilities ?? {});
        const desiredCapabilities = (this._userCaps ?? {});
        return !!browserDesiredCapabilities['appium:app'] || !!desiredCapabilities['appium:app'] || !!(desiredCapabilities['appium:options']?.app);
    }
    registerListeners() {
        if (!(this._framework === 'mocha' || this._framework === 'cucumber')) {
            return;
        }
        process.removeAllListeners(`bs:addLog:${process.pid}`);
        process.on(`bs:addLog:${process.pid}`, this.appendTestItemLog.bind(this));
    }
    setSuiteFile(filename) {
        this._suiteFile = filename;
    }
    async before() {
        if (isBrowserstackSession(this._browser)) {
            await this._browser.execute(`browserstack_executor: ${JSON.stringify({
                action: 'annotate',
                arguments: {
                    data: `ObservabilitySync:${Date.now()}`,
                    level: 'debug'
                }
            })}`);
        }
        const gitMeta = await getGitMetaData();
        if (gitMeta) {
            this._gitConfigPath = gitMeta.root;
        }
    }
    getCucumberHookType(test) {
        let hookType = null;
        if (!test) {
            hookType = this._cucumberData.scenariosStarted ? 'AFTER_ALL' : 'BEFORE_ALL';
        }
        else if (!this._cucumberData.stepsStarted) {
            hookType = 'BEFORE_EACH';
        }
        else if (this._cucumberData.steps?.length > 0) {
            // beforeStep or afterStep
        }
        else {
            hookType = 'AFTER_EACH';
        }
        return hookType;
    }
    getCucumberHookName(hookType) {
        switch (hookType) {
            case 'BEFORE_EACH':
            case 'AFTER_EACH':
                return `${hookType} for ${this._cucumberData.scenario?.name}`;
            case 'BEFORE_ALL':
            case 'AFTER_ALL':
                return `${hookType} for ${this._cucumberData.feature?.name}`;
        }
        return '';
    }
    getCucumberHookUniqueId(hookType, hook) {
        switch (hookType) {
            case 'BEFORE_EACH':
            case 'AFTER_EACH':
                return hook.hookId;
            case 'BEFORE_ALL':
            case 'AFTER_ALL':
                // Can only work for single beforeAll or afterAll
                return `${hookType} for ${this.getCucumberFeatureUniqueId()}`;
        }
        return null;
    }
    getCucumberFeatureUniqueId() {
        const { uri, feature } = this._cucumberData;
        return `${uri}:${feature?.name}`;
    }
    setCurrentHook(hookDetails) {
        if (hookDetails.finished) {
            if (this._currentHook.uuid === hookDetails.uuid) {
                this._currentHook.finished = true;
            }
            return;
        }
        this._currentHook = {
            uuid: hookDetails.uuid,
            finished: false
        };
    }
    async sendScenarioObjectSkipped(scenario, feature, uri) {
        const testMetaData = {
            uuid: uuidv4(),
            startedAt: (new Date()).toISOString(),
            finishedAt: (new Date()).toISOString(),
            scenario: {
                name: scenario.name
            },
            feature: {
                path: uri,
                name: feature.name,
                description: feature.description
            },
            steps: scenario.steps.map((step) => {
                return {
                    id: step.id,
                    text: step.text,
                    keyword: step.keyword,
                    result: 'skipped',
                };
            }),
        };
        this.listener.testFinished(this.getTestRunDataForCucumber(null, 'TestRunSkipped', testMetaData));
    }
    async processCucumberHook(test, params, result) {
        const hookType = this.getCucumberHookType(test);
        if (!hookType) {
            return;
        }
        const { event, hookUUID } = params;
        const hookId = this.getCucumberHookUniqueId(hookType, test);
        if (!hookId) {
            return;
        }
        if (event === 'before') {
            this.setCurrentHook({ uuid: hookUUID });
            const hookMetaData = {
                uuid: hookUUID,
                startedAt: (new Date()).toISOString(),
                testRunId: InsightsHandler.currentTest.uuid,
                hookType: hookType
            };
            this._tests[hookId] = hookMetaData;
            this.listener.hookStarted(this.getHookRunDataForCucumber(hookMetaData, 'HookRunStarted'));
        }
        else {
            this._tests[hookId].finishedAt = (new Date()).toISOString();
            this.setCurrentHook({ uuid: this._tests[hookId].uuid, finished: true });
            this.listener.hookFinished(this.getHookRunDataForCucumber(this._tests[hookId], 'HookRunFinished', result));
            if (hookType === 'BEFORE_ALL' && result && !result.passed) {
                const { feature, uri } = this._cucumberData;
                if (!feature) {
                    return;
                }
                feature.children.map(async (childObj) => {
                    if (childObj.rule) {
                        childObj.rule.children.map(async (scenarioObj) => {
                            if (scenarioObj.scenario) {
                                await this.sendScenarioObjectSkipped(scenarioObj.scenario, feature, uri);
                            }
                        });
                    }
                    else if (childObj.scenario) {
                        await this.sendScenarioObjectSkipped(childObj.scenario, feature, uri);
                    }
                });
            }
        }
    }
    async beforeHook(test, context) {
        if (!frameworkSupportsHook('before', this._framework)) {
            return;
        }
        const hookUUID = uuidv4();
        if (this._framework === 'cucumber') {
            test = test;
            await this.processCucumberHook(test, { event: 'before', hookUUID });
            return;
        }
        test = test;
        const fullTitle = getUniqueIdentifier(test, this._framework);
        this._tests[fullTitle] = {
            uuid: hookUUID,
            startedAt: (new Date()).toISOString()
        };
        this.setCurrentHook({ uuid: hookUUID });
        this.attachHookData(context, hookUUID);
        this.listener.hookStarted(this.getRunData(test, 'HookRunStarted'));
    }
    async afterHook(test, result) {
        if (!frameworkSupportsHook('after', this._framework)) {
            return;
        }
        if (this._framework === 'cucumber') {
            await this.processCucumberHook(test, { event: 'after' }, result);
            return;
        }
        test = test;
        const fullTitle = getUniqueIdentifier(test, this._framework);
        if (this._tests[fullTitle]) {
            this._tests[fullTitle].finishedAt = (new Date()).toISOString();
        }
        else {
            this._tests[fullTitle] = {
                finishedAt: (new Date()).toISOString()
            };
        }
        this.setCurrentHook({ uuid: this._tests[fullTitle].uuid, finished: true });
        this.listener.hookFinished(this.getRunData(test, 'HookRunFinished', result));
        const hookType = getHookType(test.title);
        /*
            If any of the `beforeAll`, `beforeEach`, `afterEach` then the tests after the hook won't run in mocha (https://github.com/mochajs/mocha/issues/4392)
            So if any of this hook fails, then we are sending the next tests in the suite as skipped.
            This won't be needed for `afterAll`, as even if `afterAll` fails all the tests that we need are already run by then, so we don't need to send the stats for them separately
         */
        if (!result.passed && (hookType === 'BEFORE_EACH' || hookType === 'BEFORE_ALL' || hookType === 'AFTER_EACH')) {
            const sendTestSkip = async (skippedTest) => {
                // We only need to send the tests that whose state is not determined yet. The state of tests which is determined will already be sent.
                if (skippedTest.state === undefined) {
                    const fullTitle = `${skippedTest.parent.title} - ${skippedTest.title}`;
                    this._tests[fullTitle] = {
                        uuid: uuidv4(),
                        startedAt: (new Date()).toISOString(),
                        finishedAt: (new Date()).toISOString()
                    };
                    this.listener.testFinished(this.getRunData(skippedTest, 'TestRunSkipped'));
                }
            };
            /*
                Recursively send the tests as skipped for all suites below the hook. This is to handle nested describe blocks
             */
            const sendSuiteSkipped = async (suite) => {
                for (const skippedTest of suite.tests) {
                    await sendTestSkip(skippedTest);
                }
                for (const skippedSuite of suite.suites) {
                    await sendSuiteSkipped(skippedSuite);
                }
            };
            await sendSuiteSkipped(test.ctx.test.parent);
        }
    }
    getHookRunDataForCucumber(hookData, eventType, result) {
        const { uri, feature } = this._cucumberData;
        const testData = {
            uuid: hookData.uuid,
            type: 'hook',
            name: this.getCucumberHookName(hookData.hookType),
            body: {
                lang: 'webdriverio',
                code: null
            },
            started_at: hookData.startedAt,
            finished_at: hookData.finishedAt,
            hook_type: hookData.hookType,
            test_run_id: hookData.testRunId,
            scope: feature?.name,
            scopes: [feature?.name || ''],
            file_name: uri ? path.relative(process.cwd(), uri) : undefined,
            location: uri ? path.relative(process.cwd(), uri) : undefined,
            vc_filepath: (this._gitConfigPath && uri) ? path.relative(this._gitConfigPath, uri) : undefined,
            result: 'pending',
            framework: this._framework
        };
        if (eventType === 'HookRunFinished' && result) {
            testData.result = result.passed ? 'passed' : 'failed';
            testData.retries = result.retries;
            testData.duration_in_ms = result.duration;
            if (!result.passed) {
                Object.assign(testData, getFailureObject(result.error));
            }
        }
        if (eventType === 'HookRunStarted') {
            testData.integrations = {};
            if (this._browser && this._platformMeta) {
                const provider = getCloudProvider(this._browser);
                testData.integrations[provider] = this.getIntegrationsObject();
            }
        }
        return testData;
    }
    async beforeTest(test) {
        const uuid = uuidv4();
        InsightsHandler.currentTest = {
            test, uuid
        };
        if (this._framework !== 'mocha') {
            return;
        }
        const fullTitle = getUniqueIdentifier(test, this._framework);
        this._tests[fullTitle] = {
            uuid,
            startedAt: (new Date()).toISOString()
        };
        this.listener.testStarted(this.getRunData(test, 'TestRunStarted'));
    }
    async afterTest(test, result) {
        if (this._framework !== 'mocha') {
            return;
        }
        const fullTitle = getUniqueIdentifier(test, this._framework);
        this._tests[fullTitle] = {
            ...(this._tests[fullTitle] || {}),
            finishedAt: (new Date()).toISOString()
        };
        BStackLogger.debug('calling testFinished');
        this.flushCBTDataQueue();
        this.listener.testFinished(this.getRunData(test, 'TestRunFinished', result));
    }
    /**
      * Cucumber Only
      */
    async beforeFeature(uri, feature) {
        this._cucumberData.scenariosStarted = false;
        this._cucumberData.feature = feature;
        this._cucumberData.uri = uri;
    }
    async beforeScenario(world) {
        const uuid = uuidv4();
        InsightsHandler.currentTest = {
            uuid
        };
        this._cucumberData.scenario = world.pickle;
        this._cucumberData.scenariosStarted = true;
        this._cucumberData.stepsStarted = false;
        const pickleData = world.pickle;
        const gherkinDocument = world.gherkinDocument;
        const featureData = gherkinDocument.feature;
        const uniqueId = getUniqueIdentifierForCucumber(world);
        const testMetaData = {
            uuid: uuid,
            startedAt: (new Date()).toISOString()
        };
        if (pickleData) {
            testMetaData.scenario = {
                name: pickleData.name,
            };
        }
        if (gherkinDocument && featureData) {
            testMetaData.feature = {
                path: gherkinDocument.uri,
                name: featureData.name,
                description: featureData.description,
            };
        }
        this._tests[uniqueId] = testMetaData;
        this.listener.testStarted(this.getTestRunDataForCucumber(world, 'TestRunStarted'));
    }
    async afterScenario(world) {
        this._cucumberData.scenario = undefined;
        this.flushCBTDataQueue();
        this.listener.testFinished(this.getTestRunDataForCucumber(world, 'TestRunFinished'));
    }
    async beforeStep(step, scenario) {
        this._cucumberData.stepsStarted = true;
        this._cucumberData.steps.push(step);
        const uniqueId = getUniqueIdentifierForCucumber({ pickle: scenario });
        const testMetaData = this._tests[uniqueId] || { steps: [] };
        if (testMetaData && !testMetaData.steps) {
            testMetaData.steps = [];
        }
        testMetaData.steps?.push({
            id: step.id,
            text: step.text,
            keyword: step.keyword,
            started_at: (new Date()).toISOString()
        });
        this._tests[uniqueId] = testMetaData;
    }
    async afterStep(step, scenario, result) {
        this._cucumberData.steps.pop();
        const uniqueId = getUniqueIdentifierForCucumber({ pickle: scenario });
        const testMetaData = this._tests[uniqueId] || { steps: [] };
        if (!testMetaData.steps) {
            testMetaData.steps = [{
                    id: step.id,
                    text: step.text,
                    keyword: step.keyword,
                    finished_at: (new Date()).toISOString(),
                    result: result.passed ? 'PASSED' : 'FAILED',
                    duration: result.duration,
                    failure: result.error ? removeAnsiColors(result.error) : result.error
                }];
        }
        const stepDetails = testMetaData.steps?.find(item => item.id === step.id);
        if (stepDetails) {
            stepDetails.finished_at = (new Date()).toISOString();
            stepDetails.result = result.passed ? 'PASSED' : 'FAILED';
            stepDetails.duration = result.duration;
            stepDetails.failure = result.error ? removeAnsiColors(result.error) : result.error;
        }
        this._tests[uniqueId] = testMetaData;
    }
    /**
     * misc methods
     */
    appendTestItemLog = async (stdLog) => {
        try {
            if (this._currentHook.uuid && !this._currentHook.finished && (this._framework === 'mocha' || this._framework === 'cucumber')) {
                stdLog.hook_run_uuid = this._currentHook.uuid;
            }
            else if (InsightsHandler.currentTest.uuid && (this._framework === 'mocha' || this._framework === 'cucumber')) {
                stdLog.test_run_uuid = InsightsHandler.currentTest.uuid;
            }
            if (stdLog.hook_run_uuid || stdLog.test_run_uuid) {
                this.listener.logCreated([stdLog]);
            }
        }
        catch (error) {
            BStackLogger.debug(`Exception in uploading log data to Observability with error : ${error}`);
        }
    };
    async browserCommand(commandType, args, test) {
        const dataKey = `${args.sessionId}_${args.method}_${args.endpoint}`;
        if (commandType === 'client:beforeCommand') {
            this._commands[dataKey] = args;
            return;
        }
        if (!test) {
            return;
        }
        const identifier = this.getIdentifier(test);
        const testMeta = this._tests[identifier] || TestReporter.getTests()[identifier];
        if (!testMeta) {
            return;
        }
        // log screenshot
        const body = 'body' in args ? args.body : undefined;
        const result = 'result' in args ? args.result : undefined;
        if (Boolean(process.env[TESTOPS_SCREENSHOT_ENV]) && isScreenshotCommand(args) && result?.value) {
            await this.listener.onScreenshot([{
                    test_run_uuid: testMeta.uuid,
                    timestamp: new Date().toISOString(),
                    message: result.value,
                    kind: 'TEST_SCREENSHOT'
                }]);
        }
        const requestData = this._commands[dataKey];
        if (!requestData) {
            return;
        }
        // log http request
        this.listener.logCreated([{
                test_run_uuid: testMeta.uuid,
                timestamp: new Date().toISOString(),
                kind: 'HTTP',
                http_response: {
                    path: requestData.endpoint,
                    method: requestData.method,
                    body,
                    response: result
                }
            }]);
    }
    /*
     * private methods
     */
    attachHookData(context, hookId) {
        if (context.currentTest && context.currentTest.parent) {
            const parentTest = `${context.currentTest.parent.title} - ${context.currentTest.title}`;
            if (!this._hooks[parentTest]) {
                this._hooks[parentTest] = [];
            }
            this._hooks[parentTest].push(hookId);
            return;
        }
        else if (context.test) {
            this.setHooksFromSuite(context.test.parent, hookId);
        }
    }
    setHooksFromSuite(parent, hookId) {
        if (!parent) {
            return false;
        }
        if (parent.tests && parent.tests.length > 0) {
            const uniqueIdentifier = getUniqueIdentifier(parent.tests[0], this._framework);
            if (!this._hooks[uniqueIdentifier]) {
                this._hooks[uniqueIdentifier] = [];
            }
            this._hooks[uniqueIdentifier].push(hookId);
            return true;
        }
        for (const suite of parent.suites) {
            const result = this.setHooksFromSuite(suite, hookId);
            if (result) {
                return true;
            }
        }
        return false;
    }
    /*
     * Get hierarchy info
     */
    getHierarchy(test) {
        const value = [];
        if (test.ctx && test.ctx.test) {
            // If we already have the parent object, utilize it else get from context
            let parent = typeof test.parent === 'object' ? test.parent : test.ctx.test.parent;
            while (parent && parent.title !== '') {
                value.push(parent.title);
                parent = parent.parent;
            }
        }
        else if (test.description && test.fullName) {
            // for Jasmine
            value.push(test.description);
            value.push(test.fullName.replace(new RegExp(' ' + test.description + '$'), ''));
        }
        return value.reverse();
    }
    getRunData(test, eventType, results) {
        const fullTitle = getUniqueIdentifier(test, this._framework);
        const testMetaData = this._tests[fullTitle];
        const filename = test.file || this._suiteFile;
        this.currentTestId = testMetaData.uuid;
        if (eventType === 'TestRunStarted') {
            InsightsHandler.currentTest.name = test.title || test.description;
        }
        const testData = {
            uuid: testMetaData.uuid,
            type: test.type || 'test',
            name: test.title || test.description,
            body: {
                lang: 'webdriverio',
                code: test.body
            },
            scope: fullTitle,
            scopes: this.getHierarchy(test),
            identifier: fullTitle,
            file_name: filename ? path.relative(process.cwd(), filename) : undefined,
            location: filename ? path.relative(process.cwd(), filename) : undefined,
            vc_filepath: (this._gitConfigPath && filename) ? path.relative(this._gitConfigPath, filename) : undefined,
            started_at: testMetaData.startedAt,
            finished_at: testMetaData.finishedAt,
            result: 'pending',
            framework: this._framework
        };
        if ((eventType === 'TestRunFinished' || eventType === 'HookRunFinished') && results) {
            const { error, passed } = results;
            if (!passed) {
                testData.result = (error && error.message && error.message.includes('sync skip; aborting execution')) ? 'ignore' : 'failed';
                if (error && testData.result !== 'skipped') {
                    testData.failure = [{ backtrace: [removeAnsiColors(error.message), removeAnsiColors(error.stack || '')] }]; // add all errors here
                    testData.failure_reason = removeAnsiColors(error.message);
                    testData.failure_type = isUndefined(error.message) ? null : error.message.toString().match(/AssertionError/) ? 'AssertionError' : 'UnhandledError'; //verify if this is working
                }
            }
            else {
                testData.result = 'passed';
            }
            testData.retries = results.retries;
            testData.duration_in_ms = results.duration;
            if (this._hooks[fullTitle]) {
                testData.hooks = this._hooks[fullTitle];
            }
        }
        if (eventType === 'TestRunStarted' || eventType === 'TestRunSkipped' || eventType === 'HookRunStarted') {
            testData.integrations = {};
            if (this._browser && this._platformMeta) {
                const provider = getCloudProvider(this._browser);
                testData.integrations[provider] = this.getIntegrationsObject();
            }
        }
        if (eventType === 'TestRunSkipped') {
            testData.result = 'skipped';
            eventType = 'TestRunFinished';
        }
        /* istanbul ignore if */
        if (eventType.match(/HookRun/)) {
            testData.hook_type = testData.name?.toLowerCase() ? getHookType(testData.name.toLowerCase()) : 'undefined';
            testData.test_run_id = this.getTestRunId(test.ctx);
        }
        return testData;
    }
    getTestRunId(context) {
        if (!context) {
            return;
        }
        if (context.currentTest) {
            const uniqueIdentifier = getUniqueIdentifier(context.currentTest, this._framework);
            return this._tests[uniqueIdentifier] && this._tests[uniqueIdentifier].uuid;
        }
        if (!context.test) {
            return;
        }
        return this.getTestRunIdFromSuite(context.test.parent);
    }
    getTestRunIdFromSuite(parent) {
        if (!parent) {
            return;
        }
        for (const test of parent.tests) {
            const uniqueIdentifier = getUniqueIdentifier(test, this._framework);
            if (this._tests[uniqueIdentifier]) {
                return this._tests[uniqueIdentifier].uuid;
            }
        }
        for (const suite of parent.suites) {
            const testRunId = this.getTestRunIdFromSuite(suite);
            if (testRunId) {
                return testRunId;
            }
        }
        return;
    }
    getTestRunDataForCucumber(worldObj, eventType, testMetaData = null) {
        const world = worldObj;
        const dataHub = testMetaData ? testMetaData : (this._tests[getUniqueIdentifierForCucumber(world)] || {});
        const { feature, scenario, steps, uuid, startedAt, finishedAt } = dataHub;
        const examples = !testMetaData ? getScenarioExamples(world) : undefined;
        let fullNameWithExamples;
        if (!testMetaData) {
            fullNameWithExamples = examples
                ? world.pickle.name + ' (' + examples.join(', ') + ')'
                : world.pickle.name;
        }
        else {
            fullNameWithExamples = scenario?.name || '';
        }
        this.currentTestId = uuid;
        if (eventType === 'TestRunStarted') {
            InsightsHandler.currentTest.name = fullNameWithExamples;
        }
        const testData = {
            uuid: uuid,
            started_at: startedAt,
            finished_at: finishedAt,
            type: 'test',
            body: {
                lang: 'webdriverio',
                code: null
            },
            name: fullNameWithExamples,
            scope: fullNameWithExamples,
            scopes: [feature?.name || ''],
            identifier: scenario?.name,
            file_name: feature && feature.path ? path.relative(process.cwd(), feature.path) : undefined,
            location: feature && feature.path ? path.relative(process.cwd(), feature.path) : undefined,
            vc_filepath: (this._gitConfigPath && feature?.path) ? path.relative(this._gitConfigPath, feature?.path) : undefined,
            framework: this._framework,
            result: 'pending',
            meta: {
                feature: feature,
                scenario: scenario,
                steps: steps,
                examples: examples
            }
        };
        if (eventType === 'TestRunStarted' || eventType === 'TestRunSkipped') {
            testData.integrations = {};
            if (this._browser && this._platformMeta) {
                const provider = getCloudProvider(this._browser);
                testData.integrations[provider] = this.getIntegrationsObject();
            }
        }
        /* istanbul ignore if */
        if (world?.result) {
            let result = world.result.status.toLowerCase();
            if (result !== 'passed' && result !== 'failed') {
                result = 'skipped'; // mark UNKNOWN/UNDEFINED/AMBIGUOUS/PENDING as skipped
            }
            testData.finished_at = (new Date()).toISOString();
            testData.result = result;
            testData.duration_in_ms = world.result.duration.seconds * 1000 + world.result.duration.nanos / 1000000; // send duration in ms
            if (result === 'failed') {
                testData.failure = [
                    {
                        'backtrace': [world.result.message ? removeAnsiColors(world.result.message) : 'unknown']
                    }
                ];
                testData.failure_reason = world.result.message ? removeAnsiColors(world.result.message) : world.result.message;
                if (world.result.message) {
                    testData.failure_type = world.result.message.match(/AssertionError/)
                        ? 'AssertionError'
                        : 'UnhandledError';
                }
            }
        }
        if (world?.pickle) {
            testData.tags = world.pickle.tags.map(({ name }) => (name));
        }
        if (eventType === 'TestRunSkipped') {
            testData.result = 'skipped';
            eventType = 'TestRunFinished';
        }
        return testData;
    }
    async flushCBTDataQueue() {
        if (isUndefined(this.currentTestId)) {
            return;
        }
        this.cbtQueue.forEach(cbtData => {
            cbtData.uuid = this.currentTestId;
            this.listener.cbtSessionCreated(cbtData);
        });
        this.currentTestId = undefined; // set undefined for next test
    }
    async sendCBTInfo() {
        const integrationsData = {};
        if (this._browser && this._platformMeta) {
            const provider = getCloudProvider(this._browser);
            integrationsData[provider] = this.getIntegrationsObject();
        }
        const cbtData = {
            uuid: '',
            integrations: integrationsData
        };
        if (this.currentTestId !== undefined) {
            cbtData.uuid = this.currentTestId;
            this.listener.cbtSessionCreated(cbtData);
        }
        else {
            this.cbtQueue.push(cbtData);
        }
    }
    getIntegrationsObject() {
        const caps = this._browser?.capabilities;
        const sessionId = this._browser?.sessionId;
        return {
            capabilities: caps,
            session_id: sessionId,
            browser: caps?.browserName,
            browser_version: caps?.browserVersion,
            platform: caps?.platformName,
            product: this._platformMeta?.product,
            platform_version: getPlatformVersion(this._userCaps)
        };
    }
    getIdentifier(test) {
        if ('pickle' in test) {
            return getUniqueIdentifierForCucumber(test);
        }
        return getUniqueIdentifier(test, this._framework);
    }
}
// https://github.com/microsoft/TypeScript/issues/6543
const InsightsHandler = o11yClassErrorHandler(_InsightsHandler);
export default InsightsHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5zaWdodHMtaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9pbnNpZ2h0cy1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUs1QixPQUFPLEVBQUUsRUFBRSxJQUFJLE1BQU0sRUFBRSxNQUFNLE1BQU0sQ0FBQTtBQUVuQyxPQUFPLFlBQVksTUFBTSxlQUFlLENBQUE7QUFJeEMsT0FBTyxFQUNILHFCQUFxQixFQUNyQixnQkFBZ0IsRUFBRSxnQkFBZ0IsRUFDbEMsY0FBYyxFQUNkLFdBQVcsRUFBRSxrQkFBa0IsRUFDL0IsbUJBQW1CLEVBQ25CLG1CQUFtQixFQUNuQiw4QkFBOEIsRUFDOUIscUJBQXFCLEVBQ3JCLG1CQUFtQixFQUNuQixXQUFXLEVBQ1gscUJBQXFCLEVBQ3JCLGdCQUFnQixFQUNoQix1QkFBdUIsRUFDMUIsTUFBTSxXQUFXLENBQUE7QUFTbEIsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBRWhELE9BQU8sUUFBUSxNQUFNLHVCQUF1QixDQUFBO0FBQzVDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGdCQUFnQixDQUFBO0FBRXZELE1BQU0sZ0JBQWdCO0lBbUJHO0lBQXdFO0lBbEJyRixNQUFNLEdBQTZCLEVBQUUsQ0FBQTtJQUNyQyxNQUFNLEdBQTZCLEVBQUUsQ0FBQTtJQUNyQyxhQUFhLENBQWM7SUFDM0IsU0FBUyxHQUF5RCxFQUFFLENBQUE7SUFDcEUsY0FBYyxDQUFTO0lBQ3ZCLFVBQVUsQ0FBUztJQUNwQixNQUFNLENBQUMsV0FBVyxHQUFtQixFQUFFLENBQUE7SUFDdEMsWUFBWSxHQUFtQixFQUFFLENBQUE7SUFDakMsYUFBYSxHQUFrQjtRQUNuQyxZQUFZLEVBQUUsS0FBSztRQUNuQixnQkFBZ0IsRUFBRSxLQUFLO1FBQ3ZCLEtBQUssRUFBRSxFQUFFO0tBQ1osQ0FBQTtJQUNPLFNBQVMsR0FB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