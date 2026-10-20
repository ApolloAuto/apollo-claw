import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile, spawn } from "node:child_process";
import { connect } from "node:net";
import { homedir, networkInterfaces } from "node:os";
import { promisify } from "node:util";
//#region lib/types/sensor-conf-diff.js
function tokenize(text) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i] ?? "";
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if (ch === "#" || text.startsWith("//", i)) {
			const end = text.indexOf("\n", i);
			i = end < 0 ? text.length : end + 1;
			continue;
		}
		if (text.startsWith("/*", i)) {
			const end = text.indexOf("*/", i + 2);
			if (end < 0) throw new Error("配置块注释未闭合");
			i = end + 2;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			const quote = ch;
			const start = ++i;
			let closed = false;
			while (i < text.length) {
				if (text[i] === "\\") {
					i += 2;
					continue;
				}
				if (text[i] === quote) {
					closed = true;
					break;
				}
				i++;
			}
			if (!closed) throw new Error("配置字符串未闭合");
			tokens.push({
				kind: "string",
				value: text.slice(start, i)
			});
			i++;
		} else if ("{}<>[]:;,".includes(ch)) {
			tokens.push({
				kind: "punct",
				value: ch
			});
			i++;
		} else {
			const start = i;
			while (i < text.length && !/[\s{}<>\[\]:;,"'#]/.test(text[i] ?? "") && !text.startsWith("//", i) && !text.startsWith("/*", i)) i++;
			if (i === start) throw new Error(`无法识别配置字符，位置 ${i}`);
			tokens.push({
				kind: "bare",
				value: text.slice(start, i)
			});
		}
		if (tokens.length > 2e5) throw new Error("配置过大，无法生成字段对比");
	}
	return tokens;
}
function confScalarFields(text) {
	const fields = [];
	if (/^\s*\{/.test(text)) {
		const walk = (value, path) => {
			if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
			else if (typeof value === "object" && value !== null) for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
			else fields.push({
				key: path,
				value: String(value)
			});
		};
		walk(JSON.parse(text), "");
		return fields;
	}
	const tokens = tokenize(text);
	let pos = 0;
	const peek = () => tokens[pos];
	const expect = (value) => {
		if (peek()?.value !== value) throw new Error(`配置结构不完整，预期 ${value}`);
		pos++;
	};
	const scalar = (path) => {
		const token = peek();
		if (token === void 0 || token.kind === "punct") throw new Error(`字段 ${path} 缺少标量值`);
		pos++;
		let value = token.value;
		if (token.kind === "string") while (peek()?.kind === "string") {
			value += tokens[pos]?.value ?? "";
			pos++;
		}
		fields.push({
			key: path,
			value
		});
	};
	const message = (parent, closing, depth = 0) => {
		if (depth > 64) throw new Error("配置嵌套过深");
		const occurrences = /* @__PURE__ */ new Map();
		while (pos < tokens.length && peek()?.value !== closing) {
			if (peek()?.value === "," || peek()?.value === ";") {
				pos++;
				continue;
			}
			const field = peek();
			if (field?.kind !== "bare" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.value)) throw new Error(`配置字段名不合法：${field?.value ?? "EOF"}`);
			pos++;
			const base = parent ? `${parent}.${field.value}` : field.value;
			const allocate = () => {
				const index = occurrences.get(field.value) ?? 0;
				occurrences.set(field.value, index + 1);
				return index === 0 ? base : `${base}[${index}]`;
			};
			if (peek()?.value === ":") pos++;
			const value = (path) => {
				const open = peek()?.value;
				if (open === "{" || open === "<") {
					pos++;
					const close = open === "{" ? "}" : ">";
					message(path, close, depth + 1);
					expect(close);
				} else scalar(path);
			};
			if (peek()?.value === "[") {
				pos++;
				while (peek()?.value !== "]") {
					value(allocate());
					if (peek()?.value !== "]") expect(",");
				}
				expect("]");
			} else value(allocate());
		}
	};
	message("");
	return fields;
}
//#endregion
//#region lib/types/channel.js
/**
* Dedicated RPC channel for this plugin's Host endpoints.
*
* The shared `/api` channel holds exactly one interceptor and it belongs to
* `@deepseek-ai/dsh-api-gateway`; a second `rpc.intercept('/api', …)` throws
* `shared RPC channel "/api" already has an interceptor` and whichever half
* loses the race stops answering. Own a private channel via `rpc.handle`
* instead — same Host/Origin fence and browser authentication, no contention.
* @module
*/
/** Absolute channel this plugin mounts on the Web server. */
const APOLLO_OPS_CHANNEL = "/apollo-ops";
//#endregion
//#region lib/types/index.js
const CHANNEL = APOLLO_OPS_CHANNEL;
const DEFAULT_MAX_TEXT_BYTES = 1024 * 1024;
const DEFAULT_MONITOR = {
	sensors: [],
	externalTargets: [
		{
			name: "Internet",
			host: "1.1.1.1",
			port: 443
		},
		{
			name: "Internet",
			host: "223.5.5.5",
			port: 443
		},
		{
			name: "Internet",
			host: "114.114.114.114",
			port: 53
		},
		{
			name: "Internet",
			host: "8.8.8.8",
			port: 53
		}
	],
	channelPageSize: 20,
	refreshMs: 2e3
};
function ok(value) {
	return {
		ok: true,
		value
	};
}
function fail(code, message, details = {}) {
	return {
		ok: false,
		error: {
			code,
			message,
			details
		}
	};
}
function discoverWorkspace(configured) {
	const candidates = [
		configured,
		process.env.APOLLO_WORKSPACE,
		process.cwd(),
		"/apollo_workspace"
	].filter((value) => typeof value === "string" && value.length > 0);
	for (const candidate of candidates) {
		const root = resolve(candidate);
		if (existsSync(join(root, ".workspace.json")) || existsSync(join(root, "profiles"))) return root;
	}
}
function contained(root, candidate) {
	const rel = relative(root, candidate);
	return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}
