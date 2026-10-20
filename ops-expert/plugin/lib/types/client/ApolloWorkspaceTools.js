import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import css from './ApolloWorkspaceTools.module.css';
export function ApolloWorkspaceTools({ apolloOps, t }) {
    const [path, setPath] = useState('.');
    const [history, setHistory] = useState([]);
    const [entries, setEntries] = useState([]);
    const [editor, setEditor] = useState();
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        let active = true;
        setStatus('');
        void apolloOps.listFiles(path).then(result => {
            if (!active)
                return;
            if (result.ok)
                setEntries(result.value);
            else
                setStatus(result.error.message);
        });
        return () => { active = false; };
    }, [apolloOps, path, refresh]);
    const enter = (next) => { setHistory(current => [...current, path]); setPath(next); };
    const back = () => {
        const prior = history[history.length - 1];
        if (prior === undefined)
            return;
        setHistory(current => current.slice(0, -1));
        setPath(prior);
    };
    const open = async (entry) => {
        if (entry.type === 'directory') {
            enter(entry.path);
            return;
        }
        const result = await apolloOps.readFile(entry.path);
        if (!result.ok) {
            setStatus(result.error.message);
            return;
        }
        setEditor(result.value);
        setStatus(result.value.truncated ? '文件过大，仅展示前 1 MiB，禁止保存' : '');
    };
    const save = async () => {
        if (editor === undefined || editor.truncated)
            return;
        setSaving(true);
        const result = await apolloOps.writeFile(editor.path, editor.content, editor.version);
        setSaving(false);
        if (!result.ok) {
            setStatus(result.error.message);
            return;
        }
        setEditor(result.value);
        setStatus(t('saved'));
    };
    if (editor !== undefined)
        return (_jsxs("aside", { className: css.root, "aria-label": t('filesTool'), children: [_jsxs("div", { className: css.editorTop, children: [_jsx("button", { type: "button", onClick: () => setEditor(undefined), "aria-label": t('backToFiles'), children: "\u2039" }), _jsx("code", { title: editor.path, children: editor.path }), _jsx("button", { type: "button", onClick: () => void save(), disabled: saving || editor.truncated, children: saving ? t('saving') : t('saveFile') }), _jsx("button", { type: "button", onClick: () => setEditor(undefined), "aria-label": t('closeFile'), children: "\u00D7" })] }), _jsx("textarea", { autoFocus: true, className: css.editorFull, value: editor.content, onChange: event => setEditor({ ...editor, content: event.target.value }), spellCheck: false }), status === '' ? null : _jsx("div", { className: css.status, role: "status", children: status })] }));
    return (_jsxs("aside", { className: css.root, "aria-label": t('filesTool'), children: [_jsxs("div", { className: css.explorerHeader, children: [_jsx("button", { type: "button", onClick: back, disabled: history.length === 0, "aria-label": t('back'), children: "\u2039" }), _jsx("strong", { children: t('filesTool') }), _jsx("button", { type: "button", onClick: () => setRefresh(value => value + 1), "aria-label": t('refreshFiles'), children: "\u21BB" })] }), _jsx("div", { className: css.breadcrumb, children: _jsx("code", { children: path }) }), _jsx("div", { className: css.explorer, role: "tree", children: entries.length === 0 ? _jsx("p", { children: t('emptyDirectory') }) : entries.map(entry => _jsxs("button", { type: "button", role: "treeitem", onClick: () => void open(entry), title: entry.path, children: [_jsx("span", { className: entry.type === 'directory' ? css.folder : css.file, "aria-hidden": "true", children: entry.type === 'directory' ? '›' : '·' }), _jsx("span", { children: entry.name }), entry.type === 'file' && entry.size !== undefined ? _jsx("small", { children: entry.size < 1024 ? `${entry.size} B` : `${Math.ceil(entry.size / 1024)} KB` }) : null] }, entry.path)) }), status === '' ? null : _jsx("div", { className: css.status, role: "status", children: status })] }));
}
//# sourceMappingURL=ApolloWorkspaceTools.js.map