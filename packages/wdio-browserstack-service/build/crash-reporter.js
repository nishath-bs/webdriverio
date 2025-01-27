import got from 'got';
import { BSTACK_SERVICE_VERSION, DATA_ENDPOINT, BROWSERSTACK_TESTHUB_UUID } from './constants.js';
import { DEFAULT_REQUEST_CONFIG, getObservabilityKey, getObservabilityUser } from './util.js';
import { BStackLogger } from './bstackLogger.js';
export default class CrashReporter {
    /* User test config for build run minus PII */
    static userConfigForReporting = {};
    /* User credentials used for reporting crashes in browserstack service */
    static credentialsForCrashReportUpload = {};
    static setCredentialsForCrashReportUpload(options, config) {
        this.credentialsForCrashReportUpload = {
            username: getObservabilityUser(options, config),
            password: getObservabilityKey(options, config)
        };
        process.env.CREDENTIALS_FOR_CRASH_REPORTING = JSON.stringify(this.credentialsForCrashReportUpload);
    }
    static setConfigDetails(userConfig, capabilities, options) {
        const configWithoutPII = this.filterPII(userConfig);
        const filteredCapabilities = this.filterCapabilities(capabilities);
        this.userConfigForReporting = {
            framework: userConfig.framework,
            services: configWithoutPII.services,
            capabilities: filteredCapabilities,
            env: {
                'BROWSERSTACK_BUILD': process.env.BROWSERSTACK_BUILD,
                'BROWSERSTACK_BUILD_NAME': process.env.BROWSERSTACK_BUILD_NAME,
                'BUILD_TAG': process.env.BUILD_TAG
            }
        };
        process.env.USER_CONFIG_FOR_REPORTING = JSON.stringify(this.userConfigForReporting);
        this.setCredentialsForCrashReportUpload(options, userConfig);
    }
    static async uploadCrashReport(exception, stackTrace) {
        try {
            if (!this.credentialsForCrashReportUpload.username || !this.credentialsForCrashReportUpload.password) {
                this.credentialsForCrashReportUpload = process.env.CREDENTIALS_FOR_CRASH_REPORTING !== undefined ? JSON.parse(process.env.CREDENTIALS_FOR_CRASH_REPORTING) : this.credentialsForCrashReportUpload;
            }
        }
        catch (error) {
            return BStackLogger.error(`[Crash_Report_Upload] Failed to parse user credentials while reporting crash due to ${error}`);
        }
        if (!this.credentialsForCrashReportUpload.username || !this.credentialsForCrashReportUpload.password) {
            return BStackLogger.error('[Crash_Report_Upload] Failed to parse user credentials while reporting crash');
        }
        try {
            if (Object.keys(this.userConfigForReporting).length === 0) {
                this.userConfigForReporting = process.env.USER_CONFIG_FOR_REPORTING !== undefined ? JSON.parse(process.env.USER_CONFIG_FOR_REPORTING) : {};
            }
        }
        catch (error) {
            BStackLogger.error(`[Crash_Report_Upload] Failed to parse user config while reporting crash due to ${error}`);
            this.userConfigForReporting = {};
        }
        const data = {
            hashed_id: process.env[BROWSERSTACK_TESTHUB_UUID],
            observability_version: {
                frameworkName: 'WebdriverIO-' + (this.userConfigForReporting.framework || 'null'),
                sdkVersion: BSTACK_SERVICE_VERSION
            },
            exception: {
                error: exception.toString(),
                stackTrace: stackTrace
            },
            config: this.userConfigForReporting
        };
        const url = `${DATA_ENDPOINT}/api/v1/analytics`;
        got.post(url, {
            ...DEFAULT_REQUEST_CONFIG,
            ...this.credentialsForCrashReportUpload,
            json: data
        }).text().then(response => {
            BStackLogger.debug(`[Crash_Report_Upload] Success response: ${JSON.stringify(response)}`);
        }).catch((error) => {
            BStackLogger.error(`[Crash_Report_Upload] Failed due to ${error}`);
        });
    }
    static recursivelyRedactKeysFromObject(obj, keys) {
        if (!obj) {
            return;
        }
        if (Array.isArray(obj)) {
            obj.map(ele => this.recursivelyRedactKeysFromObject(ele, keys));
        }
        else {
            for (const prop in obj) {
                if (keys.includes(prop.toLowerCase())) {
                    obj[prop] = '[REDACTED]';
                }
                else if (typeof obj[prop] === 'object') {
                    this.recursivelyRedactKeysFromObject(obj[prop], keys);
                }
            }
        }
    }
    static deletePIIKeysFromObject(obj) {
        if (!obj) {
            return;
        }
        ['user', 'username', 'key', 'accessKey'].forEach(key => delete obj[key]);
    }
    static filterCapabilities(capabilities) {
        const capsCopy = JSON.parse(JSON.stringify(capabilities));
        this.recursivelyRedactKeysFromObject(capsCopy, ['extensions']);
        return capsCopy;
    }
    static filterPII(userConfig) {
        const configWithoutPII = JSON.parse(JSON.stringify(userConfig));
        this.deletePIIKeysFromObject(configWithoutPII);
        const finalServices = [];
        const initialServices = configWithoutPII.services;
        delete configWithoutPII.services;
        try {
            for (const serviceArray of initialServices) {
                if (Array.isArray(serviceArray) && serviceArray.length >= 2 && serviceArray[0] === 'browserstack') {
                    for (let idx = 1; idx < serviceArray.length; idx++) {
                        this.deletePIIKeysFromObject(serviceArray[idx]);
                        serviceArray[idx] && this.deletePIIKeysFromObject(serviceArray[idx].testObservabilityOptions);
                    }
                    finalServices.push(serviceArray);
                    break;
                }
            }
        }
        catch (err) {
            /* Wrong configuration like strings instead of json objects could break this method, needs no action */
            BStackLogger.error(`Error in parsing user config PII with error ${err ? (err.stack || err) : err}`);
            return configWithoutPII;
        }
        configWithoutPII.services = finalServices;
        return configWithoutPII;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3Jhc2gtcmVwb3J0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvY3Jhc2gtcmVwb3J0ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQ0EsT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFBO0FBRXJCLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxhQUFhLEVBQUUseUJBQXlCLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQTtBQUVqRyxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsbUJBQW1CLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxXQUFXLENBQUE7QUFDN0YsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBSWhELE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUM5Qiw4Q0FBOEM7SUFDdkMsTUFBTSxDQUFDLHNCQUFzQixHQUEyQixFQUFFLENBQUE7SUFDakUseUVBQXlFO0lBQ2pFLE1BQU0sQ0FBQywrQkFBK0IsR0FBb0MsRUFBRSxDQUFBO0lBRXBGLE1BQU0sQ0FBQyxrQ0FBa0MsQ0FBQyxPQUFnRCxFQUFFLE1BQTBCO1FBQ2xILElBQUksQ0FBQywrQkFBK0IsR0FBRztZQUNuQyxRQUFRLEVBQUUsb0JBQW9CLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQztZQUMvQyxRQUFRLEVBQUUsbUJBQW1CLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQztTQUNqRCxDQUFBO1FBQ0QsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0IsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxDQUFBO0lBQ3RHLENBQUM7SUFFRCxNQUFNLENBQUMsZ0JBQWdCLENBQUMsVUFBOEIsRUFBRSxZQUEyQyxFQUFFLE9BQWdEO1FBQ2pKLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNuRCxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxZQUFZLENB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