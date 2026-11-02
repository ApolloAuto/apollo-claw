# 01 新增 TrafficRule（11.0 本机可执行全流程）

<!--
file: references/manual/15_二次开发手册/01_新增TrafficRule.md
scope: 11.0（默认，包工作区实测）。EDU 版（application-pnc）口径见 ../pnc_赛事版/01_赛事版开发口径速查.md，勿混
tags: TrafficRule, buildtool create, planning_traffic_rule, 六件套, plugins.xml, base_class, apollo_plugin, alwayslink, default_conf.pb.txt, traffic_rule_config.pb.txt, cyber_plugin_index, profiles/current, ApplyRule, LoadConfig
sources:
- /opt/apollo/neo/src/modules/planning/traffic_rules/region_speed_limit/{region_speed_limit.h(56行),region_speed_limit.cc(112行),BUILD(29行),cyberfile.xml(16行),plugins.xml(3行),conf/default_conf.pb.txt(8行),proto/region_speed_limit.proto(25行),proto/BUILD(11行)}（全部 read 全文）
- /opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/core/action/create.py（240–299 read；1480–1580 sed 核对）
- /opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/data/templates/template_planning_traffic_rule/*（cat 全部模板）
- references/manual/12_planning源码/07_traffic_rule框架.md（框架事实与行号结论，直接引用）
- references/manual/00_versions/01_命令与词汇对照.md
-->

## 0. 一句话作用

本文是**在本机 11.0 包工作区从零加一个 TrafficRule 插件并让它真正生效**的操作手册：模板命令原文 →
样板包六件套核对表 → 逐步命令/编辑序列 → 失败症状表 → 验证。框架机制（谁调 `ApplyRule`、
清单顺序语义、conf 路径解析）不重复，见 [`../12_planning源码/07_traffic_rule框架.md`](../12_planning源码/07_traffic_rule框架.md)。

## 1. 关键符号与文件

| 对象 | 位置（层） | 已核 | 说明 |
|---|---|---|---|
| 顶层基类 `TrafficRule` | `/opt/apollo/neo/include/modules/planning/planning_interface_base/traffic_rules_base/traffic_rule.h`（②′，src 侧只有 proto） | 07 篇 §1 | `Init`/`ApplyRule`(纯虚)/`Reset`(纯虚) + `LoadConfig<T>` |
| 样板包（本文对照物） | `/opt/apollo/neo/src/modules/planning/traffic_rules/region_speed_limit/`（②） | 全 8 文件 read | 本车新增件，八文件齐全 |
| 同包的可改副本 | `/apollo_workspace/modules/planning/traffic_rules/region_speed_limit/`（①） | `ls` 已核，文件名与 ② 一致 | ① 层是唯一源码修改点 |
| 模板引擎 | `/opt/apollo/neo/packages/buildtool/.../core/action/create.py` + `data/templates/template_planning_traffic_rule/` | read/cat | 决定生成什么、命名怎么推导 |
| 生效清单 | `/apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt` → `/apollo_workspace/profiles/current/...`（current→`ARCF_40P`，`readlink -f` 已核） | 尾 8 行已核（`SPEED_SETTING`、`REGION_SPEED_LIMIT`） | ④ 软链 → **profile 覆盖层** |
| 插件索引 | `/opt/apollo/neo/share/cyber_plugin_index/modules__planning__traffic_rules__region_speed_limit__libregion_speed_limit.so` | cat：内容 = `share/modules/planning/traffic_rules/region_speed_limit/plugins.xml` | 文件名 = library path 换 `__`，内容 = 描述文件相对路径 |

## 2. 模板：两个模板都存在，但只有一个该用

`buildtool create --help` 原文（已跑，只读）列出 6 个模板：
`{component,timer_component,plugin,planning_scenario,planning_task,planning_traffic_rule}` ——
`--template plugin` 与 `--template planning_traffic_rule` **都存在**。加 rule 用后者：
它预置了 `TrafficRule` 基类、`ApplyRule/Reset` 骨架、`base_class="apollo::planning::TrafficRule"`
与 planning 依赖；`plugin` 是通用插件骨架，基类要自己用 `--base_class_name` 填，等于多做一遍手工。

**本机实际可用的命令行（参数名照抄 --help）：**

```bash
buildtool create --template planning_traffic_rule \
  --rule school_zone_speed \
  --namespaces planning \
  --author "your name" --email you@example.com \
  --description "school zone speed limit rule" \
  modules/planning/traffic_rules/school_zone_speed
```

命名推导（create.py:264-284 已核，别猜）：

| 输入 | 产出 |
|---|---|
| `--rule school_zone_speed` | 类名 `SchoolZoneSpeedRule`（**自动补 `Rule` 后缀**）、文件 `school_zone_speed_rule.{h,cc}`、库 `libschool_zone_speed_rule.so` |
| 同上 | `target_name=school_zone_speed`；包名 `planning-traffic-rule-school-zone-speed`；描述文件 `plugin_school_zone_speed_description.xml` |
| 未给 `--namespaces` | 自动补 `['planning']`（create.py:286-291），即 `apollo::planning::` |

参数取舍（对本模板已核）：

- **`--rule` 必填**，缺了直接 `ParamErr: rule is required`（create.py:261-263）。
- `--name` / `--class_name` 对本模板**无效**：包名与类名在 :273-284 被 `--rule` 推导值覆盖。
- `--config_message_name` 对本模板**无效**：proto 模板硬写 `message {{traffic_rule_name}}Config`，
  即消息名固定 `<类名>Config`（`proto/traffic_rule.proto.in` 已核）。
- `--config_file_name` 不给则 `default_conf`（:276-277），生成 `conf/default_conf.pb.txt`（内容为空模板）。
- `--dependencies` / `--build_dependencies` 追加 `cyberfile.xml` 的 `<depend>`；`--includes` 往 `.h` 加 include。
- `--type` 默认按模板给 `module`；`--scenario/--stage/--task/--channel_*` 是别的模板的参数，这里不用。
- 已存在的文件**跳过不覆盖**（create.py 每个 render 都先 `if ... exists(): skip`）。

> 想要类名不带 `Rule` 后缀（像出厂的 `RegionSpeedLimit`），模板做不到 —— 生成后自己改
> `.h/.cc/plugins.xml/BUILD/proto` 五处一致，或直接接受 `XxxRule` 命名。

## 3. 六件套核对表（逐文件「必须写什么」，对照 region_speed_limit 全文）

| 文件 | 必须写什么 | 样板证据（已 read） |
|---|---|---|
| `<name>.h` | ① `#include ".../proto/<name>.pb.h"` + `.../traffic_rules_base/traffic_rule.h`；② `class X : public TrafficRule`；③ `Init(name, injector) override`、`ApplyRule(Frame*, ReferenceLineInfo*)`、`Reset()`；④ 私有 `XConfig config_`；⑤ **文件末尾（namespace 内）** `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::X, TrafficRule)` | `region_speed_limit.h`:26-27 include；38 继承；40-46 三接口；49 config_；52-53 注册宏 |
| `<name>.cc` | ① `Init` 固定两步：`if (!TrafficRule::Init(name, injector)) return false;` → `return TrafficRule::LoadConfig<XConfig>(&config_);`；② `ApplyRule` 主体：取 `reference_line_info->mutable_reference_line()`，按 `config_` 开关叠加决策/限速，末尾 `return Status::OK()` | `region_speed_limit.cc`:35-43（Init）；45-52（取 reference_line / map_path）；64-106（三段 `AddSpeedLimit`）；108 返回 OK |
| `plugins.xml` | 三属性且只有三属性：`<library path="modules/planning/traffic_rules/<dir>/lib<name>.so">` + `<class type="apollo::planning::X" base_class="apollo::planning::TrafficRule">`。**没有 `class_type`** | `plugins.xml`:1-2（全文 3 行） |
| `BUILD` | ① 两条 load：`//tools:cpplint.bzl` 的 `cpplint`、`//tools:apollo_package.bzl` 的 `apollo_package`+`apollo_plugin`；② `package(default_visibility=["//visibility:public"])`；③ `filegroup(name="runtime_files", srcs=glob(["conf/**"]))` ← conf 靠它进安装产物；④ `apollo_plugin(name="lib<name>.so", srcs, hdrs, description=":plugins.xml", copts=PLANNING_COPTS, deps=[planning_interface_base, 本包 proto])`；⑤ 结尾 `apollo_package()` 与 `cpplint()` | `BUILD`:1-2 load；4 visibility；8-13 filegroup；15-25 apollo_plugin（19 description、22-23 deps）；27 apollo_package；29 cpplint |
| `proto/<name>.proto` | `syntax="proto2"; package apollo.planning;` + `message XConfig { optional ... = N [default = ...]; }`，消息名必须等于 `LoadConfig<T>` 的 T | `proto/region_speed_limit.proto`:1-3、8-24 |
| `proto/BUILD` | `apollo_package` + `//tools/proto:proto.bzl` 的 `proto_library(name="<name>_proto", srcs=[...])` + 末尾 `apollo_package()`；**BUILD 里写 `_proto`，被依赖时写 `_cc_proto`** | `proto/BUILD`:1-9、11；主 BUILD:23 引用 `:region_speed_limit_cc_proto` |
| `conf/default_conf.pb.txt` | proto 的文本值，字段名与 proto 一致（可只写要改的字段，其余走 proto default） | `conf/default_conf.pb.txt`:1-8，与 proto default 逐条一致 |
| `cyberfile.xml` | `<name>` 包名（kebab）、`<version>local`、`<type>module`、**`<src_path>//modules/planning/traffic_rules/<dir>` 必须与目录完全一致**、`<builder>bazel`、`<depend>bazel-extend-tools`、`<depend type="binary" repo_name="planning-interface-base">planning-interface-base` | `cyberfile.xml`:2、3、8、9、15、12-13 |

模板与出厂样板的三处差异（都不影响能跑，知道就行）：模板的描述文件叫
`plugin_<target>_description.xml` 而出厂叫 `plugins.xml`（conf 路径只取**所在目录**，文件名不参与，07 篇 §3.3）；
模板 `deps` 多带一个 `planning_base`；模板注册宏第二参写全限定 `apollo::planning::TrafficRule`，
出厂写非限定 `TrafficRule`（同在 namespace 内，等价）。

## 4. 从零到生效：步骤序列

| # | 动作 | 命令 / 编辑点 |
|---|---|---|
| 1 | 确认 planning traffic_rules 已在 ① 层（本机已在，`ls` 已核；缺则装） | `buildtool install planning` |
| 2 | 生成骨架（工作区根执行；`package_path` 是**相对工作区的路径**） | `cd /apollo_workspace && buildtool create --template planning_traffic_rule --rule school_zone_speed --namespaces planning modules/planning/traffic_rules/school_zone_speed` |
| 3 | 写 proto 字段 | 编辑 `/apollo_workspace/modules/planning/traffic_rules/school_zone_speed/proto/school_zone_speed_rule.proto`，在 `message SchoolZoneSpeedRuleConfig{}` 里加 `optional double speed_limit = 1 [default = 5.0];` 等 |
| 4 | 写 `.h` | 确认 `SchoolZoneSpeedRuleConfig config_;`、三接口签名、末尾注册宏（模板已生成，通常只补 include 与成员） |
| 5 | 写 `.cc`：`Init` = `TrafficRule::Init` + `LoadConfig<T>`；`ApplyRule` = 主体 | 照 `region_speed_limit.cc`:35-43 / 64-106；加限速用 `reference_line_info->mutable_reference_line()->AddSpeedLimit(start_s, end_s, v)`；加停车墙用 `util::BuildStopDecision(...)`（头 `planning_base/common/util/common.h`，07 篇 §2.2） |
| 6 | 核对描述文件三属性 | `plugin_school_zone_speed_description.xml`：`path=modules/planning/traffic_rules/school_zone_speed/libschool_zone_speed_rule.so`，`type=apollo::planning::SchoolZoneSpeedRule`，`base_class=apollo::planning::TrafficRule` |
| 7 | 写 `conf/default_conf.pb.txt` | 字段名与 proto 一致；空文件也合法（全走 proto default） |
| 8 | 核对 `cyberfile.xml` 的 `<src_path>` | 必须 `//modules/planning/traffic_rules/school_zone_speed` |
| 9 | 编译 + install（**关键一步**） | `buildtool build -p modules/planning/traffic_rules/school_zone_speed` |
| 10 | 确认安装产物（两处缺一不可） | `ls /opt/apollo/neo/lib/modules/planning/traffic_rules/school_zone_speed/` 有 `libschool_zone_speed_rule.so`；`ls /opt/apollo/neo/share/cyber_plugin_index/ \| grep school_zone_speed` 有条目 |
| 11 | 确认实例 conf 落到 ④ 层 | `ls -l /apollo/modules/planning/traffic_rules/school_zone_speed/conf/default_conf.pb.txt`（新包一般指向 share 出厂层，profile 树里没有它） |
| 12 | **判生效档落点**，再追加清单 | `readlink -f /apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt` → 本机 = `/apollo_workspace/profiles/ARCF_40P/modules/planning/planning_component/conf/traffic_rule_config.pb.txt`。**在该落点文件**末尾追加：`rule {\n  name: "SCHOOL_ZONE_SPEED"\n  type: "SchoolZoneSpeedRule"\n}`（`type` 写**不带命名空间的类名**；书写位置 = 执行顺序） |
| 13 | 重启 planning 验证 | `mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag` |

第 12 步的 `name` 是别名、可自定；`type` 必须与类名逐字一致（`TrafficDecider` 侧会补
`apollo::planning::` 再去 PluginManager 取实例，07 篇 §3.2）。

## 5. ⚠️ 常见失败（症状 → 原因 → 修法）

| 症状 | 原因 | 修法 |
|---|---|---|
| 启动日志找不到该 rule；`CreateInstance` 返回 nullptr / 规则从不执行 | `base_class` 写成中间基类或别的名字。TrafficRule 族**没有中间基类可写**，必须是 `apollo::planning::TrafficRule` | 改 `plugin_*_description.xml` / `plugins.xml` 的 `base_class`，重跑第 9 步 |
| 描述文件像是被整条忽略 | 属性名写成 `class_type`（正确只有 `type` / `base_class` / `path` 三个） | 改成 `type=`，重跑第 9 步 |
| `.so` 编出来了，运行期 `Class factory objs counts is 0` | BUILD 用 `cc_library` 代替 `apollo_plugin` → 少了 `alwayslink=True`，注册宏的静态对象被链接器裁掉 | 换回 `apollo_plugin(... description=":<描述文件>")`，**别手写 `alwayslink`** |
| 只 `bazel build` 成功，运行时依然加载不到 | 运行时只读 `/opt/apollo/neo/{lib,share}` 的 install 产物，且插件索引不扫 `bazel-bin`（`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`，env 已核） | 必须 `buildtool build -p <包路径>` 完成 install |
| 参数改了完全不起作用，日志只有一句 `Failed to load default config file` 或直接静默用默认值 | conf 文件名/位置不对：必须是 `<包目录>/conf/default_conf.pb.txt`（除非用了 `--config_file_name`），且解析走 `APOLLO_CONF_PATH=/apollo` → 实际读 ④ 层；proto 消息名与 `LoadConfig<T>` 的 T 不一致也会静默失败 | `ls -l /apollo/modules/planning/traffic_rules/<dir>/conf/default_conf.pb.txt` 确认存在与落点；核对消息名 = `<类名>Config` |
| 改了 `/opt/apollo/neo/share/.../traffic_rule_config.pb.txt`（或 rule conf）没生效 / 一编译就丢 | ④ 层软链指向 **profile 覆盖层**（本机 `profiles/current`→`ARCF_40P`），profile 档优先；share 是出厂件，且下次 install 会被覆盖 | 一律先 `readlink -f` 认落点，改落点文件（profile 层能长期驻留） |
| `buildtool build -p <路径>` 报找不到包 / 包名不对 | `cyberfile.xml` 的 `<src_path>` 与实际目录不一致（它同时决定 install 位置与 bazel package 路径） | 改成 `//` + 目录相对路径；另注意 buildtool **遇到第一个含 `cyberfile.xml` 的目录就停止下钻**，不要把新包嵌在别的包内部 |
| rule 出现在清单里但明显没生效 | 清单 `type` 写了带命名空间的名字，或类名拼错（模板自动加了 `Rule` 后缀，容易漏） | `type` 写非限定类名，与 `.h` 里 `class X` 逐字一致 |
| 该 rule 一返回非 OK，整条参考线不可驾驶、车不走 | 框架行为：任一 rule 非 OK → `SetDrivable(false)` + `AWARN "... traffic decider failed"`（07 篇 §2.1） | 正常路径统一 `return Status::OK()`，异常只用日志表达 |

## 6. 验证（只列本环境存在的命令）

```bash
# 1) 插件装没装：.so + 索引条目，缺一不可
ls /opt/apollo/neo/lib/modules/planning/traffic_rules/<dir>/
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep <dir>
cat /opt/apollo/neo/share/cyber_plugin_index/modules__planning__traffic_rules__<dir>__lib<name>.so   # 应打印描述文件相对路径

# 2) 清单与 conf 落点（④ 层一律 readlink 判定，别假设指向 share）
readlink -f /apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt
grep -n 'name:\|type:' $(readlink -f /apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt)
ls -l /apollo/modules/planning/traffic_rules/*/conf/default_conf.pb.txt
grep -Rn '<自定字段名>' /apollo/modules/planning/traffic_rules/<dir>/conf/    # 搜 /apollo 必须 -R，-r 不跟随软链会假空

