export interface ApolloEnvironmentSnapshot {
    readonly available: boolean;
    readonly workspace?: string;
    readonly currentProfile?: string;
    readonly targetId?: string;
    readonly apolloVersion?: string;
    readonly skills: {
        readonly apolloEnv: boolean;
        readonly apolloDev: boolean;
    };
    readonly baseline?: {
        readonly targetId: string;
        readonly version: string;
        readonly parameters: boolean;
        readonly code: boolean;
    };
    readonly warnings: readonly string[];
}
export interface ApolloFileEntry {
    readonly name: string;
    readonly path: string;
    readonly type: 'file' | 'directory' | 'symlink';
    readonly size?: number;
    readonly modifiedMs?: number;
}
export interface ApolloFileContent {
    readonly path: string;
    readonly content: string;
    readonly version: string;
    readonly truncated: boolean;
}
export interface ApolloRestoreOptions {
    readonly sensors: readonly {
        readonly id: string;
        readonly name: string;
    }[];
    readonly modules: readonly string[];
}
export interface ApolloRestoreTargets {
    readonly targets: readonly string[];
    readonly detected: string | null;
}
export interface ApolloSensorConfig {
    readonly name: string;
    readonly confs: readonly {
        readonly path: string;
        readonly exists: boolean;
        readonly inBaseline: boolean;
        readonly changed: boolean;
        readonly fields: readonly {
            readonly key: string;
            readonly value: string;
            readonly baseline?: string;
            readonly changed: boolean;
        }[];
    }[];
    readonly current: readonly {
        readonly key: string;
        readonly value: string;
    }[];
    readonly baseline: readonly {
        readonly key: string;
        readonly value: string;
    }[];
    readonly changed: readonly {
        readonly key: string;
        readonly current: string;
        readonly baseline: string;
    }[];
}
export interface ApolloRestorePlan {
    readonly mode: 'full' | 'sensor' | 'module';
    readonly targetId: string;
    readonly baselineVersion: string;
    readonly selector?: string;
    readonly planId?: string;
    readonly command: string;
    readonly supported: boolean;
    readonly requiresConfirmation: boolean;
    readonly readyToApply: boolean;
    readonly changes: readonly string[];
    readonly buildDirectories?: readonly string[];
    readonly modules?: readonly string[];
    readonly sensors?: readonly string[];
    readonly summary: string;
}
export interface ApolloRestoreResult {
    readonly applied: boolean;
    readonly planId: string;
    readonly backup?: string;
    readonly output: string;
}
export interface ApolloSensorConfigResult {
    readonly output: string;
}
export interface ApolloSensorConfigOptions {
    readonly lidar: {
        readonly models: readonly string[];
        readonly current: Record<string, string>;
    };
    readonly gnss: {
        readonly current: Record<string, string>;
    };
    readonly camera: {
        readonly cameras: readonly string[];
        readonly current: Record<string, string>;
    };
}
export interface ApolloLidarField {
    readonly id: string;
    readonly key: string;
    readonly sourceField: string;
    readonly value: string;
    readonly sourcePath: string;
    readonly sourceType: 'pb' | 'json';
}
export interface ApolloLidarDetail {
    readonly dag: string;
    readonly radars: readonly {
        readonly name: string;
        readonly className: string;
        readonly conf: string;
        readonly model: string;
        readonly fields: readonly ApolloLidarField[];
    }[];
    readonly models: readonly {
        readonly model: string;
        readonly driverConf: string;
        readonly fields: readonly {
            readonly key: string;
            readonly sourceField: string;
            readonly value: string;
        }[];
    }[];
    readonly fusion?: {
        readonly conf: string;
        readonly mainChannel: string;
        readonly inputChannels: readonly string[];
        readonly outputChannel: string;
        readonly targetFrameId: string;
        readonly perceptionChannel: string;
    };
}
export interface ApolloCameraDetail {
    readonly version: string;
    readonly dag: string;
    readonly dags: readonly string[];
    readonly profile: string;
    readonly valid: boolean;
    readonly cameras: readonly {
        readonly name: string;
        readonly className: string;
        readonly conf: string;
        readonly enabled: boolean;
        readonly dev: string;
        readonly frameId: string;
        readonly channel: string;
        readonly confExists: boolean;
        readonly linked: readonly {
            readonly name: string;
            readonly dag: string;
            readonly enabled: boolean;
        }[];
        readonly fields: readonly ApolloLidarField[];
    }[];
}
export interface ApolloMonitorConfig {
    readonly sensors: readonly {
        readonly id: string;
        readonly name: string;
        readonly channel: string;
        readonly required: boolean;
        readonly minHz: number;
        readonly timeoutMs: number;
    }[];
    readonly externalTargets: readonly {
        readonly name: string;
        readonly host: string;
        readonly port: number;
    }[];
    readonly channelPageSize: number;
    readonly refreshMs: number;
    readonly permissions?: {
        readonly fileWrite: boolean;
        readonly terminal: boolean;
        readonly restore: boolean;
    };
}
export interface ApolloMonitorSnapshot {
    readonly at: number;
    readonly sensors: readonly {
        readonly id: string;
        readonly name: string;
        readonly channel: string;
        readonly required: boolean;
        readonly status: 'ok' | 'error' | 'unavailable';
        readonly hz?: number;
        readonly reason: string;
    }[];
    readonly network: {
        readonly status: 'ok' | 'error';
        readonly external: 'ok' | 'error';
        readonly interfaceCount: number;
        readonly reason: string;
        readonly sensorLinks: readonly {
            readonly kind: string;
            readonly target: string;
            readonly detail: string;
            readonly ok: boolean;
        }[];
    };
    readonly channels: readonly {
        readonly name: string;
        readonly type: string;
        readonly hz: number;
        readonly status: 'active' | 'idle';
    }[];
}
export interface ApolloPtySnapshot {
    readonly id: string;
    readonly output: string;
    readonly running: boolean;
    readonly exitCode?: number | null;
}
export interface ApolloRuntimeStatus {
    readonly dreamview: 'running' | 'stopped';
    readonly dreamviewPid?: number;
    readonly ports: readonly {
        readonly name: string;
        readonly address: string;
        readonly up: boolean;
    }[];
}
export interface ApolloPtyRead {
    readonly id: string;
    readonly delta: string;
    readonly offset: number;
    readonly running: boolean;
    readonly reset: boolean;
}
//# sourceMappingURL=types.d.ts.map