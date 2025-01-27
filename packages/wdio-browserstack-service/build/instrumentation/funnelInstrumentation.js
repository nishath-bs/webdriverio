import os from 'node:os';
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import got from 'got';
import UsageStats from '../testOps/usageStats.js';
import TestOpsConfig from '../testOps/testOpsConfig.js';
import { BStackLogger } from '../bstackLogger.js';
import { BSTACK_A11Y_POLLING_TIMEOUT, BSTACK_SERVICE_VERSION, FUNNEL_INSTRUMENTATION_URL } from '../constants.js';
import { getDataFromWorkers, removeWorkersDataDir } from '../data-store.js';
import { getProductMap } from '../testHub/utils.js';
async function fireFunnelTestEvent(eventType, config) {
    if (!config.userName || !config.accessKey) {
        BStackLogger.debug('username/accesskey not passed');
        return;
    }
    try {
        const data = buildEventData(eventType, config);
        await fireFunnelRequest(data);
        BStackLogger.debug('Funnel event success');
        if (eventType === 'SDKTestSuccessful') {
            config.sentFunnelData();
        }
    }
    catch (error) {
        BStackLogger.debug('Exception in sending funnel data: ' + error);
    }
}
export async function sendStart(config) {
    // Remove Workers folder if exists
    removeWorkersDataDir();
    await fireFunnelTestEvent('SDKTestAttempted', config);
}
export async function sendFinish(config) {
    await fireFunnelTestEvent('SDKTestSuccessful', config);
}
export function saveFunnelData(eventType, config) {
    const data = buildEventData(eventType, config);
    BStackLogger.ensureLogsFolder();
    const filePath = path.join(BStackLogger.logFolderPath, 'funnelData.json');
    fs.writeFileSync(filePath, JSON.stringify(data));
    return filePath;
}
function redactCredentialsFromFunnelData(data) {
    if (data) {
        if (data.userName) {
            data.userName = '[REDACTED]';
        }
        if (data.accessKey) {
            data.accessKey = '[REDACTED]';
        }
    }
    return data;
}
// Called from two different process
export async function fireFunnelRequest(data) {
    const { userName, accessKey } = data;
    redactCredentialsFromFunnelData(data);
    BStackLogger.debug('Sending SDK event with data ' + util.inspect(data, { depth: 6 }));
    await got.post(FUNNEL_INSTRUMENTATION_URL, {
        headers: {
            'content-type': 'application/json'
        }, username: userName, password: accessKey, json: data
    });
}
function getProductList(config) {
    const products = [];
    if (config.testObservability.enabled) {
        products.push('observability');
    }
    if (config.accessibility) {
        products.push('accessibility');
    }
    if (config.percy) {
        products.push('percy');
    }
    if (config.automate) {
        products.push('automate');
    }
    if (config.appAutomate) {
        products.push('app-automate');
    }
    return products;
}
function buildEventData(eventType, config) {
    const eventProperties = {
        // Framework Details
        language_framework: getLanguageFramework(config.framework),
        referrer: getReferrer(config.framework),
        language: 'WebdriverIO',
        languageVersion: process.version,
        // Build Details
        buildName: config.buildName || 'undefined',
        buildIdentifier: String(config.buildIdentifier),
        sdkRunId: config.sdkRunID,
        // Host details
        os: os.type() || 'unknown',
        hostname: os.hostname() || 'unknown',
        // Product Details
        productMap: getProductMap(config),
        product: getProductList(config),
    };
    if (TestOpsConfig.getInstance().buildHashedId) {
        eventProperties.testhub_uuid = TestOpsConfig.getInstance().buildHashedId;
    }
    if (eventType === 'SDKTestSuccessful') {
        const workerData = getDataFromWorkers();
        eventProperties.productUsage = getProductUsage(workerData);
        eventProperties.isPercyAutoEnabled = config.isPercyAutoEnabled;
        eventProperties.percyBuildId = config.percyBuildId;
        if (process.env[BSTACK_A11Y_POLLING_TIMEOUT]) {
            eventProperties.pollingTimeout = process.env[BSTACK_A11Y_POLLING_TIMEOUT];
        }
        if (config.killSignal) {
            eventProperties.finishedMetadata = {
                reason: 'user_killed',
                signal: config.killSignal
            };
        }
    }
    return {
        userName: config.userName,
        accessKey: config.accessKey,
        event_type: eventType,
        detectedFramework: 'WebdriverIO-' + config.framework,
        event_properties: eventProperties
    };
}
function getProductUsage(workersData) {
    return {
        testObservability: UsageStats.getInstance().getFormattedData(workersData)
    };
}
function getLanguageFramework(framework) {
    return 'WebdriverIO_' + framework;
}
function getReferrer(framework) {
    const fullName = framework ? 'WebdriverIO-' + framework : 'WebdriverIO';
    return `${fullName}/${BSTACK_SERVICE_VERSION}`;
}
const sendEvent = {
    tcgDown: (config) => fireFunnelTestEvent('SDKTestTcgDownResponse', config),
    invalidTcgAuth: (config) => fireFunnelTestEvent('SDKTestInvalidTcgAuthResponseWithUserImpact', config),
    tcgAuthFailure: (config) => fireFunnelTestEvent('SDKTestTcgAuthFailure', config),
    tcgtInitSuccessful: (config) => fireFunnelTestEvent('SDKTestTcgtInitSuccessful', config),
    initFailed: (config) => fireFunnelTestEvent('SDKTestInitFailedResponse', config),
};
function handleUpgradeRequired(isSelfHealEnabled) {
    if (isSelfHealEnabled) {
        BStackLogger.warn('Please upgrade Browserstack Service to the latest version to use the self-healing feature.');
    }
}
function handleAuthenticationFailure(status, config, isSelfHealEnabled) {
    if (status >= 500) {
        if (isSelfHealEnabled) {
            BStackLogger.warn('Something went wrong. Disabling healing for this session. Please try again later.');
        }
        sendEvent.tcgDown(config);
    }
    else {
        if (isSelfHealEnabled) {
            BStackLogger.warn('Authentication Failed. Disabling Healing for this session.');
        }
        sendEvent.tcgAuthFailure(config);
    }
}
function handleAuthenticationSuccess(isHealingEnabledForUser, userId, config, isSelfHealEnabled) {
    if (!isHealingEnabledForUser && isSelfHealEnabled) {
        BStackLogger.warn('Healing is not enabled for your group, please contact the admin');
    }
    else if (userId && isHealingEnabledForUser) {
        sendEvent.tcgtInitSuccessful(config);
    }
}
function handleInitializationFailure(status, config, isSelfHealEnabled) {
    if (status >= 400) {
        sendEvent.initFailed(config);
    }
    else if (!status && isSelfHealEnabled) {
        sendEvent.invalidTcgAuth(config);
    }
    if (isSelfHealEnabled) {
        BStackLogger.warn('Authentication Failed. Healing will be disabled for this session.');
    }
}
export function handleHealingInstrumentation(authResult, config, isSelfHealEnabled) {
    try {
        const { message, isAuthenticated, status, userId, groupId, isHealingEnabled: isHealingEnabledForUser } = authResult;
        if (message === 'Upgrade required') {
            handleUpgradeRequired(isSelfHealEnabled);
            return;
        }
        if (!isAuthenticated) {
            handleAuthenticationFailure(status, config, isSelfHealEnabled);
            return;
        }
        if (isAuthenticated && userId && groupId) {
            handleAuthenticationSuccess(isHealingEnabledForUser, userId, config, isSelfHealEnabled);
            return;
        }
        if (status >= 400 || !status) {
            handleInitializationFailure(status, config, isSelfHealEnabled);
            return;
        }
    }
    catch (err) {
        BStackLogger.debug('Error in handling healing instrumentation: ' + err);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnVubmVsSW5zdHJ1bWVudGF0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2luc3RydW1lbnRhdGlvbi9mdW5uZWxJbnN0cnVtZW50YXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLFVBQVUsTUFBTSwwQkFBMEIsQ0FBQTtBQUNqRCxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sb0JBQW9CLENBQUE7QUFFakQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLHNCQUFzQixFQUFFLDBCQUEwQixFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDakgsT0FBTyxFQUFFLGtCQUFrQixFQUFFLG9CQUFvQixFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDM0UsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLHFCQUFxQixDQUFBO0FBR25ELEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxTQUFpQixFQUFFLE1BQTBCO0lBQzVFLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ3hDLFlBQVksQ0FBQyxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQTtRQUNuRCxPQUFNO0lBQ1YsQ0FBQztJQUVELElBQUksQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFHLGNBQWMsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDOUMsTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM3QixZQUFZLENBQUMsS0FBSyxDQUFDLHNCQUFzQixD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