import FeatureStats from './featureStats.js';
import FeatureUsage from './featureUsage.js';
import { BStackLogger } from '../bstackLogger.js';
import TestOpsConfig from './testOpsConfig.js';
class UsageStats {
    static instance;
    testStartedStats;
    testFinishedStats;
    hookStartedStats;
    hookFinishedStats;
    cbtSessionStats;
    logStats;
    launchBuildUsage;
    stopBuildUsage;
    static getInstance() {
        if (!UsageStats.instance) {
            UsageStats.instance = new UsageStats();
        }
        return UsageStats.instance;
    }
    constructor() {
        this.testStartedStats = new FeatureStats();
        this.testFinishedStats = new FeatureStats();
        this.hookStartedStats = new FeatureStats();
        this.hookFinishedStats = new FeatureStats();
        this.cbtSessionStats = new FeatureStats();
        this.logStats = new FeatureStats();
        this.launchBuildUsage = new FeatureUsage();
        this.stopBuildUsage = new FeatureUsage();
    }
    add(usageStats) {
        this.testStartedStats.add(usageStats.testStartedStats);
        this.testFinishedStats.add(usageStats.testFinishedStats);
        this.hookStartedStats.add(usageStats.hookStartedStats);
        this.hookFinishedStats.add(usageStats.hookFinishedStats);
        this.cbtSessionStats.add(usageStats.cbtSessionStats);
        this.logStats.add(usageStats.logStats);
    }
    getFormattedData(workersData) {
        this.addDataFromWorkers(workersData);
        const testOpsConfig = TestOpsConfig.getInstance();
        const usage = {
            enabled: testOpsConfig.enabled,
            manuallySet: testOpsConfig.manuallySet,
            buildHashedId: testOpsConfig.buildHashedId
        };
        if (!usage.enabled) {
            return usage;
        }
        try {
            usage.events = this.getEventsData();
        }
        catch (e) {
            BStackLogger.debug('exception in getFormattedData: ' + e);
        }
        return usage;
    }
    addDataFromWorkers(workersData) {
        workersData.map(workerData => {
            try {
                const usageStatsForWorker = UsageStats.fromJSON(workerData.usageStats);
                this.add(usageStatsForWorker);
            }
            catch (e) {
                BStackLogger.debug('Exception in adding workerData: ' + e);
            }
        });
    }
    getEventsData() {
        return {
            buildEvents: {
                started: this.launchBuildUsage.toJSON(),
                finished: this.stopBuildUsage.toJSON()
            },
            testEvents: {
                started: this.testStartedStats.toJSON(),
                finished: this.testFinishedStats.toJSON({ omitGroups: true }),
                ...this.testFinishedStats.toJSON({ onlyGroups: true })
            },
            hookEvents: {
                started: this.hookStartedStats.toJSON(),
                finished: this.hookFinishedStats.toJSON({ omitGroups: true }),
                ...this.hookFinishedStats.toJSON({ onlyGroups: true })
            },
            logEvents: this.logStats.toJSON(),
            cbtSessionEvents: this.cbtSessionStats.toJSON()
        };
    }
    getDataToSave() {
        return {
            testEvents: {
                started: this.testStartedStats.toJSON(),
                finished: this.testFinishedStats.toJSON({ nestedGroups: true }),
            },
            hookEvents: {
                started: this.hookStartedStats.toJSON(),
                finished: this.hookFinishedStats.toJSON({ nestedGroups: true }),
            },
            logEvents: this.logStats.toJSON({ nestedGroups: true }),
            cbtSessionEvents: this.cbtSessionStats.toJSON()
        };
    }
    static fromJSON(data) {
        const usageStats = new UsageStats();
        usageStats.testStartedStats = FeatureStats.fromJSON(data.testEvents.started);
        usageStats.testFinishedStats = FeatureStats.fromJSON(data.testEvents.finished);
        usageStats.hookStartedStats = FeatureStats.fromJSON(data.hookEvents.started);
        usageStats.hookFinishedStats = FeatureStats.fromJSON(data.hookEvents.finished);
        usageStats.logStats = FeatureStats.fromJSON(data.logEvents);
        usageStats.cbtSessionStats = FeatureStats.fromJSON(data.cbtSessionStats);
        return usageStats;
    }
}
export default UsageStats;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNhZ2VTdGF0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90ZXN0T3BzL3VzYWdlU3RhdHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxZQUFZLE1BQU0sbUJBQW1CLENBQUE7QUFDNUMsT0FBTyxZQUFZLE1BQU0sbUJBQW1CLENBQUE7QUFDNUMsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2pELE9BQU8sYUFBYSxNQUFNLG9CQUFvQixDQUFBO0FBRzlDLE1BQU0sVUFBVTtJQUNMLE1BQU0sQ0FBQyxRQUFRLENBQVk7SUFDM0IsZ0JBQWdCLENBQWM7SUFDOUIsaUJBQWlCLENBQWM7SUFDL0IsZ0JBQWdCLENBQWM7SUFDOUIsaUJBQWlCLENBQWM7SUFDL0IsZUFBZSxDQUFjO0lBQzdCLFFBQVEsQ0FBYztJQUN0QixnQkFBZ0IsQ0FBYztJQUM5QixjQUFjLENBQWM7SUFFNUIsTUFBTSxDQUFDLFdBQVc7UUFDckIsSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUN2QixVQUFVLENBQUMsUUFBUSxHQUFHLElBQUksVUFBVSxFQUFFLENBQUE7UUFDMUMsQ0FBQztRQUNELE9BQU8sVUFBVSxDQUFDLFFBQVEsQ0FBQTtJQUM5QixDQUFDO0lBRUQ7UUFDSSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtRQUMxQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtRQUMzQyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtRQUMxQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtRQUMzQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksWUFBWSxFQUFFLENBQUE7UUFDekMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFBO1FBQ2xDLElBQUks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