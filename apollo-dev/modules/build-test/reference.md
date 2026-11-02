# Apollo 构建体系参考

配套 `SKILL.md`。本文只放长知识：宏签名与选择规则、bazel 配置项、目录说明、CI。
所有 `file:line` 相对仓库根。

## 1. Bazel 宏全集（`tools/apollo_package.bzl`，744 行）

原生 `cc_library` / `cc_binary` / `cc_test` **被禁用**（`scripts/apollo_rule_check.sh:52-64`
用 buildozer 扫描，命中即 CI 红），必须用下面这些。

### 1.1 选择规则（先看这张表）

| 你要做的东西 | 用哪个宏 | name 约束 | 产物 |
|---|---|---|---|
| 普通 C++ 库（给别的 target 依赖） | `apollo_cc_library` | 任意，如 `apollo_control_lib` | `lib<name>.so` + `alwayslink=True` 的同名 wrapper `cc_library` |
| 可执行程序 | `apollo_cc_binary` | 任意 | 可执行文件 |
| 单元测试 | `apollo_cc_test` | 惯例 `*_test` | test 可执行 |
| cyber 组件（被 dag 加载） | `apollo_component` | **必须 `lib*.so`** | `<name>` 的 `.so`，内部库名前缀 `DO_NOT_IMPORT_` |
| cyber 插件（planning task、control controller、traffic rule 等） | `apollo_plugin` | **必须 `lib*.so`**，且必须给 `description` | `<name>` 的 `.so` + 内部 `<stem>_lib` cc_library + plugin 索引 |
| Qt 界面库（如 visualizer） | `apollo_qt_library` | 任意 | 含 moc/uic/rcc 预处理 |
| proto | `proto_library`（Apollo 重写版） | **必须以 `proto` 结尾** | 一次展开 6~7 个 target，含 `<name>_cc_proto` |
| Python 库/程序 | `apollo_py_library` / `apollo_py_binary` | 任意 | — |
| GPU（cuda/hip）源码 | `gpu_library` / `cuda_library` | 任意 | — |
| **每个 BUILD 文件末尾** | `apollo_package()` | — | 自动生成 install / install_src 规则 |
| C++ BUILD 文件末尾 | `cpplint()` | — | 每个 rule 生成 `<name>_cpplint` py_test，tag = `cpplint` |

### 1.2 逐个签名与展开语义

**`apollo_cc_library(**kwargs)`** — `tools/apollo_package.bzl:602-645`
接受原生 `cc_library` 的全部属性。展开成两个 target：
1. `cc_binary(name = "lib<name>.so", linkshared = True, linkstatic = True, srcs = srcs + hdrs,
   tags = ["export_library", <name>])`（`:640-643`）
2. `cc_library(name = <name>, srcs = [":lib<name>.so"], alwayslink = True)`（`:644-645`）

含义：**真正的代码在 `.so` 里，你依赖的 `<name>` 只是个 alwayslink 壳。**
传入的 `alwayslink` 会被丢弃（`:637-638`），因为 wrapper 恒为 `alwayslink=True`。
`hdrs` 与 `*include_prefix` 不会传给 cc_binary（`:605-609`）。
实例：`modules/control/control_component/BUILD:8-9`（`apollo_control_lib`）、
`modules/planning/planning_base/BUILD:17-18`（`apollo_planning_planning_base`）。

**`apollo_cc_binary(**kwargs)`** — `:579-581`，仅 `dynamic_fill_deps` 后转发 `cc_binary`。
**`apollo_cc_test(**kwargs)`** — `:575-577`，仅 `dynamic_fill_deps` 后转发 `cc_test`。
实例：`cyber/common/BUILD:36-45`（`file_test`，`size = "small"`）、
`modules/control/control_component/BUILD:56-66`。

**`apollo_component(**kwargs)`** — `:583-600`
- `name` 不是 `lib*.so` → `fail("name must start with 'lib' and end with '.so'")`（`:584-585`）
- 传了 `alwayslink` → `fail("'apollo_component' macro has not 'alwayslink' attribute")`（`:586-587`）
- 展开：先 `apollo_cc_library(name = "DO_NOT_IMPORT_<stem>")`（前缀常量 `:24`），
  再 `cc_binary(name = <name>, linkshared, linkstatic, deps = [":DO_NOT_IMPORT_<stem>"])`（`:594-599`）
