import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { nodeRequest, getBrowserStackUser, getBrowserStackKey, sleep } from '../util.js';
import { PercyLogger } from './PercyLogger.js';
import PercyBinary from './PercyBinary.js';
import { BROWSERSTACK_TESTHUB_UUID } from '../constants.js';
const logDir = 'logs';
class Percy {
    #logfile = path.join(logDir, 'percy.log');
    #address = process.env.PERCY_SERVER_ADDRESS || 'http://127.0.0.1:5338';
    #binaryPath = null;
    #options;
    #config;
    #proc = null;
    #isApp;
    #projectName = undefined;
    isProcessRunning = false;
    percyCaptureMode;
    buildId = null;
    percyAutoEnabled = false;
    percy;
    constructor(options, config, bsConfig) {
        this.#options = options;
        this.#config = config;
        this.#isApp = Boolean(options.app);
        this.#projectName = bsConfig.projectName;
        this.percyCaptureMode = options.percyCaptureMode;
        this.percy = options.percy ?? false;
    }
    async #getBinaryPath() {
        if (!this.#binaryPath) {
            const pb = new PercyBinary();
            this.#binaryPath = await pb.getBinaryPath(this.#config);
        }
        return this.#binaryPath;
    }
    async healthcheck() {
        try {
            const resp = await nodeRequest('GET', 'percy/healthcheck', null, this.#address);
            if (resp) {
                this.buildId = resp.build.id;
                return true;
            }
        }
        catch (err) {
            return false;
        }
    }
    async start() {
        const binaryPath = await this.#getBinaryPath();
        const logStream = fs.createWriteStream(this.#logfile, { flags: 'a' });
        const token = await this.fetchPercyToken();
        const configPath = await this.createPercyConfig();
        if (!token) {
            return false;
        }
        const commandArgs = [`${this.#isApp ? 'app:exec' : 'exec'}:start`];
        if (configPath) {
            commandArgs.push('-c', configPath);
        }
        this.#proc = spawn(binaryPath, commandArgs, { env: { ...process.env, PERCY_TOKEN: token, TH_BUILD_UUID: process.env[BROWSERSTACK_TESTHUB_UUID] } });
        this.#proc.stdout.pipe(logStream);
        this.#proc.stderr.pipe(logStream);
        this.isProcessRunning = true;
        const that = this;
        this.#proc.on('close', function () {
            that.isProcessRunning = false;
        });
        do {
            const healthcheck = await this.healthcheck();
            if (healthcheck) {
                PercyLogger.debug('Percy healthcheck successful');
                return true;
            }
            await sleep(1000);
        } while (this.isProcessRunning);
        return false;
    }
    async stop() {
        const binaryPath = await this.#getBinaryPath();
        return new Promise((resolve) => {
            const proc = spawn(binaryPath, ['exec:stop']);
            proc.on('close', (code) => {
                this.isProcessRunning = false;
                resolve(code);
            });
        });
    }
    isRunning() {
        return this.isProcessRunning;
    }
    async fetchPercyToken() {
        const projectName = this.#projectName;
        try {
            const type = this.#isApp ? 'app' : 'automate';
            const params = new URLSearchParams();
            if (projectName) {
                params.set('name', projectName);
            }
            if (type) {
                params.set('type', type);
            }
            if (this.#options.percyCaptureMode) {
                params.set('percy_capture_mode', this.#options.percyCaptureMode);
            }
            params.set('percy', String(this.#options.percy));
            const query = `api/app_percy/get_project_token?${params.toString()}`;
            const response = await nodeRequest('GET', query, {
                username: getBrowserStackUser(this.#config),
                password: getBrowserStackKey(this.#config)
            }, 'https://api.browserstack.com');
            PercyLogger.debug('Percy fetch token success : ' + response.token);
            if (!this.#options.percy && response.success) {
                this.percyAutoEnabled = response.success;
            }
            this.percyCaptureMode = response.percy_capture_mode;
            this.percy = response.success;
            return response.token;
        }
        catch (err) {
            PercyLogger.error(`Percy unable to fetch project token: ${err}`);
            return null;
        }
    }
    async createPercyConfig() {
        if (!this.#options.percyOptions) {
            return null;
        }
        const configPath = path.join(os.tmpdir(), 'percy.json');
        const percyOptions = this.#options.percyOptions;
        if (!percyOptions.version) {
            percyOptions.version = '2';
        }
        return new Promise((resolve) => {
            fs.writeFile(configPath, JSON.stringify(percyOptions), (err) => {
                if (err) {
                    PercyLogger.error(`Error creating percy config: ${err}`);
                    resolve(null);
                }
                PercyLogger.debug('Percy config created at ' + configPath);
                resolve(configPath);
            });
        });
    }
}
export default Percy;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGVyY3kuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvUGVyY3kvUGVyY3kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFFeEIsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBRTFDLE9BQU8sRUFBRSxXQUFXLEVBQUUsbUJBQW1CLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxFQUFFLE1BQU0sWUFBWSxDQUFBO0FBQ3hGLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxrQkFBa0IsQ0FBQTtBQUU5QyxPQUFPLFdBQVcsTUFBTSxrQkFBa0IsQ0FBQTtBQUkxQyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQTtBQUUzRCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUE7QUFFckIsTUFBTSxLQUFLO0lBQ1AsUUFBUSxHQUFXLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFBO0lBQ2pELFFBQVEsR0FBVyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixJQUFJLHVCQUF1QixDQUFBO0lBRTlFLFdBQVcsR0FBaUIsSUFBSSxDQUFBO0lBQ2hDLFFBQVEsQ0FBeUM7SUFDakQsT0FBTyxDQUFvQjtJQUMzQixLQUFLLEdBQVEsSUFBSSxDQUFBO0lBQ2pCLE1BQU0sQ0FBUztJQUNmLFlBQVksR0FBdUIsU0FBUyxDQUFBO0lBRTVDLGdCQUFnQixHQUFHLEtBQUssQ0FBQTtJQUN4QixnQkFBZ0IsQ0FBUztJQUN6QixPQUFPLEdBQWtCLElBQUksQ0FBQTtJQUM3QixnQkFBZ0IsR0FBRyxLQUFLLENBQUE7SUFDeEIsS0FBSyxDQUFTO0lBRWQsWUFBWSxPQUFnRCxFQUFFLE1BQTBCLEVBQUUsUUFBb0I7UUFDMUcsSUFB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