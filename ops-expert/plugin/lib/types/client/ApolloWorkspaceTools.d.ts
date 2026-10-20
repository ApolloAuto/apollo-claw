import { type ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ApolloOpsClientApi } from './api.ts';
interface Props {
    readonly apolloOps: ApolloOpsClientApi;
    readonly t: TranslateNS<'settings.apolloOps'>;
}
export declare function ApolloWorkspaceTools({ apolloOps, t }: Props): ReactNode;
export {};
//# sourceMappingURL=ApolloWorkspaceTools.d.ts.map