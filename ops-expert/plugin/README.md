# Apollo Ops Expert

Portable DSH Web plugin for Apollo vehicle operations.

## What it provides

- Runtime discovery of the Apollo workspace, active profile, vehicle stamp, Apollo version, `apollo-env`, `apollo-dev`, and matching baseline.
- An authenticated Host API for environment discovery, workspace-scoped file listing, UTF-8 file reading, version-guarded text saving, and a controlled Bash command surface.
- The `Apollo Ops Expert` sidebar action and the Settings > Plugins tab.
- A workspace file tree/editor and Bash terminal in the operations panel.

The browser half never reads the Host filesystem directly. The Host half resolves paths against the discovered Apollo workspace, rejects paths outside it, and rejects stale file saves.

## Portability

This package has no dependency on `/home/apollo/deepseek-harness`, `/apollo_workspace`, or a fixed vehicle. At runtime it checks, in order:

1. Loader configuration `workspace` when supplied;
2. `APOLLO_WORKSPACE`;
3. the DSH process working directory;
4. `/apollo_workspace`.

A workspace is accepted only when it contains `.workspace.json` or `profiles/`. Missing Apollo, Skills, or baselines are reported as unavailable and do not prevent DSH from loading.

## Install in another DSH checkout

Use the portable deployment bundle for a source checkout:

```sh
./portable/package.sh
# Transfer and extract the resulting archive, then:
./ui-apollo-ops/portable/install.sh /path/to/target/deepseek-harness
```

The installer copies the package, idempotently registers the root client/host TypeScript projects, Web app dependency, and Cordis browser roster, then runs `pnpm install` and `pnpm run build` in the target. Upgrade and uninstall scripts are included, and every changed target file is backed up before mutation. See [`portable/README.md`](portable/README.md) for transfer, recovery, and lifecycle details.

The package's main entry is the Host half and its `./client` export is the browser half. The scripts do not start or replace a DSH server; refresh the target's existing Web page after rebuilding.

## Configuration

The Host entry accepts optional Loader configuration:

```yaml
workspace: /path/to/apollo/workspace
maxTextBytes: 1048576
```

`workspace` is an operator deployment setting, not a source-code constant. For remote vehicles, run DSH on the Apollo host or provide the target workspace through the deployment profile; the browser never mounts a remote filesystem itself.

## Compatibility

- DSH Web client plugin loader with `dsh.client` support.
- DSH Connection Host API (`ctx.connection.rpc`).
- Apollo package or source workspaces with a `profiles/` tree, or a compatible workspace exposing `.workspace.json`.
- `apollo-env` and `apollo-dev` are optional capabilities. Their absence is visible in the environment card.

The current version includes environment discovery, file browsing/editing, and a command surface. Full target-aware restore planning, sensor/module scoped restore, network/Cyber live polling, and a streaming PTY are separate Host capability milestones; the UI marks unavailable operations instead of claiming they are implemented.
