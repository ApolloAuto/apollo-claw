import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ApolloOpsClientApi } from './api.ts';
export interface ApolloOpsTabInjected {
    apolloOps: ApolloOpsClientApi;
}
export type ApolloOpsTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'settings.apolloOps'> & InjectFace<ApolloOpsTabInjected>;
export type ApolloOpsDashboardProps = PropsLocale<'settings.apolloOps'> & ApolloOpsTabInjected;
export declare function ApolloOpsTab({ t, apolloOps }: ApolloOpsDashboardProps): ReactNode;
//# sourceMappingURL=ApolloOpsTab.d.ts.map