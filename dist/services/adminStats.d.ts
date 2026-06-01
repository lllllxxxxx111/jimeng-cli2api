export declare function collectAdminStats(): Promise<{
    generatedAt: string;
    runtime: {
        pid: number;
        uptimeSeconds: number;
        cliBin: string;
        nodeVersion: string;
        platform: NodeJS.Platform;
        cpuCount: number;
        memory: {
            rss: number;
            heapUsed: number;
            heapTotal: number;
        };
        systemMemory: {
            total: number;
            free: number;
            used: number;
            usedPercent: number;
        };
    };
    accounts: {
        total: number;
        idle: number;
        busy: number;
        error: number;
        offline: number;
        noVip: number;
        accounts: {
            totalCreatives: number;
            todayCreatives: number;
            processingTasks: number;
            todaySuccess: number;
            failedTasks: number;
            todayFailed: number;
            id: string;
            name: string;
            status: string;
            creditBalance: number;
            lastChecked: Date;
            createdAt: Date;
        }[];
    };
    apiKeys: {
        total: number;
        active: number;
        inactive: number;
        bound: number;
        unbound: number;
    };
    tasks: {
        total: number;
        processing: number;
        pending: number;
        success: number;
        failed: number;
        failureRate: number;
        today: {
            total: number;
            success: number;
            failed: number;
            processing: number;
            failureRate: number;
        };
        byStatus: {
            status: any;
            count: number;
        }[];
        byType: {
            type: any;
            count: number;
        }[];
        byModel: {
            model: string;
            count: any;
        }[];
    };
    tools: {
        total: any;
        success: any;
        failed: any;
        processing: any;
        pending: any;
        active: any;
        failureRate: number;
        today: {
            total: any;
            failed: any;
            failureRate: number;
        };
        byType: any[];
    };
    failures: {
        total: number;
        today: number;
        rate: number;
        todayRate: number;
        byPrompt: {
            prompt: string;
            promptPreview: string;
            model: string;
            type: string;
            count: any;
            lastFailedAt: any;
            sampleError: string;
        }[];
        byReason: {
            reason: string;
            reasonPreview: string;
            count: any;
            lastUpdatedAt: any;
        }[];
        byModel: {
            model: string;
            count: any;
            lastUpdatedAt: any;
        }[];
        byAccount: {
            id: string;
            name: string;
            count: any;
            lastUpdatedAt: any;
        }[];
        recent: {
            id: string;
            type: string;
            model: string | null;
            prompt: string;
            entrypoint: string | null;
            toolType: string | null;
            jimengSubmitId: string | null;
            jimengLogId: string | null;
            status: string;
            resultUrl: string | null;
            errorMsg: string | null;
            pollErrorMsg: string | null;
            createdAt: Date;
            updatedAt: Date;
            apiKey: {
                id: string;
                owner: string;
            };
            account: {
                id: string;
                name: string;
            } | null;
        }[];
        timeline: {
            failureRate: number;
            dateKey: string;
            label: string;
            total: number;
            success: number;
            failed: number;
            processing: number;
            pending: number;
        }[];
    };
}>;
//# sourceMappingURL=adminStats.d.ts.map