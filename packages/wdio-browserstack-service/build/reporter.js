import path from 'node:path';
import WDIOReporter from '@wdio/reporter';
import * as url from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { getCloudProvider, o11yClassErrorHandler, getGitMetaData, removeAnsiColors, getHookType, getPlatformVersion } from './util.js';
import { BStackLogger } from './bstackLogger.js';
import Listener from './testOps/listener.js';
class _TestReporter extends WDIOReporter {
    _capabilities = {};
    _config;
    _observability = true;
    _sessionId;
    _suiteName;
    _suites = [];
    static _tests = {};
    _gitConfigPath;
    _gitConfigured = false;
    _currentHook = {};
    static currentTest = {};
    _userCaps = {};
    listener = Listener.getInstance();
    async onRunnerStart(runnerStats) {
        this._capabilities = runnerStats.capabilities;
        this._userCaps = this.getUserCaps(runnerStats);
        this._config = runnerStats.config;
        this._sessionId = runnerStats.sessionId;
        if (typeof this._config.testObservability !== 'undefined') {
            this._observability = this._config.testObservability;
        }
        await this.configureGit();
        this.registerListeners();
    }
    getUserCaps(runnerStats) {
        return runnerStats.instanceOptions[runnerStats.sessionId]?.capabilities;
    }
    registerListeners() {
        if (this._config?.framework !== 'jasmine') {
            return;
        }
        process.removeAllListeners(`bs:addLog:${process.pid}`);
        process.on(`bs:addLog:${process.pid}`, this.appendTestItemLog.bind(this));
    }
    async appendTestItemLog(stdLog) {
        if (this._currentHook.uuid && !this._currentHook.finished) {
            stdLog.hook_run_uuid = this._currentHook.uuid;
        }
        else if (_TestReporter.currentTest.uuid) {
            stdLog.test_run_uuid = _TestReporter.currentTest.uuid;
        }
        if (stdLog.hook_run_uuid || stdLog.test_run_uuid) {
            this.listener.logCreated([stdLog]);
        }
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
    async configureGit() {
        if (this._gitConfigured) {
            return;
        }
        const gitMeta = await getGitMetaData();
        if (gitMeta) {
            this._gitConfigPath = gitMeta.root;
        }
        this._gitConfigured = true;
    }
    static getTests() {
        return _TestReporter._tests;
    }
    onSuiteStart(suiteStats) {
        let filename = suiteStats.file;
        if (this._config?.framework === 'jasmine') {
            try {
                if (suiteStats.file.startsWith('file://')) {
                    filename = url.fileURLToPath(suiteStats.file);
                }
                if (filename === 'unknown spec file') {
                    // Sometimes in cases where a file has two suites. Then the file name be unknown for second suite, so getting the filename from first suite
                    filename = this._suiteName || suiteStats.file;
                }
            }
            catch (e) {
                BStackLogger.debug('Error in decoding file name of suite');
            }
        }
        this._suiteName = filename;
        this._suites.push(suiteStats);
    }
    onSuiteEnd() {
        this._suites.pop();
    }
    needToSendData(testType, event) {
        if (!this._observability) {
            return false;
        }
        switch (this._config?.framework) {
            case 'mocha':
                return event === 'skip';
            case 'cucumber':
                return false;
            case 'jasmine':
                return event !== 'skip';
            default:
                return false;
        }
    }
    async onTestEnd(testStats) {
        if (!this.needToSendData('test', 'end')) {
            return;
        }
        if (testStats.fullTitle === '<unknown test>') {
            return;
        }
        testStats.end ||= new Date();
        this.listener.testFinished(await this.getRunData(testStats, 'TestRunFinished'));
    }
    async onTestStart(testStats) {
        if (!this.needToSendData('test', 'start')) {
            return;
        }
        if (testStats.fullTitle === '<unknown test>') {
            return;
        }
        const uuid = uuidv4();
        _TestReporter.currentTest.uuid = uuid;
        _TestReporter._tests[testStats.fullTitle] = {
            uuid: uuid,
        };
        this.listener.testStarted(await this.getRunData(testStats, 'TestRunStarted'));
    }
    async onHookStart(hookStats) {
        if (!this.needToSendData('hook', 'start')) {
            return;
        }
        const identifier = this.getHookIdentifier(hookStats);
        const hookId = uuidv4();
        this.setCurrentHook({ uuid: hookId });
        _TestReporter._tests[identifier] = {
            uuid: hookId,
            startedAt: (new Date()).toISOString()
        };
        this.listener.hookStarted(await this.getRunData(hookStats, 'HookRunStarted'));
    }
    async onHookEnd(hookStats) {
        if (!this.needToSendData('hook', 'end')) {
            return;
        }
        const identifier = this.getHookIdentifier(hookStats);
        if (_TestReporter._tests[identifier]) {
            _TestReporter._tests[identifier].finishedAt = (new Date()).toISOString();
        }
        else {
            _TestReporter._tests[identifier] = {
                finishedAt: (new Date()).toISOString()
            };
        }
        this.setCurrentHook({ uuid: _TestReporter._tests[identifier].uuid, finished: true });
        if (!hookStats.state && !hookStats.error) {
            hookStats.state = 'passed';
        }
        this.listener.hookFinished(await this.getRunData(hookStats, 'HookRunFinished'));
    }
    getHookIdentifier(hookStats) {
        return `${hookStats.title} for ${this._suites.at(-1)?.title}`;
    }
    async onTestSkip(testStats) {
        // cucumber steps call this method. We don't want step skipped state so skip for cucumber
        if (!this.needToSendData('test', 'skip')) {
            return;
        }
        testStats.start ||= new Date();
        testStats.end ||= new Date();
        this.listener.testFinished(await this.getRunData(testStats, 'TestRunSkipped'));
    }
    async getRunData(testStats, eventType) {
        const framework = this._config?.framework;
        const scopes = this._suites.map(s => s.title);
        const identifier = testStats.type === 'test' ? testStats.fullTitle : this.getHookIdentifier(testStats);
        const testMetaData = _TestReporter._tests[identifier];
        const scope = testStats.type === 'test' ? testStats.fullTitle : `${this._suites[0].title} - ${testStats.title}`;
        // If no describe block present, onSuiteStart doesn't get called. Use specs list for filename
        const suiteFileName = this._suiteName || (this.specs?.length > 0 ? this.specs[this.specs.length - 1]?.replace('file:', '') : undefined);
        if (eventType === 'TestRunStarted') {
            _TestReporter.currentTest.name = testStats.title;
        }
        await this.configureGit();
        const testData = {
            uuid: testMetaData ? testMetaData.uuid : uuidv4(),
            type: testStats.type,
            name: testStats.title,
            body: {
                lang: 'webdriverio',
                code: null
            },
            scope: scope,
            scopes: scopes,
            identifier: identifier,
            file_name: suiteFileName ? path.relative(process.cwd(), suiteFileName) : undefined,
            location: suiteFileName ? path.relative(process.cwd(), suiteFileName) : undefined,
            vc_filepath: (this._gitConfigPath && suiteFileName) ? path.relative(this._gitConfigPath, suiteFileName) : undefined,
            started_at: testStats.start && testStats.start.toISOString(),
            finished_at: testStats.end && testStats.end.toISOString(),
            framework: framework,
            duration_in_ms: testStats._duration,
            result: testStats.state,
        };
        if (testStats.type === 'test') {
            testData.retries = { limit: testStats.retries || 0, attempts: testStats.retries || 0 };
        }
        if (eventType.startsWith('TestRun') || eventType === 'HookRunStarted') {
            /* istanbul ignore next */
            const cloudProvider = getCloudProvider({ options: { hostname: this._config?.hostname } });
            testData.integrations = {};
            /* istanbul ignore next */
            testData.integrations[cloudProvider] = {
                capabilities: this._capabilities,
                session_id: this._sessionId,
                browser: this._capabilities?.browserName,
                browser_version: this._capabilities?.browserVersion,
                platform: this._capabilities?.platformName,
                platform_version: getPlatformVersion(this._userCaps)
            };
        }
        if (eventType === 'TestRunFinished' || eventType === 'HookRunFinished') {
            const { error } = testStats;
            const failed = testStats.state === 'failed';
            if (failed) {
                testData.result = (error && error.message && error.message.includes('sync skip; aborting execution')) ? 'ignore' : 'failed';
                if (error && testData.result !== 'skipped') {
                    testData.failure = [{ backtrace: [removeAnsiColors(error.message), removeAnsiColors(error.stack || '')] }]; // add all errors here
                    testData.failure_reason = removeAnsiColors(error.message);
                    testData.failure_type = error.message === null ? null : error.message.toString().match(/AssertionError/) ? 'AssertionError' : 'UnhandledError'; //verify if this is working
                }
            }
        }
        if (eventType.match(/HookRun/)) {
            testData.hook_type = testData.name?.toLowerCase() ? getHookType(testData.name.toLowerCase()) : 'undefined';
        }
        return testData;
    }
}
// https://github.com/microsoft/TypeScript/issues/6543
const TestReporter = o11yClassErrorHandler(_TestReporter);
export default TestReporter;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwb3J0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvcmVwb3J0ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBRzVCLE9BQU8sWUFBWSxNQUFNLGdCQUFnQixDQUFBO0FBRXpDLE9BQU8sS0FBSyxHQUFHLE1BQU0sVUFBVSxDQUFBO0FBRS9CLE9BQU8sRUFBRSxFQUFFLElBQUksTUFBTSxFQUFFLE1BQU0sTUFBTSxDQUFBO0FBSW5DLE9BQU8sRUFDSCxnQkFBZ0IsRUFDaEIscUJBQXFCLEVBQ3JCLGNBQWMsRUFDZCxnQkFBZ0IsRUFDaEIsV0FBVyxFQUNYLGtCQUFrQixFQUNyQixNQUFNLFdBQVcsQ0FBQTtBQUNsQixPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFFaEQsT0FBTyxRQUFRLE1BQU0sdUJBQXVCLENBQUE7QUFFNUMsTUFBTSxhQUFjLFNBQVEsWUFBWTtJQUM1QixhQUFhLEdBQTZCLEVBQUUsQ0FBQTtJQUM1QyxPQUFPLENBQTBDO0lBQ2pELGNBQWMsR0FBRyxJQUFJLENBQUE7SUFDckIsVUFBVSxDQUFTO0lBQ25CLFVBQVUsQ0FBUztJQUNuQixPQUFPLEdBQWlCLEVBQUUsQ0FBQTtJQUMxQixNQUFNLENBQUMsTUFBTSxHQUE2QixFQUFFLENBQUE7SUFDNUMsY0FBYyxDQUFTO0lBQ3ZCLGNBQWMsR0FBWSxLQUFLLENBQUE7SUFDL0IsWUFBWSxHQUFtQixFQUFFLENBQUE7SUFDbEMsTUFBTSxDQUFDLFdBQVcsR0FBbUIsRUFBRSxDQUFBO0lBQ3RDLFNBQVMsR0FBbUMsRUFBRSxDQUFBO0lBQzlDLFFBQVEsR0FBRyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUE7SUFFekMsS0FBSyxDQUFDLGFBQWEsQ0FBRSxXQUF3QjtRQUN6QyxJQUFJLENBQUMsYUFBYSxHQUFHLFdBQVcsQ0FBQyxZQUF3QyxDQUFBO1FBQ3pFLElBQUksQ0FBQyxTQUFT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