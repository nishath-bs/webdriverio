import { o11yClassErrorHandler, sleep } from '../util.js';
import PercyCaptureMap from './PercyCaptureMap.js';
import * as PercySDK from './PercySDK.js';
import { PercyLogger } from './PercyLogger.js';
import { PERCY_DOM_CHANGING_COMMANDS_ENDPOINTS, CAPTURE_MODES } from '../constants.js';
class _PercyHandler {
    _percyAutoCaptureMode;
    _browser;
    _capabilities;
    _isAppAutomate;
    _framework;
    _testMetadata = {};
    _sessionName;
    _isPercyCleanupProcessingUnderway = false;
    _percyScreenshotCounter = 0;
    _percyDeferredScreenshots = [];
    _percyScreenshotInterval = null;
    _percyCaptureMap;
    constructor(_percyAutoCaptureMode, _browser, _capabilities, _isAppAutomate, _framework) {
        this._percyAutoCaptureMode = _percyAutoCaptureMode;
        this._browser = _browser;
        this._capabilities = _capabilities;
        this._isAppAutomate = _isAppAutomate;
        this._framework = _framework;
        if (!_percyAutoCaptureMode || !CAPTURE_MODES.includes(_percyAutoCaptureMode)) {
            this._percyAutoCaptureMode = 'auto';
        }
    }
    _setSessionName(name) {
        this._sessionName = name;
    }
    async teardown() {
        await new Promise((resolve) => {
            setInterval(() => {
                if (this._percyScreenshotCounter === 0) {
                    resolve();
                }
            }, 1000);
        });
    }
    async percyAutoCapture(eventName, sessionName) {
        try {
            if (eventName) {
                if (!sessionName) {
                    /* Service doesn't wait for handling of browser commands so the below counter is used in teardown method to delay service exit */
                    this._percyScreenshotCounter += 1;
                }
                this._percyCaptureMap?.increment(sessionName ? sessionName : this._sessionName, eventName);
                await (this._isAppAutomate ? PercySDK.screenshotApp(this._percyCaptureMap?.getName(sessionName ? sessionName : this._sessionName, eventName)) : await PercySDK.screenshot(this._browser, this._percyCaptureMap?.getName(sessionName ? sessionName : this._sessionName, eventName)));
                this._percyScreenshotCounter -= 1;
            }
        }
        catch (err) {
            this._percyScreenshotCounter -= 1;
            this._percyCaptureMap?.decrement(sessionName ? sessionName : this._sessionName, eventName);
            PercyLogger.error(`Error while trying to auto capture Percy screenshot ${err}`);
        }
    }
    async before() {
        this._percyCaptureMap = new PercyCaptureMap();
    }
    deferCapture(sessionName, eventName) {
        /* Service doesn't wait for handling of browser commands so the below counter is used in teardown method to delay service exit */
        this._percyScreenshotCounter += 1;
        this._percyDeferredScreenshots.push({ sessionName, eventName });
    }
    isDOMChangingCommand(args) {
        /*
          Percy screenshots which are to be taken on events such as send keys, element click & screenshot are deferred until
          another DOM changing command is seen such that any DOM processing post the previous command is completed
        */
        return (typeof args.method === 'string' && typeof args.endpoint === 'string' &&
            ((args.method === 'POST' &&
                (PERCY_DOM_CHANGING_COMMANDS_ENDPOINTS.includes(args.endpoint) ||
                    (
                    /* click / clear element */
                    args.endpoint.includes('/session/:sessionId/element') &&
                        (args.endpoint.includes('click') ||
                            args.endpoint.includes('clear'))) ||
                    /* execute script sync / async */
                    (args.endpoint.includes('/session/:sessionId/execute') && args.body?.script) ||
                    /* Touch action for Appium */
                    (args.endpoint.includes('/session/:sessionId/touch')))) ||
                (args.method === 'DELETE' && args.endpoint === '/session/:sessionId')));
    }
    async cleanupDeferredScreenshots() {
        this._isPercyCleanupProcessingUnderway = true;
        for (const entry of this._percyDeferredScreenshots) {
            await this.percyAutoCapture(entry.eventName, entry.sessionName);
        }
        this._percyDeferredScreenshots = [];
        this._isPercyCleanupProcessingUnderway = false;
    }
    async browserBeforeCommand(args) {
        try {
            if (!this.isDOMChangingCommand(args)) {
                return;
            }
            do {
                await sleep(1000);
            } while (this._percyScreenshotInterval);
            this._percyScreenshotInterval = setInterval(async () => {
                if (!this._isPercyCleanupProcessingUnderway) {
                    clearInterval(this._percyScreenshotInterval);
                    await this.cleanupDeferredScreenshots();
                    this._percyScreenshotInterval = null;
                }
            }, 1000);
        }
        catch (err) {
            PercyLogger.error(`Error while trying to cleanup deferred screenshots ${err}`);
        }
    }
    async browserAfterCommand(args) {
        try {
            if (!args.endpoint || !this._percyAutoCaptureMode) {
                return;
            }
            let eventName = null;
            const endpoint = args.endpoint;
            if (endpoint.includes('click') && ['click', 'auto'].includes(this._percyAutoCaptureMode)) {
                eventName = 'click';
            }
            else if (endpoint.includes('screenshot') && ['screenshot', 'auto'].includes(this._percyAutoCaptureMode)) {
                eventName = 'screenshot';
            }
            else if (endpoint.includes('actions') && ['auto'].includes(this._percyAutoCaptureMode)) {
                if (args.body && args.body.actions && Array.isArray(args.body.actions) && args.body.actions.length && args.body.actions[0].type === 'key') {
                    eventName = 'keys';
                }
            }
            else if (endpoint.includes('/session/:sessionId/element') && endpoint.includes('value') && ['auto'].includes(this._percyAutoCaptureMode)) {
                eventName = 'keys';
            }
            if (eventName) {
                this.deferCapture(this._sessionName, eventName);
            }
        }
        catch (err) {
            PercyLogger.error(`Error while trying to calculate auto capture parameters ${err}`);
        }
    }
    async afterTest() {
        if (this._percyAutoCaptureMode && this._percyAutoCaptureMode === 'testcase') {
            await this.percyAutoCapture('testcase', null);
        }
    }
    async afterScenario() {
        if (this._percyAutoCaptureMode && this._percyAutoCaptureMode === 'testcase') {
            await this.percyAutoCapture('testcase', null);
        }
    }
}
// https://github.com/microsoft/TypeScript/issues/6543
const PercyHandler = o11yClassErrorHandler(_PercyHandler);
export default PercyHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGVyY3ktSGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QZXJjeS9QZXJjeS1IYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUdBLE9BQU8sRUFDSCxxQkFBcUIsRUFDckIsS0FBSyxFQUNSLE1BQU0sWUFBWSxDQUFBO0FBQ25CLE9BQU8sZUFBZSxNQUFNLHNCQUFzQixDQUFBO0FBRWxELE9BQU8sS0FBSyxRQUFRLE1BQU0sZUFBZSxDQUFBO0FBQ3pDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxrQkFBa0IsQ0FBQTtBQUU5QyxPQUFPLEVBQUUscUNBQXFDLEVBQUUsYUFBYSxFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFFdEYsTUFBTSxhQUFhO0lBVUg7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQWJKLGFBQWEsR0FBMkIsRUFBRSxDQUFBO0lBQzFDLFlBQVksQ0FBUztJQUNyQixpQ0FBaUMsR0FBYSxLQUFLLENBQUE7SUFDbkQsdUJBQXVCLEdBQVEsQ0FBQyxDQUFBO0lBQ2hDLHlCQUF5QixHQUFRLEVBQUUsQ0FBQTtJQUNuQyx3QkFBd0IsR0FBUSxJQUFJLENBQUE7SUFDcEMsZ0JBQWdCLENBQWtCO0lBRTFDLFlBQ1kscUJBQXlDLEVBQ3pDLFFBQThELEVBQzlELGFBQTRDLEVBQzVDLGNBQXdCLEVBQ3hCLFVBQW1CO1FBSm5CLDBCQUFxQixHQUFyQixxQkFBcUIsQ0FBb0I7UUFDekMsYUFBUSxHQUFSLFFBQVEsQ0FBc0Q7UUFDOUQsa0JBQWEsR0FBYixhQUFhLENBQStCO1FBQzVDLG1CQUFjLEdBQWQsY0FBYyxDQUFVO1FBQ3hCLGVBQVUsR0FBVixVQUFVLENBQVM7UUFFM0IsSUFBSSxDQUFDLHFCQUFxQixJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxxQkFBK0IsQ0FBQyxFQUFFLENBQUM7WUFDckYsSUFBSSxDQUFDLHFCQUFxQixHQUFHLE1BQU0sQ0FBQTtRQUN2QyxDQUFDO0lBQ0wsQ0FBQztJQUVELGVBQWUsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFBO0lBQzVCLENBQUM7SUFFRCxLQUFLLENBQUMsUUFBUTtRQUNWLE1BQU0sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNoQyxXQUFXLENBQUMsR0FBRyxFQUFFO2dCQUNiLElBQUksSUFBSSxDQUFDLHVCQUF1QixLQUFLLENBQUMsRUFBRSxDQUFDO29CQUNyQyxPQUFPLEVBQUUsQ0FBQTtnQkFDYixDQUFDO1lBQ0wsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ1osQ0FBQyxDQUFDLENBQUE7SUFDTixDQUFDO0lBRUQsS0FBSyxDQUFDLGdCQUFnQixDQUFDLFNBQXdCLEVBQUUsV0FBMEI7UUFDdkUsSUFBSSxDQUFDO1lBQ0QsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDWixJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7b0JBQ2YsaUlBQWlJO29CQUNqSSxJQUFJLENBQUMsdUJBQXVCLElBQUksQ0FBQyxDQUFBO2dCQUNyQyxDQUFDO2dCQUVELElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxTQUFTLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFFLElBQUksQ0FBQyxZQUF1QixFQUFFLFNBQVMsQ0FBQyxDQUFBO2dCQUN0RyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsT0FBTyxDQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBRSxJQUFJLENBQUMsWUFBdUIsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsT0FBTyxDQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBRSxJQUFJLENBQUMsWUFBdUIsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBQzdTLElBQUksQ0FBQyx1QkFBdUIsSUFBSSxDQUFDLENBQUE7WUFDckMsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEdBQVEsRUFBRSxDQUFDO1lBQ2hCLElBQUksQ0FBQyx1QkFBdUIsSUFBSSxDQUFDLENBQUE7WUFDakMsSUFBSSxDQUFDLGdCQUFnQixFQUFFLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUUsSUFBSSxDQUFDLFlBQXVCLEVBQUUsU0FBbUIsQ0FBQyxDQUFBO1lBQ2hILFdBQVcsQ0FBQyxLQUFLLENBQUMsdURBQXVELEdBQUcsRUFBRSxDQUFDLENBQUE7UUFDbkYsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTTtRQUNSLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLGVBQWUsRUFBRSxDQUFBO0lBQ2pELENBQUM7SUFFRCxZQUFZLENBQUMsV0FBbUIsRUFBRSxTQUF3QjtRQUN0RCxpSUFBaUk7UUFDakksSUFBSSxDQUFDLHVCQUF1QixJQUFJLENBQUMsQ0FBQTtRQUNqQyxJQUFJLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUE7SUFDbkUsQ0FBQztJQUVELG9CQUFvQixDQUFDLElBQXVCO1FBQ3hDOzs7VUFHRTtRQUNGLE9BQU8sQ0FDSCxPQUFPLElBQUksQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLE9BQU8sSUFBSSxDQUFDLFFBQVEsS0FBSyxRQUFRO1lBQ3BFLENBQ0ksQ0FDSSxJQUFJLENBQUMsTUFBTSxLQUFLLE1BQU07Z0JBQ3RCLENBQ0kscUNBQXFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7b0JBQzdEO29CQUNJLDJCQUEyQjtvQkFDM0IsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsNkJBQTZCLENBQUM7d0JBQ3JELENBQ0ksSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDOzRCQUMvQixJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FDbEMsQ0FDSjtvQkFDRCxpQ0FBaUM7b0JBQ2pDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsNkJBQTZCLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQztvQkFDNUUsNkJBQTZCO29CQUM3QixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FDeEQsQ0FDSjtnQkFDRCxDQUFFLElBQUksQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUsscUJBQXFCLENBQUUsQ0FDMUUsQ0FDSixDQUFBO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQywwQkFBMEI7UUFDNUIsSUFBSSxDQUFDLGlDQUFpQyxHQUFHLElBQUksQ0FBQTtRQUM3QyxLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFDO1lBQ2pELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQ25FLENBQUM7UUFDRCxJQUFJLENBQUMseUJBQXlCLEdBQUcsRUFBRSxDQUFBO1FBQ25DLElBQUksQ0FBQyxpQ0FBaUMsR0FBRyxLQUFLLENBQUE7SUFDbEQsQ0FBQztJQUVELEtBQUssQ0FBQyxvQkFBb0IsQ0FBRSxJQUF1QjtRQUMvQyxJQUFJLENBQUM7WUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ25DLE9BQU07WUFDVixDQUFDO1lBQ0QsR0FBRyxDQUFDO2dCQUNBLE1BQU0sS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ3JCLENBQUMsUUFBUSxJQUFJLENBQUMsd0JBQXdCLEVBQUM7WUFDdkMsSUFBSSxDQUFDLHdCQUF3QixHQUFHLFdBQVcsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDbkQsSUFBSSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsRUFBRSxDQUFDO29CQUMxQyxhQUFhLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLENBQUE7b0JBQzVDLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUE7b0JBQ3ZDLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxJQUFJLENBQUE7Z0JBQ3hDLENBQUM7WUFDTCxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDWixDQUFDO1FBQUMsT0FBTyxHQUFRLEVBQUUsQ0FBQztZQUNoQixXQUFXLENBQUMsS0FBSyxDQUFDLHNEQUFzRCxHQUFHLEVBQUUsQ0FBQyxDQUFBO1FBQ2xGLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLG1CQUFtQixDQUFFLElBQTBDO1FBQ2pFLElBQUksQ0FBQztZQUNELElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7Z0JBQ2hELE9BQU07WUFDVixDQUFDO1lBQ0QsSUFBSSxTQUFTLEdBQUcsSUFBSSxDQUFBO1lBQ3BCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFrQixDQUFBO1lBQ3hDLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLHFCQUErQixDQUFDLEVBQUUsQ0FBQztnQkFDakcsU0FBUyxHQUFHLE9BQU8sQ0FBQTtZQUN2QixDQUFDO2lCQUFNLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLHFCQUErQixDQUFDLEVBQUUsQ0FBQztnQkFDbEgsU0FBUyxHQUFHLFlBQVksQ0FBQTtZQUM1QixDQUFDO2lCQUFNLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMscUJBQStCLENBQUMsRUFBRSxDQUFDO2dCQUNqRyxJQUFJLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssS0FBSyxFQUFFLENBQUM7b0JBQ3hJLFNBQVMsR0FBRyxNQUFNLENBQUE7Z0JBQ3RCLENBQUM7WUFDTCxDQUFDO2lCQUFNLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLHFCQUErQixDQUFDLEVBQUUsQ0FBQztnQkFDbkosU0FBUyxHQUFHLE1BQU0sQ0FBQTtZQUN0QixDQUFDO1lBQ0QsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDWixJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxZQUFzQixFQUFFLFNBQVMsQ0FBQyxDQUFBO1lBQzdELENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxHQUFRLEVBQUUsQ0FBQztZQUNoQixXQUFXLENBQUMsS0FBSyxDQUFDLDJEQUEyRCxHQUFHLEVBQUUsQ0FBQyxDQUFBO1FBQ3ZGLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLFNBQVM7UUFDWCxJQUFJLElBQUksQ0FBQyxxQkFBcUIsSUFBSSxJQUFJLENBQUMscUJBQXFCLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDMUUsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ2pELENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWE7UUFDZixJQUFJLElBQUksQ0FBQyxxQkFBcUIsSUFBSSxJQUFJLENBQUMscUJBQXFCLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDMUUsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ2pELENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFFRCxzREFBc0Q7QUFDdEQsTUFBTSxZQUFZLEdBQXlCLHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxDQUFBO0FBRy9FLGVBQWUsWUFBWSxDQUFBIn0=