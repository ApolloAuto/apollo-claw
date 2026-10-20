import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { IconClose, IconPersonalization } from "./icons.js";
import { ApolloOpsTab } from "./ApolloOpsTab.js";
import css from './ApolloOpsQuickAction.module.css';
export function ApolloOpsQuickAction({ wide, t, apolloOps }) {
    const [open, setOpen] = useState(false);
    const label = t('tab');
    return (_jsxs(_Fragment, { children: [_jsx(Tooltip, { label: label, delayMs: 500, disabled: wide, children: _jsxs("button", { type: "button", className: css.trigger, "data-wide": wide ? 'true' : undefined, "aria-label": label, "aria-haspopup": "dialog", "aria-expanded": open, onClick: () => { setOpen(true); }, children: [_jsx(IconPersonalization, { size: 16 }), wide ? _jsx("span", { children: label }) : null, wide ? _jsx("span", { className: css.liveDot, "aria-hidden": "true" }) : null] }) }), open ? (_jsxs("div", { className: css.overlay, role: "presentation", children: [_jsx("div", { className: css.mask, "aria-hidden": "true", onClick: () => { setOpen(false); } }), _jsxs("div", { className: css.panel, role: "dialog", "aria-modal": "true", "aria-label": label, children: [_jsxs("div", { className: css.panelHeader, children: [_jsxs("span", { className: css.panelTitle, children: [_jsx(IconPersonalization, { size: 16 }), label] }), _jsx("button", { type: "button", className: css.close, "aria-label": t('close'), onClick: () => { setOpen(false); }, children: _jsx(IconClose, { size: 16 }) })] }), _jsx("div", { className: css.panelBody, children: _jsx(ApolloOpsTab, { t: t, apolloOps: apolloOps }) })] })] })) : null] }));
}
//# sourceMappingURL=ApolloOpsQuickAction.js.map