import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import css from './ApolloOpsTab.module.css';
import { CameraConfigDialog } from "./CameraConfigDialog.js";
const CONFIG_FIELDS = {
    gnss: [
        { key: 'address', label: '基站地址' },
        { key: 'port', label: '端口' },
        { key: 'mountPoint', label: '挂载点' },
        { key: 'user', label: '账号' },
        { key: 'password', label: '密码' },
    ],
    lidar: [
        { key: 'model', label: '雷达型号' },
        { key: 'deviceIp', label: '设备 IP' },
        { key: 'hostIp', label: '本机 IP' },
        { key: 'dataPort', label: '数据端口' },
        { key: 'auxPort', label: '辅助端口' },
        { key: 'frameId', label: 'frame_id' },
        { key: 'pointcloud', label: '点云 channel' },
        { key: 'scan', label: '扫描 channel' },
    ],
    camera: [
        { key: 'enable', label: '启用相机（逗号分隔）' },
        { key: 'devs', label: '设备映射（name:/dev/videoX）' },
    ],
};
function Status({ tone, label }) {
    return _jsxs("span", { className: css.status, "data-tone": tone, children: [_jsx("i", { "aria-hidden": "true" }), label] });
}
function Icon({ name }) {
    const paths = {
        car: _jsxs(_Fragment, { children: [_jsx("path", { d: "M4 13l1.4-4.2A2 2 0 0 1 7.3 7h9.4a2 2 0 0 1 1.9 1.4L20 13" }), _jsx("path", { d: "M3 13h18v5H3zM6 18v2m12-2v2M7 15h.01M17 15h.01" })] }),
        sensor: _jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "12", r: "2" }), _jsx("path", { d: "M7.8 7.8a6 6 0 0 0 0 8.4m8.4 0a6 6 0 0 0 0-8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2 0a10 10 0 0 0 0-14.2" })] }),
        network: _jsxs(_Fragment, { children: [_jsx("circle", { cx: "12", cy: "12", r: "2" }), _jsx("circle", { cx: "5", cy: "6", r: "2" }), _jsx("circle", { cx: "19", cy: "6", r: "2" }), _jsx("circle", { cx: "5", cy: "18", r: "2" }), _jsx("circle", { cx: "19", cy: "18", r: "2" }), _jsx("path", { d: "M10.5 10.5L6.5 7.5m7 3l4-3m-7 6l-4 3m7-3l4 3" })] }),
        channel: _jsxs(_Fragment, { children: [_jsx("path", { d: "M4 6h16M4 12h16M4 18h16" }), _jsx("circle", { cx: "8", cy: "6", r: "1.5" }), _jsx("circle", { cx: "15", cy: "12", r: "1.5" }), _jsx("circle", { cx: "10", cy: "18", r: "1.5" })] }),
        restore: _jsxs(_Fragment, { children: [_jsx("path", { d: "M4 12a8 8 0 1 0 2.3-5.7L4 8.6" }), _jsx("path", { d: "M4 4v4.6h4.6" })] }),
        refresh: _jsxs(_Fragment, { children: [_jsx("path", { d: "M20 6v5h-5M4 18v-5h5" }), _jsx("path", { d: "M18.5 9A7 7 0 0 0 6 6.5L4 9m2 6a7 7 0 0 0 12 2.5l2-2.5" })] }),
    };
    return _jsx("svg", { className: css.icon, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: paths[name] });
}
export function ApolloOpsTab({ t, apolloOps }) {
    const [environment, setEnvironment] = useState({ warnings: [] });
    const [monitor, setMonitor] = useState(() => { try {
        const cached = JSON.parse(localStorage.getItem('apollo-ops-monitor-cache') ?? 'null');
        return cached ?? undefined;
    }
    catch {
        return undefined;
    } });
    const [runtime, setRuntime] = useState();
    const [restoreDialog, setRestoreDialog] = useState();
    const [restoreOptions, setRestoreOptions] = useState();
    const [restorePlan, setRestorePlan] = useState();
    const [sensorConfig, setSensorConfig] = useState();
    const [restoring, setRestoring] = useState(false);
    const [configDialog, setConfigDialog] = useState();
    const [cameraDialogOpen, setCameraDialogOpen] = useState(false);
    const [configFields, setConfigFields] = useState({});
    const [initialConfigFields, setInitialConfigFields] = useState({});
    const [editingConf, setEditingConf] = useState();
    const [editingCamera, setEditingCamera] = useState();
    const [lidarDetail, setLidarDetail] = useState();
    const [cameraDetail, setCameraDetail] = useState();
    const [addCameraDialog, setAddCameraDialog] = useState(false);
    const [addCameraFields, setAddCameraFields] = useState({});
    const [viewConf, setViewConf] = useState();
    const [targetDialog, setTargetDialog] = useState();
    const [targets, setTargets] = useState([]);
    const [customSensors, setCustomSensors] = useState(() => { try {
        return JSON.parse(localStorage.getItem('apollo-ops-custom-sensors') ?? '[]');
    }
    catch {
        return [];
    } });
    const [sensorDialog, setSensorDialog] = useState(false);
    const [sensorName, setSensorName] = useState('');
    const [sensorChannel, setSensorChannel] = useState('');
    useEffect(() => {
        let active = true;
        void apolloOps.environment().then(result => {
            if (active && result.ok)
                setEnvironment(result.value);
        });
        void apolloOps.runtimeStatus().then(result => { if (active && result.ok)
            setRuntime(result.value); });
        return () => { active = false; };
    }, [apolloOps]);
    useEffect(() => {
        let active = true;
        const load = () => { void apolloOps.monitorSnapshot(customSensors).then(result => { if (active && result.ok) {
            setMonitor(result.value);
            try {
                localStorage.setItem('apollo-ops-monitor-cache', JSON.stringify(result.value));
            }
            catch { }
        } }); };
        load();
        const timer = window.setInterval(load, 1000);
        return () => { active = false; window.clearInterval(timer); };
    }, [apolloOps, customSensors]);
    const liveSensors = monitor?.sensors ?? [];
    const liveChannels = monitor?.channels ?? [];
    const [page, setPage] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState('');
    const pageSize = 20;
    const pages = Math.max(1, Math.ceil(liveChannels.length / pageSize));
    const visible = useMemo(() => liveChannels.slice(page * pageSize, page * pageSize + pageSize), [liveChannels, page]);
    const previewRestore = (mode, selector) => {
        if (environment.targetId === undefined) {
            setTargetDialog({ mode, ...(selector === undefined ? {} : { selector }) });
            void apolloOps.restoreTargets().then(result => { if (result.ok)
                setTargets(result.value.targets); });
            return;
        }
        runRestorePlan(mode, selector, environment.targetId);
    };
    const runRestorePlan = (mode, selector, targetId) => {
        setNotice('正在生成恢复计划…');
        void apolloOps.restorePlan(mode, selector, targetId).then(result => {
            if (result.ok) {
                setRestorePlan(result.value);
                setNotice('');
            }
            else {
                setNotice(result.error.message);
            }
        });
    };
    const executeRestore = (planId) => {
        setRestoring(true);
        setNotice('正在执行恢复…');
        void apolloOps.restoreExecute(planId).then(result => {
            setRestoring(false);
            setRestorePlan(undefined);
            setNotice(result.ok ? (result.value.backup !== undefined ? `恢复完成，备份：${result.value.backup}` : '恢复完成') : result.error.message);
        });
    };
    const openScopedRestore = (mode) => {
        setRestoreDialog({ mode });
        setSensorConfig(undefined);
        void apolloOps.restoreOptions().then(result => { if (result.ok)
            setRestoreOptions(result.value); });
    };
    const selectSensor = (id) => {
        setRestoreDialog({ mode: 'sensor', selector: id });
        void apolloOps.restoreSensorConfig(id).then(result => { setSensorConfig(result.ok ? result.value : undefined); });
    };
    const openConfig = (kind) => {
        if (kind === 'camera') {
            setCameraDialogOpen(true);
            return;
        }
        setConfigDialog(kind);
        setConfigFields({});
        setInitialConfigFields({});
        setLidarDetail(undefined);
        setCameraDetail(undefined);
        setEditingConf(undefined);
        setEditingCamera(undefined);
        if (kind === 'lidar') {
            void apolloOps.configLidarDetail().then(result => {
                if (!result.ok)
                    return;
                setLidarDetail(result.value);
            });
            return;
        }
        void apolloOps.configOptions().then(result => {
            if (!result.ok)
                return;
            setConfigFields(result.value.gnss.current);
            setInitialConfigFields(result.value.gnss.current);
        });
    };
    const refreshCameraDetail = () => {
        void apolloOps.configCameraDetail().then(result => { if (result.ok)
            setCameraDetail(result.value); });
    };
    const toggleCamera = (camera) => {
        setNotice(camera.enabled ? '正在停用相机…' : '正在启用相机…');
        void apolloOps.configCameraInstance({ action: camera.enabled ? 'disable' : 'enable', dag: cameraDetail?.dag, name: camera.name, conf: camera.conf }).then(result => {
            setNotice(result.ok ? result.value.output : result.error.message);
            refreshCameraDetail();
        });
    };
    const editCamera = (camera) => {
        const fields = {};
        for (const field of camera.fields)
            fields[field.id] = field.value;
        setConfigFields(fields);
        setInitialConfigFields(fields);
        setEditingCamera(camera.conf);
    };
    const submitConfig = () => {
        if (configDialog === undefined)
            return;
        if (configDialog === 'lidar' && editingConf !== undefined) {
            const radar = lidarDetail?.radars.find(item => item.conf === editingConf);
            const jsonPaths = {};
            for (const field of radar?.fields ?? [])
                if (field.sourceType === 'json')
                    jsonPaths[field.id] = field.sourcePath;
            setNotice('正在写入雷达实例配置…');
            void apolloOps.configLidarInstance({ action: 'edit', conf: editingConf, values: configFields, jsonPaths }).then(result => {
                setNotice(result.ok ? '雷达实例配置已更新，融合输入已同步' : result.error.message);
                if (result.ok) {
                    setEditingConf(undefined);
                    setConfigFields({});
                    setInitialConfigFields({});
                    refreshLidarDetail();
                }
            });
            return;
        }
        if (configDialog === 'lidar') {
            setNotice('正在添加雷达…');
            void apolloOps.configLidarInstance({ action: 'add', model: configFields.model, values: configFields }).then(result => {
                setNotice(result.ok ? result.value.output : result.error.message);
                if (result.ok) {
                    setConfigFields({});
                    setInitialConfigFields({});
                    refreshLidarDetail();
                }
            });
            return;
        }
        if (configDialog === 'camera') {
            if (editingCamera === undefined) {
                setNotice('请先选择要修改的相机');
                return;
            }
            setNotice('正在写入相机配置…');
            void apolloOps.configCameraInstance({ action: 'edit', conf: editingCamera, values: configFields }).then(result => {
                setNotice(result.ok ? result.value.output : result.error.message);
                if (result.ok) {
                    setEditingCamera(undefined);
                    setConfigFields({});
                    setInitialConfigFields({});
                    refreshCameraDetail();
                }
            });
            return;
        }
        setNotice('正在写入配置…');
        void apolloOps.configGnss(configFields).then(result => {
            setConfigDialog(undefined);
            setNotice(result.ok ? `配置完成：${result.value.output.slice(0, 300)}` : result.error.message);
        });
    };
    const submitAddCamera = () => {
        setNotice('正在添加相机…');
        void apolloOps.configCameraInstance({ action: 'add', dag: cameraDetail?.dag, ...addCameraFields }).then(result => {
            setAddCameraDialog(false);
            setNotice(result.ok ? result.value.output : result.error.message);
            if (result.ok)
                refreshCameraDetail();
        });
    };
    const viewCameraConf = (camera) => {
        void apolloOps.readFile(camera.conf).then(result => {
            if (result.ok)
                setViewConf({ name: camera.name, path: camera.conf, content: result.value.content });
        });
    };
    const renderCameraRow = (camera) => (_jsxs("div", { className: css.lidarRow, "data-editing": editingCamera === camera.conf ? 'true' : undefined, children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: camera.enabled, onChange: () => toggleCamera(camera), "aria-label": `${camera.name} enable` }), _jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => viewCameraConf(camera), children: camera.name })] }), _jsx("code", { title: `${camera.dev} · ${camera.frameId}`, children: camera.dev }), _jsx("div", { className: css.lidarRowActions, children: _jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => editCamera(camera), children: t('editLidar') }) })] }, `${camera.name}-${camera.conf}`));
    const refreshLidarDetail = () => {
        void apolloOps.configLidarDetail().then(r => { if (r.ok)
            setLidarDetail(r.value); });
    };
    const removeLidar = (conf) => {
        setNotice('正在删除雷达…');
        void apolloOps.configLidarInstance({ action: 'remove', conf }).then(result => {
            setNotice(result.ok ? '雷达已删除' : result.error.message);
            refreshLidarDetail();
        });
    };
    const editLidar = (radar) => {
        const fields = { conf: radar.conf, mode: 'edit', model: radar.model };
        for (const f of radar.fields ?? [])
            fields[f.id] = f.value;
        setConfigFields(fields);
        setInitialConfigFields(fields);
        setEditingConf(radar.conf);
    };
    const addSensor = () => {
        const name = sensorName.trim();
        const channel = sensorChannel.trim();
        if (name === '' || channel === '')
            return;
        const next = [...customSensors.filter(s => s.channel !== channel), { id: name, name, channel }];
        setCustomSensors(next);
        localStorage.setItem('apollo-ops-custom-sensors', JSON.stringify(next));
        setSensorName('');
        setSensorChannel('');
        setSensorDialog(false);
    };
    const removeSensor = (channel) => {
        const next = customSensors.filter(s => s.channel !== channel);
        setCustomSensors(next);
        localStorage.setItem('apollo-ops-custom-sensors', JSON.stringify(next));
    };
    const refresh = () => {
        setRefreshing(true);
        window.setTimeout(() => { setRefreshing(false); setNotice(t('updated')); }, 550);
    };
    return (_jsxs("section", { className: css.shell, "aria-label": t('title'), children: [cameraDialogOpen ? _jsx(CameraConfigDialog, { api: apolloOps, onClose: () => setCameraDialogOpen(false) }) : null, _jsxs("header", { className: css.hero, children: [_jsxs("div", { children: [_jsx("span", { className: css.eyebrow, children: t('eyebrow') }), _jsx("h2", { children: t('title') }), _jsx("p", { children: t('subtitle') })] }), _jsxs("div", { className: css.heroActions, children: [_jsx("span", { className: css.demoBadge, children: t('liveValue') }), _jsxs("button", { type: "button", className: css.secondaryButton, onClick: refresh, disabled: refreshing, children: [_jsx(Icon, { name: "refresh" }), refreshing ? '…' : t('refresh')] })] })] }), notice ? _jsx("div", { className: css.srNotice, role: "status", children: notice }) : null, _jsxs("div", { className: css.summaryGrid, children: [_jsxs("article", { className: `${css.card} ${css.environmentCard}`, children: [_jsxs("div", { className: css.cardHeader, children: [_jsx("span", { className: css.iconBox, children: _jsx(Icon, { name: "car" }) }), _jsxs("div", { children: [_jsx("h3", { children: t('environment') }), _jsx("p", { children: environment.currentProfile ?? '—' })] }), _jsx(Status, { tone: environment.warnings.length === 0 ? 'ok' : 'warn', label: environment.warnings.length === 0 ? t('normal') : t('warning') })] }), _jsxs("dl", { className: css.facts, children: [_jsxs("div", { children: [_jsx("dt", { children: t('vehicle') }), _jsx("dd", { children: environment.targetId ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: t('version') }), _jsx("dd", { children: environment.apolloVersion ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: t('profile') }), _jsx("dd", { children: environment.targetId ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: t('baseline') }), _jsx("dd", { children: environment.targetId === undefined ? '—' : _jsxs(_Fragment, { children: [_jsx("span", { className: css.inlineOk, children: "\u25CF" }), " ", t('matched')] }) })] })] }), _jsxs("div", { className: css.dvStatus, children: [_jsx("span", { children: t('startDreamview') }), _jsx(Status, { tone: runtime?.dreamview === 'running' ? 'ok' : 'warn', label: runtime?.dreamview === 'running' ? t('dreamviewRunning') : t('dreamviewStopped') })] }), _jsxs("div", { className: css.runtimeActions, children: [_jsx("button", { type: "button", onClick: () => { const next = runtime?.dreamview === 'running' ? 'stop' : 'start'; setNotice(next === 'start' ? '正在启动 DreamView…' : '正在关闭 DreamView…'); void apolloOps.setDreamview(next).then(result => { if (result.ok) {
                                            setRuntime(result.value);
                                            setNotice('');
                                        }
                                        else
                                            setNotice(result.error.message); }); }, children: runtime?.dreamview === 'running' ? t('stopDreamview') : t('startDreamview') }), _jsx("button", { type: "button", className: css.dangerButton, onClick: () => { if (window.confirm(t('closeAllApollo'))) {
                                            setNotice('正在关闭所有 Apollo 模块…');
                                            void apolloOps.killAll().then(result => { if (result.ok) {
                                                setRuntime(result.value);
                                                setNotice('');
                                            }
                                            else
                                                setNotice(result.error.message); });
                                        } }, children: t('closeAllApollo') })] })] }), _jsxs("article", { className: `${css.card} ${css.restoreCard}`, children: [_jsxs("div", { className: css.cardHeader, children: [_jsx("span", { className: css.iconBox, "data-tone": "amber", children: _jsx(Icon, { name: "restore" }) }), _jsxs("div", { children: [_jsx("h3", { children: t('restore') }), _jsx("p", { children: t('restoreHint') })] })] }), _jsxs("div", { className: css.restoreModes, children: [_jsxs("button", { type: "button", onClick: () => setRestoreDialog({ mode: 'full' }), children: [_jsxs("span", { children: [_jsx("strong", { children: t('fullRestore') }), _jsx("small", { children: t('fullRestoreHint') })] }), _jsx(Status, { tone: "ok", label: t('available') })] }), _jsxs("button", { type: "button", onClick: () => openScopedRestore('sensor'), children: [_jsxs("span", { children: [_jsx("strong", { children: t('sensorRestore') }), _jsx("small", { children: t('sensorRestoreHint') })] }), _jsx(Status, { tone: "ok", label: t('available') })] }), _jsxs("button", { type: "button", onClick: () => openScopedRestore('module'), children: [_jsxs("span", { children: [_jsx("strong", { children: t('moduleRestore') }), _jsx("small", { children: t('moduleRestoreHint') })] }), _jsx(Status, { tone: "ok", label: t('available') })] })] })] })] }), _jsxs("article", { className: `${css.card} ${css.configCard}`, children: [_jsxs("div", { className: css.cardHeader, children: [_jsx("span", { className: css.iconBox, "data-tone": "green", children: _jsx(Icon, { name: "sensor" }) }), _jsxs("div", { children: [_jsx("h3", { children: t('sensorConfigTitle') }), _jsx("p", { children: t('sensorConfigHint') })] })] }), _jsxs("div", { className: css.restoreModes, children: [_jsxs("button", { type: "button", onClick: () => openConfig('gnss'), children: [_jsxs("span", { children: [_jsx("strong", { children: t('gnssConfig') }), _jsx("small", { children: t('gnssConfigHint') })] }), _jsx(Status, { tone: "ok", label: t('available') })] }), _jsxs("button", { type: "button", onClick: () => openConfig('lidar'), children: [_jsxs("span", { children: [_jsx("strong", { children: t('lidarConfig') }), _jsx("small", { children: t('lidarConfigHint') })] }), _jsx(Status, { tone: "ok", label: t('available') })] }), _jsxs("button", { type: "button", onClick: () => openConfig('camera'), children: [_jsxs("span", { children: [_jsx("strong", { children: t('cameraConfig') }), _jsx("small", { children: t('cameraConfigHint') })] }), _jsx(Status, { tone: "ok", label: t('available') })] })] })] }), _jsxs("div", { className: css.mainGrid, children: [_jsxs("article", { className: `${css.card} ${css.sensorCard}`, children: [_jsxs("div", { className: css.sectionHeading, children: [_jsx("span", { className: css.iconBox, children: _jsx(Icon, { name: "sensor" }) }), _jsxs("div", { children: [_jsx("h3", { children: t('sensors') }), _jsx("p", { children: t('sensorsHint') })] }), _jsxs("button", { type: "button", className: css.addButton, onClick: () => setSensorDialog(true), children: ["\uFF0B ", t('addSensor')] })] }), _jsx("div", { className: css.sensorList, children: liveSensors.length === 0 ? _jsx("div", { className: css.loadingRow, children: t('detecting') }) : liveSensors.map(sensor => _jsxs("div", { className: css.sensorRow, children: [_jsxs("div", { className: css.sensorIdentity, children: [_jsx(Status, { tone: sensor.status === 'ok' ? 'ok' : 'warn', label: sensor.status === 'ok' ? t('normal') : t('warning') }), _jsx("strong", { children: sensor.name }), _jsx("code", { children: sensor.channel })] }), _jsxs("div", { className: css.metric, children: [_jsx("strong", { children: sensor.hz !== undefined && sensor.hz > 0 ? `${sensor.hz.toFixed(1)} Hz` : '—' }), _jsx("span", { children: sensor.reason }), customSensors.some(s => s.channel === sensor.channel) ? _jsx("button", { type: "button", className: css.removeButton, onClick: () => removeSensor(sensor.channel), children: "\u00D7" }) : null] })] }, sensor.channel)) })] }), _jsxs("article", { className: `${css.card} ${css.networkCard}`, children: [_jsxs("div", { className: css.sectionHeading, children: [_jsx("span", { className: css.iconBox, children: _jsx(Icon, { name: "network" }) }), _jsxs("div", { children: [_jsx("h3", { children: t('network') }), _jsx("p", { children: t('networkHint') })] })] }), _jsxs("div", { className: css.networkHero, "data-alert": monitor?.network.external === 'error' ? 'true' : undefined, children: [_jsx("div", { className: css.globe, "aria-hidden": "true", children: _jsx("span", { children: "\u2197" }) }), _jsxs("div", { children: [_jsx("span", { children: t('external') }), _jsx("strong", { children: monitor?.network.external === 'error' ? t('disconnected') : t('reachable') }), _jsx("small", { children: monitor?.network.reason ?? t('checking') })] }), _jsx(Status, { tone: monitor?.network.external === 'error' ? 'warn' : 'ok', label: monitor?.network.external === 'error' ? t('warning') : t('normal') })] }), _jsxs("div", { className: css.linkGroup, children: [_jsx("div", { className: css.groupTitle, children: t('sensorLinkTitle') }), (monitor?.network.sensorLinks ?? []).map(link => _jsxs("div", { className: css.linkRow, children: [_jsx("span", { children: link.kind }), _jsx("code", { children: link.target }), _jsx(Status, { tone: link.ok ? 'ok' : 'warn', label: link.detail })] }, `${link.kind}-${link.target}`))] }), _jsxs("div", { className: css.linkGroup, children: [_jsx("div", { className: css.groupTitle, children: t('interfaceTitle') }), (runtime?.ports ?? []).map(port => _jsxs("div", { className: css.linkRow, children: [_jsx("span", { children: port.name }), _jsx("code", { children: port.address }), _jsx(Status, { tone: "ok", label: t('upValue') })] }, port.address))] })] })] }), _jsxs("article", { className: `${css.card} ${css.channelCard}`, children: [_jsxs("div", { className: css.sectionHeading, children: [_jsx("span", { className: css.iconBox, children: _jsx(Icon, { name: "channel" }) }), _jsxs("div", { children: [_jsx("h3", { children: t('channels') }), _jsx("p", { children: t('channelsHint', { page: page + 1, pages }) })] }), _jsx("span", { className: css.pageSize, children: t('pageSize') })] }), _jsx("div", { className: css.tableWrap, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: t('channel') }), _jsx("th", { children: t('rate') }), _jsx("th", { children: t('statusLabel') })] }) }), _jsx("tbody", { children: visible.length === 0 ? _jsx("tr", { children: _jsx("td", { colSpan: 3, className: css.loadingRow, children: t('loadingChannels') }) }) : visible.map(item => _jsxs("tr", { children: [_jsx("td", { children: _jsx("code", { children: item.name }) }), _jsx("td", { children: item.hz > 0 ? `${item.hz.toFixed(1)} Hz` : '—' }), _jsx("td", { children: _jsx(Status, { tone: item.status === 'active' ? 'ok' : 'warn', label: item.status === 'active' ? t('normal') : t('warning') }) })] }, item.name)) })] }) }), _jsxs("footer", { className: css.pagination, children: [_jsxs("span", { children: [page + 1, " / ", pages] }), _jsxs("div", { children: [_jsx("button", { type: "button", onClick: () => setPage(value => Math.max(0, value - 1)), disabled: page === 0, children: t('previous') }), _jsx("button", { type: "button", onClick: () => setPage(value => Math.min(pages - 1, value + 1)), disabled: page === pages - 1, children: t('next') })] })] })] }), targetDialog !== undefined ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => setTargetDialog(undefined) }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: t('chooseTarget') }), _jsxs("select", { value: "", onChange: event => { const targetId = event.target.value; if (targetId !== '') {
                                    runRestorePlan(targetDialog.mode, targetDialog.selector, targetId);
                                    setTargetDialog(undefined);
                                } }, children: [_jsx("option", { value: "", disabled: true, children: t('chooseTarget') }), targets.map(target => _jsx("option", { value: target, children: target }, target))] }), _jsx("div", { className: css.modalActions, children: _jsx("button", { type: "button", onClick: () => setTargetDialog(undefined), children: t('cancel') }) })] })] }) : null, restoreDialog !== undefined ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => setRestoreDialog(undefined) }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: restoreDialog.mode === 'full' ? t('fullRestore') : restoreDialog.mode === 'sensor' ? t('chooseSensor') : t('chooseModule') }), restoreDialog.mode === 'full' ? _jsx("p", { children: t('restoreWarning') }) : restoreDialog.mode === 'sensor' ? _jsxs(_Fragment, { children: [_jsxs("select", { value: restoreDialog.selector ?? '', onChange: event => selectSensor(event.target.value), children: [_jsx("option", { value: "", disabled: true, children: t('chooseSensor') }), (restoreOptions?.sensors ?? []).map(sensor => _jsx("option", { value: sensor.id, children: sensor.name }, sensor.id))] }), sensorConfig !== undefined ? _jsxs("div", { className: css.instanceFields, children: [_jsx("div", { className: css.diffNote, children: sensorConfig.changed.length > 0 ? t('sensorDiffNote') : t('sensorNoDiff') }), sensorConfig.confs.map(conf => _jsxs("div", { className: css.confGroup, children: [_jsxs("div", { className: css.confGroupHead, children: [_jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => viewCameraConf({ name: conf.path.split('/').pop() ?? conf.path, conf: conf.path }), children: conf.path.split('/').pop() }), _jsx("small", { children: conf.inBaseline ? (conf.changed ? t('sensorDiffNote') : t('sensorNoDiff')) : '基线无此文件' })] }), _jsx("code", { className: css.confPath, children: conf.path }), _jsx("div", { className: css.configBox, children: conf.fields.map(field => _jsxs("div", { "data-changed": field.changed ? 'true' : undefined, children: [_jsx("span", { children: field.key }), _jsx("code", { children: field.value }), field.changed ? _jsxs("em", { children: ["\u2192 ", field.baseline ?? '(基线无此项)'] }) : null] }, `${conf.path}-${field.key}-${field.value}`)) })] }, conf.path))] }) : null] }) : _jsxs("select", { value: restoreDialog.selector ?? '', onChange: event => setRestoreDialog({ mode: 'module', selector: event.target.value }), children: [_jsx("option", { value: "", disabled: true, children: t('chooseModule') }), (restoreOptions?.modules ?? []).map(module => _jsx("option", { value: module, children: module }, module))] }), _jsxs("div", { className: css.modalActions, children: [_jsx("button", { type: "button", onClick: () => setRestoreDialog(undefined), children: t('cancel') }), _jsx("button", { type: "button", className: css.dangerButton, disabled: restoreDialog.mode !== 'full' && restoreDialog.selector === undefined, onClick: () => { previewRestore(restoreDialog.mode, restoreDialog.selector); setRestoreDialog(undefined); }, children: t('confirmRestore') })] })] })] }) : null, restorePlan !== undefined ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => { if (!restoring)
                            setRestorePlan(undefined); } }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: t('dryRun') }), _jsx("p", { children: restorePlan.summary }), restoring ? _jsx("div", { className: css.progressTrack, children: _jsx("div", { className: css.progressBar }) }) : restorePlan.changes.length > 0 ? _jsxs("ul", { className: css.changeList, children: [restorePlan.changes.slice(0, 40).map(change => _jsx("li", { children: _jsx("code", { children: change }) }, change)), restorePlan.changes.length > 40 ? _jsx("li", { children: t('moreChanges', { count: restorePlan.changes.length - 40 }) }) : null] }) : null, _jsxs("div", { className: css.modalActions, children: [restoring ? _jsx("span", { className: css.restoringNote, children: t('restoring') }) : _jsx("button", { type: "button", onClick: () => setRestorePlan(undefined), children: t('cancel') }), !restoring && restorePlan.readyToApply && restorePlan.planId !== undefined ? _jsx("button", { type: "button", className: css.dangerButton, onClick: () => executeRestore(restorePlan.planId), children: t('confirmRestore') }) : null] })] })] }) : null, sensorDialog ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => setSensorDialog(false) }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: t('addSensor') }), _jsx("input", { value: sensorName, onChange: event => setSensorName(event.target.value), placeholder: t('sensorNamePlaceholder') }), _jsx("input", { value: sensorChannel, onChange: event => setSensorChannel(event.target.value), placeholder: t('sensorChannelPlaceholder') }), _jsxs("div", { className: css.modalActions, children: [_jsx("button", { type: "button", onClick: () => setSensorDialog(false), children: t('cancel') }), _jsx("button", { type: "button", onClick: addSensor, children: t('confirmRestore') })] })] })] }) : null, configDialog !== undefined ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => setConfigDialog(undefined) }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: configDialog === 'gnss' ? t('gnssConfig') : configDialog === 'lidar' ? t('lidarConfig') : t('cameraConfig') }), configDialog === 'gnss' ? CONFIG_FIELDS.gnss.map(field => { const current = initialConfigFields[field.key] ?? ''; const value = configFields[field.key] ?? ''; const changed = current !== '' && value !== '' && current !== value; return _jsxs("div", { className: css.configField, children: [_jsx("label", { children: field.label }), _jsx("input", { value: value, onChange: event => setConfigFields(prev => ({ ...prev, [field.key]: event.target.value })), placeholder: current || field.label, "aria-label": field.label }), changed ? _jsxs("em", { children: [current, " \u2192 ", value] }) : _jsx("small", { children: current !== '' ? `当前 ${current}` : '' })] }, field.key); }) : configDialog === 'lidar' ? _jsxs(_Fragment, { children: [_jsx("div", { className: css.dagPath, children: _jsx("code", { children: lidarDetail?.dag ?? '' }) }), _jsxs("div", { className: css.lidarList, children: [_jsx("div", { className: css.cameraGroupTitle, children: t('currentRadars') }), (lidarDetail?.radars ?? []).map(radar => _jsxs("div", { className: css.lidarRow, "data-editing": editingConf === radar.conf ? 'true' : undefined, children: [_jsx("span", { children: radar.model }), _jsx("code", { title: radar.conf, children: radar.name }), _jsxs("div", { className: css.lidarRowActions, children: [_jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => editLidar(radar), children: t('editLidar') }), _jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => removeLidar(radar.conf), children: t('removeLidar') })] })] }, radar.conf))] }), _jsxs("div", { className: css.configField, children: [_jsx("label", { children: t('addLidar') }), _jsxs("select", { value: configFields.model ?? '', onChange: event => { const model = event.target.value; const m = lidarDetail?.models.find(x => x.model === model); const fields = { model, mode: 'add' }; for (const f of m?.fields ?? [])
                                                    fields[f.key.replace(/_([a-z])/g, (_s, c) => c.toUpperCase())] = f.value; setConfigFields(fields); setInitialConfigFields(fields); setEditingConf(undefined); }, children: [_jsx("option", { value: "", disabled: true, children: t('chooseSensor') }), (lidarDetail?.models ?? []).map(m => _jsx("option", { value: m.model, children: m.model }, m.model))] })] }), editingConf === undefined && configFields.model !== undefined && configFields.model !== '' ? CONFIG_FIELDS.lidar.filter(f => f.key !== 'model').map(field => { const current = initialConfigFields[field.key] ?? ''; const value = configFields[field.key] ?? ''; const changed = current !== '' && value !== '' && current !== value; return _jsxs("div", { className: css.configField, children: [_jsx("label", { children: field.label }), _jsx("input", { value: value, onChange: event => setConfigFields(prev => ({ ...prev, [field.key]: event.target.value })), placeholder: current || field.label, "aria-label": field.label }), changed ? _jsxs("em", { children: [current, " \u2192 ", value] }) : _jsx("small", { children: current !== '' ? `当前 ${current}` : '' })] }, field.key); }) : null, editingConf !== undefined ? _jsxs("div", { className: css.instanceEditor, children: [_jsxs("div", { className: css.instanceEditorHead, children: [_jsx("strong", { children: lidarDetail?.radars.find(r => r.conf === editingConf)?.name ?? '' }), _jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => { setEditingConf(undefined); setConfigFields({}); setInitialConfigFields({}); }, children: t('cancel') })] }), _jsx("div", { className: css.instanceFields, children: (lidarDetail?.radars.find(r => r.conf === editingConf)?.fields ?? []).map(field => _jsxs("div", { className: css.configField, children: [_jsx("label", { title: field.key, children: field.key }), _jsx("input", { value: configFields[field.id] ?? field.value, onChange: event => setConfigFields(prev => ({ ...prev, [field.id]: event.target.value })) }), _jsxs("small", { children: [field.sourceType === 'json' ? 'JSON' : 'PB', " \u00B7 ", field.sourcePath] })] }, field.id)) })] }) : null] }) : _jsxs(_Fragment, { children: [_jsx("div", { className: css.dagPath, children: _jsx("code", { children: cameraDetail?.dag ?? '' }) }), _jsxs("div", { className: css.lidarList, children: [_jsx("div", { className: css.cameraGroupTitle, children: t('enabledCameras') }), (cameraDetail?.cameras ?? []).filter(c => c.enabled).map(renderCameraRow), _jsx("div", { className: css.cameraGroupTitle, children: t('disabledCameras') }), (cameraDetail?.cameras ?? []).filter(c => !c.enabled).map(renderCameraRow)] }), editingCamera !== undefined ? _jsxs("div", { className: css.instanceEditor, children: [_jsxs("div", { className: css.instanceEditorHead, children: [_jsx("strong", { children: cameraDetail?.cameras.find(c => c.conf === editingCamera)?.name ?? '' }), _jsx("button", { type: "button", className: css.cameraNameBtn, onClick: () => { setEditingCamera(undefined); setConfigFields({}); setInitialConfigFields({}); }, children: t('cancel') })] }), _jsx("div", { className: css.instanceFields, children: (cameraDetail?.cameras.find(c => c.conf === editingCamera)?.fields ?? []).map(field => _jsxs("div", { className: css.configField, children: [_jsx("label", { title: field.key, children: field.key }), _jsx("input", { value: configFields[field.id] ?? field.value, onChange: event => setConfigFields(prev => ({ ...prev, [field.id]: event.target.value })) }), _jsx("small", { children: field.sourcePath })] }, field.id)) })] }) : null] }), _jsxs("div", { className: css.modalActions, children: [configDialog === 'camera' ? _jsx("button", { type: "button", onClick: () => { setAddCameraFields({}); setAddCameraDialog(true); }, children: t('addCamera') }) : null, _jsx("button", { type: "button", onClick: () => setConfigDialog(undefined), children: t('cancel') }), _jsx("button", { type: "button", className: css.dangerButton, onClick: submitConfig, children: t('writeConfig') })] })] })] }) : null, addCameraDialog ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => setAddCameraDialog(false) }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: t('addCamera') }), _jsx("input", { value: addCameraFields.name ?? '', onChange: event => setAddCameraFields(prev => ({ ...prev, name: event.target.value })), placeholder: t('cameraNamePlaceholder') }), _jsx("input", { value: addCameraFields.dev ?? '', onChange: event => setAddCameraFields(prev => ({ ...prev, dev: event.target.value })), placeholder: t('cameraDevPlaceholder') }), _jsx("input", { value: addCameraFields.frameId ?? '', onChange: event => setAddCameraFields(prev => ({ ...prev, frameId: event.target.value })), placeholder: t('cameraFramePlaceholder') }), _jsxs("div", { className: css.modalActions, children: [_jsx("button", { type: "button", onClick: () => setAddCameraDialog(false), children: t('cancel') }), _jsx("button", { type: "button", className: css.dangerButton, onClick: submitAddCamera, children: t('writeConfig') })] })] })] }) : null, viewConf !== undefined ? _jsxs("div", { className: css.modalOverlay, role: "presentation", children: [_jsx("div", { className: css.modalMask, onClick: () => setViewConf(undefined) }), _jsxs("div", { className: css.modal, role: "dialog", "aria-modal": "true", children: [_jsx("strong", { children: viewConf.name }), _jsx("div", { className: css.dagPath, children: _jsx("code", { children: viewConf.path }) }), _jsx("pre", { className: css.confView, children: viewConf.content }), _jsx("div", { className: css.modalActions, children: _jsx("button", { type: "button", onClick: () => setViewConf(undefined), children: t('close') }) })] })] }) : null] }));
}
//# sourceMappingURL=ApolloOpsTab.js.map