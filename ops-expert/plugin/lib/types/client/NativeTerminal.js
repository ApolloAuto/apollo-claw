import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import css from './NativeTerminal.module.css';
export function NativeTerminal({ apolloOps, t }) {
    const host = useRef(null);
    const api = useRef(apolloOps);
    api.current = apolloOps;
    useEffect(() => {
        const element = host.current;
        if (element === null)
            return;
        const term = new Terminal({
            convertEol: true,
            cursorBlink: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12,
            scrollback: 10_000,
            theme: { background: '#101114', foreground: '#e5e7eb', cursor: '#7dd3fc', selectionBackground: '#334155' },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(element);
        fit.fit();
        let alive = true;
        let id;
        let offset = 0;
        const data = term.onData((chunk) => { if (id !== undefined)
            void api.current.writePty(id, chunk); });
        void api.current.openPty().then((result) => {
            if (!alive)
                return;
            if (!result.ok) {
                term.write(`\r\n[error] ${result.error.message}\r\n`);
                return;
            }
            id = result.value.id;
            offset = result.value.output.length;
            term.write(result.value.output || t('terminalReady'));
            term.focus();
        });
        const timer = window.setInterval(() => {
            if (id === undefined)
                return;
            void api.current.readPty(id, offset).then((result) => {
                if (!alive || !result.ok)
                    return;
                if (result.value.reset)
                    term.reset();
                if (result.value.delta !== '')
                    term.write(result.value.delta);
                offset = result.value.offset;
            });
        }, 300);
        const observer = new ResizeObserver(() => { fit.fit(); });
        observer.observe(element);
        return () => {
            alive = false;
            window.clearInterval(timer);
            observer.disconnect();
            data.dispose();
            if (id !== undefined)
                void api.current.closePty(id);
            term.dispose();
        };
    }, [t]);
    return _jsx("div", { className: css.root, ref: host, role: "application", "aria-label": t('terminalTool') });
}
//# sourceMappingURL=NativeTerminal.js.map