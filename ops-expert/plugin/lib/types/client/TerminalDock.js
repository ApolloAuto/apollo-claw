import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { NativeTerminal } from "./NativeTerminal.js";
import css from './TerminalDock.module.css';
export function TerminalDock({ t, apolloOps }) {
    const [open, setOpen] = useState(false);
    const [tabs, setTabs] = useState([{ id: 1, title: t('terminalName', { index: 1 }) }]);
    const [active, setActive] = useState(1);
    useEffect(() => {
        const toggle = () => { setOpen(value => !value); };
        window.addEventListener('apollo-ops:toggle-terminal', toggle);
        return () => { window.removeEventListener('apollo-ops:toggle-terminal', toggle); };
    }, []);
    if (!open)
        return null;
    const add = () => {
        const id = Math.max(0, ...tabs.map(tab => tab.id)) + 1;
        setTabs(current => [...current, { id, title: t('terminalName', { index: id }) }]);
        setActive(id);
    };
    const closeTab = (id) => {
        const remaining = tabs.filter(tab => tab.id !== id);
        setTabs(remaining);
        if (remaining.length === 0) {
            setOpen(false);
            return;
        }
        if (active === id)
            setActive(remaining[remaining.length - 1].id);
    };
    return (_jsxs("section", { className: css.dock, "aria-label": t('terminalTool'), children: [_jsxs("div", { className: css.header, children: [_jsx("div", { className: css.tabs, role: "tablist", children: tabs.map(tab => _jsxs("button", { type: "button", role: "tab", "aria-selected": tab.id === active, onClick: () => setActive(tab.id), children: [_jsx("span", { children: tab.title }), _jsx("i", { role: "button", "aria-label": t('closeTerminal', { name: tab.title }), onClick: (event) => { event.stopPropagation(); closeTab(tab.id); }, children: "\u00D7" })] }, tab.id)) }), _jsxs("div", { className: css.actions, children: [_jsx("button", { type: "button", "aria-label": t('newTerminal'), onClick: add, children: "\uFF0B" }), _jsx("button", { type: "button", "aria-label": t('closeTerminalPanel'), onClick: () => setOpen(false), children: "\u00D7" })] })] }), _jsx("div", { className: css.panels, children: tabs.map(tab => _jsx("div", { role: "tabpanel", hidden: tab.id !== active, children: _jsx(NativeTerminal, { apolloOps: apolloOps, t: t }) }, tab.id)) })] }));
}
//# sourceMappingURL=TerminalDock.js.map