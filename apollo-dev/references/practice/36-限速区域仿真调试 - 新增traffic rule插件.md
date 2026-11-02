<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# 限速区域仿真调试 - 新增traffic rule插件

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_8aec81ad38e956f26eddb80c70f045b6.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_8aec81ad38e956f26eddb80c70f045b6.html)
> 抓取时间：2026-09-08


##  实践内容

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_e4e2b74.png)

以车辆在行进过程中，驶入需限速的交汇路口为例，向大家介绍 Planning 模块插件机制，以及针对该交汇路口限速场景，教大家新建自定义插件，实现在指定区域的限速功能。新建一个 traffic rule 插件流程如下图所示，主要包括了配置插件相关文件、在[`traffic_rule_config.pb.txt`](https://apollo.baidu.com/docs/apollo/latest/traffic__rule__config_8pb_8txt.html)中加入新增插件。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_4266c80.png)

Apollo9.0 中通过交通规则插件配置可以配置 planning 启用的交通规则插件，交通规则插件的所有业务逻辑对于所有场景均会生效，本实验将通过添加 traffic rule 插件，实现自动驾驶车辆在行驶到交汇路口限速区域时低于指定速度行驶。

##  实践目的

学习 traffic rule 新增插件流程，掌握开发 traffic rule 插件步骤，使学员具有新建自定义插件能力。在本实验中，你将学会：

- a\. 指定位置新建插件`region_speed_limit`文件夹。
- b\. 根据要求，配置相应插件文件与[`traffic_rule_config.pb.txt`](https://apollo.baidu.com/docs/apollo/latest/traffic__rule__config_8pb_8txt.html)。
  - 配置`RegionSpeedLimit`类代码文件以及相应 BUILD 文件，
  - 配置参数文件以及 BUILD 文件，
  - 配置插件参数文件`default_conf.pb.txt`，
  - 配置`cyberfile.xml`，
  - 配置`plugins.xml`，
  - [`traffic_rule_config.pb.txt`](https://apollo.baidu.com/docs/apollo/latest/traffic__rule__config_8pb_8txt.html)中加入新增插件。
- c\. 编译`region_speed_limit`插件。
- d\. 运行车辆规划模块，并在 dreamview+ 上观察车辆驶入交汇路口的速度变化。

##  启动仿真环境

1.  在终端中输入以下指令，启动 dreamview+。

    <div>

    <div>

    aem bootstrap start --plus

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_e831cb0.png)

2.  运行成功后，点击左上角 dreamview+ 按钮。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_53acd5f.png)

3.  首次进入 Dreamview+ 界面，需要勾选 **Accept the User Agreement and Privacy Policy\*\*，点击 \*\*Enter this mode** 进入 Dreamview+。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_fa209e0.png)

4.  点击红框 **Skip** 跳过介绍。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_65dbda8.png)

5.  在 **Mode/模式** 中选择 **PnC** 模式。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_6528f43.png)

6.  在 **Operations/操作** 中选择 \*\*Sim Control/仿真\*\*。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_bc5b24d.png)

7.  在 **Modules/模块** 中打开 **Planning** 模块。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_1cdb2b2.png)

8.  在 **Vehicle Visualization/车辆可视化** 面板中点击 **Routing Editing/路径编辑** 进入路径编辑界面。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_144eb36.png)

9.  点击左上角第一个红框选择车辆起始点，第二个红框选择途经点与终点。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_938519d.png)

10. 点击左下角红框开始仿真。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_8a83620.png)

1.  如图所示，红线为道路参考线，浅蓝色的轨迹是 planning 模块实时规划的轨迹。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_5760e6c.png)

##  全局配置实践实验流程

###  全局配置参数同步

输入全局配置参数同步指令，系统将自动将全局配置参数复制到 profile 的 default 目录中，然后就可以在 profile 目录上轻松修改配置参数。

<div>

<div>

buildtool profile config init --package planning --profile=default && aem profile use default



###  新建 traffic rule 插件实践

####  新建插件文件

输入下述指令，在`modules/planning/traffic_rules/`下新建插件文件夹`region_speed_limit`：

<div>

<div>

buildtool create --template plugin \\


<div>

--namespaces planning \\


<div>

--includes "modules/common/status/status.h" \\


<div>

"modules/planning/planning_base/traffic_rules_base/traffic_rule.h" \\


<div>

"modules/planning/traffic_rules/region_speed_limit/proto/default_conf.pb.h" \\


<div>

--dependencies planning:planning \\


<div>

--build_dependencies "//modules/planning/planning_base:apollo_planning_planning_base" \\


<div>

--base_class_name apollo::planning::TrafficRule \\


