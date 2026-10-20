import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import css from './CameraConfigDialog.module.css';
const emptyDraft = { name: '', dev: '', frameId: '', reference: '', enabled: false };
const keyOf = (camera) => `${camera.name}\n${camera.conf}`;
const valuesOf = (camera) => Object.fromEntries(camera.fields.map(field => [field.id, field.value]));
/** One actual DAG graph, one versioned snapshot and one explicit operation at a time. */
export function CameraConfigDialog({ api, onClose }) {
    const [detail, setDetail] = useState();
    const [selected, setSelected] = useState();
    const [values, setValues] = useState({});
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState(emptyDraft);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [search, setSearch] = useState('');
    const inFlight = useRef(false);
    const alive = useRef(true);
    const dialog = useRef(null);
    const editor = useRef(null);
    const current = detail?.cameras.find(camera => keyOf(camera) === selected);
    const dirty = adding ? Object.entries(draft).some(([key, value]) => value !== emptyDraft[key]) : current?.fields.some(field => values[field.id] !== field.value) === true;
    const fetchDetail = async (dag) => {
        const result = await api.configCameraDetail(dag);
        if (!result.ok)
            throw new Error(result.error.message);
        // Old hosts returned a different API shape. Never allow editing a stale snapshot.
        if (!result.value.version || !Array.isArray(result.value.cameras))
            throw new Error('后端尚未加载新版相机管理器。请先经确认重启 DSH，再刷新页面。');
        return result.value;
    };
    useEffect(() => {
        alive.current = true;
        const previous = document.activeElement;
        dialog.current?.focus();
        setBusy(true);
        inFlight.current = true;
        void fetchDetail().then(result => { if (alive.current)
            setDetail(result); }, reason => { if (alive.current)
            setError(String(reason instanceof Error ? reason.message : reason)); }).finally(() => {
            inFlight.current = false;
            if (alive.current)
                setBusy(false);
        });
        return () => {
            alive.current = false;
            if (previous instanceof HTMLElement)
                previous.focus();
        };
    }, [api]);
    const discard = () => !dirty || window.confirm('当前修改尚未保存，是否放弃修改？');
    const close = () => { if (!inFlight.current && discard())
        onClose(); };
    const choose = (camera) => {
        if (inFlight.current || !discard())
            return;
        setSelected(keyOf(camera));
        setValues(valuesOf(camera));
        setAdding(false);
        setError('');
        setMessage('');
        if (editor.current)
            editor.current.scrollTop = 0;
    };
    const load = async (dag) => {
        if (inFlight.current || !discard())
            return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const next = await fetchDetail(dag);
            if (!alive.current)
                return;
            setDetail(next);
            setSelected(undefined);
            setValues({});
            setAdding(false);
            setDraft(emptyDraft);
        }
        catch (reason) {
            if (alive.current)
                setError(reason instanceof Error ? reason.message : String(reason));
        }
        finally {
            inFlight.current = false;
            if (alive.current)
                setBusy(false);
        }
    };
    const apply = async (payload, keep) => {
        if (!detail || inFlight.current)
            return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await api.configCameraInstance({ ...payload, dag: detail.dag, version: detail.version });
            if (!result.ok)
                throw new Error(result.error.message);
            // Only report success after a fresh readback. Do not close the dialog on failure.
            const next = await fetchDetail(detail.dag);
            if (!alive.current)
                return;
            setDetail(next);
            const wantedName = payload.action === 'add' ? draft.name : undefined;
            const chosen = next.cameras.find(camera => wantedName ? camera.name === wantedName : keyOf(camera) === keep);
            setSelected(chosen ? keyOf(chosen) : undefined);
            setValues(chosen ? valuesOf(chosen) : {});
            setAdding(false);
            setDraft(emptyDraft);
            setMessage(`${result.value.output} 已重新读取当前配置。`);
        }
        catch (reason) {
            if (alive.current)
                setError(`${reason instanceof Error ? reason.message : String(reason)}（未清空你的输入；如提示版本变化，请刷新后重新核对。）`);
        }
        finally {
            inFlight.current = false;
            if (alive.current)
                setBusy(false);
        }
    };
    const toggle = (camera) => {
        if (inFlight.current || !discard())
            return;
        if (!window.confirm(`确认${camera.enabled ? '停用并注释' : '启用并取消注释'} ${camera.name}？关联的 ${camera.linked.length} 个压缩组件将同步；其他相机不变。此操作只写配置，不启动或停止进程。`))
            return;
        void apply({ action: camera.enabled ? 'disable' : 'enable', name: camera.name, conf: camera.conf }, keyOf(camera));
    };
    const beginAdd = () => {
        if (inFlight.current || !discard())
            return;
        setAdding(true);
        setSelected(undefined);
        setValues({});
        setDraft(emptyDraft);
        setError('');
        setMessage('');
    };
    const save = () => {
        if (!current)
            return;
        const changes = Object.fromEntries(current.fields.filter(field => values[field.id] !== field.value).map(field => [field.id, values[field.id] ?? '']));
        void apply({ action: 'edit', name: current.name, conf: current.conf, values: changes }, keyOf(current));
    };
    const list = (enabled) => {
        const cameras = (detail?.cameras ?? []).filter(camera => camera.enabled === enabled && `${camera.name} ${camera.dev} ${camera.conf}`.toLowerCase().includes(search.toLowerCase()));
        return _jsxs("section", { "aria-label": enabled ? '已启用相机' : '未启用相机', children: [_jsxs("h3", { children: [enabled ? '已启用（未注释）' : '未启用（已注释）', " \u00B7 ", cameras.length] }), cameras.map(camera => _jsxs("article", { className: css.camera, "data-selected": selected === keyOf(camera), children: [_jsxs("div", { className: css.identity, children: [_jsx("strong", { children: camera.name }), _jsx("code", { children: camera.dev || '未配置设备' }), _jsxs("small", { children: [camera.className, " \u00B7 \u538B\u7F29\u7EC4\u4EF6 ", camera.linked.length] })] }), _jsxs("div", { className: css.rowActions, children: [_jsx("button", { type: "button", disabled: busy || !camera.confExists, onClick: () => choose(camera), "aria-label": `编辑 ${camera.name}`, children: "\u7F16\u8F91" }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: camera.enabled, disabled: busy || !camera.confExists, onChange: () => toggle(camera), "aria-label": `启用 ${camera.name}` }), "\u542F\u7528"] })] }), !camera.confExists ? _jsxs("p", { role: "alert", children: ["conf \u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u4E0D\u80FD\u7F16\u8F91\u6216\u542F\u7528\uFF1A", camera.conf] }) : null] }, keyOf(camera))), cameras.length === 0 ? _jsx("p", { className: css.hint, children: "\u65E0\u5339\u914D\u76F8\u673A" }) : null] });
    };
    return _jsxs("div", { className: css.overlay, children: [_jsx("div", { className: css.mask, onClick: close }), _jsxs("div", { className: css.dialog, ref: dialog, tabIndex: -1, role: "dialog", "aria-modal": "true", "aria-label": "\u76F8\u673A\u5B9E\u4F8B\u914D\u7F6E", onKeyDown: event => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        close();
                    }
                    if (event.key === 'Tab') {
                        const controls = Array.from(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
                        const first = controls[0], last = controls[controls.length - 1];
                        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
                            event.preventDefault();
                            last?.focus();
                        }
                        else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault();
                            first?.focus();
                        }
                    }
                }, children: [_jsxs("header", { className: css.header, children: [_jsxs("div", { children: [_jsx("h2", { children: "\u76F8\u673A\u5B9E\u4F8B\u914D\u7F6E" }), _jsx("p", { children: "\u8BFB\u53D6\u5B9E\u9645 DAG\uFF08\u542B\u6CE8\u91CA\u9879\uFF09\u4E0E PB \u6587\u4EF6\u3002\u542F\u7528\u72B6\u6001\u662F\u914D\u7F6E\u72B6\u6001\uFF0C\u4E0D\u4EE3\u8868\u8FDB\u7A0B\u8FD0\u884C\u72B6\u6001\u3002" })] }), _jsx("button", { type: "button", disabled: busy, onClick: close, children: "\u5173\u95ED" })] }), _jsxs("div", { className: css.toolbar, children: [_jsxs("label", { children: ["DAG", _jsx("select", { "aria-label": "\u76F8\u673A DAG", disabled: busy || !detail, value: detail?.dag ?? '', onChange: event => { void load(event.target.value); }, children: (detail?.dags ?? []).map(dag => _jsx("option", { value: dag, children: dag.split('/').pop() }, dag)) })] }), _jsx("button", { type: "button", disabled: busy, onClick: () => { void load(detail?.dag); }, children: "\u5237\u65B0\u914D\u7F6E" }), _jsx("button", { type: "button", disabled: busy || !detail?.cameras.some(camera => camera.confExists), onClick: beginAdd, children: "\u6DFB\u52A0\u76F8\u673A" })] }), _jsx("code", { className: css.path, children: detail?.dag }), _jsxs("div", { className: css.feedback, "aria-live": "polite", children: [busy ? _jsx("span", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u6216\u5199\u5165\uFF0C\u8BF7\u7A0D\u5019\u2026" }) : null, error ? _jsx("p", { role: "alert", children: error }) : null, message ? _jsx("p", { role: "status", children: message }) : null] }), _jsxs("div", { className: css.workspace, children: [_jsxs("aside", { className: css.list, "aria-label": "\u5F53\u524D DAG \u76F8\u673A\u5217\u8868", children: [_jsxs("label", { className: css.search, children: ["\u7B5B\u9009\u76F8\u673A", _jsx("input", { "aria-label": "\u7B5B\u9009\u76F8\u673A", value: search, onChange: event => setSearch(event.target.value) })] }), list(true), list(false)] }), _jsx("div", { className: css.editor, ref: editor, children: adding ? _jsxs("form", { onSubmit: event => { event.preventDefault(); void apply({ action: 'add', ...draft }); }, children: [_jsx("h3", { children: "\u4ECE\u771F\u5B9E\u76F8\u673A\u521B\u5EFA\u72EC\u7ACB\u5B9E\u4F8B" }), _jsx("p", { className: css.hint, children: "\u660E\u786E\u9009\u62E9\u53C2\u8003\u9879\u3002\u4FDD\u7559\u53C2\u8003 PB \u53C2\u6570\u53CA\u538B\u7F29\u7EC4\u4EF6 readers/\u914D\u7F6E\uFF0C\u521B\u5EFA\u72EC\u7ACB conf\u3001frame \u548C\u901A\u9053\uFF1B\u4E0D\u5207\u6362 Profile\u3002" }), _jsxs("label", { children: ["\u53C2\u8003\u76F8\u673A", _jsxs("select", { required: true, disabled: busy, value: draft.reference, onChange: event => setDraft(prev => ({ ...prev, reference: event.target.value })), children: [_jsx("option", { value: "", disabled: true, children: "\u8BF7\u9009\u62E9\u53C2\u8003\u76F8\u673A" }), (detail?.cameras ?? []).filter(camera => camera.confExists).map(camera => _jsxs("option", { value: camera.name, children: [camera.name, "\uFF08", camera.enabled ? '已启用' : '已注释', "\uFF09"] }, keyOf(camera)))] })] }), _jsxs("label", { children: ["\u65B0\u5B9E\u4F8B\u540D", _jsx("input", { required: true, pattern: "[A-Za-z][A-Za-z0-9_-]{0,63}", disabled: busy, value: draft.name, onChange: event => setDraft(prev => ({ ...prev, name: event.target.value })) })] }), _jsxs("label", { children: ["\u8BBE\u5907\u8DEF\u5F84", _jsx("input", { required: true, disabled: busy, value: draft.dev, onChange: event => setDraft(prev => ({ ...prev, dev: event.target.value })), placeholder: "/dev/video..." })] }), _jsxs("label", { children: ["\u72EC\u7ACB frame_id", _jsx("input", { required: true, pattern: "[A-Za-z][A-Za-z0-9_-]{0,63}", disabled: busy, value: draft.frameId, onChange: event => setDraft(prev => ({ ...prev, frameId: event.target.value })) })] }), _jsxs("label", { className: css.check, children: [_jsx("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: event => setDraft(prev => ({ ...prev, enabled: event.target.checked })) }), "\u5199\u5165\u672A\u6CE8\u91CA\u7684\u542F\u7528\u7EC4\u4EF6\uFF08\u9ED8\u8BA4\u6DFB\u52A0\u4E3A\u6CE8\u91CA\u72B6\u6001\uFF09"] }), _jsxs("p", { className: css.hint, children: ["\u65B0\u901A\u9053\u5728\u53C2\u8003\u901A\u9053\u672B\u5C3E\u52A0 /", draft.name || '新实例名', "\uFF0C\u4FDD\u5B58\u540E\u53EF\u7F16\u8F91\uFF1B\u5173\u8054\u538B\u7F29 readers \u540C\u6B65\u3002"] }), _jsx("button", { type: "submit", disabled: busy || !draft.reference || !draft.name || !draft.dev || !draft.frameId, children: "\u786E\u8BA4\u6DFB\u52A0\u5E76\u56DE\u8BFB" })] }) : current ? _jsxs(_Fragment, { children: [_jsxs("h3", { children: ["\u7F16\u8F91\uFF1A", current.name] }), _jsx("code", { className: css.path, children: current.conf }), _jsx("p", { className: css.hint, children: "\u5F53\u524D\u6587\u4EF6\u771F\u5B9E\u503C\uFF0C\u672A\u586B\u5199\u7684\u5B57\u6BB5\u4E0D\u4ECE\u6A21\u677F\u8865\u5165\u3002\u53EA\u4FDD\u5B58\u4FEE\u6539\u9879\uFF1B\u5E03\u5C14\u3001\u6570\u503C\u4E0E\u914D\u7F6E\u7248\u672C\u4F1A\u6821\u9A8C\u3002" }), current.linked.length > 0 ? _jsxs("details", { children: [_jsxs("summary", { children: ["\u5173\u8054\u538B\u7F29\u7EC4\u4EF6\uFF08", current.linked.length, "\uFF09"] }), current.linked.map(comp => _jsxs("p", { className: css.path, children: [comp.name, " \u00B7 ", comp.enabled ? '未注释' : '已注释', " \u00B7 ", comp.dag] }, `${comp.dag}:${comp.name}`))] }) : null, current.fields.map(field => _jsxs("label", { className: css.field, children: [_jsx("span", { children: field.key }), field.value === 'true' || field.value === 'false' ? _jsxs("select", { "aria-label": field.key, disabled: busy, value: values[field.id] ?? field.value, onChange: event => setValues(prev => ({ ...prev, [field.id]: event.target.value })), children: [_jsx("option", { value: "true", children: "true" }), _jsx("option", { value: "false", children: "false" })] }) : _jsx("input", { "aria-label": field.key, disabled: busy, value: values[field.id] ?? field.value, onChange: event => setValues(prev => ({ ...prev, [field.id]: event.target.value })) }), values[field.id] !== field.value ? _jsxs("small", { children: ["\u539F\u503C\uFF1A", field.value] }) : null] }, field.id))] }) : _jsx("div", { className: css.empty, children: "\u5728\u5DE6\u4FA7\u9009\u62E9\u4EFB\u4E00\u5DF2\u542F\u7528\u6216\u5DF2\u6CE8\u91CA\u76F8\u673A\u8FDB\u884C\u7F16\u8F91\u3002\u5217\u8868\u4E0E\u7F16\u8F91\u533A\u72EC\u7ACB\u6EDA\u52A8\uFF0C\u59CB\u7EC8\u53EF\u4EE5\u5207\u6362\u5B9E\u4F8B\u3002" }) })] }), _jsxs("footer", { className: css.footer, children: [_jsxs("span", { children: [dirty ? '有未保存修改' : '当前内容已同步', " \u00B7 ", detail?.cameras.length ?? 0, " \u4E2A\u76F8\u673A"] }), current && !adding ? _jsx("button", { type: "button", disabled: busy || !dirty, onClick: save, children: "\u4FDD\u5B58\u4FEE\u6539\u5E76\u56DE\u8BFB" }) : null, _jsx("button", { type: "button", disabled: busy, onClick: close, children: "\u5173\u95ED" })] })] })] });
}
//# sourceMappingURL=CameraConfigDialog.js.map