import { createHash, randomUUID } from 'node:crypto';
import { confScalarFields } from "./sensor-conf-diff.js";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { APOLLO_OPS_CHANNEL } from "./channel.js";
export { APOLLO_OPS_CHANNEL } from "./channel.js";
const CHANNEL = APOLLO_OPS_CHANNEL;
const DEFAULT_MAX_TEXT_BYTES = 1024 * 1024;
const DEFAULT_MONITOR = {
    sensors: [],
    externalTargets: [{ name: 'Internet', host: '1.1.1.1', port: 443 }], channelPageSize: 20, refreshMs: 2000,
};
function ok(value) { return { ok: true, value }; }
function fail(code, message, details = {}) {
    return { ok: false, error: { code, message, details } };
}
function discoverWorkspace(configured) {
    const candidates = [configured, process.env.APOLLO_WORKSPACE, process.cwd(), '/apollo_workspace']
        .filter((value) => typeof value === 'string' && value.length > 0);
    for (const candidate of candidates) {
        const root = resolve(candidate);
        if (existsSync(join(root, '.workspace.json')) || existsSync(join(root, 'profiles')))
            return root;
    }
    return undefined;
}
function contained(root, candidate) {
    const rel = relative(root, candidate);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function safePath(root, input, forWrite = false) {
    if (typeof input !== 'string' || input.includes('\0'))
        throw new Error('invalid path');
    const canonicalRoot = realpathSync(root);
    const lexical = isAbsolute(input) ? resolve(input) : resolve(root, input);
    const stat = (() => { try {
        return lstatSync(lexical);
    }
    catch {
        return undefined;
    } })();
    if (stat?.isSymbolicLink())
        throw new Error('symbolic links are not editable or readable');
    const canonical = stat === undefined && forWrite ? realpathSync(join(lexical, '..')) : realpathSync(lexical);
    if (!contained(canonicalRoot, canonical))
        throw new Error('path leaves workspace');
    return lexical;
}
function skillRoots(root) {
    const homes = [join(root, '.dsh/skills'), join(root, '.claude/skills')];
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    homes.push(join(dshHome, 'skills'));
    return homes;
}
function skillInstalled(root, name) {
    return skillRoots(root).some(home => existsSync(join(home, name, 'SKILL.md')));
}
function workspaceVersion(root) {
    try {
        const parsed = JSON.parse(readFileSync(join(root, '.workspace.json'), 'utf8'));
        return parsed.repositories?.find(row => row.name?.includes('universe'))?.version;
    }
    catch {
        return undefined;
    }
}
function currentProfile(root) {
    const current = join(root, 'profiles/current');
    try {
        const path = realpathSync(current);
        if (!contained(join(root, 'profiles'), path))
            return { warning: 'profiles/current 指向工作区外部' };
        const target = path.split(sep).pop();
        return { path, ...(target === undefined ? {} : { target }) };
    }
    catch {
        return { warning: 'profiles/current 不存在或已断开' };
    }
}
function readStamp(profilePath) {
    if (profilePath === undefined)
        return {};
    try {
        const text = readFileSync(join(profilePath, '.apollo_vehicle_stamp.yaml'), 'utf8');
        const value = (key) => text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'))?.[1]?.trim();
        const targetId = value('target_id');
        const version = value('apollo_version');
        const baseline = value('baseline_id');
        return { ...(targetId === undefined ? {} : { targetId }), ...(version === undefined ? {} : { version }), ...(baseline === undefined ? {} : { baseline }) };
    }
    catch {
        return {};
    }
}
function baselineVersion(root, targetId) {
    for (const home of skillRoots(root)) {
        for (const skill of ['apollo-vehicle-restore', 'apollo-env']) {
            const latest = join(home, skill, 'baselines', targetId, 'latest');
            if (!existsSync(latest))
                continue;
            let version = 'latest';
            try {
                version = lstatSync(latest).isSymbolicLink() ? readlinkSync(latest) : 'latest';
            }
            catch { }
            return {
                version,
                parameters: existsSync(join(latest, 'parameters.yaml')),
                code: existsSync(join(latest, 'code.yaml')),
            };
        }
    }
    return undefined;
}
function environment(root) {
    if (root === undefined)
        return { available: false, skills: { apolloEnv: false, apolloDev: false }, warnings: ['未发现 Apollo 工作区'] };
    const current = currentProfile(root);
    const stamp = readStamp(current.path);
    const warnings = [...current.warning === undefined ? [] : [current.warning]];
    if (current.target !== undefined && stamp.targetId !== undefined && current.target !== stamp.targetId) {
        warnings.push(`当前 Profile ${current.target} 与车型指纹 ${stamp.targetId} 不一致`);
    }
    const detectedVersion = workspaceVersion(root);
    if (stamp.version !== undefined && detectedVersion !== undefined && stamp.version !== detectedVersion) {
        warnings.push(`Apollo 版本 ${detectedVersion} 与车型指纹 ${stamp.version} 不一致`);
    }
    const targetId = stamp.targetId ?? current.target;
    const baseline = targetId === undefined ? undefined : baselineVersion(root, targetId);
    if (baseline === undefined && targetId !== undefined)
        warnings.push(`未找到 ${targetId} 对应基线`);
    return {
        available: true,
        workspace: root,
        ...(current.path === undefined ? {} : { currentProfile: current.path }),
        ...(targetId === undefined ? {} : { targetId }),
        ...(detectedVersion === undefined ? {} : { apolloVersion: detectedVersion }),
        skills: { apolloEnv: skillInstalled(root, 'apollo-env'), apolloDev: skillInstalled(root, 'apollo-dev') },
        ...(targetId === undefined || baseline === undefined ? {} : { baseline: { targetId, ...baseline } }),
        warnings,
    };
}
function listFiles(root, payload) {
    const request = payload;
    const path = safePath(root, request?.path ?? '.');
    const stat = statSync(path);
    if (!stat.isDirectory())
        throw new Error('path is not a directory');
    return readdirSync(path, { withFileTypes: true }).slice(0, 500).map((entry) => {
        const absolute = join(path, entry.name);
        const info = lstatSync(absolute);
        const rel = relative(root, absolute) || '.';
        const type = entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file';
        return {
            name: entry.name,
            path: rel,
            type,
            ...entry.isFile() ? { size: info.size } : {},
            modifiedMs: info.mtimeMs,
        };
    }).sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
}
function readText(root, payload, maxBytes) {
    const request = payload;
    const path = safePath(root, request?.path);
    const info = statSync(path);
    if (!info.isFile())
        throw new Error('path is not a file');
    const bytes = readFileSync(path);
    if (bytes.includes(0))
        throw new Error('binary file is not editable');
    const truncated = bytes.length > maxBytes;
    const content = bytes.subarray(0, maxBytes).toString('utf8');
    return { path: relative(root, path), content, version: createHash('sha256').update(bytes).digest('hex'), truncated };
}
function writeText(root, payload, maxBytes) {
    const request = payload;
    if (typeof request.content !== 'string' || Buffer.byteLength(request.content) > maxBytes)
        throw new Error('invalid or oversized content');
    if (typeof request.version !== 'string')
        throw new Error('missing file version');
    const path = safePath(root, request.path, true);
    const current = readFileSync(path);
    const currentVersion = createHash('sha256').update(current).digest('hex');
    if (currentVersion !== request.version)
        throw new Error('file changed on disk; reload before saving');
    writeFileSync(path, request.content, { encoding: 'utf8', flush: true });
    return readText(root, request, maxBytes);
}
const execFileAsync = promisify(execFile);
function monitorConfig(config) {
    return {
        sensors: config.sensors ?? DEFAULT_MONITOR.sensors,
        externalTargets: config.externalTargets ?? DEFAULT_MONITOR.externalTargets,
        channelPageSize: config.channelPageSize ?? DEFAULT_MONITOR.channelPageSize,
        refreshMs: config.refreshMs ?? DEFAULT_MONITOR.refreshMs,
        permissions: { fileWrite: config.allowFileWrite !== false, terminal: config.allowTerminal !== false, restore: config.allowRestore !== false },
    };
}
function tcpReachable(host, port, timeoutMs = 1500) {
    if (!/^[A-Za-z0-9.-]+$/.test(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535)
        return Promise.resolve(false);
    return new Promise(resolveResult => {
        const socket = connect({ host, port });
        const done = (value) => { socket.destroy(); resolveResult(value); };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}
function detectSensors(channels) {
    const sensors = [];
    const chassis = channels.find(c => c === '/apollo/canbus/chassis');
    if (chassis)
        sensors.push({ id: 'chassis', name: '底盘', channel: chassis, required: true });
    const gnss = channels.find(c => c.includes('/sensor/gnss/') && (c.endsWith('/ins_stat') || c.endsWith('/best_pose')));
    if (gnss)
        sensors.push({ id: 'gnss', name: 'GNSS', channel: gnss, required: true });
    const lidar = channels.find(c => c.includes('PointCloud2'));
    if (lidar)
        sensors.push({ id: 'lidar', name: '激光雷达', channel: lidar, required: true });
    const radar = channels.find(c => /radar/i.test(c) && !c.includes('PointCloud2') && !c.includes('/gnss/'));
    if (radar)
        sensors.push({ id: 'radar', name: '毫米波雷达', channel: radar, required: false });
    const camera = channels.find(c => c.includes('/sensor/camera/') && c.endsWith('/image'));
    if (camera)
        sensors.push({ id: 'camera', name: '相机', channel: camera, required: false });
    return sensors;
}
const MONITOR_SCRIPT = [
    'import sys, os, time, json',
    'dist = os.environ.get("APOLLO_DISTRIBUTION_HOME", "/opt/apollo/neo")',
    'for cand in [os.path.join(dist, "lib", "python3.6", "site-packages"), os.path.join(dist, "packages", "cyber-python", "latest", "lib", "python3.6", "site-packages")]:',
    '    if os.path.isdir(cand): sys.path.insert(0, cand)',
    'from cyber.python.cyber_py3 import cyber',
    'cyber.init()',
    'node = cyber.Node("apollo_ops_mon")',
    'subscribed = set()',
    'counts = {}',
    'channels = []',
    'refresh = 0',
    'def make_cb(ch):',
    '    def cb(msg): counts[ch] = counts.get(ch, 0) + 1',
    '    return cb',
    'while True:',
    '    refresh += 1',
    '    if refresh >= 5:',
    '        refresh = 0',
    '        try: channels = sorted(cyber.ChannelUtils.get_channels())',
    '        except: channels = []',
    '        for ch in channels:',
    '            if ch not in subscribed:',
    '                try: node.create_rawdata_reader(ch, make_cb(ch)); subscribed.add(ch)',
    '                except: pass',
    '    counts.clear()',
    '    t0 = time.time()',
    '    time.sleep(1.0)',
    '    elapsed = time.time() - t0',
    '    hz = {ch: round(counts.get(ch, 0) / elapsed, 2) for ch in channels}',
    '    print(json.dumps({"channels": channels, "hz": hz}), flush=True)',
].join('\n');
let monitorProc;
let monitorCache = { channels: [], hz: {} };
let monitorBuffer = '';
function startMonitor(root) {
    if (monitorProc !== undefined)
        return;
    const tmp = join(root, '.apollo-ops-mon.py');
    writeFileSync(tmp, MONITOR_SCRIPT);
    const proc = spawn('python3', [tmp], { cwd: root });
    monitorProc = proc;
    monitorBuffer = '';
    proc.stdout?.on('data', (chunk) => {
        monitorBuffer += chunk.toString();
        const lines = monitorBuffer.split('\n');
        monitorBuffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{'))
                continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed.channels))
                    monitorCache = { channels: parsed.channels, hz: parsed.hz ?? {} };
            }
            catch { }
        }
    });
    proc.on('exit', () => { monitorProc = undefined; });
}
function localSubnets() {
    const subnets = [];
    for (const addrs of Object.values(networkInterfaces())) {
        for (const a of addrs ?? []) {
            if (a.family === 'IPv4' && !a.internal && a.address && a.netmask) {
                const ip = a.address.split('.').map(Number);
                const mask = a.netmask.split('.').map(Number);
                subnets.push(ip.map((o, i) => o & (mask[i] ?? 0)).join('.'));
            }
        }
    }
    return subnets;
}
function sameSubnet(ip, subnets) {
    const parts = ip.split('.').map(Number);
    return subnets.some(subnet => {
        const s = subnet.split('.').map(Number);
        return parts[0] === s[0] && parts[1] === s[1] && parts[2] === s[2];
    });
}
function isPrivateIp(ip) {
    const p = ip.split('.').map(Number);
    return (p[0] ?? 0) === 10 || ((p[0] ?? 0) === 192 && (p[1] ?? 0) === 168) || ((p[0] ?? 0) === 172 && (p[1] ?? 0) >= 16 && (p[1] ?? 0) <= 31) || (p[0] ?? 0) === 127;
}
function apolloRoot() {
    return process.env.APOLLO_ROOT_DIR ?? '/apollo';
}
// 传感器类型 → 恢复模块路径 + 显示名（Apollo drivers 框架结构，不含车型信息）
const SENSOR_TYPE_META = {
    lidar: { module: 'drivers/lidar', name: '激光雷达' },
    gnss: { module: 'drivers/gnss', name: 'GNSS / 惯导' },
    camera: { module: 'drivers/camera', name: '相机' },
    radar: { module: 'drivers/radar', name: '毫米波雷达' },
};
function sensorTypeFromPath(path) {
    const match = path.match(/drivers\/([^/]+)/);
    return match?.[1] ?? '';
}
function readSensorEndpoints() {
    const result = [];
    const root = apolloRoot();
    const modeFiles = [
        join(root, 'modules/dreamview_plus/conf/hmi_modes/vehicle_test.pb.txt'),
        join(root, 'modules/dreamview/conf/hmi_modes/vehicle_test.pb.txt'),
    ];
    for (const modeFile of modeFiles) {
        let text;
        try {
            text = readFileSync(modeFile, 'utf8');
        }
        catch {
            continue;
        }
        const dagFiles = [...text.matchAll(/dag_files:\s*"([^"]+)"/g)].map(m => m[1]).filter((v) => typeof v === 'string');
        for (const dagFile of dagFiles) {
            let dagText;
            try {
                dagText = readFileSync(dagFile, 'utf8');
            }
            catch {
                continue;
            }
            const confs = [...dagText.matchAll(/(?:^|\n)([^\n]*?)config_file_path\s*:\s*"([^"]+)"/g)]
                .filter(m => !(m[1] ?? '').includes('#'))
                .map(m => m[2])
                .filter((v) => typeof v === 'string');
            for (const conf of confs) {
                const type = sensorTypeFromPath(conf);
                const meta = SENSOR_TYPE_META[type];
                if (meta === undefined)
                    continue;
                let confText;
                try {
                    confText = readFileSync(conf, 'utf8');
                }
                catch {
                    continue;
                }
                const isTcp = /tcp\s*\{/.test(confText);
                const ips = [...confText.matchAll(/(?:ip|address|device_ip):\s*"(\d+\.\d+\.\d+\.\d+)"/g)].map(m => m[1]).filter((v) => typeof v === 'string').filter(isPrivateIp);
                const ports = [...confText.matchAll(/(?:_port|port):\s*(\d+)/g)].map(m => Number(m[1])).filter(n => Number.isSafeInteger(n) && n > 0 && n < 65536);
                const channel = confText.match(/(?:output_)?channel[_:a-z]*:\s*"([^"]+)"/)?.[1];
                const frameId = confText.match(/frame_id:\s*"([^"]+)"/)?.[1];
                const device = confText.match(/(?:device|camera_dev):\s*"([^"]+)"/)?.[1];
                if (ips.length > 0) {
                    for (const ip of ips) {
                        result.push({ type, name: meta.name, ip, ...(ports.length > 0 ? { port: ports[0] } : {}), proto: isTcp ? 'tcp' : 'udp', ...(channel === undefined ? {} : { channel }), ...(frameId === undefined ? {} : { frameId }), ...(device === undefined ? {} : { device }), conf });
                    }
                }
                else {
                    result.push({ type, name: meta.name, proto: isTcp ? 'tcp' : 'udp', ...(channel === undefined ? {} : { channel }), ...(frameId === undefined ? {} : { frameId }), ...(device === undefined ? {} : { device }), conf });
                }
            }
        }
    }
    return result;
}
function readSensorModules() {
    const seen = new Set();
    const out = [];
    for (const sensor of readSensorEndpoints()) {
        const meta = SENSOR_TYPE_META[sensor.type];
        if (meta === undefined || seen.has(sensor.type))
            continue;
        seen.add(sensor.type);
        out.push({ id: meta.module, name: meta.name });
    }
    return out;
}
async function refreshSensorLinks(_root) {
    const links = [];
    const subnets = localSubnets();
    for (const sensor of readSensorEndpoints()) {
        if (sensor.ip === undefined)
            continue;
        let ok = false;
        let detail = '离线';
        if (sensor.proto === 'tcp' && sensor.port !== undefined) {
            ok = await tcpReachable(sensor.ip, sensor.port, 1500);
            detail = ok ? '已连接' : '连接失败';
        }
        else {
            ok = sameSubnet(sensor.ip, subnets);
            detail = ok ? '在线' : '离线';
        }
        links.push({ kind: sensor.name, target: sensor.ip, detail, ok });
    }
    return links;
}
async function monitor(root, config, payload) {
    startMonitor(root);
    const channels = monitorCache.channels;
    const hzMap = monitorCache.hz;
    const detected = detectSensors(channels);
    const extra = payload?.customSensors ?? [];
    const configured = [...config.sensors.map(s => ({ id: s.id, name: s.name, channel: s.channel, required: s.required })), ...extra.map(s => ({ id: s.id, name: s.name, channel: s.channel, required: s.required ?? true }))];
    const merged = [...configured, ...detected.filter(d => !configured.some(s => s.id === d.id))];
    const sensors = merged.map(sensor => {
        const hz = hzMap[sensor.channel] ?? 0;
        if (hz > 0)
            return { id: sensor.id, name: sensor.name, channel: sensor.channel, required: sensor.required, status: 'ok', hz, reason: `${hz.toFixed(1)} Hz` };
        const exists = channels.includes(sensor.channel);
        return { id: sensor.id, name: sensor.name, channel: sensor.channel, required: sensor.required, status: exists ? 'unavailable' : 'error', hz: 0, reason: exists ? '无数据流' : 'Channel 不存在' };
    });
    const typed = channels.map(name => {
        const hz = hzMap[name] ?? 0;
        return { name, type: '', hz, status: hz > 0 ? 'active' : 'idle' };
    });
    const interfaces = Object.values(networkInterfaces()).filter(addrs => (addrs ?? []).some(a => a.family === 'IPv4' && !a.internal)).length;
    let external = 'error';
    for (const target of config.externalTargets) {
        if (await tcpReachable(target.host, target.port)) {
            external = 'ok';
            break;
        }
    }
    const sensorLinks = await refreshSensorLinks(root);
    return { at: Date.now(), sensors, network: { status: interfaces > 0 ? 'ok' : 'error', external, interfaceCount: interfaces, reason: external === 'ok' ? '外网连接正常' : '外网已断开', sensorLinks }, channels: typed };
}
function findRestoreScript(root) {
    for (const skillsDir of skillRoots(root)) {
        for (const candidate of ['apollo-vehicle-restore/scripts/restore_plan.py', 'apollo-env/scripts/restore_plan.py']) {
            const path = join(skillsDir, candidate);
            if (existsSync(path))
                return path;
        }
    }
    return undefined;
}
function readTargets(root) {
    const targets = [];
    for (const skillsDir of skillRoots(root)) {
        for (const skill of ['apollo-vehicle-restore', 'apollo-env']) {
            const baselinesDir = join(skillsDir, skill, 'baselines');
            if (!existsSync(baselinesDir))
                continue;
            try {
                for (const entry of readdirSync(baselinesDir, { withFileTypes: true })) {
                    if (!entry.isDirectory())
                        continue;
                    if (existsSync(join(baselinesDir, entry.name, 'latest')))
                        targets.push(entry.name);
                }
            }
            catch { }
        }
    }
    return [...new Set(targets)];
}
function findConfigScript(root, skillName, scriptName) {
    for (const skillsDir of skillRoots(root)) {
        const path = join(skillsDir, skillName, 'scripts', scriptName);
        if (existsSync(path))
            return path;
    }
    return undefined;
}
async function runSensorConfig(root, skillName, scriptName, payload, skipYes = false) {
    const script = findConfigScript(root, skillName, scriptName);
    if (script === undefined)
        throw new Error(`${skillName} 未安装`);
    const args = skipYes ? [] : ['--yes'];
    const p = payload;
    for (const [key, value] of Object.entries(p)) {
        if (value === undefined || value === null || value === '')
            continue;
        const flag = `--${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`).replace(/_/g, '-')}`;
        args.push(flag, String(value));
    }
    const result = await execFileAsync('python3', [script, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return { output: result.stdout.slice(-3000) };
}
function readLidarModels(root) {
    for (const skillsDir of skillRoots(root)) {
        const yamlPath = join(skillsDir, 'apollo-lidar-config', 'config', 'lidar_templates.yaml');
        if (!existsSync(yamlPath))
            continue;
        try {
            const text = readFileSync(yamlPath, 'utf8');
            return [...text.matchAll(/^- model:\s*(\S+)/gm)].map(m => m[1]).filter((v) => typeof v === 'string');
        }
        catch { }
    }
    return [];
}
function lidarCurrent() {
    return {};
}
function gnssCurrent() {
    const conf = join(apolloRoot(), 'modules/drivers/gnss/conf/gnss_conf.pb.txt');
    try {
        const text = readFileSync(conf, 'utf8');
        const ntrip = text.match(/ntrip\s*\{([^}]*)\}/s)?.[1] ?? '';
        const field = (re) => ntrip.match(re)?.[1] ?? '';
        return {
            address: field(/address:\s*"([^"]*)"/),
            port: field(/port:\s*(\d+)/),
            mountPoint: field(/mount_point:\s*"([^"]*)"/),
            user: field(/user:\s*"([^"]*)"/),
            password: field(/password:\s*"([^"]*)"/),
        };
    }
    catch {
        return {};
    }
}
function cameraOptions() {
    const cameras = [];
    const current = {};
    const dag = join(apolloRoot(), 'modules/drivers/camera/dag/camera.dag');
    try {
        const text = readFileSync(dag, 'utf8');
        const confs = [...text.matchAll(/config_file_path\s*:\s*"([^"]+)"/g)].map(m => m[1]).filter((v) => typeof v === 'string');
        const devs = [];
        for (const conf of confs) {
            const name = conf.split('/').pop()?.replace(/\.pb\.txt$/, '') ?? '';
            if (name === '')
                continue;
            cameras.push(name);
            try {
                const confText = readFileSync(conf, 'utf8');
                const dev = confText.match(/camera_dev:\s*"([^"]*)"/)?.[1];
                if (dev !== undefined)
                    devs.push(`${name}:${dev}`);
            }
            catch { }
        }
        if (cameras.length > 0)
            current.enable = cameras.join(',');
        if (devs.length > 0)
            current.devs = devs.join(',');
    }
    catch { }
    return { cameras, current };
}
async function runInstanceManager(root, skill, script, label, command, payload) {
    const scriptPath = findConfigScript(root, skill, script);
    if (scriptPath === undefined)
        throw new Error(`${skill} 实例管理器未安装`);
    const args = [scriptPath, command];
    if (label === 'camera' && payload !== null && typeof payload === 'object' && 'dag' in payload) {
        const dag = payload.dag;
        if (dag !== undefined && typeof dag !== 'string')
            throw new Error('camera dag 必须为路径字符串');
        if (typeof dag === 'string' && dag !== '')
            args.push('--dag', dag);
    }
    let requestFile;
    if (command === 'apply') {
        const requestsDir = join(root, '.apollo-env', 'requests');
        mkdirSync(requestsDir, { recursive: true });
        requestFile = join(requestsDir, `${label}-${Date.now()}-${randomUUID()}.json`);
        writeFileSync(requestFile, JSON.stringify(payload ?? {}), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        args.push('--request', requestFile);
    }
    try {
        let stdout;
        try {
            const result = await execFileAsync('python3', args, { cwd: root, env: { ...process.env, APOLLO_WORKSPACE: root, APOLLO_ROOT_DIR: apolloRoot() }, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
            stdout = result.stdout;
        }
        catch (error) {
            // The manager reports refusals as JSON on stdout with a non-zero exit; surface that reason.
            const failure = error;
            const raw = (failure.stdout ?? '').trim();
            let managerError;
            try {
                const parsed = JSON.parse(raw);
                if (typeof parsed.error === 'string')
                    managerError = parsed.error;
            }
            catch { /* Non-JSON subprocess errors use the stderr fallback below. */ }
            if (managerError !== undefined)
                throw new Error(managerError);
            const stderrTail = (failure.stderr ?? '').trim().split('\n').slice(-3).join(' ');
            throw new Error(stderrTail !== '' ? stderrTail : (failure.message ?? '配置失败'));
        }
        const parsed = JSON.parse(stdout);
        if (!parsed.ok)
            throw new Error(parsed.error ?? '配置失败');
        if (command === 'inspect')
            return parsed;
        return { output: typeof parsed.message === 'string' ? parsed.message : '配置完成' };
    }
    finally {
        if (requestFile !== undefined) {
            try {
                rmSync(requestFile, { force: true });
            }
            catch { }
        }
    }
}
async function runLidarManager(root, command, payload) {
    return await runInstanceManager(root, 'apollo-lidar-config', 'lidar_instance_manager.py', 'lidar', command, payload);
}
async function runCameraManager(root, command, payload) {
    return await runInstanceManager(root, 'apollo-camera-config', 'camera_instance_manager.py', 'camera', command, payload);
}
function configOptions(root) {
    const camera = cameraOptions();
    return {
        lidar: { models: readLidarModels(root), current: lidarCurrent() },
        gnss: { current: gnssCurrent() },
        camera: { cameras: camera.cameras, current: camera.current },
    };
}
function restoreOptions(root) {
    const sensors = readSensorModules();
    const modules = [];
    try {
        for (const entry of readdirSync(join(root, 'modules'), { withFileTypes: true })) {
            if (entry.isDirectory())
                modules.push(entry.name);
        }
        for (const entry of readdirSync(join(root, 'modules/drivers'), { withFileTypes: true })) {
            if (entry.isDirectory())
                modules.push(`drivers/${entry.name}`);
        }
    }
    catch { }
    return { sensors, modules: [...new Set(modules)] };
}
function findBaselineTar(root, targetId) {
    for (const skillsDir of skillRoots(root)) {
        for (const skill of ['apollo-vehicle-restore', 'apollo-env']) {
            const tar = join(skillsDir, skill, 'baselines', targetId, 'latest', 'apollo_profiles.tar.gz');
            if (existsSync(tar))
                return tar;
        }
    }
    return undefined;
}
async function baselineConfText(root, targetId, confPath) {
    const tar = findBaselineTar(root, targetId);
    if (tar === undefined)
        return undefined;
    const rel = confPath.replace(new RegExp(`^${apolloRoot()}/`), `profiles/${targetId}/`);
    try {
        const out = await execFileAsync('tar', ['-xOf', tar, rel], { cwd: root, encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
        return out.stdout;
    }
    catch {
        return undefined;
    }
}
async function sensorConfig(root, targetId, type) {
    const sensors = readSensorEndpoints().filter(s => s.type === type);
    const first = sensors[0];
    if (first === undefined)
        return undefined;
    const confPaths = [...new Set(sensors.map(s => s.conf))];
    const confs = [];
    const current = [];
    const baseline = [];
    for (const path of confPaths) {
        let text;
        try {
            text = readFileSync(path, 'utf8');
        }
        catch { }
        const baseText = await baselineConfText(root, targetId, path);
        const currentFields = text === undefined ? [] : confScalarFields(text);
        const baselineFields = baseText === undefined ? [] : confScalarFields(baseText);
        const fields = currentFields.map(field => {
            const baselineValue = baselineFields.find(b => b.key === field.key)?.value;
            return {
                key: field.key,
                value: field.value,
                ...(baselineValue === undefined ? {} : { baseline: baselineValue }),
                changed: baseText !== undefined && baselineValue !== field.value,
            };
        });
        confs.push({
            path,
            exists: text !== undefined,
            inBaseline: baseText !== undefined,
            changed: fields.some(f => f.changed),
            fields,
        });
        current.push(...currentFields);
        baseline.push(...baselineFields);
    }
    const changed = confs.flatMap(conf => conf.fields.filter(f => f.changed)
        .map(f => ({ key: `${conf.path.split('/').pop() ?? ''} · ${f.key}`, current: f.value, baseline: f.baseline ?? '(基线无此项)' })));
    return { name: first.name, confs, current, baseline, changed };
}
const restoreRecords = new Map();
async function restorePlan(root, payload) {
    const env = environment(root);
    const request = payload;
    const mode = request.mode;
    if (mode !== 'full' && mode !== 'sensor' && mode !== 'module')
        throw new Error('invalid restore mode');
    const requestedTarget = typeof request.targetId === 'string' ? request.targetId : undefined;
    const targetId = requestedTarget ?? env.targetId;
    if (targetId === undefined)
        throw new Error('未识别车型，请先选择车型');
    const selector = typeof request.selector === 'string' ? request.selector : undefined;
    const script = findRestoreScript(root);
    if (script === undefined)
        throw new Error('apollo-vehicle-restore 未安装');
    const plansDir = join(root, '.apollo-env', 'plans');
    mkdirSync(plansDir, { recursive: true });
    const planFile = join(plansDir, `restore-${Date.now()}.json`);
    const args = ['plan', '--target', targetId, '--scope', mode, '--json', '--output', planFile];
    if (mode === 'module' || (mode === 'sensor' && selector !== undefined)) {
        if (selector === undefined || !/^[A-Za-z0-9_./-]+$/.test(selector))
            throw new Error('恢复需要有效选择');
        args.push('--module', selector);
    }
    const result = await execFileAsync('python3', [script, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    const parsed = JSON.parse(result.stdout);
    const supported = Array.isArray(parsed.blockers) && parsed.blockers.length === 0;
    const changes = [...(parsed.parameters?.changes ?? []).map(c => c.path), ...(parsed.code?.changes ?? []).map(c => c.path)];
    const planId = parsed.plan_id;
    if (planId !== undefined)
        restoreRecords.set(planId, { planId, planFile });
    return {
        mode, targetId, baselineVersion: baselineVersion(root, targetId)?.version ?? 'latest',
        ...(selector === undefined ? {} : { selector }),
        ...(planId === undefined ? {} : { planId }),
        command: JSON.stringify(['python3', script, ...args]),
        supported, requiresConfirmation: true, readyToApply: parsed.ready_to_apply === true,
        changes,
        modules: parsed.modules ?? [], buildDirectories: parsed.build_packages ?? [],
        sensors: mode === 'sensor' ? parsed.modules ?? [] : [],
        summary: supported
            ? (parsed.ready_to_apply === true
                ? `将恢复 ${changes.length} 个文件${(parsed.build_packages ?? []).length > 0 ? '并重新编译' : ''}（目标 ${targetId}）`
                : '当前已与基线一致，无需恢复')
            : `恢复被阻止：${(parsed.blockers ?? []).join('；')}`,
    };
}
async function restoreExecute(root, payload) {
    const request = payload;
    const planId = typeof request.planId === 'string' ? request.planId : undefined;
    const record = planId === undefined ? undefined : restoreRecords.get(planId);
    if (record === undefined || planId === undefined)
        throw new Error('恢复计划不存在或已过期，请重新生成');
    const script = findRestoreScript(root);
    if (script === undefined)
        throw new Error('apollo-vehicle-restore 未安装');
    const { code, stdout, stderr } = await new Promise(resolve => {
        execFile('python3', [script, 'execute', '--plan', record.planFile, '--apply', '--confirm-plan', planId], { cwd: root, timeout: 900_000, maxBuffer: 8 * 1024 * 1024 }, (err, out, errOut) => {
            resolve({ code: err === null ? 0 : (typeof err.code === 'number' ? err.code : 1), stdout: out ?? '', stderr: errOut ?? '' });
        });
    });
    if (code !== 0) {
        const lines = stderr.split(/\r?\n/).filter(line => /error|Error|FATAL|Traceback|failed/i.test(line));
        const msg = lines.slice(-3).map(line => line.replace(/^\[[^\]]*\]\s*/, '').trim()).join('；') || `执行失败（退出码 ${code}）`;
        throw new Error(msg);
    }
    const backupMatch = stdout.match(/backup:\s*(\S+)/);
    const noChanges = stdout.includes('no changes') || stdout.includes('nothing to apply');
    const summary = noChanges ? '无变更，无需恢复' : stdout.includes('scoped restore applied') ? '恢复完成' : '恢复并编译完成';
    return { applied: true, planId, ...(backupMatch !== null ? { backup: backupMatch[1] } : {}), output: summary };
}
async function runtimeStatus() {
    const running = await tcpReachable('127.0.0.1', 8888, 1500);
    const ports = Object.entries(networkInterfaces()).flatMap(([name, addrs]) => (addrs ?? []).filter(a => a.family === 'IPv4' && !a.internal).map(a => ({ name, address: a.address, up: true })));
    return { dreamview: running ? 'running' : 'stopped', ports };
}
function ptyRead(id, record, payload) {
    const requested = payload?.offset;
    const offset = typeof requested === 'number' && Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
    const reset = offset > record.output.length;
    const start = reset ? 0 : offset;
    return { id, delta: record.output.slice(start), offset: record.output.length, running: !record.done, reset };
}
function ptySnapshot(id, record) {
    return { id, output: record.output, running: !record.done, ...(record.done ? { exitCode: record.exitCode } : {}) };
}
async function openPty(ctx, root, sessions) {
    const id = randomUUID();
    const handle = await ctx.subprocess.spawnTerminal({
        argv: ['/bin/bash', '--noprofile', '--norc'], cwd: root, env: { TERM: 'xterm-256color', PS1: '\\u@\\h:\\w\\$ ' }, rows: 28, cols: 120, graceMs: 2_000,
    });
    const record = { handle, output: '', done: false, exitCode: null };
    sessions.set(id, record);
    handle.output.on('data', (chunk) => {
        record.output = (record.output + chunk.toString()).slice(-1024 * 1024);
    });
    void handle.done.then(({ exitCode }) => { record.done = true; record.exitCode = exitCode; }, () => { record.done = true; });
    return ptySnapshot(id, record);
}
function expectPty(sessions, payload) {
    const id = payload?.id;
    if (typeof id !== 'string')
        throw new Error('missing terminal id');
    const record = sessions.get(id);
    if (record === undefined)
        throw new Error('terminal session not found');
    return [id, record];
}
/** `webServer` is required because a private channel mounts its own Web route. */
export const inject = ['connection', 'webServer', 'subprocess'];
export function apply(ctx, config = {}) {
    const root = discoverWorkspace(config.workspace);
    const maxBytes = config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
    const monitoring = monitorConfig(config);
    const sessions = new Map();
    if (root !== undefined)
        startMonitor(root);
    ctx.effect(() => async () => {
        await Promise.all([...sessions.values()].map(async (record) => { await record.handle.terminate(); }));
        sessions.clear();
    }, 'apollo-ops: terminal cleanup');
    ctx.effect(() => () => {
        if (monitorProc !== undefined) {
            monitorProc.kill();
            monitorProc = undefined;
        }
    }, 'apollo-ops: monitor cleanup');
    ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
        try {
            if (endpoint === 'apolloOps/environment')
                return ok(environment(root));
            if (root === undefined)
                return fail('apollo/workspace-not-found', '未发现 Apollo 工作区');
            if (endpoint === 'apolloOps/files/list')
                return ok(listFiles(root, payload));
            if (endpoint === 'apolloOps/files/read')
                return ok(readText(root, payload, maxBytes));
            if (endpoint === 'apolloOps/files/write') {
                if (config.allowFileWrite === false)
                    return fail('apollo/permission-denied', '文件编辑未在部署配置中启用');
                return ok(writeText(root, payload, maxBytes));
            }
            if (endpoint === 'apolloOps/monitor/config')
                return ok(monitoring);
            if (endpoint === 'apolloOps/monitor/snapshot')
                return ok(await monitor(root, monitoring, payload));
            if (endpoint === 'apolloOps/restore/options')
                return ok(restoreOptions(root));
            if (endpoint === 'apolloOps/restore/targets')
                return ok({ targets: readTargets(root), detected: environment(root).targetId ?? null });
            if (endpoint === 'apolloOps/restore/sensor-config') {
                const id = typeof payload.id === 'string' ? payload.id : '';
                const type = id.replace(/^drivers\//, '');
                const meta = SENSOR_TYPE_META[type];
                if (meta === undefined)
                    return fail('apollo/invalid-argument', '未知传感器类型');
                const env = environment(root);
                if (env.targetId === undefined)
                    return fail('apollo/no-target', '当前环境无法匹配车型');
                const cfg = await sensorConfig(root, env.targetId, type);
                return cfg === undefined ? fail('apollo/not-found', '该传感器在当前车型中未配置') : ok(cfg);
            }
            if (endpoint === 'apolloOps/restore/plan')
                return ok(await restorePlan(root, payload));
            if (endpoint === 'apolloOps/restore/execute')
                return ok(await restoreExecute(root, payload));
            if (endpoint === 'apolloOps/config/gnss')
                return ok(await runSensorConfig(root, 'apollo-gnss-config', 'configure_ntrip_base.py', payload));
            if (endpoint === 'apolloOps/config/lidar')
                return ok(await runSensorConfig(root, 'apollo-lidar-config', 'configure_lidar.py', payload));
            if (endpoint === 'apolloOps/config/lidar-instance') {
                return ok(await runLidarManager(root, 'apply', payload));
            }
            if (endpoint === 'apolloOps/config/camera-instance' || endpoint === 'apolloOps/config/camera-add') {
                if (config.allowFileWrite === false)
                    return fail('apollo/permission-denied', '相机配置写入未在部署配置中启用');
                return ok(await runCameraManager(root, 'apply', endpoint.endsWith('camera-add') ? { ...payload, action: 'add' } : payload));
            }
            if (endpoint === 'apolloOps/config/options')
                return ok(configOptions(root));
            if (endpoint === 'apolloOps/config/lidar-detail')
                return ok(await runLidarManager(root, 'inspect'));
            if (endpoint === 'apolloOps/config/camera-detail')
                return ok(await runCameraManager(root, 'inspect', payload));
            if (endpoint === 'apolloOps/runtime/status')
                return ok(await runtimeStatus());
            if (endpoint === 'apolloOps/runtime/dreamview') {
                if (config.allowRestore === false)
                    return fail('apollo/permission-denied', '运行控制未启用');
                const action = payload.action;
                if (action === 'start') {
                    await execFileAsync('aem', ['bootstrap', 'start', '--plus'], { cwd: root, timeout: 90_000, maxBuffer: 1024 * 1024 });
                }
                else if (action === 'stop') {
                    await execFileAsync('aem', ['bootstrap', 'stop'], { cwd: root, timeout: 60_000, maxBuffer: 1024 * 1024 });
                }
                else {
                    throw new Error('invalid DreamView action');
                }
                return ok(await runtimeStatus());
            }
            if (endpoint === 'apolloOps/runtime/kill-all') {
                if (config.allowRestore === false)
                    return fail('apollo/permission-denied', '运行控制未启用');
                await execFileAsync('/bin/bash', ['-lc', `${JSON.stringify(join(root, 'kill_all.sh'))} 2>/dev/null || true`], { cwd: root, timeout: 60_000, maxBuffer: 1024 * 1024 });
                return ok(await runtimeStatus());
            }
            if (endpoint === 'apolloOps/pty/open') {
                if (config.allowTerminal === false)
                    return fail('apollo/permission-denied', '终端未在部署配置中启用');
                return ok(await openPty(ctx, root, sessions));
            }
            if (endpoint === 'apolloOps/pty/read') {
                const [id, record] = expectPty(sessions, payload);
                return ok(ptyRead(id, record, payload));
            }
            if (endpoint === 'apolloOps/pty/write') {
                const [id, record] = expectPty(sessions, payload);
                const data = payload.data;
                if (typeof data !== 'string' || data.length > 65_536)
                    throw new Error('invalid terminal input');
                await record.handle.write(data);
                return ok(ptySnapshot(id, record));
            }
            if (endpoint === 'apolloOps/pty/signal') {
                const [id, record] = expectPty(sessions, payload);
                await record.handle.signalForeground('SIGINT');
                return ok(ptySnapshot(id, record));
            }
            if (endpoint === 'apolloOps/pty/close') {
                const [id, record] = expectPty(sessions, payload);
                await record.handle.terminate();
                sessions.delete(id);
                return ok({ closed: true });
            }
            return fail('apollo/not-found', `unknown endpoint ${endpoint}`);
        }
        catch (error) {
            return fail('apollo/operation-failed', error instanceof Error ? error.message : String(error));
        }
    }), 'apollo-ops: authenticated host endpoints');
}
//# sourceMappingURL=index.js.map