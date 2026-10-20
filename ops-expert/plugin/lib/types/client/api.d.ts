import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionHandle, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client';
import type { ApolloCameraDetail, ApolloEnvironmentSnapshot, ApolloFileContent, ApolloFileEntry, ApolloLidarDetail, ApolloMonitorConfig, ApolloMonitorSnapshot, ApolloPtyRead, ApolloPtySnapshot, ApolloRestoreOptions, ApolloRestorePlan, ApolloRestoreResult, ApolloRestoreTargets, ApolloRuntimeStatus, ApolloSensorConfig, ApolloSensorConfigOptions, ApolloSensorConfigResult } from '../types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        connection: ConnectionHandle;
    }
}
export interface ApolloOpsClientApi {
    environment(): Promise<ConnectionRpcResult<ApolloEnvironmentSnapshot>>;
    listFiles(path: string): Promise<ConnectionRpcResult<readonly ApolloFileEntry[]>>;
    readFile(path: string): Promise<ConnectionRpcResult<ApolloFileContent>>;
    writeFile(path: string, content: string, version: string): Promise<ConnectionRpcResult<ApolloFileContent>>;
    monitorConfig(): Promise<ConnectionRpcResult<ApolloMonitorConfig>>;
    monitorSnapshot(customSensors?: readonly {
        id: string;
        name: string;
        channel: string;
        required?: boolean;
    }[]): Promise<ConnectionRpcResult<ApolloMonitorSnapshot>>;
    restoreOptions(): Promise<ConnectionRpcResult<ApolloRestoreOptions>>;
    restoreTargets(): Promise<ConnectionRpcResult<ApolloRestoreTargets>>;
    restoreSensorConfig(id: string): Promise<ConnectionRpcResult<ApolloSensorConfig>>;
    restorePlan(mode: ApolloRestorePlan['mode'], selector?: string, targetId?: string): Promise<ConnectionRpcResult<ApolloRestorePlan>>;
    restoreExecute(planId: string): Promise<ConnectionRpcResult<ApolloRestoreResult>>;
    configGnss(payload: Record<string, unknown>): Promise<ConnectionRpcResult<ApolloSensorConfigResult>>;
    configLidar(payload: Record<string, unknown>): Promise<ConnectionRpcResult<ApolloSensorConfigResult>>;
    configLidarInstance(payload: Record<string, unknown>): Promise<ConnectionRpcResult<ApolloSensorConfigResult>>;
    configCamera(payload: Record<string, unknown>): Promise<ConnectionRpcResult<ApolloSensorConfigResult>>;
    configCameraInstance(payload: Record<string, unknown>): Promise<ConnectionRpcResult<ApolloSensorConfigResult>>;
    configCameraAdd(payload: Record<string, unknown>): Promise<ConnectionRpcResult<ApolloSensorConfigResult>>;
    configOptions(): Promise<ConnectionRpcResult<ApolloSensorConfigOptions>>;
    configLidarDetail(): Promise<ConnectionRpcResult<ApolloLidarDetail>>;
    configCameraDetail(dag?: string): Promise<ConnectionRpcResult<ApolloCameraDetail>>;
    runtimeStatus(): Promise<ConnectionRpcResult<ApolloRuntimeStatus>>;
    setDreamview(action: 'start' | 'stop'): Promise<ConnectionRpcResult<ApolloRuntimeStatus>>;
    killAll(): Promise<ConnectionRpcResult<ApolloRuntimeStatus>>;
    openPty(): Promise<ConnectionRpcResult<ApolloPtySnapshot>>;
    readPty(id: string, offset: number): Promise<ConnectionRpcResult<ApolloPtyRead>>;
    writePty(id: string, data: string): Promise<ConnectionRpcResult<ApolloPtySnapshot>>;
    signalPty(id: string): Promise<ConnectionRpcResult<ApolloPtySnapshot>>;
    closePty(id: string): Promise<ConnectionRpcResult<{
        closed: true;
    }>>;
}
export declare function createApolloOpsClient(ctx: Context): ApolloOpsClientApi;
//# sourceMappingURL=api.d.ts.map