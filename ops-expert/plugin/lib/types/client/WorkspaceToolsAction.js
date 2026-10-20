import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { IconClose, IconData } from "./icons.js";
import { ApolloWorkspaceTools } from "./ApolloWorkspaceTools.js";
import css from './WorkspaceToolsAction.module.css';
export function WorkspaceToolsAction({ t, apolloOps }) {
    const [open, setOpen] = useState(false);
    const openFiles = () => { setOpen(true); };
    return (_jsxs(_Fragment, { children: [_jsx(Tooltip, { label: t('filesTool'), delayMs: 400, children: _jsx("button", { type: "button", className: css.utility, "aria-label": t('filesTool'), onClick: openFiles, children: _jsx(IconData, { size: 16 }) }) }), _jsx(Tooltip, { label: t('terminalTool'), delayMs: 400, children: _jsx("button", { type: "button", className: css.utility, "aria-label": t('terminalTool'), onClick: () => window.dispatchEvent(new CustomEvent('apollo-ops:toggle-terminal')), children: _jsx("span", { "aria-hidden": "true", children: "\u203A_" }) }) }), open ? (_jsxs("aside", { className: css.drawer, "aria-label": t('filesTool'), children: [_jsxs("div", { className: css.drawerHeader, children: [_jsx("strong", { children: t('filesTool') }), _jsx("button", { type: "button", "aria-label": t('close'), onClick: () => setOpen(false), children: _jsx(IconClose, { size: 16 }) })] }), _jsx(ApolloWorkspaceTools, { apolloOps: apolloOps, t: t })] })) : null] }));
}
//# sourceMappingURL=WorkspaceToolsAction.js.map