- **想在单测里链 component 的实现，deps 只能写 `"DO_NOT_IMPORT_<stem>"` 并配 `linkstatic = True`**
  （`modules/planning/planning_component/BUILD:45,47`、`modules/control/control_component/BUILD:62`）

**`apollo_plugin(**kwargs)`** — `:647-678`
- 缺 `description` → `fail("missing attribution of 'description'")`（`:648-649`）
- 缺 `name` → fail（`:650-651`）；name 非 `lib*.so` → fail（`:652-653`）
- 展开三个：`cyber_plugin_description(name = "plugin_<stem>_lib_description", ...)`（`:657-661`，
  rule 定义在 `tools/apollo.bzl:15-21`，把 `plugins.xml` 路径写进 `bazel-bin/cyber_plugin_index/`）；
  `cc_library(name = "<stem>_lib", alwayslink = True)`（`:665-673`）；
  `cc_binary(name = <name>, linkshared, linkstatic, deps = [":<stem>_lib"])`（`:675-677`）
- 完整范例（照抄这个写新插件）：`modules/planning/tasks/lane_follow_path/BUILD:13-25`，
  配套 `plugins.xml` 一行 `<library path="...">` + `<class type="..." base_class="...">`。

**`apollo_package(enable_source = True)`** — `:234-337`
遍历 `native.existing_rules()`，给每个非 testonly 的 rule 生成 `_install_<name>` 动作，
汇总成本包的 `install` / `install_src` target，并把子包的同名 target 串进来（`:245-251`）。
**因此它必须写在 BUILD 的最后**（`cpplint()` 可在其后，它自己也遍历 existing_rules）。
漏写的后果：`apollo.sh release` / `build_pkg` 里这个包没有任何产物，且**没有任何报错**。

**`apollo_deps_library(**kwargs)`** — `:558-573`，包管理模式用；deps 里若某包在 `SOURCE` 中，
把 `@pkg//:a_S_b_C_c` 形式重写回 `@//a/b:c`。源码模式基本不会手写。

**`apollo_qt_library(name, srcs, hdrs, data, copts, uis, res, normal_hdrs, deps, **kwargs)`**
— `:689-744`。全仓主要用户是 `modules/tools/visualizer`。

**`proto_library(tags = [], **kwargs)`** — `tools/proto/proto.bzl:116-281`，**同名覆盖原生规则**。
name 不以 `proto` 结尾 → `fail(...)`（`:120-121`）。一次展开出 `<name>`、`<name>_cc_proto`、
py proto 等 6~7 个 target。**BUILD 里必须 `load("//tools/proto:proto.bzl", "proto_library")`**，
否则 deps 写 `:xxx_cc_proto` 会报 `no such target`。

**`cpplint(data = None, extra_srcs = None)`** — `tools/cpplint.bzl:57-94`，
为当前 BUILD 已声明 rule 的 srcs/hdrs 各生成一个 tag 为 `cpplint` 的 py_test（`:43-55`），
默认配置 `//tools:CPPLINT.cfg`（`:46`）。

**`gpu_library(mandatory = True, copts = [], **kwargs)` / `cuda_library(**kwargs)`**
— `third_party/gpus/common.bzl:66-73`。

**install 家族** — `tools/install/install.bzl`：`install`（`:496`）、`install_files`（`:602`）、
`install_src_files`（`:719`）、`_install_plugin_description_code`（`:728`）。
两个 src 装到同一 dst 会 `fail("Warning: Install conflict detected: ...")`（`:384-387`）。

**`cc_so_proto_library(name, ...)`** — `tools/cc_so_proto_rules.bzl:4-61`，全仓仅 1 处使用。

## 2. bazel 配置

### 2.1 `.bazelrc`（根，7 行，只做转发）
```
try-import %workspace%/tools/bazel.rc        # 提交进仓库的静态配置
try-import %workspace%/.apollo.bazelrc       # tools/bootstrap.py 生成，apollo.sh:99 每次重写
try-import %workspace%/.custom.bazelrc       # 本地定制写这里，不会被覆盖
```
`.bazelignore` 只有两行：`.cache`、`docker/build`。

