import UsageStats from './usageStats.js';
import RequestQueueHandler from '../request-handler.js';
import { batchAndPostEvents, isTrue, sleep } from '../util.js';
import { DATA_BATCH_ENDPOINT, DEFAULT_WAIT_INTERVAL_FOR_PENDING_UPLOADS, DEFAULT_WAIT_TIMEOUT_FOR_PENDING_UPLOADS, LOG_KIND_USAGE_MAP, TESTOPS_BUILD_COMPLETED_ENV, TEST_ANALYTICS_ID } from '../constants.js';
import { sendScreenshots } from './requestUtils.js';
import { BStackLogger } from '../bstackLogger.js';
import { shouldProcessEventForTesthub } from '../testHub/utils.js';
class Listener {
    static instance;
    usageStats = UsageStats.getInstance();
    testStartedStats = this.usageStats.testStartedStats;
    testFinishedStats = this.usageStats.testFinishedStats;
    hookStartedStats = this.usageStats.hookStartedStats;
    hookFinishedStats = this.usageStats.hookFinishedStats;
    cbtSessionStats = this.usageStats.cbtSessionStats;
    logEvents = this.usageStats.logStats;
    requestBatcher;
    pendingUploads = 0;
    static _accessibilityOptions;
    static _testRunAccessibilityVar = false;
    // Making the constructor private to use singleton pattern
    constructor() {
    }
    static getInstance() {
        if (!Listener.instance) {
            Listener.instance = new Listener();
        }
        return Listener.instance;
    }
    static setAccessibilityOptions(options) {
        Listener._accessibilityOptions = options;
    }
    static setTestRunAccessibilityVar(accessibility) {
        Listener._testRunAccessibilityVar = accessibility;
    }
    async onWorkerEnd() {
        try {
            await this.uploadPending();
            await this.teardown();
        }
        catch (e) {
            BStackLogger.debug('Exception in onWorkerEnd: ' + e);
        }
    }
    async uploadPending(waitTimeout = DEFAULT_WAIT_TIMEOUT_FOR_PENDING_UPLOADS, waitInterval = DEFAULT_WAIT_INTERVAL_FOR_PENDING_UPLOADS) {
        if ((this.pendingUploads <= 0) || waitTimeout <= 0) {
            return;
        }
        await sleep(waitInterval);
        return this.uploadPending(waitTimeout - waitInterval);
    }
    async teardown() {
        BStackLogger.debug('teardown started');
        RequestQueueHandler.tearDownInvoked = true;
        await this.requestBatcher?.shutdown();
        BStackLogger.debug('teardown ended');
    }
    hookStarted(hookData) {
        try {
            if (!shouldProcessEventForTesthub('HookRunStarted')) {
                return;
            }
            this.hookStartedStats.triggered();
            this.sendBatchEvents(this.getEventForHook('HookRunStarted', hookData));
        }
        catch (e) {
            this.hookStartedStats.failed();
            throw e;
        }
    }
    hookFinished(hookData) {
        try {
            if (!shouldProcessEventForTesthub('HookRunFinished')) {
                return;
            }
            this.hookFinishedStats.triggered(hookData.result);
            this.sendBatchEvents(this.getEventForHook('HookRunFinished', hookData));
        }
        catch (e) {
            this.hookFinishedStats.failed(hookData.result);
            throw e;
        }
    }
    testStarted(testData) {
        try {
            if (!shouldProcessEventForTesthub('TestRunStarted')) {
                return;
            }
            process.env[TEST_ANALYTICS_ID] = testData.uuid;
            this.testStartedStats.triggered();
            testData.product_map = {
                accessibility: Listener._testRunAccessibilityVar
            };
            this.sendBatchEvents(this.getEventForHook('TestRunStarted', testData));
        }
        catch (e) {
            this.testStartedStats.failed();
            throw e;
        }
    }
    testFinished(testData) {
        try {
            if (!shouldProcessEventForTesthub('TestRunFinished')) {
                return;
            }
            testData.product_map = {
                accessibility: Listener._testRunAccessibilityVar
            };
            this.testFinishedStats.triggered(testData.result);
            this.sendBatchEvents(this.getEventForHook('TestRunFinished', testData));
        }
        catch (e) {
            this.testFinishedStats.failed(testData.result);
            throw e;
        }
    }
    logCreated(logs) {
        try {
            if (!shouldProcessEventForTesthub('LogCreated')) {
                return;
            }
            this.markLogs('triggered', logs);
            this.sendBatchEvents({
                event_type: 'LogCreated', logs: logs
            });
        }
        catch (e) {
            this.markLogs('failed', logs);
            throw e;
        }
    }
    async onScreenshot(jsonArray) {
        if (!this.shouldSendEvents()) {
            return;
        }
        try {
            if (!shouldProcessEventForTesthub('LogCreated')) {
                return;
            }
            this.markLogs('triggered', jsonArray);
            this.pendingUploads += 1;
            await sendScreenshots([{
                    event_type: 'LogCreated', logs: jsonArray
                }]);
            this.markLogs('success', jsonArray);
        }
        catch (e) {
            this.markLogs('failed', jsonArray);
            throw e;
        }
        finally {
            this.pendingUploads -= 1;
        }
    }
    cbtSessionCreated(data) {
        try {
            if (!shouldProcessEventForTesthub('CBTSessionCreated')) {
                return;
            }
            this.cbtSessionStats.triggered();
            this.sendBatchEvents({ event_type: 'CBTSessionCreated', test_run: data });
        }
        catch (e) {
            this.cbtSessionStats.failed();
            throw e;
        }
    }
    markLogs(status, data) {
        if (!data) {
            BStackLogger.debug('No log data');
            return;
        }
        try {
            for (const _log of data) {
                const kind = _log.kind;
                this.logEvents.mark(status, LOG_KIND_USAGE_MAP[kind] || kind);
            }
        }
        catch (e) {
            BStackLogger.debug('Exception in marking logs status ' + e);
            throw e;
        }
    }
    getResult(jsonObject, kind) {
        const runStr = kind === 'test' ? 'test_run' : 'hook_run';
        const runData = jsonObject[runStr];
        return runData?.result;
    }
    shouldSendEvents() {
        return isTrue(process.env[TESTOPS_BUILD_COMPLETED_ENV]);
    }
    sendBatchEvents(jsonObject) {
        if (!this.shouldSendEvents()) {
            return;
        }
        if (!this.requestBatcher) {
            this.requestBatcher = RequestQueueHandler.getInstance(async (data) => {
                BStackLogger.debug('callback: called with events ' + data.length);
                try {
                    this.pendingUploads += 1;
                    await batchAndPostEvents(DATA_BATCH_ENDPOINT, 'BATCH_DATA', data);
                    BStackLogger.debug('callback: marking events success ' + data.length);
                    this.eventsSuccess(data);
                }
                catch (e) {
                    BStackLogger.debug('callback: marking events failed ' + data.length);
                    this.eventsFailed(data);
                }
                finally {
                    this.pendingUploads -= 1;
                }
            });
        }
        this.requestBatcher.add(jsonObject);
    }
    eventsFailed(events) {
        for (const event of events) {
            const eventType = event.event_type;
            if (eventType === 'TestRunStarted') {
                this.testStartedStats.failed();
            }
            else if (eventType === 'TestRunFinished') {
                this.testFinishedStats.failed(this.getResult(event, 'test'));
            }
            else if (eventType === 'HookRunStarted') {
                this.hookStartedStats.failed();
            }
            else if (eventType === 'HookRunFinished') {
                this.hookFinishedStats.failed(this.getResult(event, 'hook'));
            }
            else if (eventType === 'CBTSessionCreated') {
                this.cbtSessionStats.failed();
            }
            else if (eventType === 'LogCreated') {
                this.markLogs('failed', event.logs);
            }
        }
    }
    eventsSuccess(events) {
        for (const event of events) {
            const eventType = event.event_type;
            if (eventType === 'TestRunStarted') {
                this.testStartedStats.success();
            }
            else if (eventType === 'TestRunFinished') {
                this.testFinishedStats.success(this.getResult(event, 'test'));
            }
            else if (eventType === 'HookRunStarted') {
                this.hookStartedStats.success();
            }
            else if (eventType === 'HookRunFinished') {
                this.hookFinishedStats.success(this.getResult(event, 'hook'));
            }
            else if (eventType === 'CBTSessionCreated') {
                this.cbtSessionStats.success();
            }
            else if (eventType === 'LogCreated') {
                this.markLogs('success', event.logs);
            }
        }
    }
    getEventForHook(eventType, data) {
        return {
            event_type: eventType, [data.type === 'hook' ? 'hook_run' : 'test_run']: data
        };
    }
}
export default Listener;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlzdGVuZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdGVzdE9wcy9saXN0ZW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLFVBQVUsTUFBTSxpQkFBaUIsQ0FBQTtBQUV4QyxPQUFPLG1CQUFtQixNQUFNLHVCQUF1QixDQUFBO0FBRXZELE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sWUFBWSxDQUFBO0FBQzlELE9BQU8sRUFDSCxtQkFBbUIsRUFDbkIseUNBQXlDLEVBQ3pDLHdDQUF3QyxFQUN4QyxrQkFBa0IsRUFBRSwyQkFBMkIsRUFDL0MsaUJBQWlCLEVBQ3BCLE1BQU0saUJBQWlCLENBQUE7QUFDeEIsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBQ25ELE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxvQkFBb0IsQ0FBQTtBQUNqRCxPQUFPLEVBQUUsNEJBQTRCLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQTtBQUVsRSxNQUFNLFFBQVE7SUFDRixNQUFNLENBQUMsUUFBUSxDQUFVO0lBQ2hCLFVBQVUsR0FBZSxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDakQsZ0JBQWdCLEdBQWlCLElBQUksQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLENBQUE7SUFDakUsaUJBQWlCLEdBQWlCLElBQUksQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUE7SUFDbkUsZ0JBQWdCLEdBQWlCLElBQUksQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLENBQUE7SUFDakUsaUJBQWlCLEdBQWlCLElBQUksQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUE7SUFDbkUsZUFBZSxHQUFpQixJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQTtJQUMvRCxTQUFTLEdBQWlCLElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFBO0lBQzNELGNBQWMsQ0FBc0I7SUFDcEMsY0FBYyxHQUFH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