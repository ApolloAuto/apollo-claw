import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ApolloOpsClientApi } from './api.ts';
export type TerminalDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'settings.apolloOps'> & InjectFace<{
    apolloOps: ApolloOpsClientApi;
}>;
export declare function TerminalDock({ t, apolloOps }: TerminalDockProps): ReactNode;
//# sourceMappingURL=TerminalDock.d.ts.map