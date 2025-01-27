import type fs from 'node:fs';
import type zlib from 'node:zlib';
export declare class FileStream {
    readableStream: fs.ReadStream | zlib.Gzip;
    constructor(readableStream: fs.ReadStream | zlib.Gzip);
    stream(): fs.ReadStream | zlib.Gzip;
    get [Symbol.toStringTag](): string;
}
//# sourceMappingURL=fileStream.d.ts.map