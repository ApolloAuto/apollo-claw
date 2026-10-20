import { APOLLO_OPS_CHANNEL } from "../channel.js";
export function createApolloOpsClient(ctx) {
    const call = async (endpoint, payload = {}) => await ctx.connection.rpc.call(APOLLO_OPS_CHANNEL, endpoint, payload);
    return {
        environment: () => call('apolloOps/environment'),
        listFiles: path => call('apolloOps/files/list', { path }),
        readFile: path => call('apolloOps/files/read', { path }),
        writeFile: (path, content, version) => call('apolloOps/files/write', { path, content, version }),
        monitorConfig: () => call('apolloOps/monitor/config'),
        monitorSnapshot: customSensors => call('apolloOps/monitor/snapshot', { customSensors }),
        restoreOptions: () => call('apolloOps/restore/options'),
        restoreTargets: () => call('apolloOps/restore/targets'),
        restoreSensorConfig: id => call('apolloOps/restore/sensor-config', { id }),
        restorePlan: (mode, selector, targetId) => call('apolloOps/restore/plan', { mode, ...(selector === undefined ? {} : { selector }), ...(targetId === undefined ? {} : { targetId }) }),
        restoreExecute: planId => call('apolloOps/restore/execute', { planId }),
        configGnss: payload => call('apolloOps/config/gnss', payload),
        configLidar: payload => call('apolloOps/config/lidar', payload),
        configLidarInstance: payload => call('apolloOps/config/lidar-instance', payload),
        configCamera: payload => call('apolloOps/config/camera', payload),
        configCameraInstance: payload => call('apolloOps/config/camera-instance', payload),
        configCameraAdd: payload => call('apolloOps/config/camera-add', payload),
        configOptions: () => call('apolloOps/config/options'),
        configLidarDetail: () => call('apolloOps/config/lidar-detail'),
        configCameraDetail: dag => call('apolloOps/config/camera-detail', dag === undefined ? {} : { dag }),
        runtimeStatus: () => call('apolloOps/runtime/status'),
        setDreamview: action => call('apolloOps/runtime/dreamview', { action }),
        killAll: () => call('apolloOps/runtime/kill-all'),
        openPty: () => call('apolloOps/pty/open'),
        readPty: (id, offset) => call('apolloOps/pty/read', { id, offset }),
        writePty: (id, data) => call('apolloOps/pty/write', { id, data }),
        signalPty: id => call('apolloOps/pty/signal', { id }),
        closePty: id => call('apolloOps/pty/close', { id }),
    };
}
//# sourceMappingURL=api.js.map