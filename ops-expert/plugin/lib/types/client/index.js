import { createApolloOpsClient } from "./api.js";
import { ApolloOpsQuickAction } from "./ApolloOpsQuickAction.js";
import { ApolloOpsTab } from "./ApolloOpsTab.js";
import { WorkspaceToolsAction } from "./WorkspaceToolsAction.js";
import { TerminalDock } from "./TerminalDock.js";
import { en, zh } from "./locales.js";
export const NS = 'settings.apolloOps';
export const inject = ['slots', 'locale', 'connection'];
export function apply(ctx) {
    const apolloOps = createApolloOpsClient(ctx);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'apollo-ops: dictionaries');
    const t = ctx.locale.bind(NS);
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'apollo-ops',
        order: 20,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({ apolloOps }),
    }, ApolloOpsTab));
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'apollo-ops',
        order: -10,
        locale: NS,
        inject: () => ({ apolloOps }),
    }, ApolloOpsQuickAction));
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'apollo-workspace-tools',
        order: 30,
        locale: NS,
        inject: () => ({ apolloOps }),
    }, WorkspaceToolsAction));
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'apollo-native-terminal',
        order: 50,
        locale: NS,
        inject: () => ({ apolloOps }),
    }, TerminalDock));
}
//# sourceMappingURL=index.js.map