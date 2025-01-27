import { PerformanceObserver } from 'node:perf_hooks';
export default class PerformanceTester {
    static _observer: PerformanceObserver;
    static _csvWriter: any;
    private static _events;
    static started: boolean;
    static startMonitoring(csvName?: string): void;
    static getPerformance(): import("perf_hooks").Performance;
    static calculateTimes(methods: string[]): number;
    static stopAndGenerate(filename?: string): Promise<void>;
    static generateReport(entries: PerformanceEntry[]): string;
    static generateCSV(entries: PerformanceEntry[]): void;
}
//# sourceMappingURL=performance-tester.d.ts.map