### 2.2 `tools/bazel.rc` 关键项（146 行）

| 行 | 配置 | 影响 |
|---|---|---|
| `:27` | `build --spawn_strategy=standalone` | 源码模式用 standalone 提速；`build_pkg` 会改成 sandboxed，`site_restore()` 改回来 |
| `:37` | `--per_file_copt=external/upb/.*@-Wno-sign-compare` | 屏蔽 upb 警告 |
| `:39-43` | `-Werror=return-type` / `-Werror=unused-but-set-variable` / `-Werror=switch` / `-Werror=reorder` | **这 4 类 warning 是编译错误**，必须真改代码 |
| `:46-49` | `--define=PREFIX=/usr` 等 + `use_fast_cpp_protos=true` | 系统库路径与 proto 实现 |
| `:52-53` | `--define NVIDIA=0` / `AMD=1` | GPU 平台默认值 |
| `:56-57` | `build:dbg -c dbg` / `build:opt -c opt` | `--config=dbg` / `opt` |
| `:65` | `build:cpu --verbose_failures` | CPU 模式自带 verbose |
| `:67` | `build:gpu --config=nvidia` | **`--config=gpu` 等价 `--config=nvidia`** |
| `:70-79` | `build:amd` / `build:nvidia` 的 `-DGPU_PLATFORM` `-DUSE_GPU=1` 等 | 条件编译宏 |
| `:82-83` | `build:prof --linkopt=-lprofiler -DENABLE_PERF=1` | `build_prof` |
| `:90-91` | `--cxxopt=-std=c++14`（host 同） | **C++14**；另有 `build:c++17`（`:86`） |
| `:99` | `test --flaky_test_attempts=3` | 掩盖偶发失败 |
| `:100` | `test --test_size_filters=small,medium` | **large/enormous 默认不跑** |
| `:104` | `test --test_output=errors` | 只打失败输出 |
| `:105` | `test:unit_test --test_verbose_timeout_warnings` | — |
| `:133-136` | `test:cpplint --test_tag_filters=cpplint --build_tests_only --test_timeout=3600 --flaky_test_attempts=1` | cpplint 独立 config |
| `:138` | `test:unit_test --test_tag_filters=-cpplint` | 单测排除 cpplint |
| `:110-121` | coverage 相关（`--instrument_test_targets`、`--combined_report=lcov`、`--coverage` 系 cxxopt、`-lgcov`） | `apollo.sh coverage` |
| `:140` | `coverage --test_tag_filters=-cpplint` | — |

### 2.3 `apollo.sh` 自动追加的 bazel 参数（`scripts/apollo_base.sh:690-763`）

- 目标：`determine_targets`（`:620-649`）→ 无参数 `//modules/... union //cyber/...`；
  `cyber` → `//cyber/... union //modules/tools/visualizer/...`；否则 `//modules/<component>/...`。
- 自动排除（`determine_disabled_targets`，`:584-617` + `_determine_*`，`:551-583`）：
  CPU 模式排除 `//modules/perception/...`（`:562`）与 `//modules/planning/planning_open_space:planning_block`（`:579-580`）；
  AMD 排除 `.../inference/tensorrt/...`，NVIDIA 排除 `.../inference/migraphx/...`（`:563-566`）；
  非 x86_64 排除 `//modules/localization/msf/...`（`:571-574`）；
  `CUSTOM_DISABLED_TARGETS` 追加（`:585-590`）。
- job 参数（`:755-760`）：x86_64 → `--copt=-mavx2 --host_copt=-mavx2 --jobs=$(nproc)
  --local_ram_resources=HOST_RAM*0.7`；aarch64 → `--copt=-march=native ... --copt=-fPIC`。
  `CUSTOM_JOB_ARGS` 整体覆盖（`:751-753`）。
- 5 组 cpu/gpu/nvidia/amd 互斥检查，命中即 `exit 1`（`:437-460`）。
- 最终 `bazel ${1,,} ${CMDLINE_OPTIONS} ${job_args} -- ${formatted_targets}`（`:762`），
  外面包着 `set -x`（`:760`）/ `set +x`（`:763`）——**想知道到底跑了什么，看这一行输出**。
