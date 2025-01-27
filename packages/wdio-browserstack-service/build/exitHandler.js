import { spawn } from 'node:child_process';
import path from 'node:path';
import BrowserStackConfig from './config.js';
import { saveFunnelData } from './instrumentation/funnelInstrumentation.js';
import { fileURLToPath } from 'node:url';
import { BROWSERSTACK_TESTHUB_JWT } from './constants.js';
import { BStackLogger } from './bstackLogger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getInterruptSignals() {
    const allSignals = [
        'SIGTERM',
        'SIGINT',
        'SIGHUP'
    ];
    if (process.platform !== 'win32') {
        allSignals.push('SIGABRT');
        allSignals.push('SIGQUIT');
    }
    else {
        // For windows Ctrl+Break
        allSignals.push('SIGBREAK');
    }
    return allSignals;
}
export function setupExitHandlers() {
    process.on('exit', (code) => {
        BStackLogger.debug('Exit hook called');
        const args = shouldCallCleanup(BrowserStackConfig.getInstance());
        if (Array.isArray(args) && args.length) {
            BStackLogger.debug('Spawning cleanup with args ' + args.toString());
            const childProcess = spawn('node', [`${path.join(__dirname, 'cleanup.js')}`, ...args], { detached: true, stdio: 'inherit', env: { ...process.env } });
            childProcess.unref();
            process.exit(code);
        }
    });
    getInterruptSignals().forEach((sig) => {
        process.on(sig, () => {
            BrowserStackConfig.getInstance().setKillSignal(sig);
        });
    });
}
export function shouldCallCleanup(config) {
    const args = [];
    if (!!process.env[BROWSERSTACK_TESTHUB_JWT] && !config.testObservability.buildStopped) {
        args.push('--observability');
    }
    if (config.userName && config.accessKey && !config.funnelDataSent) {
        const savedFilePath = saveFunnelData('SDKTestSuccessful', config);
        args.push('--funnelData', savedFilePath);
    }
    return args;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhpdEhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvZXhpdEhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQzFDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLGtCQUFrQixNQUFNLGFBQWEsQ0FBQTtBQUM1QyxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sNENBQTRDLENBQUE7QUFDM0UsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFFaEQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7QUFDakQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQTtBQUUxQyxTQUFTLG1CQUFtQjtJQUN4QixNQUFNLFVBQVUsR0FBYTtRQUN6QixTQUFTO1FBQ1QsUUFBUTtRQUNSLFFBQVE7S0FDWCxDQUFBO0lBQ0QsSUFBSSxPQUFPLENBQUMsUUFBUSxLQUFLLE9BQU8sRUFBRSxDQUFDO1FBQy9CLFVBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDMUIsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUM5QixDQUFDO1NBQU0sQ0FBQztRQUNKLHlCQUF5QjtRQUN6QixVQUFVLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQy9CLENBQUM7SUFDRCxPQUFPLFVBQVUsQ0FBQTtBQUNyQixDQUFDO0FBRUQsTUFBTSxVQUFVLGlCQUFpQjtJQUM3QixPQUFPLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFO1FBQ3hCLFlBQVksQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUN0QyxNQUFNLElBQUksR0FBRyxpQkFBaUIsQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFBO1FBQ2hFLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDckMsWUFBWSxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQTtZQUNuRSxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxZQUFZLENBQUMsRUFBRSxFQUFFLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLEVBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1lBQ3JKLFlBQVksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUNwQixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3RCLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQTtJQUVGLG1CQUFtQixFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBVyxFQUFFLEVBQUU7UUFDMUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFO1lBQ2pCLGtCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUN2RCxDQUFDLENBQUMsQ0FBQTtJQUNOLENBQUMsQ0FBQyxDQUFBO0FBQ04sQ0FBQztBQUVELE1BQU0sVUFBVSxpQkFBaUIsQ0FBQyxNQUEwQjtJQUN4RCxNQUFNLElBQUksR0FBYSxFQUFFLENBQUE7SUFDekIsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ3BGLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtJQUNoQyxDQUFDO0lBRUQsSUFBSSxNQUFNLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxTQUFTLElBQUksQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDaEUsTUFBTSxhQUFhLEdBQUcsY0FBYyxDQUFDLG1CQUFtQixFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ2pFLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLGFBQWEsQ0FBQyxDQUFBO0lBQzVDLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQTtBQUNmLENBQUMifQ==