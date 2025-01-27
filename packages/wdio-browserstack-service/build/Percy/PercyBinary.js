import url from 'node:url';
import yauzl from 'yauzl';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import got from 'got';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { PercyLogger } from './PercyLogger.js';
class PercyBinary {
    #hostOS = process.platform;
    #httpPath = null;
    #binaryName = 'percy';
    #orderedPaths = [
        path.join(os.homedir(), '.browserstack'),
        process.cwd(),
        os.tmpdir()
    ];
    constructor() {
        const base = 'https://github.com/percy/cli/releases/latest/download';
        if (this.#hostOS.match(/darwin|mac os/i)) {
            this.#httpPath = base + '/percy-osx.zip';
        }
        else if (this.#hostOS.match(/mswin|msys|mingw|cygwin|bccwin|wince|emc|win32/i)) {
            this.#httpPath = base + '/percy-win.zip';
            this.#binaryName = 'percy.exe';
        }
        else {
            this.#httpPath = base + '/percy-linux.zip';
        }
    }
    async #makePath(path) {
        if (await this.#checkPath(path)) {
            return true;
        }
        return fsp.mkdir(path).then(() => true).catch(() => false);
    }
    async #checkPath(path) {
        try {
            const hasDir = await fsp.access(path).then(() => true, () => false);
            if (hasDir) {
                return true;
            }
        }
        catch (err) {
            return false;
        }
    }
    async #getAvailableDirs() {
        for (let i = 0; i < this.#orderedPaths.length; i++) {
            const path = this.#orderedPaths[i];
            if (await this.#makePath(path)) {
                return path;
            }
        }
        throw new Error('Error trying to download percy binary');
    }
    async getBinaryPath(conf) {
        const destParentDir = await this.#getAvailableDirs();
        const binaryPath = path.join(destParentDir, this.#binaryName);
        if (await this.#checkPath(binaryPath)) {
            return binaryPath;
        }
        const downloadedBinaryPath = await this.download(conf, destParentDir);
        const isValid = await this.validateBinary(downloadedBinaryPath);
        if (!isValid) {
            // retry once
            PercyLogger.error('Corrupt percy binary, retrying');
            return await this.download(conf, destParentDir);
        }
        return downloadedBinaryPath;
    }
    async validateBinary(binaryPath) {
        const versionRegex = /^.*@percy\/cli \d.\d+.\d+/;
        /* eslint-disable @typescript-eslint/no-unused-vars */
        return new Promise((resolve, reject) => {
            const proc = spawn(binaryPath, ['--version']);
            proc.stdout.on('data', (data) => {
                if (versionRegex.test(data)) {
                    resolve(true);
                }
            });
            proc.on('close', () => {
                resolve(false);
            });
        });
    }
    async download(conf, destParentDir) {
        if (!await this.#checkPath(destParentDir)) {
            await fsp.mkdir(destParentDir);
        }
        const binaryName = this.#binaryName;
        const zipFilePath = path.join(destParentDir, binaryName + '.zip');
        const binaryPath = path.join(destParentDir, binaryName);
        const downloadedFileStream = fs.createWriteStream(zipFilePath);
        const options = url.parse(this.#httpPath);
        return new Promise((resolve, reject) => {
            const stream = got.extend({ followRedirect: true }).get(this.#httpPath, { isStream: true });
            stream.on('error', (err) => {
                PercyLogger.error('Got Error in percy binary download response: ' + err);
            });
            stream.pipe(downloadedFileStream)
                .on('finish', () => {
                yauzl.open(zipFilePath, { lazyEntries: true }, function (err, zipfile) {
                    if (err) {
                        return reject(err);
                    }
                    zipfile.readEntry();
                    zipfile.on('entry', (entry) => {
                        if (/\/$/.test(entry.fileName)) {
                            // Directory file names end with '/'.
                            zipfile.readEntry();
                        }
                        else {
                            // file entry
                            const writeStream = fs.createWriteStream(path.join(destParentDir, entry.fileName));
                            zipfile.openReadStream(entry, function (zipErr, readStream) {
                                if (zipErr) {
                                    reject(err);
                                }
                                readStream.on('end', function () {
                                    writeStream.close();
                                    zipfile.readEntry();
                                });
                                readStream.pipe(writeStream);
                            });
                            if (entry.fileName === binaryName) {
                                zipfile.close();
                            }
                        }
                    });
                    zipfile.on('error', (zipErr) => {
                        reject(zipErr);
                    });
                    zipfile.once('end', () => {
                        fs.chmod(binaryPath, '0755', function (zipErr) {
                            if (zipErr) {
                                reject(zipErr);
                            }
                            resolve(binaryPath);
                        });
                        zipfile.close();
                    });
                });
            });
        });
    }
}
export default PercyBinary;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGVyY3lCaW5hcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvUGVyY3kvUGVyY3lCaW5hcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFBO0FBQzFCLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFDeEIsT0FBTyxHQUFHLE1BQU0sa0JBQWtCLENBQUE7QUFDbEMsT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFBO0FBRXJCLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFDeEIsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQzFDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxrQkFBa0IsQ0FBQTtBQUc5QyxNQUFNLFdBQVc7SUFDYixPQUFPLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQTtJQUMxQixTQUFTLEdBQVEsSUFBSSxDQUFBO0lBQ3JCLFdBQVcsR0FBRyxPQUFPLENBQUE7SUFFckIsYUFBYSxHQUFHO1FBQ1osSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUUsZUFBZSxDQUFDO1FBQ3hDLE9BQU8sQ0FBQyxHQUFHLEVBQUU7UUFDYixFQUFFLENBQUMsTUFBTSxFQUFFO0tBQ2QsQ0FBQTtJQUVEO1FBQ0ksTUFBTSxJQUFJLEdBQUcsdURBQXVELENBQUE7UUFDcEUsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLEdBQUcsZ0JBQWdCLENBQUE7UUFDNUMsQ0FBQzthQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsaURBQWlELENBQUMsRUFBRSxDQUFDO1lBQy9FLElBQUksQ0FB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