import got from 'got';
import { FormData } from 'formdata-node';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import { promisify, format } from 'node:util';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import os from 'node:os';
import { SevereServiceError } from 'webdriverio';
import * as BrowserstackLocalLauncher from 'browserstack-local';
import PerformanceTester from './performance-tester.js';
import { startPercy, stopPercy, getBestPlatformForPercySnapshot } from './Percy/PercyHelper.js';
import { BSTACK_SERVICE_VERSION, NOT_ALLOWED_KEYS_IN_CAPS, PERF_MEASUREMENT_ENV, RERUN_ENV, RERUN_TESTS_ENV, BROWSERSTACK_TESTHUB_UUID, VALID_APP_EXTENSION, BROWSERSTACK_PERCY, BROWSERSTACK_OBSERVABILITY } from './constants.js';
import { launchTestSession, shouldAddServiceVersion, stopBuildUpstream, getCiInfo, isBStackSession, isUndefined, isAccessibilityAutomationSession, isTrue, getBrowserStackUser, getBrowserStackKey, uploadLogs, ObjectsAreEqual, isValidCapsForHealing } from './util.js';
import { getProductMap } from './testHub/utils.js';
import CrashReporter from './crash-reporter.js';
import { BStackLogger } from './bstackLogger.js';
import { PercyLogger } from './Percy/PercyLogger.js';
import { FileStream } from './fileStream.js';
import { sendStart, sendFinish } from './instrumentation/funnelInstrumentation.js';
import BrowserStackConfig from './config.js';
import { setupExitHandlers } from './exitHandler.js';
import AiHandler from './ai-handler.js';
import TestOpsConfig from './testOps/testOpsConfig.js';
export default class BrowserstackLauncherService {
    _options;
    _config;
    browserstackLocal;
    _buildName;
    _projectName;
    _buildTag;
    _buildIdentifier;
    _accessibilityAutomation;
    _percy;
    _percyBestPlatformCaps;
    browserStackConfig;
    constructor(_options, capabilities, _config) {
        this._options = _options;
        this._config = _config;
        BStackLogger.clearLogFile();
        PercyLogger.clearLogFile();
        setupExitHandlers();
        // added to maintain backward compatibility with webdriverIO v5
        this._config || (this._config = _options);
        this.browserStackConfig = BrowserStackConfig.getInstance(_options, _config);
        if (Array.isArray(capabilities)) {
            capabilities
                .flatMap((c) => {
                if (Object.values(c).length > 0 && Object.values(c).every(c => typeof c === 'object' && c.capabilities)) {
                    return Object.values(c).map((o) => o.capabilities);
                }
                return c;
            })
                .forEach((capability) => {
                if (!capability['bstack:options']) {
                    // Skipping adding of service version if session is not of browserstack
                    if (isBStackSession(this._config)) {
                        const extensionCaps = Object.keys(capability).filter((cap) => cap.includes(':'));
                        if (extensionCaps.length) {
                            capability['bstack:options'] = { wdioService: BSTACK_SERVICE_VERSION };
                            if (!isUndefined(capability['browserstack.accessibility'])) {
                                this._accessibilityAutomation ||= isTrue(capability['browserstack.accessibility']);
                            }
                            else if (isTrue(this._options.accessibility)) {
                                capability['bstack:options'].accessibility = true;
                            }
                        }
                        else if (shouldAddServiceVersion(this._config, this._options.testObservability)) {
                            capability['browserstack.wdioService'] = BSTACK_SERVICE_VERSION;
                        }
                    }
                    // Need this details for sending data to Observability
                    this._buildIdentifier = capability['browserstack.buildIdentifier']?.toString();
                    this._buildName = capability.build?.toString();
                }
                else {
                    capability['bstack:options'].wdioService = BSTACK_SERVICE_VERSION;
                    this._buildName = capability['bstack:options'].buildName;
                    this._projectName = capability['bstack:options'].projectName;
                    this._buildTag = capability['bstack:options'].buildTag;
                    this._buildIdentifier = capability['bstack:options'].buildIdentifier;
                    if (!isUndefined(capability['bstack:options'].accessibility)) {
                        this._accessibilityAutomation ||= isTrue(capability['bstack:options'].accessibility);
                    }
                    else if (isTrue(this._options.accessibility)) {
                        capability['bstack:options'].accessibility = (isTrue(this._options.accessibility));
                    }
                }
            });
        }
        else if (typeof capabilities === 'object') {
            Object.entries(capabilities).forEach(([, caps]) => {
                if (!caps.capabilities['bstack:options']) {
                    if (isBStackSession(this._config)) {
                        const extensionCaps = Object.keys(caps.capabilities).filter((cap) => cap.includes(':'));
                        if (extensionCaps.length) {
                            caps.capabilities['bstack:options'] = { wdioService: BSTACK_SERVICE_VERSION };
                            if (!isUndefined(caps.capabilities['browserstack.accessibility'])) {
                                this._accessibilityAutomation ||= isTrue(caps.capabilities['browserstack.accessibility']);
                            }
                            else if (isTrue(this._options.accessibility)) {
                                caps.capabilities['bstack:options'] = { wdioService: BSTACK_SERVICE_VERSION, accessibility: (isTrue(this._options.accessibility)) };
                            }
                        }
                        else if (shouldAddServiceVersion(this._config, this._options.testObservability)) {
                            caps.capabilities['browserstack.wdioService'] = BSTACK_SERVICE_VERSION;
                        }
                    }
                    this._buildIdentifier = caps.capabilities['browserstack.buildIdentifier'];
                }
                else {
                    const bstackOptions = caps.capabilities['bstack:options'];
                    bstackOptions.wdioService = BSTACK_SERVICE_VERSION;
                    this._buildName = bstackOptions.buildName;
                    this._projectName = bstackOptions.projectName;
                    this._buildTag = bstackOptions.buildTag;
                    this._buildIdentifier = bstackOptions.buildIdentifier;
                    if (!isUndefined(bstackOptions.accessibility)) {
                        this._accessibilityAutomation ||= isTrue(bstackOptions.accessibility);
                    }
                    else if (isTrue(this._options.accessibility)) {
                        bstackOptions.accessibility = isTrue(this._options.accessibility);
                    }
                }
            });
        }
        this.browserStackConfig.buildIdentifier = this._buildIdentifier;
        this.browserStackConfig.buildName = this._buildName;
        if (process.env[PERF_MEASUREMENT_ENV]) {
            PerformanceTester.startMonitoring('performance-report-launcher.csv');
        }
        this._accessibilityAutomation ||= isTrue(this._options.accessibility);
        this._options.accessibility = this._accessibilityAutomation;
        // by default observability will be true unless specified as false
        this._options.testObservability = this._options.testObservability !== false;
        if (this._options.testObservability
            &&
                // update files to run if it's a rerun
                process.env[RERUN_ENV] && process.env[RERUN_TESTS_ENV]) {
            this._config.specs = process.env[RERUN_TESTS_ENV].split(',');
        }
        try {
            CrashReporter.setConfigDetails(this._config, capabilities, this._options);
        }
        catch (error) {
            BStackLogger.error(`[Crash_Report_Upload] Config processing failed due to ${error}`);
        }
    }
    async onWorkerStart(cid, caps) {
        try {
            if (this._options.percy && this._percyBestPlatformCaps) {
                const isThisBestPercyPlatform = ObjectsAreEqual(caps, this._percyBestPlatformCaps);
                if (isThisBestPercyPlatform) {
                    process.env.BEST_PLATFORM_CID = cid;
                }
            }
        }
        catch (err) {
            PercyLogger.error(`Error while setting best platform for Percy snapshot at worker start ${err}`);
        }
    }
    async onPrepare(config, capabilities) {
        // // Send Funnel start request
        await sendStart(this.browserStackConfig);
        // Setting up healing for those sessions where we don't add the service version capability as it indicates that the session is not being run on BrowserStack
        if (!shouldAddServiceVersion(this._config, this._options.testObservability, capabilities)) {
            try {
                if (capabilities.browserName) {
                    capabilities = await AiHandler.setup(this._config, this.browserStackConfig, this._options, capabilities, false);
                }
                else if (Array.isArray(capabilities)) {
                    for (let i = 0; i < capabilities.length; i++) {
                        if (capabilities[i].browserName) {
                            capabilities[i] = await AiHandler.setup(this._config, this.browserStackConfig, this._options, capabilities[i], false);
                        }
                    }
                }
                else if (isValidCapsForHealing(capabilities)) {
                    // setting up healing in case capabilities.xyz.capabilities.browserName where xyz can be anything:
                    capabilities = await AiHandler.setup(this._config, this.browserStackConfig, this._options, capabilities, true);
                }
            }
            catch (err) {
                if (this._options.selfHeal === true) {
                    BStackLogger.warn(`Error while setting up Browserstack healing Extension ${err}. Disabling healing for this session.`);
                }
            }
        }
        /**
         * Upload app to BrowserStack if valid file path to app is given.
         * Update app value of capability directly if app_url, custom_id, shareable_id is given
         */
        if (!this._options.app) {
            BStackLogger.debug('app is not defined in browserstack-service config, skipping ...');
        }
        else {
            let app = {};
            const appConfig = this._options.app;
            try {
                app = await this._validateApp(appConfig);
            }
            catch (error) {
                throw new SevereServiceError(error);
            }
            if (VALID_APP_EXTENSION.includes(path.extname(app.app))) {
                if (fs.existsSync(app.app)) {
                    const data = await this._uploadApp(app);
                    BStackLogger.info(`app upload completed: ${JSON.stringify(data)}`);
                    app.app = data.app_url;
                }
                else if (app.customId) {
                    app.app = app.customId;
                }
                else {
                    throw new SevereServiceError(`[Invalid app path] app path ${app.app} is not correct, Provide correct path to app under test`);
                }
            }
            BStackLogger.info(`Using app: ${app.app}`);
            this._updateCaps(capabilities, 'app', app.app);
        }
        /**
         * buildIdentifier in service options will take precedence over specified in capabilities
        */
        if (this._options.buildIdentifier) {
            this._buildIdentifier = this._options.buildIdentifier;
            this._updateCaps(capabilities, 'buildIdentifier', this._buildIdentifier);
        }
        /**
         * evaluate buildIdentifier in case unique execution identifiers are present
         * e.g., ${BUILD_NUMBER} and ${DATE_TIME}
        */
        this._handleBuildIdentifier(capabilities);
        // remove accessibilityOptions from the capabilities if present
        this._updateObjectTypeCaps(capabilities, 'accessibilityOptions');
        const shouldSetupPercy = this._options.percy || (isUndefined(this._options.percy) && this._options.app);
        if (this._options.testObservability || this._accessibilityAutomation || shouldSetupPercy) {
            BStackLogger.debug('Sending launch start event');
            await launchTestSession(this._options, this._config, {
                projectName: this._projectName,
                buildName: this._buildName,
                buildTag: this._buildTag,
                bstackServiceVersion: BSTACK_SERVICE_VERSION,
                buildIdentifier: this._buildIdentifier
            }, this.browserStackConfig);
            if (this._accessibilityAutomation && this._options.accessibilityOptions) {
                const filteredOpts = Object.keys(this._options.accessibilityOptions)
                    .filter(key => !NOT_ALLOWED_KEYS_IN_CAPS.includes(key))
                    .reduce((opts, key) => {
                    return {
                        ...opts,
                        [key]: this._options.accessibilityOptions?.[key]
                    };
                }, {});
                this._updateObjectTypeCaps(capabilities, 'accessibilityOptions', filteredOpts);
            }
            else if (isAccessibilityAutomationSession(this._accessibilityAutomation)) {
                this._updateObjectTypeCaps(capabilities, 'accessibilityOptions', {});
            }
            if (shouldSetupPercy) {
                try {
                    const bestPlatformPercyCaps = getBestPlatformForPercySnapshot(capabilities);
                    this._percyBestPlatformCaps = bestPlatformPercyCaps;
                    process.env[BROWSERSTACK_PERCY] = 'false';
                    await this.setupPercy(this._options, this._config, {
                        projectName: this._projectName
                    });
                    this._updateBrowserStackPercyConfig();
                }
                catch (err) {
                    PercyLogger.error(`Error while setting up Percy ${err}`);
                }
            }
        }
        // send testhub build uuid and product map instrumentation
        this._updateCaps(capabilities, 'testhubBuildUuid');
        this._updateCaps(capabilities, 'buildProductMap');
        if (!this._options.browserstackLocal) {
            return BStackLogger.info('browserstackLocal is not enabled - skipping...');
        }
        const opts = {
            key: this._config.key,
            ...this._options.opts
        };
        this.browserstackLocal = new BrowserstackLocalLauncher.Local();
        this._updateCaps(capabilities, 'local');
        if (opts.localIdentifier) {
            this._updateCaps(capabilities, 'localIdentifier', opts.localIdentifier);
        }
        /**
         * measure BrowserStack tunnel boot time
         */
        const obs = new PerformanceObserver((list) => {
            const entry = list.getEntries()[0];
            BStackLogger.info(`Browserstack Local successfully started after ${entry.duration}ms`);
        });
        obs.observe({ entryTypes: ['measure'] });
        let timer;
        performance.mark('tbTunnelStart');
        return Promise.race([
            promisify(this.browserstackLocal.start.bind(this.browserstackLocal))(opts),
            new Promise((resolve, reject) => {
                /* istanbul ignore next */
                timer = setTimeout(function () {
                    reject('Browserstack Local failed to start within 60 seconds!');
                }, 60000);
            })
        ]).then(function (result) {
            clearTimeout(timer);
            performance.mark('tbTunnelEnd');
            performance.measure('bootTime', 'tbTunnelStart', 'tbTunnelEnd');
            return Promise.resolve(result);
        }, function (err) {
            clearTimeout(timer);
            return Promise.reject(err);
        });
    }
    async onComplete() {
        BStackLogger.debug('Inside OnComplete hook..');
        BStackLogger.debug('Sending stop launch event');
        await stopBuildUpstream();
        if (process.env[BROWSERSTACK_OBSERVABILITY] && process.env[BROWSERSTACK_TESTHUB_UUID]) {
            console.log(`\nVisit https://observability.browserstack.com/builds/${process.env[BROWSERSTACK_TESTHUB_UUID]} to view build report, insights, and many more debugging information all at one place!\n`);
        }
        this.browserStackConfig.testObservability.buildStopped = true;
        if (process.env[PERF_MEASUREMENT_ENV]) {
            await PerformanceTester.stopAndGenerate('performance-launcher.html');
            PerformanceTester.calculateTimes(['launchTestSession', 'stopBuildUpstream']);
            if (!process.env.START_TIME) {
                return;
            }
            const duration = (new Date()).getTime() - (new Date(process.env.START_TIME)).getTime();
            BStackLogger.info(`Total duration is ${duration / 1000} s`);
        }
        await sendFinish(this.browserStackConfig);
        try {
            await this._uploadServiceLogs();
        }
        catch (error) {
            BStackLogger.debug(`Failed to upload BrowserStack WDIO Service logs ${error}`);
        }
        BStackLogger.clearLogger();
        if (this._options.percy) {
            await this.stopPercy();
            PercyLogger.clearLogger();
        }
        if (!this.browserstackLocal || !this.browserstackLocal.isRunning()) {
            return;
        }
        if (this._options.forcedStop) {
            return process.kill(this.browserstackLocal.pid);
        }
        let timer;
        return Promise.race([
            new Promise((resolve, reject) => {
                this.browserstackLocal?.stop((err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            }),
            new Promise((resolve, reject) => {
                /* istanbul ignore next */
                timer = setTimeout(() => reject(new Error('Browserstack Local failed to stop within 60 seconds!')), 60000);
            })
        ]).then(function (result) {
            clearTimeout(timer);
            return Promise.resolve(result);
        }, function (err) {
            clearTimeout(timer);
            return Promise.reject(err);
        });
    }
    async setupPercy(options, config, bsConfig) {
        if (this._percy?.isRunning()) {
            process.env[BROWSERSTACK_PERCY] = 'true';
            return;
        }
        try {
            this._percy = await startPercy(options, config, bsConfig);
            if (!this._percy) {
                throw new Error('Could not start percy, check percy logs for info.');
            }
            PercyLogger.info('Percy started successfully');
            process.env[BROWSERSTACK_PERCY] = 'true';
            let signal = 0;
            const handler = async () => {
                signal++;
                signal === 1 && await this.stopPercy();
            };
            process.on('beforeExit', handler);
            process.on('SIGINT', handler);
            process.on('SIGTERM', handler);
        }
        catch (err) {
            PercyLogger.debug(`Error in percy setup ${err}`);
            process.env[BROWSERSTACK_PERCY] = 'false';
        }
    }
    async stopPercy() {
        if (!this._percy || !this._percy.isRunning()) {
            return;
        }
        try {
            await stopPercy(this._percy);
            PercyLogger.info('Percy stopped');
        }
        catch (err) {
            PercyLogger.error('Error occured while stopping percy : ' + err);
        }
    }
    async _uploadApp(app) {
        BStackLogger.info(`uploading app ${app.app} ${app.customId ? `and custom_id: ${app.customId}` : ''} to browserstack`);
        const form = new FormData();
        if (app.app) {
            const fileName = path.basename(app.app);
            form.append('file', new FileStream(fs.createReadStream(app.app)), fileName);
        }
        if (app.customId) {
            form.append('custom_id', app.customId);
        }
        const res = await got.post('https://api-cloud.browserstack.com/app-automate/upload', {
            body: form,
            username: this._config.user,
            password: this._config.key
        }).json().catch((err) => {
            throw new SevereServiceError(`app upload failed ${err.message}`);
        });
        return res;
    }
    /**
     * @param  {String | AppConfig}  appConfig    <string>: should be "app file path" or "app_url" or "custom_id" or "shareable_id".
     *                                            <object>: only "path" and "custom_id" should coexist as multiple properties.
     */
    async _validateApp(appConfig) {
        const app = {};
        if (typeof appConfig === 'string') {
            app.app = appConfig;
        }
        else if (typeof appConfig === 'object' && Object.keys(appConfig).length) {
            if (Object.keys(appConfig).length > 2 || (Object.keys(appConfig).length === 2 && (!appConfig.path || !appConfig.custom_id))) {
                throw new SevereServiceError(`keys ${Object.keys(appConfig)} can't co-exist as app values, use any one property from
                            {id<string>, path<string>, custom_id<string>, shareable_id<string>}, only "path" and "custom_id" can co-exist.`);
            }
            app.app = appConfig.id || appConfig.path || appConfig.custom_id || appConfig.shareable_id;
            app.customId = appConfig.custom_id;
        }
        else {
            throw new SevereServiceError('[Invalid format] app should be string or an object');
        }
        if (!app.app) {
            throw new SevereServiceError(`[Invalid app property] supported properties are {id<string>, path<string>, custom_id<string>, shareable_id<string>}.
                        For more details please visit https://www.browserstack.com/docs/app-automate/appium/set-up-tests/specify-app ')`);
        }
        return app;
    }
    async _uploadServiceLogs() {
        const clientBuildUuid = this._getClientBuildUuid();
        const response = await uploadLogs(getBrowserStackUser(this._config), getBrowserStackKey(this._config), clientBuildUuid);
        BStackLogger.logToFile(`Response - ${format(response)}`, 'debug');
    }
    _updateObjectTypeCaps(capabilities, capType, value) {
        try {
            if (Array.isArray(capabilities)) {
                capabilities
                    .flatMap((c) => {
                    if (Object.values(c).length > 0 && Object.values(c).every(c => typeof c === 'object' && c.capabilities)) {
                        return Object.values(c).map((o) => o.capabilities);
                    }
                    return c;
                })
                    .forEach((capability) => {
                    if (!capability['bstack:options']) {
                        const extensionCaps = Object.keys(capability).filter((cap) => cap.includes(':'));
                        if (extensionCaps.length) {
                            if (capType === 'accessibilityOptions' && value) {
                                capability['bstack:options'] = { accessibilityOptions: value };
                            }
                        }
                        else if (capType === 'accessibilityOptions') {
                            if (value) {
                                const accessibilityOpts = { ...value };
                                if (capability?.accessibility) {
                                    accessibilityOpts.authToken = process.env.BSTACK_A11Y_JWT;
                                    accessibilityOpts.scannerVersion = process.env.BSTACK_A11Y_SCANNER_VERSION;
                                }
                                capability['browserstack.accessibilityOptions'] = accessibilityOpts;
                            }
                            else {
                                delete capability['browserstack.accessibilityOptions'];
                            }
                        }
                    }
                    else if (capType === 'accessibilityOptions') {
                        if (value) {
                            const accessibilityOpts = { ...value };
                            if (capability['bstack:options'].accessibility) {
                                accessibilityOpts.authToken = process.env.BSTACK_A11Y_JWT;
                                accessibilityOpts.scannerVersion = process.env.BSTACK_A11Y_SCANNER_VERSION;
                            }
                            capability['bstack:options'].accessibilityOptions = accessibilityOpts;
                        }
                        else {
                            delete capability['bstack:options'].accessibilityOptions;
                        }
                    }
                });
            }
            else if (typeof capabilities === 'object') {
                Object.entries(capabilities).forEach(([, caps]) => {
                    if (!caps.capabilities['bstack:options']) {
                        const extensionCaps = Object.keys(caps.capabilities).filter((cap) => cap.includes(':'));
                        if (extensionCaps.length) {
                            if (capType === 'accessibilityOptions' && value) {
                                caps.capabilities['bstack:options'] = { accessibilityOptions: value };
                            }
                        }
                        else if (capType === 'accessibilityOptions') {
                            if (value) {
                                const accessibilityOpts = { ...value };
                                if (caps.capabilities['browserstack.accessibility']) {
                                    accessibilityOpts.authToken = process.env.BSTACK_A11Y_JWT;
                                    accessibilityOpts.scannerVersion = process.env.BSTACK_A11Y_SCANNER_VERSION;
                                }
                                caps.capabilities['browserstack.accessibilityOptions'] = accessibilityOpts;
                            }
                            else {
                                delete caps.capabilities['browserstack.accessibilityOptions'];
                            }
                        }
                    }
                    else if (capType === 'accessibilityOptions') {
                        if (value) {
                            const accessibilityOpts = { ...value };
                            if (caps.capabilities['bstack:options'].accessibility) {
                                accessibilityOpts.authToken = process.env.BSTACK_A11Y_JWT;
                                accessibilityOpts.scannerVersion = process.env.BSTACK_A11Y_SCANNER_VERSION;
                            }
                            caps.capabilities['bstack:options'].accessibilityOptions = accessibilityOpts;
                        }
                        else {
                            delete caps.capabilities['bstack:options'].accessibilityOptions;
                        }
                    }
                });
            }
        }
        catch (error) {
            BStackLogger.debug(`Exception while retrieving capability value. Error - ${error}`);
        }
    }
    _updateCaps(capabilities, capType, value) {
        if (Array.isArray(capabilities)) {
            capabilities
                .flatMap((c) => {
                if (Object.values(c).length > 0 && Object.values(c).every(c => typeof c === 'object' && c.capabilities)) {
                    return Object.values(c).map((o) => o.capabilities);
                }
                return c;
            })
                .forEach((capability) => {
                if (!capability['bstack:options']) {
                    const extensionCaps = Object.keys(capability).filter((cap) => cap.includes(':'));
                    if (extensionCaps.length) {
                        if (capType === 'local') {
                            capability['bstack:options'] = { local: true };
                        }
                        else if (capType === 'app') {
                            capability['appium:app'] = value;
                        }
                        else if (capType === 'buildIdentifier' && value) {
                            capability['bstack:options'] = { buildIdentifier: value };
                        }
                        else if (capType === 'testhubBuildUuid' && TestOpsConfig.getInstance().buildHashedId) {
                            capability['bstack:options'] = { testhubBuildUuid: TestOpsConfig.getInstance().buildHashedId };
                        }
                        else if (capType === 'buildProductMap' && getProductMap(this.browserStackConfig)) {
                            capability['bstack:options'] = { buildProductMap: getProductMap(this.browserStackConfig) };
                        }
                    }
                    else if (capType === 'local') {
                        capability['browserstack.local'] = true;
                    }
                    else if (capType === 'app') {
                        capability.app = value;
                    }
                    else if (capType === 'buildIdentifier') {
                        if (value) {
                            capability['browserstack.buildIdentifier'] = value;
                        }
                        else {
                            delete capability['browserstack.buildIdentifier'];
                        }
                    }
                    else if (capType === 'localIdentifier') {
                        capability['browserstack.localIdentifier'] = value;
                    }
                    else if (capType === 'testhubBuildUuid') {
                        capability['browserstack.testhubBuildUuid'] = TestOpsConfig.getInstance().buildHashedId;
                    }
                    else if (capType === 'buildProductMap') {
                        capability['browserstack.buildProductMap'] = getProductMap(this.browserStackConfig);
                    }
                }
                else if (capType === 'local') {
                    capability['bstack:options'].local = true;
                }
                else if (capType === 'app') {
                    capability['appium:app'] = value;
                }
                else if (capType === 'buildIdentifier') {
                    if (value) {
                        capability['bstack:options'].buildIdentifier = value;
                    }
                    else {
                        delete capability['bstack:options'].buildIdentifier;
                    }
                }
                else if (capType === 'localIdentifier') {
                    capability['bstack:options'].localIdentifier = value;
                }
                else if (capType === 'testhubBuildUuid') {
                    capability['bstack:options'].testhubBuildUuid = TestOpsConfig.getInstance().buildHashedId;
                }
                else if (capType === 'buildProductMap') {
                    capability['bstack:options'].buildProductMap = getProductMap(this.browserStackConfig);
                }
            });
        }
        else if (typeof capabilities === 'object') {
            Object.entries(capabilities).forEach(([, caps]) => {
                if (!caps.capabilities['bstack:options']) {
                    const extensionCaps = Object.keys(caps.capabilities).filter((cap) => cap.includes(':'));
                    if (extensionCaps.length) {
                        if (capType === 'local') {
                            caps.capabilities['bstack:options'] = { local: true };
                        }
                        else if (capType === 'app') {
                            caps.capabilities['appium:app'] = value;
                        }
                        else if (capType === 'buildIdentifier' && value) {
                            caps.capabilities['bstack:options'] = { buildIdentifier: value };
                        }
                        else if (capType === 'testhubBuildUuid') {
                            caps.capabilities['bstack:options'] = { testhubBuildUuid: TestOpsConfig.getInstance().buildHashedId };
                        }
                        else if (capType === 'buildProductMap') {
                            caps.capabilities['bstack:options'] = { buildProductMap: getProductMap(this.browserStackConfig) };
                        }
                    }
                    else if (capType === 'local') {
                        caps.capabilities['browserstack.local'] = true;
                    }
                    else if (capType === 'app') {
                        caps.capabilities['appium:app'] = value;
                    }
                    else if (capType === 'buildIdentifier') {
                        if (value) {
                            caps.capabilities['browserstack.buildIdentifier'] = value;
                        }
                        else {
                            delete caps.capabilities['browserstack.buildIdentifier'];
                        }
                    }
                    else if (capType === 'localIdentifier') {
                        caps.capabilities['browserstack.localIdentifier'] = value;
                    }
                    else if (capType === 'testhubBuildUuid') {
                        caps.capabilities['browserstack.testhubBuildUuid'] = TestOpsConfig.getInstance().buildHashedId;
                    }
                    else if (capType === 'buildProductMap') {
                        caps.capabilities['browserstack.buildProductMap'] = getProductMap(this.browserStackConfig);
                    }
                }
                else if (capType === 'local') {
                    caps.capabilities['bstack:options'].local = true;
                }
                else if (capType === 'app') {
                    caps.capabilities['appium:app'] = value;
                }
                else if (capType === 'buildIdentifier') {
                    if (value) {
                        caps.capabilities['bstack:options'].buildIdentifier = value;
                    }
                    else {
                        delete caps.capabilities['bstack:options'].buildIdentifier;
                    }
                }
                else if (capType === 'localIdentifier') {
                    caps.capabilities['bstack:options'].localIdentifier = value;
                }
                else if (capType === 'testhubBuildUuid') {
                    caps.capabilities['bstack:options'].testhubBuildUuid = TestOpsConfig.getInstance().buildHashedId;
                }
                else if (capType === 'buildProductMap') {
                    caps.capabilities['bstack:options'].buildProductMap = getProductMap(this.browserStackConfig);
                }
            });
        }
        else {
            throw new SevereServiceError('Capabilities should be an object or Array!');
        }
    }
    _updateBrowserStackPercyConfig() {
        const { percyAutoEnabled = false, percyCaptureMode, buildId, percy } = this._percy || {};
        // Setting to browserStackConfig for populating data in funnel instrumentaion
        this.browserStackConfig.percyCaptureMode = percyCaptureMode;
        this.browserStackConfig.percyBuildId = buildId;
        this.browserStackConfig.isPercyAutoEnabled = percyAutoEnabled;
        // To handle stop percy build
        this._options.percy = percy;
        // To pass data to workers
        process.env.BROWSERSTACK_PERCY = String(percy);
        process.env.BROWSERSTACK_PERCY_CAPTURE_MODE = percyCaptureMode;
    }
    _handleBuildIdentifier(capabilities) {
        if (!this._buildIdentifier) {
            return;
        }
        if ((!this._buildName || process.env.BROWSERSTACK_BUILD_NAME) && this._buildIdentifier) {
            this._updateCaps(capabilities, 'buildIdentifier');
            BStackLogger.warn('Skipping buildIdentifier as buildName is not passed.');
            return;
        }
        if (this._buildIdentifier && this._buildIdentifier.includes('${DATE_TIME}')) {
            const formattedDate = new Intl.DateTimeFormat('en-GB', {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            })
                .format(new Date())
                .replace(/ |, /g, '-');
            this._buildIdentifier = this._buildIdentifier.replace('${DATE_TIME}', formattedDate);
            this._updateCaps(capabilities, 'buildIdentifier', this._buildIdentifier);
        }
        if (!this._buildIdentifier.includes('${BUILD_NUMBER}')) {
            return;
        }
        const ciInfo = getCiInfo();
        if (ciInfo !== null && ciInfo.build_number) {
            this._buildIdentifier = this._buildIdentifier.replace('${BUILD_NUMBER}', 'CI ' + ciInfo.build_number);
            this._updateCaps(capabilities, 'buildIdentifier', this._buildIdentifier);
        }
        else {
            const localBuildNumber = this._getLocalBuildNumber();
            if (localBuildNumber) {
                this._buildIdentifier = this._buildIdentifier.replace('${BUILD_NUMBER}', localBuildNumber);
                this._updateCaps(capabilities, 'buildIdentifier', this._buildIdentifier);
            }
        }
    }
    /**
     * @return {string} if buildName doesn't exist in json file, it will return 1
     *                  else returns corresponding value in json file (e.g. { "wdio-build": { "identifier" : 2 } } => 2 in this case)
     */
    _getLocalBuildNumber() {
        const browserstackFolderPath = path.join(os.homedir(), '.browserstack');
        try {
            if (!fs.existsSync(browserstackFolderPath)) {
                fs.mkdirSync(browserstackFolderPath);
            }
            const filePath = path.join(browserstackFolderPath, '.build-name-cache.json');
            if (!fs.existsSync(filePath)) {
                fs.appendFileSync(filePath, JSON.stringify({}));
            }
            const buildCacheFileData = fs.readFileSync(filePath);
            const parsedBuildCacheFileData = JSON.parse(buildCacheFileData.toString());
            if (this._buildName && this._buildName in parsedBuildCacheFileData) {
                const prevIdentifier = parseInt((parsedBuildCacheFileData[this._buildName].identifier));
                const newIdentifier = prevIdentifier + 1;
                this._updateLocalBuildCache(filePath, this._buildName, newIdentifier);
                return newIdentifier.toString();
            }
            const newIdentifier = 1;
            this._updateLocalBuildCache(filePath, this._buildName, 1);
            return newIdentifier.toString();
        }
        catch (error) {
            return null;
        }
    }
    _updateLocalBuildCache(filePath, buildName, buildIdentifier) {
        if (!buildName || !filePath) {
            return;
        }
        const jsonContent = JSON.parse(fs.readFileSync(filePath).toString());
        jsonContent[buildName] = { 'identifier': buildIdentifier };
        fs.writeFileSync(filePath, JSON.stringify(jsonContent));
    }
    _getClientBuildUuid() {
        if (process.env[BROWSERSTACK_TESTHUB_UUID]) {
            return process.env[BROWSERSTACK_TESTHUB_UUID];
        }
        const uuid = uuidv4();
        BStackLogger.logToFile(`If facing any issues, please contact BrowserStack support with the Build Run Id - ${uuid}`, 'info');
        return uuid;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF1bmNoZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvbGF1bmNoZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFBO0FBQ3JCLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxlQUFlLENBQUE7QUFDeEMsT0FBTyxFQUFFLEVBQUUsSUFBSSxNQUFNLEVBQUUsTUFBTSxNQUFNLENBQUE7QUFFbkMsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUM3QyxPQUFPLEVBQUUsV0FBVyxFQUFFLG1CQUFtQixFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDbEUsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUVoRCxPQUFPLEtBQUsseUJBQXlCLE1BQU0sb0JBQW9CLENBQUE7QUFHL0QsT0FBTyxpQkFBaUIsTUFBTSx5QkFBeUIsQ0FBQTtBQUV2RCxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLHdCQUF3QixDQUFBO0FBRy9GLE9BQU8sRUFDSCxzQkFBc0IsRUFDdEIsd0JBQXdCLEVBQUUsb0JBQW9CLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFDMUUseUJBQXlCLEVBQ3pCLG1CQUFtQixFQUNuQixrQkFBa0IsRUFDbEIsMEJBQTBCLEVBQzdCLE1BQU0sZ0JBQWdCLENBQUE7QUFDdkIsT0FBTyxFQUNILGlCQUFpQixFQUNqQix1QkFBdUIsRUFDdkIsaUJBQWlCLEVBQ2pCLFNBQVMsRUFDVCxlQUFlLEVBQ2YsV0FBVyxFQUNYLGdDQUFnQyxFQUNoQyxNQUFNLEVBQ04sbUJBQW1CLEVBQ25CLGtCQUFrQixFQUNsQixVQUFVLEVBQ1YsZUFB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