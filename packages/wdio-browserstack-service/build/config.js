import TestOpsConfig from './testOps/testOpsConfig.js';
import { isUndefined } from './util.js';
import { v4 as uuidv4 } from 'uuid';
class BrowserStackConfig {
    static getInstance(options, config) {
        if (!this._instance && options && config) {
            this._instance = new BrowserStackConfig(options, config);
        }
        return this._instance;
    }
    userName;
    accessKey;
    framework;
    buildName;
    buildIdentifier;
    testObservability;
    percy;
    percyCaptureMode;
    accessibility;
    app;
    static _instance;
    appAutomate;
    automate;
    funnelDataSent = false;
    sdkRunID;
    killSignal;
    percyBuildId;
    isPercyAutoEnabled = false;
    constructor(options, config) {
        this.framework = config.framework;
        this.userName = config.user;
        this.accessKey = config.key;
        this.testObservability = new TestOpsConfig(options.testObservability !== false, !isUndefined(options.testObservability));
        this.percy = options.percy || false;
        this.accessibility = options.accessibility || false;
        this.app = options.app;
        this.appAutomate = !isUndefined(options.app);
        this.automate = !this.appAutomate;
        this.buildIdentifier = options.buildIdentifier;
        this.sdkRunID = uuidv4();
    }
    sentFunnelData() {
        this.funnelDataSent = true;
    }
    setKillSignal(sig) {
        this.killSignal = sig;
    }
}
export default BrowserStackConfig;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2NvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFFQSxPQUFPLGFBQWEsTUFBTSw0QkFBNEIsQ0FBQTtBQUN0RCxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sV0FBVyxDQUFBO0FBQ3ZDLE9BQU8sRUFBRSxFQUFFLElBQUksTUFBTSxFQUFFLE1BQU0sTUFBTSxDQUFBO0FBRW5DLE1BQU0sa0JBQWtCO0lBQ3BCLE1BQU0sQ0FBQyxXQUFXLENBQUMsT0FBaUQsRUFBRSxNQUEyQjtRQUM3RixJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLElBQUksTUFBTSxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLGtCQUFrQixDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUM1RCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFBO0lBQ3pCLENBQUM7SUFFTSxRQUFRLENBQVM7SUFDakIsU0FBUyxDQUFTO0lBQ2xCLFNBQVMsQ0FBUztJQUNsQixTQUFTLENBQVM7SUFDbEIsZUFBZSxDQUFTO0lBQ3hCLGlCQUFpQixDQUFlO0lBQ2hDLEtBQUssQ0FBUztJQUNkLGdCQUFnQixDQUFTO0lBQ3pCLGFBQWEsQ0FBUztJQUN0QixHQUFHLENBQW1CO0lBQ3JCLE1BQU0sQ0FBQyxTQUFTLENBQW9CO0lBQ3JDLFdBQVcsQ0FBUztJQUNwQixRQUFRLENBQVM7SUFDakIsY0FBYyxHQUFZLEtBQUssQ0FBQTtJQUMvQixRQUFRLENBQVE7SUFDaEIsVUFBVSxDQUFTO0lBQ25CLFlBQVksQ0FBZ0I7SUFDNUIsa0JBQWtCLEdBQUcsS0FBSyxDQUFBO0lBRWpDLFlBQW9CLE9BQWdELEVBQUUsTUFBMEI7UUFDNUYsSUFBSSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFBO1FBQ2pDLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQTtRQUMzQixJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUE7UUFDM0IsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksYUFBYSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsS0FBSyxLQUFLLEVBQUUsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQTtRQUN4SCxJQUFJLENBQUMsS0FBSyxHQUFHLE9BQU8sQ0FBQyxLQUFLLElBQUksS0FBSyxDQUFBO1FBQ25DLElBQUksQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDLGFBQWEsSUFBSSxLQUFLLENBQUE7UUFDbkQsSUFBSSxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxXQUFXLEdBQUcsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQzVDLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFBO1FBQ2pDLElBQUksQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFDLGVBQWUsQ0FBQTtRQUM5QyxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFBO0lBQzVCLENBQUM7SUFFRCxjQUFjO1FBQ1YsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUE7SUFDOUIsQ0FBQztJQUVELGFBQWEsQ0FBQyxHQUFXO1FBQ3JCLElBQUksQ0FBQyxVQUFVLEdBQUcsR0FBRyxDQUFBO0lBQ3pCLENBQUM7Q0FFSjtBQUVELGVBQWUsa0JBQWtCLENBQUEifQ==