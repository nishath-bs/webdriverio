import * as BrowserstackLocalLauncher from 'browserstack-local';
import type { Capabilities, Services, Options } from '@wdio/types';
import type { BrowserstackConfig, App, AppConfig, AppUploadResponse, UserConfig, BrowserstackOptions } from './types.js';
type BrowserstackLocal = BrowserstackLocalLauncher.Local & {
    pid?: number;
    stop(callback: (err?: Error) => void): void;
};
export default class BrowserstackLauncherService implements Services.ServiceInstance {
    private _options;
    private _config;
    browserstackLocal?: BrowserstackLocal;
    private _buildName?;
    private _projectName?;
    private _buildTag?;
    private _buildIdentifier?;
    private _accessibilityAutomation?;
    private _percy?;
    private _percyBestPlatformCaps?;
    private readonly browserStackConfig;
    constructor(_options: BrowserstackConfig & BrowserstackOptions, capabilities: Capabilities.RemoteCapability, _config: Options.Testrunner);
    onWorkerStart(cid: any, caps: any): Promise<void>;
    onPrepare(config: Options.Testrunner, capabilities: Capabilities.RemoteCapabilities): Promise<unknown>;
    onComplete(): Promise<unknown>;
    setupPercy(options: BrowserstackConfig & Options.Testrunner, config: Options.Testrunner, bsConfig: UserConfig): Promise<void>;
    stopPercy(): Promise<void>;
    _uploadApp(app: App): Promise<AppUploadResponse>;
    /**
     * @param  {String | AppConfig}  appConfig    <string>: should be "app file path" or "app_url" or "custom_id" or "shareable_id".
     *                                            <object>: only "path" and "custom_id" should coexist as multiple properties.
     */
    _validateApp(appConfig: AppConfig | string): Promise<App>;
    _uploadServiceLogs(): Promise<void>;
    _updateObjectTypeCaps(capabilities?: Capabilities.RemoteCapabilities, capType?: string, value?: {
        [key: string]: any;
    }): void;
    _updateCaps(capabilities?: Capabilities.RemoteCapabilities, capType?: string, value?: string): void;
    _updateBrowserStackPercyConfig(): void;
    _handleBuildIdentifier(capabilities?: Capabilities.RemoteCapabilities): void;
    /**
     * @return {string} if buildName doesn't exist in json file, it will return 1
     *                  else returns corresponding value in json file (e.g. { "wdio-build": { "identifier" : 2 } } => 2 in this case)
     */
    _getLocalBuildNumber(): string | null;
    _updateLocalBuildCache(filePath?: string, buildName?: string, buildIdentifier?: number): void;
    _getClientBuildUuid(): string;
}
export {};
//# sourceMappingURL=launcher.d.ts.map