<div>

--config_message_name RegionSpeedLimitConfig \\


<div>

--config_file_name default_conf \\


<div>

modules/planning/traffic_rules/region_speed_limit



输入下述指令修改配置文件名为`default_conf.pb.txt`：

<div>

<div>

mv modules/planning/traffic_rules/region_speed_limit/conf/region_speed_limit.pb.txt modules/planning/traffic_rules/region_speed_limit/conf/default_conf.pb.txt



####  配置插件文件

1.  打开在线编辑器。

    点击红框所示位置，打开在线编辑器，对插件文件进行编辑。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_9f3bcc8.png)

2.  编辑器配置。

    从左到右依次按红框所示点击，选择`/apollo_workspace/`目录，点击 \*\*OK\*\*。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_2561ad7.png)

    进入后下图红框所示文件夹即为新建插件模版。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_df89756.png)

    region_speed_limit.h

    region_speed_limit.h文件位置：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_3d035e7.png)

    region_speed_limit.h文件内容：

    <div>

    <div>

    \#pragma once

    </div>

    <div>

    </div>

    <div>

    \#include \<memory\>

    </div>

    <div>

    \#include "cyber/plugin_manager/plugin_manager.h"

    </div>

    <div>

    </div>

    <div>

    /\* 添加了相应的头文件\*/

    </div>

    <div>

    \#include "modules/common/status/status.h"

    </div>

    <div>

    \#include "modules/planning/traffic_rules/region_speed_limit/proto/region_speed_limit.pb.h"

    </div>

    <div>

    \#include "modules/planning/planning_base/traffic_rules_base/traffic_rule.h"

    </div>

    <div>

    </div>

    <div>

    namespace apollo {

    </div>

    <div>

    namespace planning {

    </div>

    <div>

    </div>

    <div>

    class RegionSpeedLimit : public TrafficRule {

    </div>

    <div>

    /\* 声明成员函数\*/

    </div>

    <div>

    public:

    </div>

    <div>

    bool Init(const std::string& name, const std::shared_ptr\<DependencyInjector\>& injector) override;

    </div>

    <div>

    virtual ~RegionSpeedLimit() = default;

    </div>

    <div>

    </div>

    <div>

    common::Status ApplyRule(Frame\* const frame, ReferenceLineInfo\* const reference_line_info);

    </div>

    <div>

    </div>

    <div>

    void Reset() override {}

    </div>

    <div>

    </div>

    <div>

    private:

    </div>

    <div>

    RegionSpeedLimitConfig config\_;

    </div>

    <div>

    };

    </div>

    <div>

    </div>

    <div>

    CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::RegionSpeedLimit, apollo::planning::TrafficRule)

    </div>

    <div>

    </div>

    <div>

    } // namespace planning

    </div>

    <div>

    } // namespace apollo

    </div>

    </div>

    region_speed_limit.cc

    region_speed_limit.cc文件位置：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a6f122e.png)

    region_speed_limit.cc文件内容：

    <div>

    <div>

    \#include \<memory\>

    </div>

    <div>

    \#include "modules/planning/traffic_rules/region_speed_limit/region_speed_limit.h"

    </div>

    <div>

    </div>

    <div>

    namespace apollo {

    </div>

    <div>

    namespace planning {

    </div>

    <div>

    </div>

    <div>

    /\* 定义成员函数\*/

    </div>

    <div>

    </div>

    <div>

    using apollo::common::Status;

    </div>

    <div>

    using apollo::hdmap::PathOverlap;

    </div>

    <div>

    </div>

    <div>

    bool RegionSpeedLimit::Init(const std::string& name, const std::shared_ptr\<DependencyInjector\>& injector) {

    </div>

    <div>

    if (!TrafficRule::Init(name, injector)) {

    </div>

    <div>

    return false;

    </div>

    <div>

    }

    </div>

    <div>

    // Load the config this task.

    </div>

    <div>

    return TrafficRule::LoadConfig\<RegionSpeedLimitConfig\>(&config\_);

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    Status RegionSpeedLimit::ApplyRule(Frame\* const frame, ReferenceLineInfo\* const reference_line_info) {

    </div>

    <div>

    ReferenceLine\* reference_line = reference_line_info-\>mutable_reference_line();

    </div>

    <div>

    const std::vector\<PathOverlap\>& junction_overlaps

    </div>

    <div>

    = reference_line_info-\>reference_line().map_path().junction_overlaps();

    </div>

    <div>

    for (const auto& junction_overlap : junction_overlaps) {

    </div>

    <div>

    reference_line-\>AddSpeedLimit(

    </div>

    <div>

    junction_overlap.start_s - config\_.forward_buffer(),

    </div>

    <div>

    junction_overlap.end_s + config\_.backward_buffer(),

    </div>

    <div>

    config\_.limit_speed());

    </div>

    <div>

    }

    </div>

    <div>

    return Status::OK();

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    } // namespace planning

    </div>

    <div>

    } // namespace apollo

    </div>

    </div>

    plugin_region_speed_limit_description.xml

    plugin_region_speed_limit_description.xml文件位置：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_dde873a.png)

    plugin_region_speed_limit_description.xml文件内容

    <div>

    <div>

    \<library path="modules/planning/traffic_rules/region_speed_limit/libregion_speed_limit.so"\>

    </div>

    <div>

    \<class type="apollo::planning::RegionSpeedLimit" base_class="apollo::planning::TrafficRule"\> \</class\>

    </div>

    <div>

    \</library\>

    </div>

    </div>

    cyberfile.xml

    cyberfile.xml文件位置

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_56c1a2e.png)

    cyberfile.xml文件内容

    <div>

    <div>

    \<package format="2"\>

    </div>

    <div>

    \<name\>region-speed-limit\</name\>

    </div>

    <div>

    \<version\>local\</version\>

    </div>

    <div>

    \<description\>

    </div>

    <div>

    This is a demo package

    </div>

    <div>

    \</description\>

    </div>

    <div>

    </div>

    <div>

    \<maintainer email="sample@sample.com"\>Apollo Developer\</maintainer\>

    </div>

    <div>

    \<license\>Apache License 2.0\</license\>

    </div>

    <div>

    \<url type="website"\>https://www.apollo.auto/\</url\>

    </div>

    <div>

    \<url type="repository"\>https://github.com/ApolloAuto/apollo\</url\>

    </div>

    <div>

    \<url type="bugtracker"\>https://github.com/ApolloAuto/apollo/issues\</url\>

    </div>

    <div>

    </div>

    <div>

    \<type\>module\</type\>

    </div>

    <div>

    \<src_path\>//modules/planning/traffic_rules/region_speed_limit\</src_path\>

    </div>

    <div>

    \<builder\>bazel\</builder\>

    </div>

    <div>

    </div>

    <div>

    \<depend type="binary" repo_name="cyber"\>cyber\</depend\>

    </div>

    <div>

    \<!-- add new dependency--\>

    </div>

    <div>

    \<depend type="binary" repo_name="planning"\>planning\</depend\>

    </div>

    <div>

    </div>

    <div>

    \<depend\>bazel-extend-tools\</depend\>

    </div>

    <div>

    \</package\>

    </div>

    </div>

    BUILD

    BUILD 文件位置

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_b4ab4cd.png)

    BUILD 文件内容

    <div>

    <div>

    load("//tools:apollo_package.bzl", "apollo_cc_test", "apollo_package", "apollo_plugin")

    </div>

    <div>

    load("//tools:cpplint.bzl", "cpplint")

    </div>

    <div>

    </div>

    <div>

    package(default_visibility = \["//visibility:public"\])

    </div>

    <div>

    </div>

    <div>

    filegroup(

    </div>

    <div>

    name = "region_speed_limit_files",

    </div>

    <div>

    srcs = glob(\[

    </div>

    <div>

    "conf/\*\*",

    </div>

    <div>

    \]),

    </div>

    <div>

    )

    </div>

    <div>

    </div>

    <div>

    apollo_plugin(

    </div>

    <div>

    name = "libregion_speed_limit.so",

    </div>

    <div>

    srcs = \[

    </div>

    <div>

    "region_speed_limit.cc",

    </div>

    <div>

    \],

    </div>

    <div>

    hdrs = \[

    </div>

    <div>

    "region_speed_limit.h",

    </div>

    <div>

    \],

    </div>

    <div>

    description = ":plugin_region_speed_limit_description.xml",

    </div>

    <div>

    deps = \[

    </div>

    <div>

    "//cyber",

    </div>

    <div>

    "//modules/planning/planning_base:apollo_planning_planning_base",

    </div>

    <div>

    "//modules/planning/traffic_rules/region_speed_limit/proto:region_speed_limit_cc_proto",

    </div>

    <div>

    \],

    </div>

    <div>

    )

    </div>

    <div>

    </div>

    <div>

    apollo_package()

    </div>

    <div>

    </div>

    <div>

    cpplint()

    </div>

    </div>

    proto/BUILD

    proto/BUILD 文件位置

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_ee6dea6.png)

    proto/BUILD文件内容

    <div>

    <div>

    load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_library")

    </div>

    <div>

    load("//tools:apollo_package.bzl", "apollo_cc_library", "apollo_package", "apollo_plugin")

    </div>

    <div>

    load("//tools/proto:proto.bzl", "proto_library")

    </div>

    <div>

    load("//tools:cpplint.bzl", "cpplint")

    </div>

    <div>

    </div>

    <div>

    package(default_visibility = \["//visibility:public"\])

    </div>

    <div>

    </div>

    <div>

    proto_library(

    </div>

    <div>

    name = "region_speed_limit_proto",

    </div>

    <div>

    srcs = \["region_speed_limit.proto"\],

    </div>

    <div>

    )

    </div>

    <div>

    </div>

    <div>

    apollo_package()

    </div>

    <div>

    </div>

    <div>

    cpplint()

    </div>

    </div>

    proto/region_speed_limit.proto

    proto/region_speed_limit.proto 文件位置

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_423f795.png)

    proto/region_speed_limit.proto 文件内容

    <div>

    <div>

    syntax = "proto2";

    </div>

    <div>

    </div>

    <div>

    package apollo.planning;

    </div>

    <div>

    </div>

    <div>

    message RegionSpeedLimitConfig {

    </div>

    <div>

    // 声明RegionSpeedLimitConfig中的数据结构

    </div>

    <div>

    optional double forward_buffer = 1 \[default = 3\];

    </div>

    <div>

    optional double backward_buffer = 2 \[default = 2\];

    </div>

    <div>

    optional double limit_speed = 3 \[default = 5\];

    </div>

    <div>

    }

    </div>

    </div>

    conf/default_conf.pb.txt

    conf/default_conf.pb.txt文件位置

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_de53185.png)

    修改`conf/default_conf.pb.txt`文件内容如下：

    <div>

    <div>

    forward_buffer: 3.0

    </div>

    <div>

    backward_buffer: 2.0

    </div>

    <div>

    limit_speed: 10.0

    </div>

    </div>