- Test 模式额外追加 `--action_env APOLLO_CONF_PATH=...`（`:761`）。
- Overview 打印 `USE_GPU` / `GPU arch` / `Bazel Options` / `Targets` / `Disabled`（`:734-749`）。
- bazel 最低版本 2.0.0（`tools/bootstrap.py:64`）。

## 3. `tools/`（bazel 扩展规则目录，与 `modules/tools` 完全无关）

`ls tools/` = 5 个子目录 `install/ package/ platform/ proto/ ros/` + 13 个文件。

| 文件 | 作用 |
|---|---|
| `tools/apollo_package.bzl` | 核心，全部 `apollo_*` 宏（见 §1） |
| `tools/apollo.bzl` | 仅 `cyber_plugin_description` rule（`:15-21`），写 `cyber_plugin_index/` |
| `tools/proto/proto.bzl` | 重写 `proto_library`（`:116`）+ `apollo_py_library`（`:9`）/ `apollo_py_binary`（`:18`） |
| `tools/proto/proto.bzl.tpl` | 上者的模板，`site_restore()` 从这里恢复（`scripts/apollo_base.sh:56`） |
| `tools/install/install.bzl` | `install` / `install_files` / `install_src_files` 四个 rule |
| `tools/install/install.py.in` | 安装脚本模板：strip 符号、patchelf 修 rpath、生成 `share/packages/<pkg>/cyberfile.xml` |
| `tools/cpplint.bzl` | `cpplint()` 宏（`:57`） |
| `tools/python_rules.bzl` | `py_proto_library` / `py_grpc_library` |
| `tools/common.bzl` | 路径工具 `clean_dep` / `join_paths` / `output_path` 等 |
| `tools/cc_so_proto_rules.bzl` | `cc_so_proto_library`（`:4`） |
| `tools/platform/build_defs.bzl` | `if_gpu` / `if_teleop` / `if_x86_64` / `if_esd_can` / `if_profiler` |
| `tools/platform/BUILD` | 6 个 `config_setting`（`use_gpu` / `use_esd_can` / `with_teleop` 等） |
| `tools/bazel.rc` | 静态 bazel 配置（见 §2.2） |
| `tools/bootstrap.py` | `apollo.sh config` 调用，产出 `.apollo.bazelrc`（`:61`、`:343 reset_apollo_bazelrc`） |
| `tools/workspace.bzl` | `apollo_repositories()`（`:93`）→ `initialize_third_party()`（`:50`） |
| `tools/package/dynamic_deps.bzl` | 3 行模式开关：`STATUS` / `SOURCE` / `BINARY` |
| `tools/package/rules_cc.patch` | 源码模式被清空；`rules_cc.release.patch` 是包管理模式的真补丁 |
| `tools/header.BUILD`、`tools/proto/common_msgs_header.BUILD` | 「整包头文件」cc_library 模板 |
| `tools/cyberfile.xml` | 包名 `bazel-extend-tools`，`<type>module-wrapper</type>` |
| `tools/ros/ros_configure.bzl` | ROS 集成探测，**未被 `workspace.bzl` 调用**，预留能力 |

`third_party/` 下有 4 个软链指向 `/opt/apollo/neo/packages/...`（`bazel_skylib`、`grpc`、
`rules_proto`、`rules_python`），**宿主机上是断链，grep 报错属正常**。

## 4. `scripts/`（123 个文件）

构建相关（`apollo.sh` 的实际执行体，`apollo.sh:174-180` 定义变量、`:185-294` case 分发）：

