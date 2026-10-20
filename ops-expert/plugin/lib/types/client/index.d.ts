import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type ApolloOpsLocaleKey } from './locales.ts';
export declare const NS = "settings.apolloOps";
export declare const inject: string[];
export type { ApolloOpsLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.apolloOps': ApolloOpsLocaleKey;
    }
}
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map