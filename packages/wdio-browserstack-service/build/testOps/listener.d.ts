import type { CBTData, LogData, ScreenshotLog, TestData } from '../types.js';
declare class Listener {
    private static instance;
    private readonly usageStats;
    private readonly testStartedStats;
    private readonly testFinishedStats;
    private readonly hookStartedStats;
    private readonly hookFinishedStats;
    private readonly cbtSessionStats;
    private readonly logEvents;
    private requestBatcher?;
    private pendingUploads;
    private static _accessibilityOptions?;
    private static _testRunAccessibilityVar?;
    private constructor();
    static getInstance(): Listener;
    static setAccessibilityOptions(options: {
        [key: string]: any;
    } | undefined): void;
    static setTestRunAccessibilityVar(accessibility: boolean | undefined): void;
    onWorkerEnd(): Promise<void>;
    uploadPending(waitTimeout?: number, waitInterval?: number): Promise<unknown>;
    teardown(): Promise<void>;
    hookStarted(hookData: TestData): void;
    hookFinished(hookData: TestData): void;
    testStarted(testData: TestData): void;
    testFinished(testData: TestData): void;
    logCreated(logs: LogData[]): void;
    onScreenshot(jsonArray: ScreenshotLog[]): Promise<void>;
    cbtSessionCreated(data: CBTData): void;
    private markLogs;
    private getResult;
    private shouldSendEvents;
    private sendBatchEvents;
    private eventsFailed;
    private eventsSuccess;
    private getEventForHook;
}
export default Listener;
//# sourceMappingURL=listener.d.ts.map