3.  配置插件流程文件。

    配置文件位置

    ![新增traffic rule插件.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/%E6%96%B0%E5%A2%9Etraffic%20rule%E6%8F%92%E4%BB%B6_bcf2f04.png)

    配置文件内容

    <div>

    <div>

    rule {

    </div>

    <div>

    name: "BACKSIDE_VEHICLE"

    </div>

    <div>

    type: "BacksideVehicle"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "CROSSWALK"

    </div>

    <div>

    type: "Crosswalk"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "DESTINATION"

    </div>

    <div>

    type: "Destination"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "KEEP_CLEAR"

    </div>

    <div>

    type: "KeepClear"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "REFERENCE_LINE_END"

    </div>

    <div>

    type: "ReferenceLineEnd"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "REROUTING"

    </div>

    <div>

    type: "Rerouting"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "STOP_SIGN"

    </div>

    <div>

    type: "StopSign"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "TRAFFIC_LIGHT"

    </div>

    <div>

    type: "TrafficLight"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "YIELD_SIGN"

    </div>

    <div>

    type: "YieldSign"

    </div>

    <div>

    }

    </div>

    <div>

    rule {

    </div>

    <div>

    name: "REGION_SPEED_LIMIT"

    </div>

    <div>

    type: "RegionSpeedLimit"

    </div>

    <div>

    }

    </div>

    </div>

