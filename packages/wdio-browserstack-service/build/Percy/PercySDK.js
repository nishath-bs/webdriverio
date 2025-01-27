import InsightsHandler from '../insights-handler.js';
import TestReporter from '../reporter.js';
import { PercyLogger } from './PercyLogger.js';
import { isUndefined } from '../util.js';
const tryRequire = async function (pkg, fallback) {
    try {
        return (await import(pkg)).default;
    }
    catch {
        return fallback;
    }
};
const percySnapshot = await tryRequire('@percy/selenium-webdriver', null);
const percyAppScreenshot = await tryRequire('@percy/appium-app', {});
/* eslint-disable @typescript-eslint/no-unused-vars */
let snapshotHandler = (...args) => {
    PercyLogger.error('Unsupported driver for percy');
};
if (percySnapshot) {
    snapshotHandler = (browser, snapshotName, options) => {
        if (process.env.PERCY_SNAPSHOT === 'true') {
            let { name, uuid } = InsightsHandler.currentTest;
            if (isUndefined(name)) {
                ({ name, uuid } = TestReporter.currentTest);
            }
            options ||= {};
            options = {
                ...options,
                testCase: name || '',
                thTestCaseExecutionId: uuid || '',
            };
            return percySnapshot(browser, snapshotName, options);
        }
    };
}
export const snapshot = snapshotHandler;
/*
This is a helper method which appends some internal fields
to the options object being sent to Percy methods
*/
const screenshotHelper = (type, driverOrName, nameOrOptions, options) => {
    let { name, uuid } = InsightsHandler.currentTest;
    if (isUndefined(name)) {
        ({ name, uuid } = TestReporter.currentTest);
    }
    if (!driverOrName || typeof driverOrName === 'string') {
        nameOrOptions ||= {};
        if (typeof nameOrOptions === 'object') {
            nameOrOptions = {
                ...nameOrOptions,
                testCase: name || '',
                thTestCaseExecutionId: uuid || '',
            };
        }
    }
    else {
        options ||= {};
        options = {
            ...options,
            testCase: name || '',
            thTestCaseExecutionId: uuid || '',
        };
    }
    if (type === 'app') {
        return percyAppScreenshot(driverOrName, nameOrOptions, options);
    }
    return percySnapshot.percyScreenshot(driverOrName, nameOrOptions, options);
};
/* eslint-disable @typescript-eslint/no-unused-vars */
let screenshotHandler = async (...args) => {
    PercyLogger.error('Unsupported driver for percy');
};
if (percySnapshot && percySnapshot.percyScreenshot) {
    screenshotHandler = (browser, screenshotName, options) => {
        return screenshotHelper('web', browser, screenshotName, options);
    };
}
export const screenshot = screenshotHandler;
/* eslint-disable @typescript-eslint/no-unused-vars */
let screenshotAppHandler = async (...args) => {
    PercyLogger.error('Unsupported driver for percy');
};
if (percyAppScreenshot) {
    screenshotAppHandler = (driverOrName, nameOrOptions, options) => {
        return screenshotHelper('app', driverOrName, nameOrOptions, options);
    };
}
export const screenshotApp = screenshotAppHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGVyY3lTREsuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvUGVyY3kvUGVyY3lTREsudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxlQUFlLE1BQU0sd0JBQXdCLENBQUE7QUFDcEQsT0FBTyxZQUFZLE1BQU0sZ0JBQWdCLENBQUE7QUFDekMsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQzlDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxZQUFZLENBQUE7QUFFeEMsTUFBTSxVQUFVLEdBQUcsS0FBSyxXQUFXLEdBQVcsRUFBRSxRQUFhO0lBQ3pELElBQUksQ0FBQztRQUNELE9BQU8sQ0FBQyxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQTtJQUN0QyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ0wsT0FBTyxRQUFRLENBQUE7SUFDbkIsQ0FBQztBQUNMLENBQUMsQ0FBQTtBQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sVUFBVSxDQUFDLDJCQUEyQixFQUFFLElBQUksQ0FBQyxDQUFBO0FBRXpFLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxVQUFVLENBQUMsbUJBQW1CLEVBQUUsRUFBRSxDQUFDLENBQUE7QUFFcEUsc0RBQXNEO0FBQ3RELElBQUksZUFBZSxHQUFHLENBQUMsR0FBRyxJQUFXLEVBQUUsRUFBRTtJQUNyQyxXQUFXLENBQUMsS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUE7QUFDckQsQ0FBQyxDQUFBO0FBQ0QsSUFBSSxhQUFhLEVBQUUsQ0FBQztJQUNoQixlQUFlLEdBQUcsQ0FBQyxPQUE2RCxFQUFFLFlBQW9CLEVBQUUsT0FBZ0MsRUFBRSxFQUFFO1FBQ3hJLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEtBQUssTUFBTSxFQUFFLENBQUM7WUFDeEMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsR0FBRyxlQUFlLENBQUMsV0FBVyxD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