# 3) 起 planning 看加载与规则日志（前台打屏）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
#   关键字：'Class factory objs counts is 0'（注册被裁）、'Failed to load default config file'（conf 没读到）、
#           自己在 ApplyRule 里打的 AINFO（样板 region_speed_limit.cc:58-61 每帧打 overlap 计数）

# 4) 观察限速类 rule 的实际效果
cyber_channel echo /apollo/planning | head -50        # 轨迹点 v；限速生效时区间内 v 被压低
cyber_channel hz /apollo/planning                     # 确认 planning 仍在正常出帧（注意 cyber_channel -w 在本机是坏的）
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 package 工作区，buildtool 9.0.0-rc1-r19。
- **read 全文核对**：样板包 8 文件（`region_speed_limit.{h,cc}`、`BUILD`、`cyberfile.xml`、`plugins.xml`、
  `conf/default_conf.pb.txt`、`proto/region_speed_limit.proto`、`proto/BUILD`，均在 `/opt/apollo/neo/src/...`）；
  `create.py` 240-299（read）与 1480-1580（sed）；`_template.md`；`12_planning源码/07_traffic_rule框架.md`；
  `00_versions/01_命令与词汇对照.md`。
- **非 read 证据**：`buildtool create --help` 原文（模板名与全部参数）；`cat` 六份模板 `.in`；
  `ls` 样板包与 ① 层同名包目录、`/opt/apollo/neo/lib/.../region_speed_limit/`、`cyber_plugin_index` 条目并 `cat` 其内容；
  `readlink -f /apollo_workspace/profiles/current` = `ARCF_40P`；`ls -l` 认 `traffic_rule_config.pb.txt` 软链落点；
  `tail` 生效档尾 8 行；`env` 取 `APOLLO_CONF_PATH=/apollo`、`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`、
  `APOLLO_PLUGIN_INDEX_PATH`、`APOLLO_PLUGIN_LIB_PATH`、`APOLLO_PLUGIN_DESCRIPTION_PATH`。