####  编译插件

输入如下命令进行编译：

<div>

<div>

buildtool build -p modules/planning/traffic_rules/region_speed_limit/



####  重启 planning

点击 **Modules/模块** 中的 Planning 模块，关闭 Planning。而后再次点击 Planning 模块，打开 Planning。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c59210d.png)

打开 **Routing Editing/路径编辑** 面板，设置起点终点：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_cdebe8b.png)

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c6a39be.png)

原始配置仿真：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_d24e1f6.png)

修改插件配置参数：

在`apollo_workspace`工作目录找到`modules/planning/traffic_rules/region_speed_limit/conf/default_conf.pb.txt`配置文件，调整经过路口速度。

1.  使用在线编辑工具修改`modules/planning/traffic_rules/region_speed_limit/conf/default_conf.pb.txt`配置文件，将`limit_speed`参数

    <div>

    <div>

    limit_speed: 10.0

    </div>

    </div>

    将配置参数的值修改为：

    <div>

    <div>

    limit_speed: 3.0

    </div>

    </div>

    修改之后保存代码，而后重新编译插件：

    <div>

    <div>

    buildtool build -p modules/planning/traffic_rules/region_speed_limit/

    </div>

    </div>

2.  修改好代码参数并重新编译后，在 **Modules/模块** 中重启 Planning 模块（必须步骤）。

3.  重新调整插件参数，观察车辆减速效果与减速起止点。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_fd85ca7.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

