// apollo-ops-expert.mjs — 随「Apollo 运维工程师」预设一起分发的工具插件。
//
// 注册一个 `apollo_ops_expert` 工具：薄封装，确定性调用【已安装到目标机
// $DSH_HOME/skills 的】apollo-env 命令分发器 `apollo-env.sh`（读 plugins.yaml
// 并路由到对应 apollo-* 子 skill 脚本）。
//
// 本预设不自带 skills（env 全家已单独装在 $DSH_HOME/skills），所以分发器路径
// 从 $DSH_HOME（默认 ~/.dsh）推导，而不是预设目录相对路径。
// 维护方式：改子 skill / plugins.yaml 后本插件无需改动（只透传命令）。
// 零第三方依赖（仅 node 内置模块）。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export const name = 'apollo-ops-expert'
export const inject = ['tools']

/** apollo-env 分发器路径：目标机 $DSH_HOME/skills 下已安装的那份。 */
const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME !== ''
  ? process.env.DSH_HOME
  : join(homedir(), '.dsh')
const APOLLO_ENV_SCRIPT = join(DSH_HOME, 'skills', 'apollo-env', 'scripts', 'apollo-env.sh')

const EXEC_TIMEOUT_MS = 600000 // restore 可能触发 build，给足时间
const MAX_BUFFER = 16 * 1024 * 1024

async function runCommand(command, target, args, yes, dryRun, signal) {
  const argv = [APOLLO_ENV_SCRIPT, ...command.split(/\s+/).filter(Boolean)]
  if (target) argv.push('--target', target)
  if (args) argv.push(...args.split(/\s+/).filter(Boolean))
  if (yes) argv.push('--yes')
  if (dryRun) argv.push('--dry-run')
  try {
    const { stdout, stderr } = await execFileAsync('bash', argv, {
      timeout: EXEC_TIMEOUT_MS,
      signal,
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    return { command, ok: true, exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (error) {
    if (signal?.aborted) throw error
    const code = error.code
    return {
      command,
      ok: false,
      exitCode: typeof code === 'number' ? code : -1,
      stdout: typeof error.stdout === 'string' ? error.stdout.trim() : '',
      stderr: `${typeof error.stderr === 'string' ? error.stderr.trim() : ''}${error.message ? `\n[error] ${error.message}` : ''}`.trim(),
    }
  }
}

export function apply(ctx) {
  const tool = {
    name: 'apollo_ops_expert',
    description: [
      'Apollo 运维专家 (Apollo Ops Expert): run an Apollo environment/vehicle operation',
      'through the apollo-env dispatcher. Use for vehicle config switch/restore/rollback/',
      'baseline, environment check, install/diagnose, and GNSS/lidar/camera configuration.',
      'Each command is routed to the matching apollo-* skill script. Pass command "help"',
      'to list all subcommands.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: "Subcommand to run, e.g. 'check', 'targets', 'restore', 'rollback', 'baseline list', 'gnss check', 'lidar list', 'camera add', 'clean' (clean storage: records/core/non-.INFO logs — run with dryRun first, then yes). Pass 'help' to list all.",
        },
        target: {
          type: 'string',
          description: 'Vehicle/engineering target ID (e.g. ARCF_40P, HQEV, HQEV_BDN).',
        },
        args: {
          type: 'string',
          description: 'Extra arguments passed through verbatim (e.g. "--model RS-Helios-16P").',
        },
        yes: {
          type: 'boolean',
          description: 'Pass --yes to skip the second confirmation prompt.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Pass --dry-run to preview changes without applying them.',
        },
      },
      required: ['command'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
          ok: { type: 'boolean' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
        required: ['command', 'ok', 'exitCode', 'stdout', 'stderr'],
      },
      render(_args, value) {
        const parts = [value.stdout || '']
        if (value.stderr) parts.push(`\n[stderr]\n${value.stderr}`)
        const text = parts.join('\n').trim()
        return [{ type: 'text', text: text || `(exit ${value.exitCode}, no output)` }]
      },
    },
    async execute(args, exec) {
      const command = typeof args.command === 'string' ? args.command.trim() : ''
      if (command === '') throw new Error('apollo_ops_expert: "command" is required')
      return runCommand(
        command,
        typeof args.target === 'string' && args.target !== '' ? args.target : undefined,
        typeof args.args === 'string' && args.args !== '' ? args.args : undefined,
        args.yes === true,
        args.dryRun === true,
        exec.signal,
      )
    },
  }
  ctx.tools.register(tool)
}
