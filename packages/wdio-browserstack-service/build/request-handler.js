import { DATA_BATCH_SIZE, DATA_BATCH_INTERVAL, TESTOPS_BUILD_COMPLETED_ENV } from './constants.js';
import { BStackLogger } from './bstackLogger.js';
export default class RequestQueueHandler {
    queue = [];
    pollEventBatchInterval;
    callback;
    static tearDownInvoked = false;
    static instance;
    // making it private to use singleton pattern
    constructor(callback) {
        this.callback = callback;
        this.startEventBatchPolling();
    }
    static getInstance(callback) {
        if (!RequestQueueHandler.instance && callback) {
            RequestQueueHandler.instance = new RequestQueueHandler(callback);
        }
        return RequestQueueHandler.instance;
    }
    add(event) {
        if (!process.env[TESTOPS_BUILD_COMPLETED_ENV]) {
            throw new Error('Observability build start not completed yet.');
        }
        this.queue.push(event);
        BStackLogger.debug(`Added data to request queue. Queue length = ${this.queue.length}`);
        const shouldProceed = this.shouldProceed();
        if (shouldProceed) {
            this.sendBatch().catch((e) => {
                BStackLogger.debug('Exception in sending batch: ' + e);
            });
        }
    }
    async shutdown() {
        BStackLogger.debug('shutdown started');
        this.removeEventBatchPolling('Shutting down');
        while (this.queue.length > 0) {
            const data = this.queue.splice(0, DATA_BATCH_SIZE);
            await this.callCallback(data, 'SHUTDOWN_QUEUE');
        }
        BStackLogger.debug('shutdown ended');
    }
    startEventBatchPolling() {
        this.pollEventBatchInterval = setInterval(this.sendBatch.bind(this), DATA_BATCH_INTERVAL);
    }
    async sendBatch() {
        const data = this.queue.splice(0, DATA_BATCH_SIZE);
        if (data.length === 0) {
            return;
        }
        BStackLogger.debug(`Sending data from request queue. Data length = ${data.length}, Queue length after removal = ${this.queue.length}`);
        await this.callCallback(data, 'INTERVAL_QUEUE');
    }
    callCallback = async (data, kind) => {
        BStackLogger.debug('calling callback with kind ' + kind);
        this.callback && await this.callback(data);
    };
    resetEventBatchPolling() {
        this.removeEventBatchPolling('Resetting');
        this.startEventBatchPolling();
    }
    removeEventBatchPolling(tag) {
        if (this.pollEventBatchInterval) {
            BStackLogger.debug(`${tag} request queue`);
            clearInterval(this.pollEventBatchInterval);
        }
    }
    shouldProceed() {
        if (RequestQueueHandler.tearDownInvoked) {
            BStackLogger.debug('Force request-queue shutdown, as test run event is received after teardown');
            return true;
        }
        return this.queue.length >= DATA_BATCH_SIZE;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3JlcXVlc3QtaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsZUFBZSxFQUFFLG1CQUFtQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sZ0JBQWdCLENBQUE7QUFFbEcsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBRWhELE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUJBQW1CO0lBQzVCLEtBQUssR0FBaUIsRUFBRSxDQUFBO0lBQ3hCLHNCQUFzQixDQUFpQztJQUM5QyxRQUFRLENBQVc7SUFDN0IsTUFBTSxDQUFDLGVBQWUsR0FBRyxLQUFLLENBQUE7SUFFckMsTUFBTSxDQUFDLFFBQVEsQ0FBcUI7SUFFcEMsNkNBQTZDO0lBQzdDLFlBQW9CLFFBQWtCO1FBQ2xDLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO0lBQ2pDLENBQUM7SUFFTSxNQUFNLENBQUMsV0FBVyxDQUFDLFFBQW1CO1FBQ3pDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLElBQUksUUFBUSxFQUFFLENBQUM7WUFDNUMsbUJBQW1CLENBQUMsUUFBUSxHQUFHLElBQUksbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDcEUsQ0FBQztRQUNELE9BQU8sbUJBQW1CLENBQUMsUUFBUSxDQUFBO0lBQ3ZDLENBQUM7SUFFRCxHQUFHLENBQUUsS0FBaUI7UUFDbEIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLENBQUMsRUFBRSxDQUFDO1lBQzVDLE1BQU0sSUFBSSxLQUFLLENBQUMsOENBQThDLENBQUMsQ0FBQTtRQUNuRSxDQUFDO1FBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDdEIsWUFBWSxDQUFDLEtBQUss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