| 脚本 | 被谁调 | 作用 |
|---|---|---|
| `scripts/apollo_base.sh` | 所有 | `site_restore`（`:53-73`）、`parse_cmdline_arguments`（`:473`）、`determine_targets`（`:620`）、`determine_disabled_targets`（`:584`）、`run_bazel`（`:690-763`）、模块 start/stop（`:224`、`:292`） |
| `scripts/apollo.bashrc` | 所有 | 环境变量：`APOLLO_CONF_PATH`/`APOLLO_FLAG_PATH`（`:36-37`）、`APOLLO_DISTRIBUTION_HOME=/apollo`（`:42`）、`APOLLO_PLUGIN_INDEX_PATH`（`:43`）、`APOLLO_PLUGIN_LIB_PATH`（`:46`，含 `bazel-bin`） |
| `scripts/apollo_build.sh` | `build*` | `site_restore` → `parse_cmdline_arguments` → `run_bazel "Build"`（`:24-32`） |
| `scripts/apollo_test.sh` | `test` | 同结构，`run_bazel "Test"`（`:25-31`） |
| `scripts/apollo_coverage.sh` | `coverage` | 覆盖率；jobs 取 `nproc/2`（`scripts/apollo_base.sh:728`） |
| `scripts/apollo_build_pkg.sh` | `build_pkg*` | 装 buildtool（`:260`）、改 5 个文件、最终 `buildtool build ... -p <targets>`（`:266`） |
| `scripts/apollo_lint.sh` | `lint` | cpp/py/sh 三种；`main()` 在 `:154-171`，副作用见 SKILL §6 |
| `scripts/apollo_format.sh` | `format` | 按扩展名分派 clang-format / yapf / buildifier / shfmt / prettier（`:70-104`） |
| `scripts/apollo_buildify.sh` | `buildify` | 全仓 BUILD/`*.bzl` buildifier -lint=fix |
| `scripts/apollo_rule_check.sh` | 手动 / CI | buildozer 扫原生 cc 规则（`:52-64`） |
| `scripts/apollo_clean.sh` | `clean` | `--bazel` / `--core` / `--log` / `-a` / `--expunge`（`:73-77`、`:91-104`） |
| `scripts/apollo_config.sh` | `config` | 转发 `tools/bootstrap.py`；`--clean` 删 `.apollo.bazelrc`（`:47`） |
| `scripts/apollo_release.sh` | `release` | 发布到 `<prefix>`，默认 `$APOLLO_DISTRIBUTION_HOME` = `/apollo` |
| `scripts/apollo_ci.sh` | CI | 见 §5 |
| `scripts/find_all_package.py` | `build_pkg` | 递归找含 `cyberfile.xml` 的目录（`:29-41`）= 包管理模式全量目标 |
| `scripts/clang_format.sh` / `yapf.sh` / `shfmt.sh` / `buildifier.sh` / `mdfmt.sh` | `format` | 单语言格式化封装 |

另有约 40 个模块级启动脚本（`planning.sh`、`control.sh`、`perception.sh`、`bootstrap.sh` 等），
底层都是 `nohup cyber_launch start modules/<path>/launch/<name>.launch &`（`apollo_base.sh:216-238`）。

## 5. CI 流程

- **无 GitHub Actions**：`.github/` 只有 3 个 issue 模板（`bug_report.md` / `feature_request.md` / `issues.md`）。
- **厂内流水线**：根 `ci.yml`，两个 profile（`change` 用于 PR、`merge` 用于合入），
  命令都是 `bash scripts/apollo_ci.sh build`，`artifacts.release: true`，
  cluster `DECK_CENTOS7U5_K3`。
- **TeamCity**：`.teamcity/run_ci.sh` 在宿主机拉 dev 镜像、挂载仓库、一次性容器内执行
  `/apollo/scripts/apollo_ci.sh`（无参数 = 全跑）。增量覆盖率 `.teamcity/coverage_diff.py`、
  `.teamcity/coverage_lines.py`；PR 交互 `.teamcity/pull_request.py`。
- `scripts/apollo_ci.sh`（`:32-67`）三个子命令：
  - `lint` → `apollo_lint.sh --cpp`（`:42-44`）
  - `build` → **不是编译**，而是把仓库（排除 `output`、`.git*`、`.cache`）复制到 `output/`（`:32-37`）
  - `test` → `apollo_test.sh --config=unit_test`（`:38-40`）
  - 无参数 → lint → build → test（`:50-53`）

### 提交前建议序列

