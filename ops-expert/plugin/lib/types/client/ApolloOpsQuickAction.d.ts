import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ApolloOpsClientApi } from './api.ts';
export type ApolloOpsQuickActionProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'settings.apolloOps'> & InjectFace<{
    apolloOps: ApolloOpsClientApi;
}>;
export declare function ApolloOpsQuickAction({ wide, t, apolloOps }: ApolloOpsQuickActionProps): ReactNode;
//# sourceMappingURL=ApolloOpsQuickAction.d.ts.map