- **修正**：`00_versions/01_命令与词汇对照.md`「11.0 本机无 profiles」**已过期** —— 本机存在
  `/apollo_workspace/profiles/{current→ARCF_40P}`，且 planning 生效清单与 9 个 rule 的 conf 都在 profile 覆盖层
  （2026-09-08 实测，与 07 篇 §3.1/§5 一致）。第 12 步因此以 `readlink -f` 判定为准。
- **遗留待核**：
  1. 本文未真实执行 `buildtool create`（避免污染工作区）与 `buildtool build -p`：第 2/9 步的**产出文件名与命名推导**
     出自 `create.py` + 模板源码推导，未跑过一次端到端；`buildtool create` 的实际 stdout 与失败分支未验。
  2. 第 13 步之后的**运行时验证未实机跑过**（未起 planning）：日志关键字来自样板源码与 07 篇结论。
  3. `util::BuildStopDecision` 的签名/头文件位置沿用 07 篇（该篇标注为「仅核到调用点」），本轮未打开 `common.h`。
  4. `--dependencies/--build_dependencies/--includes` 的渲染效果只从 `cyberfile.xml.in`/`traffic_rule.h.in`
     的 jinja 循环推断，未实测。
  5. 新包 conf 是否会被 profile 树接管（第 11 步预期指向 share）未实测，需真正建包后 `ls -l` 确认。