```bash
./apollo.sh format -a <改动目录>
./apollo.sh buildify
bash scripts/apollo_rule_check.sh
./apollo.sh build <module>
./apollo.sh test <module>
./apollo.sh lint --cpp
git status --short          # 确认没有意外改动 WORKSPACE / tools/
```
或 `./apollo.sh check`（= build + test + `lint --cpp`，`apollo.sh:109-114`，**不含 py/sh lint**）。

## 6. `apollo.sh` 子命令全集（`apollo.sh:185-294`）

`config` `build` `build_dbg` `build_opt` `build_cpu` `build_gpu` `build_nvidia` `build_amd`
`build_opt_gpu` `build_opt_nvidia` `build_opt_amd` `build_pnc`（固定 `cyber planning prediction
control routing dreamview external_command tools common_msgs`，dbg+gpu，`:216-218`）
`build_opt_gpu_pnc`（同列表 opt+gpu，`:213-215`）`build_pkg` `build_pkg_dbg` `build_pkg_opt`
`build_pkg_opt_gpu` `build_prof`（`--config=prof`）`build_teleop`（`--config=teleop`）
`build_fe`（dreamview 前端 `yarn build`，`:243-245`）`test` `coverage`
`cibuild` `citest` `cilint` `check` `buildify` `lint` `clean` `release` `install_dv_plugins`
`doc` `format` `usage` / `-h` / `--help`。
无法识别的命令走 `_check_command`（`:291-293`），由 `scripts/command_checker.py` 做拼写提示。

## 7. `cyberfile.xml`（全仓 241 个，不含 third_party）

**不参与源码模式的 bazel 编译**，但有四个用途：
1. 标记「这是一个可发布包」——`scripts/find_all_package.py:29-41` 递归找它，输出即 `build_pkg`
   的全量目标（`scripts/apollo_build_pkg.sh:68`）。**没有它的目录不会被 buildtool 编译，且无报错。**
2. 声明包依赖，供 buildtool 解析安装顺序与 apt 依赖。标签语义：
   `<depend so_names="..." repo_name="..." >apt包名</depend>`、`<depend expose="False">`（不传递）、
   `<depend type="binary" repo_name="..." lib_names="...">`（用预编译二进制包）。
3. `<type>` 决定打包形态：`module` / `module-wrapper` / `third-binary` / `third-wrapper`。
4. 随包安装：`apollo_package()` 把它装到 `<prefix>/<package_name>`，install 脚本再复制到
   `<prefix>/share/packages/<pkg>/cyberfile.xml`，运行时包索引靠这个目录。

`<src_path>` 给出 bazel 包路径，install 脚本用它反推 `include/` `lib/` `src/` `share/` 子路径。
最小可用范例（8 行有效内容）：`modules/planning/tasks/lane_follow_path/cyberfile.xml` ——
`<name>planning-task-lane-follow-path</name>`、`<type>module</type>`、
`<src_path>//modules/planning/tasks/lane_follow_path</src_path>`、`<builder>bazel</builder>`、
`<depend>bazel-extend-tools</depend>` + 一条 `type="binary"` 的上游依赖。

## 8. BUILD 文件硬性契约汇总

| 规则 | 检查手段 | 违反后果 |
|---|---|---|
| 不得用原生 `cc_library`/`cc_binary`/`cc_test` | `scripts/apollo_rule_check.sh:52-64` | CI 红，报 `bazel native cc rule detected in <pkg>/BUILD` |
| C++ BUILD 结尾必须有 `cpplint()` | `scripts/apollo_lint.sh:42-53` 自动补并改工作区 | `git status` 出现意外改动 |
| `apollo_package()` 必须在所有 target 之后 | 无显式检查，依赖 `native.existing_rules()` 求值顺序 | 产物静默缺失 |
| `apollo_component` / `apollo_plugin` name 必须 `lib*.so` | `tools/apollo_package.bzl:584-585`、`:652-653` | 加载阶段 fail |
| `apollo_component` 不得传 `alwayslink` | `:586-587` | fail |
| `apollo_plugin` 必须有 `description` | `:648-649` | fail |
| `proto_library` name 必须以 `proto` 结尾 | `tools/proto/proto.bzl:120-121` | fail |
| 新包必须有 `cyberfile.xml` | 无检查 | `build_pkg` 静默漏编 |

