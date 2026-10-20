/**
 * Dedicated RPC channel for this plugin's Host endpoints.
 *
 * The shared `/api` channel holds exactly one interceptor and it belongs to
 * `@deepseek-ai/dsh-api-gateway`; a second `rpc.intercept('/api', …)` throws
 * `shared RPC channel "/api" already has an interceptor` and whichever half
 * loses the race stops answering. Own a private channel via `rpc.handle`
 * instead — same Host/Origin fence and browser authentication, no contention.
 * @module
 */
/** Absolute channel this plugin mounts on the Web server. */
export declare const APOLLO_OPS_CHANNEL = "/apollo-ops";
//# sourceMappingURL=channel.d.ts.map