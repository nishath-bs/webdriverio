declare class AccessibilityScripts {
    private static instance;
    performScan: string | null;
    getResults: string | null;
    getResultsSummary: string | null;
    saveTestResults: string | null;
    commandsToWrap: Array<any> | null;
    browserstackFolderPath: string;
    commandsPath: string;
    private constructor();
    static checkAndGetInstance(): AccessibilityScripts;
    readFromExistingFile(): void;
    update(data: {
        commands: any[];
        scripts: Record<string, any>;
    }): void;
    store(): void;
}
declare const _default: AccessibilityScripts;
export default _default;
//# sourceMappingURL=accessibility-scripts.d.ts.map