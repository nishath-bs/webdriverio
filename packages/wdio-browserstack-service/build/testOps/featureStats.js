import { BStackLogger } from '../bstackLogger.js';
import { isObjectEmpty } from '../util.js';
class FeatureStats {
    triggeredCount = 0;
    sentCount = 0;
    failedCount = 0;
    groups = {};
    mark(status, groupId) {
        switch (status) {
            case 'triggered':
                this.triggered(groupId);
                break;
            case 'success':
            case 'sent':
                this.sent(groupId);
                break;
            case 'failed':
                this.failed(groupId);
                break;
            default:
                BStackLogger.debug('Request to mark usage for unknown status - ' + status);
                break;
        }
    }
    triggered(groupId) {
        this.triggeredCount += 1;
        if (groupId) {
            this.createGroup(groupId).triggered();
        }
    }
    sent(groupId) {
        this.sentCount += 1;
        if (groupId) {
            this.createGroup(groupId).sent();
        }
    }
    failed(groupId) {
        this.failedCount += 1;
        if (groupId) {
            this.createGroup(groupId).failed();
        }
    }
    success(groupId) {
        this.sent(groupId);
    }
    createGroup(groupId) {
        if (!this.groups[groupId]) {
            this.groups[groupId] = new FeatureStats();
        }
        return this.groups[groupId];
    }
    getTriggeredCount() {
        return this.triggeredCount;
    }
    getSentCount() {
        return this.sentCount;
    }
    getFailedCount() {
        return this.failedCount;
    }
    getUsageForGroup(groupId) {
        return this.groups[groupId] || new FeatureStats();
    }
    getOverview() {
        return { triggeredCount: this.triggeredCount, sentCount: this.sentCount, failedCount: this.failedCount };
    }
    getGroups() {
        return this.groups;
    }
    add(featureStats) {
        this.triggeredCount += featureStats.getTriggeredCount();
        this.sentCount += featureStats.getSentCount();
        this.failedCount += featureStats.getFailedCount();
        Object.entries(featureStats.getGroups()).forEach(([groupId, group]) => {
            this.createGroup(groupId).add(group);
        });
    }
    // omitGroups: true/false -> Include groups or not
    // onlyGroups: true/false -> data includes only groups
    // nestedGroups: true/false -> groups will be nested in groups if true
    toJSON(config = {}) {
        const overviewData = !config.onlyGroups ? {
            triggeredCount: this.triggeredCount,
            sentCount: this.sentCount,
            failedCount: this.failedCount
        } : {};
        const groupsData = {};
        if (!config.omitGroups) {
            Object.entries(this.groups).forEach(([groupId, group]) => {
                groupsData[groupId] = group.toJSON(); // Currently Nested groups are only overviews
            });
        }
        const group = config.nestedGroups ? { groups: groupsData } : groupsData;
        return {
            ...overviewData,
            ...group
        };
    }
    static fromJSON(json) {
        const stats = new FeatureStats();
        if (!json || isObjectEmpty(json)) {
            return stats;
        }
        stats.triggeredCount = json.triggeredCount;
        stats.sentCount = json.sentCount;
        stats.failedCount = json.failedCount;
        if (!json.groups) {
            return stats;
        }
        Object.entries(json.groups).forEach(([groupId, group]) => {
            stats.groups[groupId] = FeatureStats.fromJSON(group);
        });
        return stats;
    }
}
export default FeatureStats;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmVhdHVyZVN0YXRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Rlc3RPcHMvZmVhdHVyZVN0YXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxvQkFBb0IsQ0FBQTtBQUVqRCxPQUFPLEVBQUUsYUFBYSxFQUFFLE1BQU0sWUFBWSxDQUFBO0FBWTFDLE1BQU0sWUFBWTtJQUNOLGNBQWMsR0FBVyxDQUFDLENBQUE7SUFDMUIsU0FBUyxHQUFXLENBQUMsQ0FBQTtJQUNyQixXQUFXLEdBQVcsQ0FBQyxDQUFBO0lBQ3ZCLE1BQU0sR0FBb0IsRUFBRSxDQUFBO0lBRTdCLElBQUksQ0FBQyxNQUFjLEVBQUUsT0FBZTtRQUN2QyxRQUFRLE1BQU0sRUFBRSxDQUFDO1lBQ2pCLEtBQUssV0FBVztnQkFDWixJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUN2QixNQUFLO1lBQ1QsS0FBSyxTQUFTLENBQUM7WUFDZixLQUFLLE1BQU07Z0JBQ1AsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtnQkFDbEIsTUFBSztZQUNULEtBQUssUUFBUTtnQkFDVCxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUNwQixNQUFLO1lBQ1Q7Z0JBQ0ksWUFBWSxDQUFDLEtBQUssQ0FBQyw2Q0FBNkMsR0FBRyxNQUFNLENBQUMsQ0FBQTtnQkFDMUUsTUFBSztRQUNULENBQUM7SUFDTCxDQUFDO0lBRU0sU0FBUyxDQUFDLE9BQWdCO1FBQzdCLElBQUksQ0FBQyxjQUFjLElBQUksQ0FBQyxDQUFBO1FBQ3hCLElBQUksT0FBTyxFQUFFLENBQUM7WUFDVixJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3pDLENBQUM7SUFDTCxDQUFDO0lBRU0sSUFBSSxDQUFDLE9BQWdCO1FBQ3hCLElBQUksQ0FBQyxTQUFT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