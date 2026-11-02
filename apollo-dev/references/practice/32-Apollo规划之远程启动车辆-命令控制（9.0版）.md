<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Apollo规划之远程启动车辆-命令控制（9.0版）

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_ec3aabab3f704a7839391f1c9d0616f2.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_ec3aabab3f704a7839391f1c9d0616f2.html)
> 抓取时间：2026-09-08


##  实验内容

通过 5G 远程驾驶平台监控和接管自动驾驶车辆是确保自动驾驶安全行驶的重要手段，本实验将基于 Dreamview+ 进行 Sim_Control 仿真，实现对自动驾驶车辆的远程控制，包括启动、停车和靠边停车等操作。

##  实验目的

学习新增和使用新命令行插件的流程，掌握开发命令行插件的步骤，使学员具有新建自定义插件能力。

- 方法：通过使用Apollo 9.0的buildtool功能，新增一个命令控制的插件，实现通过终端控制车辆启动、停车和靠边停车的功能。
- 结果：通过命令行控制，在Dreamview +的界面上，可以观察到车辆启动、停车和靠边停车的仿真效果。

##  实验步骤

###  1. 新建远程控制车辆插件

1.  执行下面命令，新建插件文件夹`remote_control_command_demo`。

    <div>

    <div>

    buildtool create --template component remote_control_command_demo

    </div>

    </div>

    执行成功后，执行 ls 命令可以看到当前目录下生成了`remote_control_command_demo`文件夹，如下图所示：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c742c5c.png)

    查看目录结构：

    <div>

    <div>

    tree remote_control_command_demo

    </div>

    </div>

    目录结构：

    <div>

    <div>

    remote_control_command_demo

    </div>

    <div>

    \|-- BUILD

    </div>

    <div>

    \|-- conf

    </div>

    <div>

    \| \|-- remote_control_command_demo.conf -----------加载全局参数的文件

    </div>

    <div>

    \| \`-- remote_control_command_demo.pb.txt -----------proto的配置文件

    </div>

    <div>

    \|-- cyberfile.xml -----------编译的加载文件

    </div>

    <div>

    \|-- dag

    </div>

    <div>

    \| \`-- remote_control_command_demo.dag -----------启动的dag文件

    </div>

    <div>

    \|-- launch

    </div>

    <div>

    \| \`-- remote_control_command_demo.launch -----------启动的launch文件

    </div>

    <div>

    \|-- proto

    </div>

    <div>

    \| \|-- BUILD -----------proto的编译文件

    </div>

    <div>

    \| \`-- remote_control_command_demo.proto -----------proto的定义文件

    </div>

    <div>

    \|-- remote_control_command_demo.cc -----------功能实现文件

    </div>

    <div>

    \`-- remote_control_command_demo.h -----------功能定义文件

    </div>

    </div>

2.  点击红框所示位置，打开在线编辑器，对插件文件进行编辑。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_73db513.png)

3.  将下列文件中的代码拷贝至`remote_control_command_demo`对应的文件中：

    remote_control_command_demo.cc：

    <div>

    <div>

    \#include "remote_control_command_demo/remote_control_command_demo.h"

    </div>

    <div>

    </div>

    <div>

    \#include \<poll.h\>

    </div>

    <div>

    </div>

    <div>

    \#include \<cctype\>

    </div>

    <div>

    </div>

    <div>

    \#include "cyber/common/file.h"

    </div>

    <div>

    \#include "cyber/record/record_reader.h"

    </div>

    <div>

    </div>

    <div>

    using apollo::external_command::CommandStatus;

    </div>

    <div>

    </div>

    <div>

    RemoteCotrolCommandDemo::RemoteCotrolCommandDemo() : command_id\_(0), module_name\_("demo") {}

    </div>

    <div>

    </div>

    <div>

    bool RemoteCotrolCommandDemo::Init() {

    </div>

    <div>

    action_command_client\_

    </div>

    <div>

    = std::make_shared\<apollo::common::ClientWrapper\<apollo::external_command::ActionCommand, CommandStatus\>\>(

    </div>

    <div>

    node\_, "/apollo/external_command/action");

    </div>

    <div>

    free_space_command_client\_ = std::make_shared\<

    </div>

    <div>

    apollo::common::ClientWrapper\<apollo::external_command::FreeSpaceCommand, CommandStatus\>\>(

    </div>

    <div>

    node\_, "/apollo/external_command/free_space");

    </div>

    <div>

    lane_follow_command_client\_ = std::make_shared\<

    </div>

    <div>

    apollo::common::ClientWrapper\<apollo::external_command::LaneFollowCommand, CommandStatus\>\>(

    </div>

    <div>

    node\_, "/apollo/external_command/lane_follow");

    </div>

    <div>

    </div>

    <div>

    return true;

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    bool RemoteCotrolCommandDemo::Proc() {

    </div>

    <div>

    int8_t revent = 0; // short

    </div>

    <div>

    struct pollfd fd = {STDIN_FILENO, POLLIN, revent};

    </div>

    <div>

    switch (poll(&fd, 1, 100)) {

    </div>

    <div>

    case -1:

    </div>

    <div>

    std::cout \<\< "Failed to read keyboard" \<\< std::endl;

    </div>

    <div>

    return false;

    </div>

    <div>

    case 0:

    </div>

    <div>

    return true;

    </div>

    <div>

    default:

    </div>

    <div>

    char data\[50\];

    </div>

    <div>

    std::cin.getline(data, 50);

    </div>

    <div>

    std::string input_command_string = data;

    </div>

    <div>

    if (input_command_string == "pull_over") {

    </div>

    <div>

    // Pull over.

    </div>

    <div>

    // SendActionCommand(

    </div>

    <div>

    // apollo::external_command::ActionCommandType::PULL_OVER);

    </div>

    <div>

    auto command = std::make_shared\<apollo::external_command::ActionCommand\>();

    </div>

    <div>

    FillCommandHeader(command);

    </div>

    <div>

    command-\>set_command(apollo::external_command::ActionCommandType::PULL_OVER);

    </div>

    <div>

    std::cout \<\< "Sending action command: " \<\< command-\>DebugString() \<\< std::endl;

    </div>

    <div>

    auto response = action_command_client\_-\>SendRequest(command);

    </div>

    <div>

    if (nullptr == response) {

    </div>

    <div>

    std::cout \<\< "Command sending failed, please check the service is on!\n" \<\< std::endl;

    </div>

    <div>

    } else {

    </div>

    <div>

    std::cout \<\< "\*\*\*\*\*\*Finish sending command.\*\*\*\*\*\*\n" \<\< std::endl;

    </div>

    <div>

    }

    </div>

    <div>

    //

    </div>

    <div>

    } else if (input_command_string == "stop") {

    </div>

    <div>

    // Stop planning.

    </div>

    <div>

    // SendActionCommand(apollo::external_command::ActionCommandType::STOP);

    </div>

    <div>

    auto command = std::make_shared\<apollo::external_command::ActionCommand\>();

    </div>

    <div>

    FillCommandHeader(command);

    </div>

    <div>

    command-\>set_command(apollo::external_command::ActionCommandType::STOP);

    </div>

    <div>

    std::cout \<\< "Sending action command: " \<\< command-\>DebugString() \<\< std::endl;

    </div>

    <div>

    auto response = action_command_client\_-\>SendRequest(command);

    </div>

    <div>

    if (nullptr == response) {

    </div>

    <div>

    std::cout \<\< "Command sending failed, please check the service is on!\n" \<\< std::endl;

    </div>

    <div>

    } else {

    </div>

    <div>

    std::cout \<\< "\*\*\*\*\*\*Finish sending command.\*\*\*\*\*\*\n" \<\< std::endl;

    </div>

    <div>

    }

    </div>

    <div>

    //

    </div>

    <div>

    } else if (input_command_string == "start") {

    </div>

    <div>

    // Start planning.

    </div>

    <div>

    // SendActionCommand(apollo::external_command::ActionCommandType::START);

    </div>

    <div>

    auto command = std::make_shared\<apollo::external_command::ActionCommand\>();

    </div>

    <div>

    FillCommandHeader(command);

    </div>

    <div>

    command-\>set_command(apollo::external_command::ActionCommandType::START);

    </div>

    <div>

    std::cout \<\< "Sending action command: " \<\< command-\>DebugString() \<\< std::endl;

    </div>

    <div>

    auto response = action_command_client\_-\>SendRequest(command);

    </div>

    <div>

    if (nullptr == response) {

    </div>

    <div>

    std::cout \<\< "Command sending failed, please check the service is on!\n" \<\< std::endl;

    </div>

    <div>

    } else {

    </div>

    <div>

    std::cout \<\< "\*\*\*\*\*\*Finish sending command.\*\*\*\*\*\*\n" \<\< std::endl;

    </div>

    <div>

    }

    </div>

    <div>

    //

    </div>

    <div>

    } else if (input_command_string == "free1") {

    </div>

    <div>

    apollo::external_command::Pose end_pose;

    </div>

    <div>

    end_pose.set_x(437556.02);

    </div>

    <div>

    end_pose.set_y(4432540.34);

    </div>

    <div>

    end_pose.set_heading(1.8);

    </div>

    <div>

    std::vector\<apollo::external_command::Point\> way_points;

    </div>

    <div>

    apollo::external_command::Point point1;

    </div>

    <div>

    apollo::external_command::Point point2;

    </div>

    <div>

    apollo::external_command::Point point3;

    </div>

    <div>

    apollo::external_command::Point point4;

    </div>

    <div>

    point1.set_x(437536.29);

    </div>

    <div>

    point1.set_y(4432560.69);

    </div>

    <div>

    point2.set_x(437536.29);

    </div>

    <div>

    point2.set_y(4432510.69);

    </div>

    <div>

    point3.set_x(437576.29);

    </div>

    <div>

    point3.set_y(4432510.69);

    </div>

    <div>

    point4.set_x(437576.29);

    </div>

    <div>

    point4.set_y(4432560.69);

    </div>

    <div>

    way_points.emplace_back(point1);

    </div>

    <div>

    way_points.emplace_back(point2);

    </div>

    <div>

    way_points.emplace_back(point3);

    </div>

    <div>

    way_points.emplace_back(point4);

    </div>

    <div>

    </div>

    <div>

    SendFreespaceCommand(way_points, end_pose);

    </div>

    <div>

    } else {

    </div>

    <div>

    std::cout \<\< "Invalid input!" \<\< input_command_string \<\< std::endl;

    </div>

    <div>

    }

    </div>

    <div>

    }

    </div>

    <div>

    return true;

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    void RemoteCotrolCommandDemo::SendFreespaceCommand(

    </div>

    <div>

    const std::vector\<apollo::external_command::Point\>& way_points,

    </div>

    <div>

    const apollo::external_command::Pose& end) {

    </div>

    <div>

    auto command = std::make_shared\<apollo::external_command::FreeSpaceCommand\>();

    </div>

    <div>

    FillCommandHeader(command);

    </div>

    <div>

    // Copy way_points

    </div>

    <div>

    auto roi_point = command-\>mutable_drivable_roi();

    </div>

    <div>

    for (const auto& point : way_points) {

    </div>

    <div>

    roi_point-\>add_point()-\>CopyFrom(point);

    </div>

    <div>

    }

    </div>

    <div>

    // Copy end point

    </div>

    <div>

    command-\>mutable_parking_spot_pose()-\>CopyFrom(end);

    </div>

    <div>

    std::cout \<\< "Sending lane follow command: " \<\< command-\>DebugString() \<\< std::endl;

    </div>

    <div>

    auto response = free_space_command_client\_-\>SendRequest(command);

    </div>

    <div>

    if (nullptr == response) {

    </div>

    <div>

    std::cout \<\< "Command sending failed, please check the service is on!\n" \<\< std::endl;

    </div>

    <div>

    } else {

    </div>

    <div>

    std::cout \<\< "\*\*\*\*\*\*Finish sending command.\*\*\*\*\*\*\n" \<\< std::endl;

    </div>

    <div>

    }

    </div>

    <div>

    }

    </div>

    </div>

    remote_control_command_demo.h：

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

    \#include \<string\>

    </div>

    <div>

    \#include \<vector\>

    </div>

    <div>

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/action_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/chassis_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/command_status.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/free_space_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/lane_follow_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/path_follow_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/speed_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/external_command_msgs/valet_parking_command.pb.h"

    </div>

    <div>

    \#include "modules/common_msgs/planning_msgs/planning.pb.h"

    </div>

    <div>

    </div>

    <div>

    \#include "cyber/component/timer_component.h"

    </div>

    <div>

    \#include "cyber/cyber.h"

    </div>

    <div>

    \#include "modules/common/service_wrapper/client_wrapper.h"

    </div>

    <div>

    \#include "modules/common/util/message_util.h"

    </div>

    <div>

    </div>

    <div>

    class RemoteCotrolCommandDemo final : public apollo::cyber::TimerComponent {

    </div>

    <div>

    public:

    </div>

    <div>

    RemoteCotrolCommandDemo();

    </div>

    <div>

    </div>

    <div>

    bool Init() override;

    </div>

    <div>

    </div>

    <div>

    bool Proc() override;

    </div>

    <div>

    </div>

    <div>

    private:

    </div>

    <div>

    template \<typename T\>

    </div>

    <div>

    void FillCommandHeader(const std::shared_ptr\<T\>& command);

    </div>

    <div>

    </div>

    <div>

    void SendFreespaceCommand(

    </div>

    <div>

    const std::vector\<apollo::external_command::Point\>& way_points,

    </div>

    <div>

    const apollo::external_command::Pose& end);

    </div>

    <div>

    </div>

    <div>

    std::shared_ptr\<apollo::common::ClientWrapper\<

    </div>

    <div>

    apollo::external_command::ActionCommand,

    </div>

    <div>

    apollo::external_command::CommandStatus\>\>

    </div>

    <div>

    action_command_client\_;

    </div>

    <div>

    std::shared_ptr\<apollo::common::ClientWrapper\<

    </div>

    <div>

    apollo::external_command::FreeSpaceCommand,

    </div>

    <div>

    apollo::external_command::CommandStatus\>\>

    </div>

    <div>

    free_space_command_client\_;

    </div>

    <div>

    std::shared_ptr\<apollo::common::ClientWrapper\<

    </div>

    <div>

    apollo::external_command::LaneFollowCommand,

    </div>

    <div>

    apollo::external_command::CommandStatus\>\>

    </div>

    <div>

    lane_follow_command_client\_;

    </div>

    <div>

    </div>

    <div>

    uint64_t command_id\_;

    </div>

    <div>

    const std::string module_name\_;

    </div>

    <div>

    };

    </div>

    <div>

    </div>

    <div>

    template \<typename T\>

    </div>

    <div>

    void RemoteCotrolCommandDemo::FillCommandHeader(const std::shared_ptr\<T\>& command) {

    </div>

    <div>

    apollo::common::util::FillHeader(module_name\_, command.get());

    </div>

    <div>

    command-\>set_command_id(++command_id\_);

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    CYBER_REGISTER_COMPONENT(RemoteCotrolCommandDemo);

    </div>

    </div>

    cyberfile.xml：

    <div>

    <div>

    \<package format="2"\>

    </div>

    <div>

    \<name\>external-command-demo\</name\>

    </div>

    <div>

    \<version\>local\</version\>

    </div>

    <div>

    \<description\> The package contains temp component for converting routing message to external command. \</description\>

    </div>

    <div>

    \<maintainer email="apollo-support@baidu.com"\>Apollo\</maintainer\>

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

    \<type\>module\</type\>

    </div>

    <div>

    \<src_path url="https://github.com/ApolloAuto/apollo"\>//remote_control_command_demo\</src_path\>

    </div>

    <div>

    \<depend repo_name="com_github_gflags_gflags" lib_names="gflags"\>3rd-gflags\</depend\>

    </div>

    <div>

    \<depend type="binary" repo_name="common" lib_names="common"\>common\</depend\>

    </div>

    <div>

    \<depend repo_name="routing" type="binary"\>routing\</depend\>

    </div>

    <div>

    \</package\>

    </div>

    </div>

    BUILD：

    <div>

    <div>

    load("//tools:cpplint.bzl", "cpplint")

    </div>

    <div>

    load("//tools:apollo_package.bzl", "apollo_cc_binary", "apollo_cc_library", "apollo_cc_test", "apollo_component", "apollo_package")

    </div>

    <div>

    </div>

    <div>

    package(default_visibility = \["//visibility:public"\])

    </div>

    <div>

    </div>

    <div>

    apollo_component(

    </div>

    <div>

    name = "libremote_control_command_demo_component.so",

    </div>

    <div>

    hdrs = \["remote_control_command_demo.h"\],

    </div>

    <div>

    srcs = \["remote_control_command_demo.cc"\],

    </div>

    <div>

    copts = \["-DMODULE_NAME=\\\\external_command_demo\\\\"\],

    </div>

    <div>

    deps = \[

    </div>

    <div>

    "//cyber",

    </div>

    <div>

    "//modules/common/util:message_util",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:command_status_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:action_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:chassis_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:free_space_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:lane_follow_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:path_follow_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:speed_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/external_command_msgs:valet_parking_command_cc_proto",

    </div>

    <div>

    "//modules/common_msgs/planning_msgs:planning_cc_proto",

    </div>

    <div>

    "//modules/common/service_wrapper:client_wrapper",

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

    filegroup(

    </div>

    <div>

    name = "conf",

    </div>

    <div>

    srcs = glob(\[

    </div>

    <div>

    "conf/\*",

    </div>

    <div>

    "dag/\*",

    </div>

    <div>

    "launch/\*"

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

    cpplint()

    </div>

    <div>

    apollo_package()

    </div>

    </div>

    dag/remote_control_command_demo.dag：

    <div>

    <div>

    module_config {

    </div>

    <div>

    module_library : "remote_control_command_demo/libremote_control_command_demo_component.so"

    </div>

    <div>

    timer_components {

    </div>

    <div>

    class_name : "RemoteCotrolCommandDemo"

    </div>

    <div>

    config {

    </div>

    <div>

    name: "remote_control_command_demo_component"

    </div>

    <div>

    interval: 200 \# milliseconds

    </div>

    <div>

    }

    </div>

    <div>

    }

    </div>

    <div>

    }

    </div>

    </div>

    launch/remote_control_command_demo.launch：

    <div>

    <div>

    \<cyber\>

    </div>

    <div>

    \<module\>

    </div>

    <div>

    \<name\>remote_control_command_demo\</name\>

    </div>

    <div>

    \<dag_conf\>remote_control_command_demo/dag/remote_control_command_demo.dag\</dag_conf\>

    </div>

    <div>

    \<process_name\>remote_control_command_demo\</process_name\>

    </div>

    <div>

    \</module\>

    </div>

    <div>

    \</cyber\>

    </div>

    </div>

    conf/remote_control_command_demo.conf：

    <div>

    <div>

    --flagfile=/apollo/modules/common/data/global_flagfile.txt

    </div>

    </div>

4.  代码文件拷贝完毕后，点击左上角保存代码文件。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_558dca9.png)

5.  点击上一个网页链接，返回操作终端。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_ee67a23.png)

6.  执行下面指令，执行代码编译操作；

    编译远程控制车辆模块：

    <div>

    <div>

    buildtool init

    </div>

    <div>

    buildtool build -p remote_control_command_demo

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_932118c.png)

7.  如下图所示，正常情况会编译成功；如果编译失败，请检查代码的替换内容是否正确（检查完毕后保存后，重新执行5编译操作指令即可）。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_4d9df4b.png)

###  2. 启动远程控制车辆模块

1.  在终端中，执行下面命令启动远程控制车辆模块，执行成功后，如下图所示。

    远程命令模块：

    <div>

    <div>

    mainboard -d remote_control_command_demo/dag/remote_control_command_demo.dag

    </div>

    </div>

2.  执行成功后，如下图所示，此进程会被单独的挂起：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_cc8e694.png)

###  3. 启动DreamView+

在新的终端中，执行`aem bootstrap start --plus`启动 DreamView+，执行成功后，点击菜单栏 Dreamview+ 按钮，进入 Dreamview+ 界面。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_8c9001f.png)

启动 Dreamview+ 命令：

<div>

<div>

aem bootstrap start --plus



![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_5de4f6c.png)

当出现如下，即表示 Dreamview+ 启动成功了。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_ebb7089.png)

点击左下角 **个人中心** \> **设置** \> **全局设置** ，可以选择界面语言类型。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a957a49.png)

###  4. 启动车辆的运行环境

1.  点击左侧菜单栏，选择 PnC 模式，操作选择 Sim_Control（首次进入异常，请点击刷新按钮）。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_911ffee.png)

2.  开启 Planning、Prediction 和 TaskManager 模块，此时 Dreamview+ 会启动这些模块。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a389f11.png)

3.  点击 **路由编辑** 按钮，此时开始为车辆进行构建相应的 routing 信息；

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_061d28f.png)

4.  点击 **初始位置** 按钮，选择车辆运行的初始位姿（目前仅支持选择在地图场景内）；

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a6a5018.png)

5.  点击 **轨迹点** 按钮，选择车辆运行的终点（可以选择多个），构建车辆运行的终点位置（目前仅支持选择在地图场景内），选择完毕后，点击 **保存编辑** 按钮，此时构建的运行场景信息被保存。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_e00dd23.png)

6.  运行场景信息构建完毕后，点击左下角的运行按钮，车辆构建一条由初始位置到终点的轨迹线，车辆会正常的沿着轨迹线开始行驶。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_2116e2e.png)

7.  运行过程中如果需要暂停当前场景的运行，可以点击左下角的暂停按钮，此时车辆会暂停在当前位置，再次点击运行按钮车辆会继续沿着轨迹线行驶。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_2841cba.png)

###  5. 发送远程控制指令

1.  点击 Dreamview+ 左下角运行按钮，保证车辆沿着当前的轨迹线行驶，切换至远程控制终端，在终端输入 **STOP** 指令，车辆会由 **LANE_FOLLOW** 场景进入 **EMERGENCY_STOP** 场景（如 Dreamview+ 所示），车辆会在当前位置缓慢停止。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_2f3a594.png)

    切换至 Dreamview+ 界面，可以发现车辆已经执行急刹指令；

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_87e76c9.png)

2.  继续在终端输入 START 指令，车辆会再次进入 **LANE_FOLLOW** 场景，车辆会继续沿着当前的的 routing 线行驶，如下图 Dreamview+ 界面所示；

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c873f7b.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_777d320.png)

3.  在终端输入 **pull_over** 指令，车辆会进入 **PULL_OVER** 场景，车辆会执行靠边停车指令；

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_3797af1.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_38e0af0.png)

4.  继续在终端输入 **START** 指令，车辆会由 **PULL_OVER** 场景再次进入 **LANE_FOLLOW** 场景，车辆会继续沿着当前的的 routing 线行驶。

5.  当我们向终端发送错误的指令时，例如： **aaaa** ，系统无法识别指令，会提醒我们是无效的指令，对当前车辆的运行场景无影响。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_0d0e863.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

