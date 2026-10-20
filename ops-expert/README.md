# Apollo Ops Expert：公网 npm 插件 + GitHub skills/预设

这个目录是从原 `/apollo_workspace/packaging` 拆出的新分发方案。**原目录和原归档 `/apollo_workspace/ops-Expert.tar.gz` 不修改**。

## 当前发布状态（已验证）

```
npm 包名  @apollo-ops/dsh-client-ui-apollo-ops
已发布    1.0.3   （dist-tags.latest = 1.0.3）
tarball   https://registry.npmjs.org/@apollo-ops/dsh-client-ui-apollo-ops/-/dsh-client-ui-apollo-ops-1.0.3.tgz
sha1      c0efe78956d4d7fc160b17a88c18b507f9c6fde5
文件数    36 ／ 解包 1.0 MB
```

已实测：在全新 `DSH_HOME` 执行 `dsh plugin --profile web add @apollo-ops/dsh-client-ui-apollo-ops@1.0.3`
可成功安装，并被 profile 组合树以 `ui-apollo-ops` 正常加载。

> registry 的 `versions` 里还会看到一个 `0.0.0-stage`，那是 npm 对「新包首发」自动创建的占位版本，
> 不影响安装（`latest` 指向 1.0.3），无需处理。

## 分发结构

- `plugin/`：可发布到公网 npm 的 UI 插件本体。
- `github-assets/`：放进 GitHub 仓库的资源：21 个 skills 压缩包、两个预设及预设安装脚本。
- `install.sh`：新机器一键安装 npm 插件 + GitHub skills + 两个预设。
- `publish-plugin.sh`：发布 `plugin/` 到 npmjs.org。

## 第一次发布插件到公网 npm

先把 `plugin/package.json` 的包名改成你自己的 npm scope。例如 npm 用户名是 `apollo-ops`，则使用：

```json
"name": "@apollo-ops/dsh-client-ui-apollo-ops",
"version": "1.0.3"
```

`@deepseek-ai` 不是你的 scope，不能直接发布。

登录 npm 并发布：

```bash
cd /apollo_workspace/apolloopuexpert
npm login --registry=https://registry.npmjs.org/
npm whoami
PUBLISH_CONFIRM=YES ./publish-plugin.sh
```

发布前脚本会先运行 `npm pack --dry-run`，确认包内容后才真正发布。npm 的同一版本不可覆盖；以后更新插件必须递增版本号，例如 `1.0.4`、`1.1.0`。

## 把 skills 和预设放到 GitHub

### ⚠️ 先注意目录位置

本目录位于 `/apollo_workspace` 内，而 `/apollo_workspace` 是一个指向
`ApolloAuto/application-core` 的 git 仓库。**不要在这里 `git init`**（会形成嵌套仓库），
也**不要**试图提交到那个官方仓库。

正确做法：把目录复制到工作区外，在那里单独建仓库。已经准备好一份：

```text
~/apollo-ops-dist          ← 已 git init 并完成首次提交
```

更新后重新同步（覆盖过去，再提交）：

```bash
rsync -a --delete --exclude '.git' /apollo_workspace/apolloopuexpert/ ~/apollo-ops-dist/
cd ~/apollo-ops-dist && git add -A && git commit -m "sync from packaging"
```

（`/apollo_workspace/.git/info/exclude` 里已加入 `apolloopuexpert/`，本地 git 会忽略它，不会误提交到 Apollo 仓库。）

### 创建仓库并推送

创建 GitHub 仓库，例如：

```text
https://github.com/apollo-ops/apollo-ops
```

```bash
cd ~/apollo-ops-dist
git remote add origin https://github.com/apollo-ops/apollo-ops.git
git branch -M main
git push -u origin main
```

### 63MB 的 skills 包：建议改用 Releases

`github-assets/apollo-skills-envdev-*.tar.gz` 约 63MB（GitHub 单文件上限 100MB，能推）。
但**每次更新都提交一个新 63MB 包，仓库历史会迅速膨胀**。更推荐把 skills 包放到
GitHub **Releases**，仓库里只留安装脚本和预设：

1. Releases → Draft a new release → 上传 `apollo-skills-envdev-*.tar.gz`
2. 把 `github-assets/release.env` 的 `SKILLS_ARCHIVE` 改成完整 URL：

```text
SKILLS_ARCHIVE=https://github.com/apollo-ops/apollo-ops/releases/latest/download/apollo-skills-envdev-0.1.3-alpha.1.tar.gz
```

`install.sh` 已支持 `SKILLS_ARCHIVE` 写完整 URL（也支持纯文件名走 raw），两种都行。
这样以后换 skills 版本只需重传 Release 附件，仓库保持很小。

把 `github-assets/` 目录中的内容提交到仓库 `main` 分支：

```bash
cd /apollo_workspace/apolloopuexpert
git init
git add github-assets install.sh README.md
 git commit -m "发布 Apollo Ops skills 和 presets"
git branch -M main
git remote add origin https://github.com/apollo-ops/apollo-ops.git
git push -u origin main
```

如果这个目录最终单独作为 GitHub 仓库根目录，建议把 `github-assets/` 里面的内容移动到仓库根目录，并相应调整 `--github-raw` 地址；当前 `install.sh` 预期的 raw 根目录是 GitHub 仓库里的 `github-assets/`。

