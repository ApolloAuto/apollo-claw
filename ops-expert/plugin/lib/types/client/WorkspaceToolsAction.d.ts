import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ApolloOpsClientApi } from './api.ts';
export type WorkspaceToolsActionProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'settings.apolloOps'> & InjectFace<{
    apolloOps: ApolloOpsClientApi;
}>;
export declare function WorkspaceToolsAction({ t, apolloOps }: WorkspaceToolsActionProps): ReactNode;
//# sourceMappingURL=WorkspaceToolsAction.d.ts.map