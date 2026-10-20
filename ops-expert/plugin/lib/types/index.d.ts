import type { Context } from '@deepseek-ai/cordis';
import type { ApolloMonitorConfig } from './types.ts';
export type * from './types.ts';
export { APOLLO_OPS_CHANNEL } from './channel.ts';
interface ApolloOpsConfig {
    workspace?: string;
    maxTextBytes?: number;
    allowFileWrite?: boolean;
    allowTerminal?: boolean;
    allowRestore?: boolean;
    sensors?: ApolloMonitorConfig['sensors'];
    externalTargets?: ApolloMonitorConfig['externalTargets'];
    channelPageSize?: number;
    refreshMs?: number;
}
/** `webServer` is required because a private channel mounts its own Web route. */
export declare const inject: string[];
export declare function apply(ctx: Context, config?: ApolloOpsConfig): void;
//# sourceMappingURL=index.d.ts.map