对应 raw 地址示例：

```text
https://raw.githubusercontent.com/apollo-ops/apollo-ops/main/github-assets
```

## 资源放哪里：两种来源，任选其一

`install.sh` 支持两种资源来源，功能完全等价（都已实测）：

| 方式 | 参数 | 你把什么放上网 | 适合 |
|---|---|---|---|
| 目录形态 | `--github-raw <URL>` | `github-assets/` 整个目录（`release.env` + `presets-only/` + skills 包） | GitHub 仓库、任意 HTTP 目录 |
| 单文件 | `--assets-tarball <URL>` | 一个 `apollo-ops-assets-*.tar.gz` | 阿里云 OSS / S3 / 任意对象存储 |

单文件模式用 `./pack-assets.sh` 生成（含 skills 约 63MB）：

```bash
./pack-assets.sh            # 生成 dist/apollo-ops-assets-<版本>.tar.gz
./pack-assets.sh --no-skills # 只要几 KB（skills 走 release.env 里的完整 URL）
```

然后把那个 tar.gz 传到任意**公网可读**的地址即可（OSS/S3/nginx 都行，只要是直链）。

## 新环境一键安装

目标机器需要先安装 DSH、Node.js、pnpm、curl、tar：

```bash
npm install -g @deepseek-ai/dsh pnpm
```

然后用下面任一条命令安装（二选一）：

```bash
# 方式 A：资源在 GitHub / HTTP 目录
bash install.sh \
  --npm-package @apollo-ops/dsh-client-ui-apollo-ops \
  --github-raw https://raw.githubusercontent.com/<你的GitHub用户名>/apollo-ops-expert/main/github-assets

# 方式 B：资源是云端一个 tar.gz
bash install.sh \
  --npm-package @apollo-ops/dsh-client-ui-apollo-ops \
  --assets-tarball https://你的存储地址/apollo-ops-assets-0.1.3-alpha.1.tar.gz
```

指定默认运维预设：

```bash
bash install.sh \
  --npm-package @apollo-ops/dsh-client-ui-apollo-ops \
  --github-raw https://raw.githubusercontent.com/apollo-ops/apollo-ops/main/github-assets \
  --default apollo-env
```

安装过程会自动完成：

1. 用 `dsh plugin --profile web add` 从公网 npm 安装 UI 插件。
2. 从 GitHub Raw 下载 21 个 skills 到 `$DSH_HOME/skills`。
3. 从 GitHub Raw 下载两个预设和安装脚本。
4. 自动接线 `cordis.patch.yml`。
5. 自动生成运维 8 个 / 开发 13 个 skill 作用域视图。
6. 标准模式仍然可以读取全部 21 个 skill。

完成后重启：

```bash
dsh web
```

## 更新方式

### 更新插件

修改 `plugin/` 后递增 `plugin/package.json` 的版本号，再发布：

```bash
PUBLISH_CONFIRM=YES ./publish-plugin.sh
```

目标机器更新：

```bash
dsh plugin --profile web add @apollo-ops/dsh-client-ui-apollo-ops@1.0.4
```

### 更新 skills

重新生成 `github-assets/` 里的 skills tar，提交 GitHub。为了避免缓存，建议改文件名版本，例如：

```text
apollo-skills-envdev-0.1.4.tar.gz
```

推荐用 `sync-from-packaging.sh` 同步：它会自动更新 `github-assets/release.env` 里的 `SKILLS_ARCHIVE`，`install.sh` 每次安装都会先读这个清单，所以**不需要**改 `install.sh` 的代码。

### 更新预设

修改原 `packaging/presets-only/`（或直接改 `github-assets/presets-only/`），提交 GitHub 后重新执行 `install.sh` 即可。预设安装脚本会备份旧预设、重建 skill 作用域视图，并重新接线 profile。

## 后续更新：一条命令从原包同步

以后你在原 `packaging/` 里更新了插件/skills/预设，运行一次同步脚本即可，不用手动拷贝：

```bash
cd /apollo_workspace/apolloopuexpert
# 默认同步为 @apollo-ops/... @1.0.3；发正式版前用真实 scope 和新版本号：
NPM_SCOPE=@apollo-ops PLUGIN_VERSION=1.0.4 ./sync-from-packaging.sh
```

它自动完成：

- 用原 `packaging/` 最新的插件 tgz 重建 `plugin/`，并把包名/版本改写为你的 scope（含 `cordis.patch.yml` 与 lib 内的插件身份字符串）；
- 拷贝最新 skills tar 到 `github-assets/`，并重新生成 `github-assets/release.env`；
- 同步 `presets-only/`（两个预设 + `install-presets.sh`）。

然后按“第一次发布插件到公网 npm”和“把 skills 和预设放到 GitHub”两节操作即可。

## 与原完整包的关系

原完整包仍然保留在：

```text
/apollo_workspace/ops-Expert.tar.gz
```

本目录是新的“公网 npm + GitHub”拆分方案，不会修改原包。原包仍适合离线/内网完整迁移；本目录适合公网按组件更新。

注意：`install.sh` 默认不安装 `dsh-lan-access`，因为它会绑定 `0.0.0.0` 并关闭认证。需要该补丁时，继续使用原完整包的 `packaging/deploy.sh --with-lan`，并确保网络环境可信。
