import { getErrorString, stopBuildUpstream } from './util.js';
import { BStackLogger } from './bstackLogger.js';
import fs from 'node:fs';
import { fireFunnelRequest } from './instrumentation/funnelInstrumentation.js';
import { BROWSERSTACK_TESTHUB_UUID, BROWSERSTACK_TESTHUB_JWT, BROWSERSTACK_OBSERVABILITY } from './constants.js';
export default class BStackCleanup {
    static async startCleanup() {
        try {
            // Get funnel data object from saved file
            const funnelDataCleanup = process.argv.includes('--funnelData');
            let funnelData = null;
            if (funnelDataCleanup) {
                const index = process.argv.indexOf('--funnelData');
                const filePath = process.argv[index + 1];
                funnelData = this.getFunnelDataFromFile(filePath);
            }
            if (process.argv.includes('--observability')) {
                await this.executeObservabilityCleanup(funnelData);
            }
            if (funnelDataCleanup && funnelData) {
                await this.sendFunnelData(funnelData);
            }
        }
        catch (err) {
            const error = err;
            BStackLogger.error(error);
        }
    }
    static async executeObservabilityCleanup(funnelData) {
        if (!process.env[BROWSERSTACK_TESTHUB_JWT]) {
            return;
        }
        BStackLogger.debug('Executing observability cleanup');
        try {
            const killSignal = funnelData?.event_properties?.finishedMetadata?.signal;
            const result = await stopBuildUpstream(killSignal);
            if (process.env[BROWSERSTACK_OBSERVABILITY] && process.env[BROWSERSTACK_TESTHUB_UUID]) {
                BStackLogger.info(`\nVisit https://observability.browserstack.com/builds/${process.env[BROWSERSTACK_TESTHUB_UUID]} to view build report, insights, and many more debugging information all at one place!\n`);
            }
            const status = (result && result.status) || 'failed';
            const message = (result && result.message);
            this.updateO11yStopData(funnelData, status, status === 'failed' ? message : undefined);
        }
        catch (e) {
            BStackLogger.error('Error in stopping Observability build: ' + e);
            this.updateO11yStopData(funnelData, 'failed', e);
        }
    }
    static updateO11yStopData(funnelData, status, error = undefined) {
        const toData = funnelData?.event_properties?.productUsage?.testObservability;
        // Return if no O11y data in funnel data
        if (!toData) {
            return;
        }
        let existingStopData = toData.events.buildEvents.finished;
        existingStopData = existingStopData || {};
        existingStopData = {
            ...existingStopData,
            status,
            error: getErrorString(error),
            stoppedFrom: 'exitHook'
        };
        toData.events.buildEvents.finished = existingStopData;
    }
    static async sendFunnelData(funnelData) {
        try {
            await fireFunnelRequest(funnelData);
            BStackLogger.debug('Funnel data sent successfully from cleanup');
        }
        catch (e) {
            BStackLogger.error('Error in sending funnel data: ' + e);
        }
    }
    static getFunnelDataFromFile(filePath) {
        if (!filePath) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        this.removeFunnelDataFile(filePath);
        return data;
    }
    static removeFunnelDataFile(filePath) {
        if (!filePath) {
            return;
        }
        fs.rmSync(filePath, { force: true });
    }
}
await BStackCleanup.startCleanup();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xlYW51cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9jbGVhbnVwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxjQUFjLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSxXQUFXLENBQUE7QUFDN0QsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBQ2hELE9BQU8sRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUN4QixPQUFPLEVBQUUsaUJBQWlCLEVBQUUsTUFBTSw0Q0FBNEMsQ0FBQTtBQUM5RSxPQUFPLEVBQUUseUJBQXlCLEVBQUUsd0JBQXdCLEVBQUUsMEJBQTBCLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQTtBQUVoSCxNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWE7SUFDOUIsTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZO1FBQ3JCLElBQUksQ0FBQztZQUNELHlDQUF5QztZQUN6QyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQy9ELElBQUksVUFBVSxHQUFHLElBQUksQ0FBQTtZQUNyQixJQUFJLGlCQUFpQixFQUFFLENBQUM7Z0JBQ3BCLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFBO2dCQUNsRCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQTtnQkFDeEMsVUFBVSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNyRCxDQUFDO1lBRUQsSUFBSSxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUM7Z0JBQzNDLE1BQU0sSUFBSSxDQUFDLDJCQUEyQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3RELENBQUM7WUFFRCxJQUFJLGlCQUFpQixJ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