function safePath(root, input, forWrite = false) {
	if (typeof input !== "string" || input.includes("\0")) throw new Error("invalid path");
	const canonicalRoot = realpathSync(root);
	const lexical = isAbsolute(input) ? resolve(input) : resolve(root, input);
	const stat = (() => {
		try {
			return lstatSync(lexical);
		} catch {
			return;
		}
	})();
	if (stat?.isSymbolicLink()) throw new Error("symbolic links are not editable or readable");
	if (!contained(canonicalRoot, stat === void 0 && forWrite ? realpathSync(join(lexical, "..")) : realpathSync(lexical))) throw new Error("path leaves workspace");
	return lexical;
}
function skillRoots(root) {
	const homes = [join(root, ".dsh/skills"), join(root, ".claude/skills")];
	const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	homes.push(join(dshHome, "skills"));
	return homes;
}
function skillInstalled(root, name) {
	return skillRoots(root).some((home) => existsSync(join(home, name, "SKILL.md")));
}
function workspaceVersion(root) {
	try {
		const repositories = JSON.parse(readFileSync(join(root, ".workspace.json"), "utf8")).repositories ?? [];
		const pick = repositories.find((row) => row.name?.includes("universe")) ?? repositories.find((row) => row.name?.includes("apollo-core")) ?? repositories.find((row) => row.name?.includes("apollo-edu")) ?? repositories[0];
		return pick?.version;
	} catch {
		return;
	}
}
function currentProfile(root) {
	const current = join(root, "profiles/current");
	try {
		const path = realpathSync(current);
		if (!contained(join(root, "profiles"), path)) return { warning: "profiles/current 指向工作区外部" };
		const target = path.split(sep).pop();
		return {
			path,
			...target === void 0 ? {} : { target }
		};
	} catch {
		return { warning: "profiles/current 不存在或已断开" };
	}
}
function readStamp(profilePath) {
	if (profilePath === void 0) return {};
	try {
		const text = readFileSync(join(profilePath, ".apollo_vehicle_stamp.yaml"), "utf8");
		const value = (key) => text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, "m"))?.[1]?.trim();
		const targetId = value("target_id");
		const version = value("apollo_version");
		const baseline = value("baseline_id");
		return {
			...targetId === void 0 ? {} : { targetId },
			...version === void 0 ? {} : { version },
			...baseline === void 0 ? {} : { baseline }
		};
	} catch {
		return {};
	}
}
function baselineVersion(root, targetId) {
	for (const home of skillRoots(root)) for (const skill of ["apollo-vehicle-restore", "apollo-env"]) {
		const latest = join(home, skill, "baselines", targetId, "latest");
		if (!existsSync(latest)) continue;
		let version = "latest";
		try {
			version = lstatSync(latest).isSymbolicLink() ? readlinkSync(latest) : "latest";
		} catch {}
		return {
			version,
			parameters: existsSync(join(latest, "parameters.yaml")),
			code: existsSync(join(latest, "code.yaml"))
		};
	}
}
function environment(root) {
	if (root === void 0) return {
		available: false,
		skills: {
			apolloEnv: false,
			apolloDev: false
		},
		warnings: ["未发现 Apollo 工作区"]
	};
	const current = currentProfile(root);
	const stamp = readStamp(current.path);
	const warnings = [...current.warning === void 0 ? [] : [current.warning]];
	if (current.target !== void 0 && stamp.targetId !== void 0 && current.target !== stamp.targetId) warnings.push(`当前 Profile ${current.target} 与车型指纹 ${stamp.targetId} 不一致`);
	const detectedVersion = workspaceVersion(root) ?? stamp.version;
	if (stamp.version !== void 0 && detectedVersion !== void 0 && stamp.version !== detectedVersion) warnings.push(`Apollo 版本 ${detectedVersion} 与车型指纹 ${stamp.version} 不一致`);
	const targetId = stamp.targetId ?? current.target;
	const baseline = targetId === void 0 ? void 0 : baselineVersion(root, targetId);
	if (baseline === void 0 && targetId !== void 0) warnings.push(`未找到 ${targetId} 对应基线`);
	return {
		available: true,
		workspace: root,
		...current.path === void 0 ? {} : { currentProfile: current.path },
		...targetId === void 0 ? {} : { targetId },
		...detectedVersion === void 0 ? {} : { apolloVersion: detectedVersion },
		skills: {
			apolloEnv: skillInstalled(root, "apollo-env"),
			apolloDev: skillInstalled(root, "apollo-dev")
		},
		...targetId === void 0 || baseline === void 0 ? {} : { baseline: {
			targetId,
			...baseline
		} },
		warnings
	};
}
function listFiles(root, payload) {
	const path = safePath(root, payload?.path ?? ".");
	if (!statSync(path).isDirectory()) throw new Error("path is not a directory");
	return readdirSync(path, { withFileTypes: true }).slice(0, 500).map((entry) => {
		const absolute = join(path, entry.name);
		const info = lstatSync(absolute);
		const rel = relative(root, absolute) || ".";
		const type = entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file";
		return {
			name: entry.name,
			path: rel,
			type,
			...entry.isFile() ? { size: info.size } : {},
			modifiedMs: info.mtimeMs
		};
	}).sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
}
function readText(root, payload, maxBytes) {
	const path = safePath(root, payload?.path);
	if (!statSync(path).isFile()) throw new Error("path is not a file");
	const bytes = readFileSync(path);
	if (bytes.includes(0)) throw new Error("binary file is not editable");
	const truncated = bytes.length > maxBytes;
	const content = bytes.subarray(0, maxBytes).toString("utf8");
	return {
		path: relative(root, path),
		content,
		version: createHash("sha256").update(bytes).digest("hex"),
		truncated
	};
}
function writeText(root, payload, maxBytes) {
	const request = payload;
	if (typeof request.content !== "string" || Buffer.byteLength(request.content) > maxBytes) throw new Error("invalid or oversized content");
	if (typeof request.version !== "string") throw new Error("missing file version");
	const path = safePath(root, request.path, true);
	const current = readFileSync(path);
	if (createHash("sha256").update(current).digest("hex") !== request.version) throw new Error("file changed on disk; reload before saving");
	writeFileSync(path, request.content, {
		encoding: "utf8",
		flush: true
	});
	return readText(root, request, maxBytes);
}
const execFileAsync = promisify(execFile);
function monitorConfig(config) {
	return {
		sensors: config.sensors ?? DEFAULT_MONITOR.sensors,
		externalTargets: config.externalTargets ?? DEFAULT_MONITOR.externalTargets,
		channelPageSize: config.channelPageSize ?? DEFAULT_MONITOR.channelPageSize,
		refreshMs: config.refreshMs ?? DEFAULT_MONITOR.refreshMs,
		permissions: {
			fileWrite: config.allowFileWrite !== false,
			terminal: config.allowTerminal !== false,
			restore: config.allowRestore !== false
		}
	};
}
function tcpReachable(host, port, timeoutMs = 1500) {
	if (!/^[A-Za-z0-9.-]+$/.test(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
	return new Promise((resolveResult) => {
		const socket = connect({
			host,
			port
		});
		const done = (value) => {
			socket.destroy();
			resolveResult(value);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}
function detectSensors(channels) {
	const sensors = [];
	const chassis = channels.find((c) => c === "/apollo/canbus/chassis");
	if (chassis) sensors.push({
		id: "chassis",
		name: "底盘",
		channel: chassis,
		required: true
	});
	const gnss = channels.find((c) => c.includes("/sensor/gnss/") && (c.endsWith("/ins_stat") || c.endsWith("/best_pose")));
	if (gnss) sensors.push({
		id: "gnss",
		name: "GNSS",
		channel: gnss,
		required: true
	});
	const lidar = channels.find((c) => c.includes("PointCloud2"));
	if (lidar) sensors.push({
		id: "lidar",
		name: "激光雷达",
		channel: lidar,
		required: true
	});
	const radar = channels.find((c) => /radar/i.test(c) && !c.includes("PointCloud2") && !c.includes("/gnss/"));
	if (radar) sensors.push({
		id: "radar",
		name: "毫米波雷达",
		channel: radar,
		required: false
	});
	const camera = channels.find((c) => c.includes("/sensor/camera/") && c.endsWith("/image"));
	if (camera) sensors.push({
		id: "camera",
		name: "相机",
		channel: camera,
		required: false
	});
	return sensors;
}
const MONITOR_SCRIPT = [
	"import sys, os, time, json",
	"dist = os.environ.get(\"APOLLO_DISTRIBUTION_HOME\", \"/opt/apollo/neo\")",
	"for cand in [os.path.join(dist, \"lib\", \"python3.6\", \"site-packages\"), os.path.join(dist, \"packages\", \"cyber-python\", \"latest\", \"lib\", \"python3.6\", \"site-packages\")]:",
	"    if os.path.isdir(cand): sys.path.insert(0, cand)",
	"from cyber.python.cyber_py3 import cyber",
	"cyber.init()",
	"node = cyber.Node(\"apollo_ops_mon_\" + str(os.getpid()))",
	"subscribed = set()",
	"counts = {}",
	"channels = []",
	"refresh = 0",
	"def make_cb(ch):",
	"    def cb(msg): counts[ch] = counts.get(ch, 0) + 1",
	"    return cb",
	"while True:",
	"    refresh += 1",
	"    if refresh >= 5:",
	"        refresh = 0",
	"        try: channels = sorted(cyber.ChannelUtils.get_channels())",
	"        except: channels = []",
	"        for ch in channels:",
	"            if ch not in subscribed:",
	"                try: node.create_rawdata_reader(ch, make_cb(ch)); subscribed.add(ch)",
	"                except: pass",
	"    counts.clear()",
	"    t0 = time.time()",
	"    time.sleep(1.0)",
	"    elapsed = time.time() - t0",
	"    hz = {ch: round(counts.get(ch, 0) / elapsed, 2) for ch in channels}",
	"    print(json.dumps({\"channels\": channels, \"hz\": hz}), flush=True)"
].join("\n");
let monitorProc;
let monitorCache = {
	channels: [],
	hz: {}
};
let monitorBuffer = "";
function startMonitor(root) {
	if (monitorProc !== void 0) return;
	const tmp = join(root, ".apollo-ops-mon.py");
	writeFileSync(tmp, MONITOR_SCRIPT);
	const proc = spawn("python3", [tmp], { cwd: root });
	monitorProc = proc;
	monitorBuffer = "";
	proc.stdout?.on("data", (chunk) => {
		monitorBuffer += chunk.toString();
		const lines = monitorBuffer.split("\n");
		monitorBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) continue;
			try {
				const parsed = JSON.parse(trimmed);
				if (Array.isArray(parsed.channels)) monitorCache = {
					channels: parsed.channels,
					hz: parsed.hz ?? {}
				};
			} catch {}
		}
	});
	proc.on("exit", () => {
		monitorProc = void 0;
	});
}
function localSubnets() {
	const subnets = [];
	for (const addrs of Object.values(networkInterfaces())) for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal && a.address && a.netmask) {
		const ip = a.address.split(".").map(Number);
		const mask = a.netmask.split(".").map(Number);
		subnets.push(ip.map((o, i) => o & (mask[i] ?? 0)).join("."));
	}
	return subnets;
}
function sameSubnet(ip, subnets) {
	const parts = ip.split(".").map(Number);
	return subnets.some((subnet) => {
		const s = subnet.split(".").map(Number);
		return parts[0] === s[0] && parts[1] === s[1] && parts[2] === s[2];
	});
}
function isPrivateIp(ip) {
	const p = ip.split(".").map(Number);
	return (p[0] ?? 0) === 10 || (p[0] ?? 0) === 192 && (p[1] ?? 0) === 168 || (p[0] ?? 0) === 172 && (p[1] ?? 0) >= 16 && (p[1] ?? 0) <= 31 || (p[0] ?? 0) === 127;
}
function apolloRoot() {
	return process.env.APOLLO_ROOT_DIR ?? "/apollo";
}
const SENSOR_TYPE_META = {
	lidar: {
		module: "drivers/lidar",
		name: "激光雷达"
	},
	gnss: {
		module: "drivers/gnss",
		name: "GNSS / 惯导"
	},
	camera: {
		module: "drivers/camera",
		name: "相机"
	},
	radar: {
		module: "drivers/radar",
		name: "毫米波雷达"
	}
};
function sensorTypeFromPath(path) {
	return path.match(/drivers\/([^/]+)/)?.[1] ?? "";
}
function readSensorEndpoints() {
	const result = [];
	const root = apolloRoot();
	const modeFiles = [join(root, "modules/dreamview_plus/conf/hmi_modes/vehicle_test.pb.txt"), join(root, "modules/dreamview/conf/hmi_modes/vehicle_test.pb.txt")];
	for (const modeFile of modeFiles) {
		let text;
		try {
			text = readFileSync(modeFile, "utf8");
		} catch {
			continue;
		}
		const dagFiles = [...text.matchAll(/dag_files:\s*"([^"]+)"/g)].map((m) => m[1]).filter((v) => typeof v === "string");
		for (const dagFile of dagFiles) {
			let dagText;
			try {
				dagText = readFileSync(dagFile, "utf8");
			} catch {
				continue;
			}
			const confs = [...dagText.matchAll(/(?:^|\n)([^\n]*?)config_file_path\s*:\s*"([^"]+)"/g)].filter((m) => !(m[1] ?? "").includes("#")).map((m) => m[2]).filter((v) => typeof v === "string");
			for (const conf of confs) {
				const type = sensorTypeFromPath(conf);
				const meta = SENSOR_TYPE_META[type];
				if (meta === void 0) continue;
				let confText;
				try {
					confText = readFileSync(conf, "utf8");
				} catch {
					continue;
				}
				const isTcp = /tcp\s*\{/.test(confText);
				const ips = [...confText.matchAll(/(?:ip|address|device_ip):\s*"(\d+\.\d+\.\d+\.\d+)"/g)].map((m) => m[1]).filter((v) => typeof v === "string").filter(isPrivateIp);
				const ports = [...confText.matchAll(/(?:_port|port):\s*(\d+)/g)].map((m) => Number(m[1])).filter((n) => Number.isSafeInteger(n) && n > 0 && n < 65536);
				const channel = confText.match(/(?:output_)?channel[_:a-z]*:\s*"([^"]+)"/)?.[1];
				const frameId = confText.match(/frame_id:\s*"([^"]+)"/)?.[1];
				const device = confText.match(/(?:device|camera_dev):\s*"([^"]+)"/)?.[1];
				if (ips.length > 0) for (const ip of ips) result.push({
					type,
					name: meta.name,
					ip,
					...ports.length > 0 ? { port: ports[0] } : {},
					proto: isTcp ? "tcp" : "udp",
					...channel === void 0 ? {} : { channel },
					...frameId === void 0 ? {} : { frameId },
					...device === void 0 ? {} : { device },
					conf
				});
				else result.push({
					type,
					name: meta.name,
					proto: isTcp ? "tcp" : "udp",
					...channel === void 0 ? {} : { channel },
					...frameId === void 0 ? {} : { frameId },
					...device === void 0 ? {} : { device },
					conf
				});
			}
		}
	}
	return result;
}
function readSensorModules() {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const sensor of readSensorEndpoints()) {
		const meta = SENSOR_TYPE_META[sensor.type];
		if (meta === void 0 || seen.has(sensor.type)) continue;
		seen.add(sensor.type);
		out.push({
			id: meta.module,
			name: meta.name
		});
	}
	return out;
}
async function refreshSensorLinks(_root) {
	const links = [];
	const subnets = localSubnets();
	for (const sensor of readSensorEndpoints()) {
		if (sensor.ip === void 0) continue;
		let ok = false;
		let detail = "离线";
		if (sensor.proto === "tcp" && sensor.port !== void 0) {
			ok = await tcpReachable(sensor.ip, sensor.port, 1500);
			detail = ok ? "已连接" : "连接失败";
		} else {
			ok = sameSubnet(sensor.ip, subnets);
			detail = ok ? "在线" : "离线";
		}
		links.push({
			kind: sensor.name,
			target: sensor.ip,
			detail,
			ok
		});
	}
	return links;
}
async function monitor(root, config, payload) {
	startMonitor(root);
	const channels = monitorCache.channels;
	const hzMap = monitorCache.hz;
	const detected = detectSensors(channels);
	const extra = payload?.customSensors ?? [];
	const configured = [...config.sensors.map((s) => ({
		id: s.id,
		name: s.name,
		channel: s.channel,
		required: s.required
	})), ...extra.map((s) => ({
		id: s.id,
		name: s.name,
		channel: s.channel,
		required: s.required ?? true
	}))];
	const sensors = [...configured, ...detected.filter((d) => !configured.some((s) => s.id === d.id))].map((sensor) => {
		const hz = hzMap[sensor.channel] ?? 0;
		if (hz > 0) return {
			id: sensor.id,
			name: sensor.name,
			channel: sensor.channel,
			required: sensor.required,
			status: "ok",
			hz,
			reason: `${hz.toFixed(1)} Hz`
		};
		const exists = channels.includes(sensor.channel);
		return {
			id: sensor.id,
			name: sensor.name,
			channel: sensor.channel,
			required: sensor.required,
			status: exists ? "unavailable" : "error",
			hz: 0,
			reason: exists ? "无数据流" : "Channel 不存在"
		};
	});
	const typed = channels.map((name) => {
		const hz = hzMap[name] ?? 0;
		return {
			name,
			type: "",
			hz,
			status: hz > 0 ? "active" : "idle"
		};
	});
	const interfaces = Object.values(networkInterfaces()).filter((addrs) => (addrs ?? []).some((a) => a.family === "IPv4" && !a.internal)).length;
	const probed = await Promise.all(config.externalTargets.map(async (target) => await tcpReachable(target.host, target.port) ? `${target.host}:${target.port}` : void 0));
	const externalVia = probed.find((via) => via !== void 0);
	const external = externalVia === void 0 ? "error" : "ok";
	const sensorLinks = await refreshSensorLinks(root);
	return {
		at: Date.now(),
		sensors,
		network: {
			status: interfaces > 0 ? "ok" : "error",
			external,
			interfaceCount: interfaces,
			reason: external === "ok" ? externalVia === void 0 ? "外网连接正常" : `外网连接正常（${externalVia}）` : `外网已断开（探测 ${config.externalTargets.map((target) => `${target.host}:${target.port}`).join(" / ")} 均不可达）`,
			sensorLinks
		},
		channels: typed
	};
}
function findRestoreScript(root) {
	for (const skillsDir of skillRoots(root)) for (const candidate of ["apollo-vehicle-restore/scripts/restore_plan.py", "apollo-env/scripts/restore_plan.py"]) {
		const path = join(skillsDir, candidate);
		if (existsSync(path)) return path;
	}
}
function readTargets(root) {
	const targets = [];
	for (const skillsDir of skillRoots(root)) for (const skill of ["apollo-vehicle-restore", "apollo-env"]) {
		const baselinesDir = join(skillsDir, skill, "baselines");
		if (!existsSync(baselinesDir)) continue;
		try {
			for (const entry of readdirSync(baselinesDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				if (existsSync(join(baselinesDir, entry.name, "latest"))) targets.push(entry.name);
			}
		} catch {}
	}
	return [...new Set(targets)];
}
function findConfigScript(root, skillName, scriptName) {
	for (const skillsDir of skillRoots(root)) {
		const path = join(skillsDir, skillName, "scripts", scriptName);
		if (existsSync(path)) return path;
	}
}
async function runSensorConfig(root, skillName, scriptName, payload, skipYes = false) {
	const script = findConfigScript(root, skillName, scriptName);
	if (script === void 0) throw new Error(`${skillName} 未安装`);
	const args = skipYes ? [] : ["--yes"];
	const p = payload;
	for (const [key, value] of Object.entries(p)) {
		if (value === void 0 || value === null || value === "") continue;
		const flag = `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/_/g, "-")}`;
		args.push(flag, String(value));
	}
	return { output: (await execFileAsync("python3", [script, ...args], {
		cwd: root,
		encoding: "utf8",
		timeout: 6e4,
		maxBuffer: 8 * 1024 * 1024
	})).stdout.slice(-3e3) };
}
function readLidarModels(root) {
	for (const skillsDir of skillRoots(root)) {
		const yamlPath = join(skillsDir, "apollo-lidar-config", "config", "lidar_templates.yaml");
		if (!existsSync(yamlPath)) continue;
		try {
			return [...readFileSync(yamlPath, "utf8").matchAll(/^- model:\s*(\S+)/gm)].map((m) => m[1]).filter((v) => typeof v === "string");
		} catch {}
	}
	return [];
}
function lidarCurrent() {
	return {};
}
function gnssCurrent() {
	const conf = join(apolloRoot(), "modules/drivers/gnss/conf/gnss_conf.pb.txt");
	try {
		const ntrip = readFileSync(conf, "utf8").match(/ntrip\s*\{([^}]*)\}/s)?.[1] ?? "";
		const field = (re) => ntrip.match(re)?.[1] ?? "";
		return {
			address: field(/address:\s*"([^"]*)"/),
			port: field(/port:\s*(\d+)/),
			mountPoint: field(/mount_point:\s*"([^"]*)"/),
			user: field(/user:\s*"([^"]*)"/),
			password: field(/password:\s*"([^"]*)"/)
		};
	} catch {
		return {};
	}
}
function cameraOptions() {
	const cameras = [];
	const current = {};
	const dag = join(apolloRoot(), "modules/drivers/camera/dag/camera.dag");
	try {
		const confs = [...readFileSync(dag, "utf8").matchAll(/config_file_path\s*:\s*"([^"]+)"/g)].map((m) => m[1]).filter((v) => typeof v === "string");
		const devs = [];
		for (const conf of confs) {
			const name = conf.split("/").pop()?.replace(/\.pb\.txt$/, "") ?? "";
			if (name === "") continue;
			cameras.push(name);
			try {
				const dev = readFileSync(conf, "utf8").match(/camera_dev:\s*"([^"]*)"/)?.[1];
				if (dev !== void 0) devs.push(`${name}:${dev}`);
			} catch {}
		}
		if (cameras.length > 0) current.enable = cameras.join(",");
		if (devs.length > 0) current.devs = devs.join(",");
	} catch {}
	return {
		cameras,
		current
	};
}
async function runInstanceManager(root, skill, script, label, command, payload) {
	const scriptPath = findConfigScript(root, skill, script);
	if (scriptPath === void 0) throw new Error(`${skill} 实例管理器未安装`);
	const args = [scriptPath, command];
	if (label === "camera" && payload !== null && typeof payload === "object" && "dag" in payload) {
		const dag = payload.dag;
		if (dag !== void 0 && typeof dag !== "string") throw new Error("camera dag 必须为路径字符串");
		if (typeof dag === "string" && dag !== "") args.push("--dag", dag);
	}
	let requestFile;
	if (command === "apply") {
		const requestsDir = join(root, ".apollo-env", "requests");
		mkdirSync(requestsDir, { recursive: true });
		requestFile = join(requestsDir, `${label}-${Date.now()}-${randomUUID()}.json`);
		writeFileSync(requestFile, JSON.stringify(payload ?? {}), {
			encoding: "utf8",
			mode: 384,
			flag: "wx"
		});
		args.push("--request", requestFile);
	}
	try {
		let stdout;
		try {
			stdout = (await execFileAsync("python3", args, {
				cwd: root,
				env: {
					...process.env,
					APOLLO_WORKSPACE: root,
					APOLLO_ROOT_DIR: apolloRoot()
				},
				encoding: "utf8",
				timeout: 18e4,
				maxBuffer: 8 * 1024 * 1024
			})).stdout;
		} catch (error) {
			const failure = error;
			const raw = (failure.stdout ?? "").trim();
			let managerError;
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed.error === "string") managerError = parsed.error;
			} catch {}
			if (managerError !== void 0) throw new Error(managerError);
			const stderrTail = (failure.stderr ?? "").trim().split("\n").slice(-3).join(" ");
			throw new Error(stderrTail !== "" ? stderrTail : failure.message ?? "配置失败");
		}
		const parsed = JSON.parse(stdout);
		if (!parsed.ok) throw new Error(parsed.error ?? "配置失败");
		if (command === "inspect") return parsed;
		return { output: typeof parsed.message === "string" ? parsed.message : "配置完成" };
	} finally {
		if (requestFile !== void 0) try {
			rmSync(requestFile, { force: true });
		} catch {}
	}
}
async function runLidarManager(root, command, payload) {
	return await runInstanceManager(root, "apollo-lidar-config", "lidar_instance_manager.py", "lidar", command, payload);
}
async function runCameraManager(root, command, payload) {
	return await runInstanceManager(root, "apollo-camera-config", "camera_instance_manager.py", "camera", command, payload);
}
function configOptions(root) {
	const camera = cameraOptions();
	return {
		lidar: {
			models: readLidarModels(root),
			current: lidarCurrent()
		},
		gnss: { current: gnssCurrent() },
		camera: {
			cameras: camera.cameras,
			current: camera.current
		}
	};
}
function restoreOptions(root) {
	const sensors = readSensorModules();
	const modules = [];
	try {
		for (const entry of readdirSync(join(root, "modules"), { withFileTypes: true })) if (entry.isDirectory()) modules.push(entry.name);
		for (const entry of readdirSync(join(root, "modules/drivers"), { withFileTypes: true })) if (entry.isDirectory()) modules.push(`drivers/${entry.name}`);
	} catch {}
	return {
		sensors,
		modules: [...new Set(modules)]
	};
}
function findBaselineTar(root, targetId) {
	for (const skillsDir of skillRoots(root)) for (const skill of ["apollo-vehicle-restore", "apollo-env"]) {
		const tar = join(skillsDir, skill, "baselines", targetId, "latest", "apollo_profiles.tar.gz");
		if (existsSync(tar)) return tar;
	}
}
async function baselineConfText(root, targetId, confPath) {
	const tar = findBaselineTar(root, targetId);
	if (tar === void 0) return void 0;
	const rel = confPath.replace(new RegExp(`^${apolloRoot()}/`), `profiles/${targetId}/`);
	try {
		return (await execFileAsync("tar", [
			"-xOf",
			tar,
			rel
		], {
			cwd: root,
			encoding: "utf8",
			timeout: 2e4,
			maxBuffer: 8 * 1024 * 1024
		})).stdout;
	} catch {
		return;
	}
}
async function sensorConfig(root, targetId, type) {
	const sensors = readSensorEndpoints().filter((s) => s.type === type);
	const first = sensors[0];
	if (first === void 0) return void 0;
	const confPaths = [...new Set(sensors.map((s) => s.conf))];
	const confs = [];
	const current = [];
	const baseline = [];
	for (const path of confPaths) {
		let text;
		try {
			text = readFileSync(path, "utf8");
		} catch {}
		const baseText = await baselineConfText(root, targetId, path);
		const currentFields = text === void 0 ? [] : confScalarFields(text);
		const baselineFields = baseText === void 0 ? [] : confScalarFields(baseText);
		const fields = currentFields.map((field) => {
			const baselineValue = baselineFields.find((b) => b.key === field.key)?.value;
			return {
				key: field.key,
				value: field.value,
				...baselineValue === void 0 ? {} : { baseline: baselineValue },
				changed: baseText !== void 0 && baselineValue !== field.value
			};
		});
		confs.push({
			path,
			exists: text !== void 0,
			inBaseline: baseText !== void 0,
			changed: fields.some((f) => f.changed),
			fields
		});
		current.push(...currentFields);
		baseline.push(...baselineFields);
	}
	const changed = confs.flatMap((conf) => conf.fields.filter((f) => f.changed).map((f) => ({
		key: `${conf.path.split("/").pop() ?? ""} · ${f.key}`,
		current: f.value,
		baseline: f.baseline ?? "(基线无此项)"
	})));
	return {
		name: first.name,
		confs,
		current,
		baseline,
		changed
	};
}
const restoreRecords = /* @__PURE__ */ new Map();
async function restorePlan(root, payload) {
	const env = environment(root);
	const request = payload;
	const mode = request.mode;
	if (mode !== "full" && mode !== "sensor" && mode !== "module") throw new Error("invalid restore mode");
	const targetId = (typeof request.targetId === "string" ? request.targetId : void 0) ?? env.targetId;
	if (targetId === void 0) throw new Error("未识别车型，请先选择车型");
	const selector = typeof request.selector === "string" ? request.selector : void 0;
	const script = findRestoreScript(root);
	if (script === void 0) throw new Error("apollo-vehicle-restore 未安装");
	const plansDir = join(root, ".apollo-env", "plans");
	mkdirSync(plansDir, { recursive: true });
	const planFile = join(plansDir, `restore-${Date.now()}.json`);
	const args = [
		"plan",
		"--target",
		targetId,
		"--scope",
		mode,
		"--json",
		"--output",
		planFile
	];
	if (mode === "module" || mode === "sensor" && selector !== void 0) {
		if (selector === void 0 || !/^[A-Za-z0-9_./-]+$/.test(selector)) throw new Error("恢复需要有效选择");
		args.push("--module", selector);
	}
	const result = await execFileAsync("python3", [script, ...args], {
		cwd: root,
		encoding: "utf8",
		timeout: 3e4,
		maxBuffer: 8 * 1024 * 1024
	});
	const parsed = JSON.parse(result.stdout);
	const supported = Array.isArray(parsed.blockers) && parsed.blockers.length === 0;
	const changes = [...(parsed.parameters?.changes ?? []).map((c) => c.path), ...(parsed.code?.changes ?? []).map((c) => c.path)];
	const planId = parsed.plan_id;
	if (planId !== void 0) restoreRecords.set(planId, {
		planId,
		planFile
	});
	return {
		mode,
		targetId,
		baselineVersion: baselineVersion(root, targetId)?.version ?? "latest",
		...selector === void 0 ? {} : { selector },
		...planId === void 0 ? {} : { planId },
		command: JSON.stringify([
			"python3",
			script,
			...args
		]),
		supported,
		requiresConfirmation: true,
		readyToApply: parsed.ready_to_apply === true,
		changes,
		modules: parsed.modules ?? [],
		buildDirectories: parsed.build_packages ?? [],
		sensors: mode === "sensor" ? parsed.modules ?? [] : [],
		summary: supported ? parsed.ready_to_apply === true ? `将恢复 ${changes.length} 个文件${(parsed.build_packages ?? []).length > 0 ? "并重新编译" : ""}（目标 ${targetId}）` : "当前已与基线一致，无需恢复" : `恢复被阻止：${(parsed.blockers ?? []).join("；")}`
	};
}
async function restoreExecute(root, payload) {
	const request = payload;
	const planId = typeof request.planId === "string" ? request.planId : void 0;
	const record = planId === void 0 ? void 0 : restoreRecords.get(planId);
	if (record === void 0 || planId === void 0) throw new Error("恢复计划不存在或已过期，请重新生成");
	const script = findRestoreScript(root);
	if (script === void 0) throw new Error("apollo-vehicle-restore 未安装");
	const { code, stdout, stderr } = await new Promise((resolve) => {
		execFile("python3", [
			script,
			"execute",
			"--plan",
			record.planFile,
			"--apply",
			"--confirm-plan",
			planId
		], {
			cwd: root,
			timeout: 9e5,
			maxBuffer: 8 * 1024 * 1024
		}, (err, out, errOut) => {
			resolve({
				code: err === null ? 0 : typeof err.code === "number" ? err.code : 1,
				stdout: out ?? "",
				stderr: errOut ?? ""
			});
		});
	});
	if (code !== 0) {
		const msg = stderr.split(/\r?\n/).filter((line) => /error|Error|FATAL|Traceback|failed/i.test(line)).slice(-3).map((line) => line.replace(/^\[[^\]]*\]\s*/, "").trim()).join("；") || `执行失败（退出码 ${code}）`;
		throw new Error(msg);
	}
	const backupMatch = stdout.match(/backup:\s*(\S+)/);
	const summary = stdout.includes("no changes") || stdout.includes("nothing to apply") ? "无变更，无需恢复" : stdout.includes("scoped restore applied") ? "恢复完成" : "恢复并编译完成";
	return {
		applied: true,
		planId,
		...backupMatch !== null ? { backup: backupMatch[1] } : {},
		output: summary
	};
}
async function runtimeStatus() {
	const running = await tcpReachable("127.0.0.1", 8888, 1500);
	const ports = Object.entries(networkInterfaces()).flatMap(([name, addrs]) => (addrs ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => ({
		name,
		address: a.address,
		up: true
	})));
	return {
		dreamview: running ? "running" : "stopped",
		ports
	};
}
function ptyRead(id, record, payload) {
	const requested = payload?.offset;
	const offset = typeof requested === "number" && Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
	const reset = offset > record.output.length;
	const start = reset ? 0 : offset;
	return {
		id,
		delta: record.output.slice(start),
		offset: record.output.length,
		running: !record.done,
		reset
	};
}
function ptySnapshot(id, record) {
	return {
		id,
		output: record.output,
		running: !record.done,
		...record.done ? { exitCode: record.exitCode } : {}
	};
}
async function openPty(ctx, root, sessions) {
	const id = randomUUID();
	const handle = await ctx.subprocess.spawnTerminal({
		argv: [
			"/bin/bash",
			"--noprofile",
			"--norc"
		],
		cwd: root,
		env: {
			TERM: "xterm-256color",
			PS1: "\\u@\\h:\\w\\$ "
		},
		rows: 28,
		cols: 120,
		graceMs: 2e3
	});
	const record = {
		handle,
		output: "",
		done: false,
		exitCode: null
	};
	sessions.set(id, record);
	handle.output.on("data", (chunk) => {
		record.output = (record.output + chunk.toString()).slice(-1024 * 1024);
	});
	handle.done.then(({ exitCode }) => {
		record.done = true;
		record.exitCode = exitCode;
	}, () => {
		record.done = true;
	});
	return ptySnapshot(id, record);
}
function expectPty(sessions, payload) {
	const id = payload?.id;
	if (typeof id !== "string") throw new Error("missing terminal id");
	const record = sessions.get(id);
	if (record === void 0) throw new Error("terminal session not found");
	return [id, record];
}
/** `webServer` is required because a private channel mounts its own Web route. */
const inject = [
	"connection",
	"webServer",
	"subprocess"
];
/**
* Mount the private RPC channel on whichever host is running.
*
* `connection.rpc.handle()` registers the channel's Web route through the
* Connection service's own fiber, and on DSH 0.2.0-rc.2 that fiber never
* injects `webServer`: the registration throws `cannot get property
* "webServer" without inject` inside its own effect, which kills the whole
* host half (the browser then reaches the static fallback for every call).
* The registry call underneath takes the owning context as its first
* argument, so pass a `webServer`-injected context instead of relying on the
* service's own; the host's admission fence and RPC envelope stay untouched.
* @param ctx - plugin context (injects `connection` and `webServer`).
* @param channel - private channel path.
* @param handler - endpoint dispatcher.
*/
function registerRpcChannel(ctx, channel, handler) {
	const label = "apollo-ops: authenticated host endpoints";
	const service = ctx.connection;
	if (typeof service.register !== "function") {
		ctx.effect(() => service.rpc.handle(channel, handler), label);
		return;
	}
	ctx.inject(["webServer"], (webCtx) => service.register(webCtx, channel, handler));
}
function apply(ctx, config = {}) {
	const root = discoverWorkspace(config.workspace);
	const maxBytes = config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
	const monitoring = monitorConfig(config);
	const sessions = /* @__PURE__ */ new Map();
	if (root !== void 0) startMonitor(root);
	ctx.effect(() => async () => {
		await Promise.all([...sessions.values()].map(async (record) => {
			await record.handle.terminate();
		}));
		sessions.clear();
	}, "apollo-ops: terminal cleanup");
	ctx.effect(() => () => {
		if (monitorProc !== void 0) {
			monitorProc.kill();
			monitorProc = void 0;
		}
	}, "apollo-ops: monitor cleanup");
	const handleEndpoint = async (endpoint, payload) => {
		try {
			if (endpoint === "apolloOps/environment") return ok(environment(root));
			if (root === void 0) return fail("apollo/workspace-not-found", "未发现 Apollo 工作区");
			if (endpoint === "apolloOps/files/list") return ok(listFiles(root, payload));
			if (endpoint === "apolloOps/files/read") return ok(readText(root, payload, maxBytes));
			if (endpoint === "apolloOps/files/write") {
				if (config.allowFileWrite === false) return fail("apollo/permission-denied", "文件编辑未在部署配置中启用");
				return ok(writeText(root, payload, maxBytes));
			}
			if (endpoint === "apolloOps/monitor/config") return ok(monitoring);
			if (endpoint === "apolloOps/monitor/snapshot") return ok(await monitor(root, monitoring, payload));
			if (endpoint === "apolloOps/restore/options") return ok(restoreOptions(root));
			if (endpoint === "apolloOps/restore/targets") return ok({
				targets: readTargets(root),
				detected: environment(root).targetId ?? null
			});
			if (endpoint === "apolloOps/restore/sensor-config") {
				const type = (typeof payload.id === "string" ? payload.id : "").replace(/^drivers\//, "");
				if (SENSOR_TYPE_META[type] === void 0) return fail("apollo/invalid-argument", "未知传感器类型");
				const env = environment(root);
				if (env.targetId === void 0) return fail("apollo/no-target", "当前环境无法匹配车型");
				const cfg = await sensorConfig(root, env.targetId, type);
				return cfg === void 0 ? fail("apollo/not-found", "该传感器在当前车型中未配置") : ok(cfg);
			}
			if (endpoint === "apolloOps/restore/plan") return ok(await restorePlan(root, payload));
			if (endpoint === "apolloOps/restore/execute") return ok(await restoreExecute(root, payload));
			if (endpoint === "apolloOps/config/gnss") return ok(await runSensorConfig(root, "apollo-gnss-config", "configure_ntrip_base.py", payload));
			if (endpoint === "apolloOps/config/lidar") return ok(await runSensorConfig(root, "apollo-lidar-config", "configure_lidar.py", payload));
			if (endpoint === "apolloOps/config/lidar-instance") return ok(await runLidarManager(root, "apply", payload));
			if (endpoint === "apolloOps/config/camera-instance" || endpoint === "apolloOps/config/camera-add") {
				if (config.allowFileWrite === false) return fail("apollo/permission-denied", "相机配置写入未在部署配置中启用");
				return ok(await runCameraManager(root, "apply", endpoint.endsWith("camera-add") ? {
					...payload,
					action: "add"
				} : payload));
			}
			if (endpoint === "apolloOps/config/options") return ok(configOptions(root));
			if (endpoint === "apolloOps/config/lidar-detail") return ok(await runLidarManager(root, "inspect"));
			if (endpoint === "apolloOps/config/camera-detail") return ok(await runCameraManager(root, "inspect", payload));
			if (endpoint === "apolloOps/runtime/status") return ok(await runtimeStatus());
			if (endpoint === "apolloOps/runtime/dreamview") {
				if (config.allowRestore === false) return fail("apollo/permission-denied", "运行控制未启用");
				const action = payload.action;
				if (action === "start") await execFileAsync("aem", [
					"bootstrap",
					"start",
					"--plus"
				], {
					cwd: root,
					timeout: 9e4,
					maxBuffer: 1024 * 1024
				});
				else if (action === "stop") await execFileAsync("aem", ["bootstrap", "stop"], {
					cwd: root,
					timeout: 6e4,
					maxBuffer: 1024 * 1024
				});
				else throw new Error("invalid DreamView action");
				return ok(await runtimeStatus());
			}
			if (endpoint === "apolloOps/runtime/kill-all") {
				if (config.allowRestore === false) return fail("apollo/permission-denied", "运行控制未启用");
				await execFileAsync("/bin/bash", ["-lc", `${JSON.stringify(join(root, "kill_all.sh"))} 2>/dev/null || true`], {
					cwd: root,
					timeout: 6e4,
					maxBuffer: 1024 * 1024
				});
				return ok(await runtimeStatus());
			}
			if (endpoint === "apolloOps/runtime/clean-storage") {
				if (config.allowRestore === false) return fail("apollo/permission-denied", "运行控制未启用");
				let cleanScript;
				for (const skillsDir of skillRoots(root)) {
					const candidate = join(skillsDir, "apollo-env/scripts/clean_apollo_storage.sh");
					if (existsSync(candidate)) { cleanScript = candidate; break; }
				}
				if (cleanScript === void 0) return fail("apollo/not-found", "未找到 apollo-env/scripts/clean_apollo_storage.sh（apollo-env skill 未安装？）");
				const action = payload?.action === "execute" ? "execute" : "preview";
				const modeArgs = action === "execute" ? ["-y", "--json"] : ["--dry-run", "--json"];
				const { stdout } = await execFileAsync("/bin/bash", [cleanScript, ...modeArgs], {
					cwd: root,
					timeout: action === "execute" ? 3e5 : 6e4,
					maxBuffer: 8 * 1024 * 1024
				});
				const line = String(stdout).trim().split("\n").filter((l) => l.trim().startsWith("{")).pop();
				if (line === void 0) return fail("apollo/operation-failed", "清理脚本无 JSON 输出");
				let parsed;
				try { parsed = JSON.parse(line); } catch { return fail("apollo/operation-failed", `清理脚本输出无法解析: ${line.slice(0, 200)}`); }
				if (parsed.error !== void 0) return fail("apollo/operation-failed", String(parsed.error));
				return ok(parsed);
			}
			if (endpoint === "apolloOps/pty/open") {
				if (config.allowTerminal === false) return fail("apollo/permission-denied", "终端未在部署配置中启用");
				return ok(await openPty(ctx, root, sessions));
			}
			if (endpoint === "apolloOps/pty/read") {
				const [id, record] = expectPty(sessions, payload);
				return ok(ptyRead(id, record, payload));
			}
			if (endpoint === "apolloOps/pty/write") {
				const [id, record] = expectPty(sessions, payload);
				const data = payload.data;
				if (typeof data !== "string" || data.length > 65536) throw new Error("invalid terminal input");
				await record.handle.write(data);
				return ok(ptySnapshot(id, record));
			}
			if (endpoint === "apolloOps/pty/signal") {
				const [id, record] = expectPty(sessions, payload);
				await record.handle.signalForeground("SIGINT");
				return ok(ptySnapshot(id, record));
			}
			if (endpoint === "apolloOps/pty/close") {
				const [id, record] = expectPty(sessions, payload);
				await record.handle.terminate();
				sessions.delete(id);
				return ok({ closed: true });
			}
			return fail("apollo/not-found", `unknown endpoint ${endpoint}`);
		} catch (error) {
			return fail("apollo/operation-failed", error instanceof Error ? error.message : String(error));
		}
	};
	registerRpcChannel(ctx, CHANNEL, handleEndpoint);
}
//#endregion
export { APOLLO_OPS_CHANNEL, apply, inject };
