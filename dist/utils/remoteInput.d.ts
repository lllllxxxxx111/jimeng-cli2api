type DownloadOptions = {
    maxBytes: number;
    timeoutMs?: number;
};
type DownloadResult = {
    buffer: Buffer;
    contentType: string;
    url: URL;
};
export declare function assertSafeRemoteUrl(rawUrl: string): Promise<URL>;
export declare function downloadRemoteInput(rawUrl: string, options: DownloadOptions): Promise<DownloadResult>;
export {};
//# sourceMappingURL=remoteInput.d.ts.map