<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Cyber通信机制实践之Listener-Talker通信（C++）

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_a18922c91e99ca11c8c443388e671499.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_a18922c91e99ca11c8c443388e671499.html)
> 抓取时间：2026-09-08


##  实验简介

构建一个简单的通信流程，发送方通过 Cyber 的 [Node](https://apollo.baidu.com/docs/apollo/latest/classNode.html) 创建 Writer，接受方通过 Cyber 的 [Node](https://apollo.baidu.com/docs/apollo/latest/classNode.html) 创建 Reader，发送方实时发送车辆的速度，接受方将接受到的车辆速度进行打印。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_9baa590.png)

##  体验地址

<https://apollo.baidu.com/community/course/37>

##  实验目的

通过 Cyber 的发布-订阅机制，实现一个节点发布消息，另一个节点订阅并接收该消息，了解 cyber 的基础通信知识。

##  前置条件

本实验需要您对 C++ 代码有一定的了解。

##  实践流程

###  1. 编写代码

1.  创建代码结构目录。

    <div>

    <div>

    buildtool create --template component communication

    </div>

    <div>

    touch /apollo_workspace/communication/listener.cc

    </div>

    <div>

    touch /apollo_workspace/communication/talker.cc

    </div>

    </div>

    检验目录结构是否正确。

    输入指令：

    <div>

    <div>

    tree communication/

    </div>

    </div>

    目录结构：

    <div>

    <div>

    communication

    </div>

    <div>

    ├── BUILD

    </div>

    <div>

    ├── communication.cc

    </div>

    <div>

    ├── communication.h

    </div>

    <div>

    ├── conf

    </div>

    <div>

    │ ├── communication.conf

    </div>

    <div>

    │ └── communication.pb.txt

    </div>

    <div>

    ├── cyberfile.xml

    </div>

    <div>

    ├── dag

    </div>

    <div>

    │ └── communication.dag

    </div>

    <div>

    ├── launch

    </div>

    <div>

    │ └── communication.launch

    </div>

    <div>

    ├── listener.cc \<必须有\>

    </div>

    <div>

    ├── proto \<必须有\>

    </div>

    <div>

    │ ├── BUILD \<必须有\>

    </div>

    <div>

    │ └── communication.proto \<必须有\>

    </div>

    <div>

    └── talker.cc \<必须有\>

    </div>

    </div>

2.  定义此次通信消息的数据结构，编写`proto/communication.proto`文件，内容如下：

    <div>

    <div>

    syntax = "proto2";

    </div>

    <div>

    </div>

    <div>

    package apollo.communication.proto;

    </div>

    <div>

    </div>

    <div>

    //定义一个车的消息，车的型号，车主，车的车牌号,已跑公里数,车速

    </div>

    <div>

    message Car{

    </div>

    <div>

    optional string plate = 1;

    </div>

    <div>

    optional string type = 2;

    </div>

    <div>

    optional string owner = 3;

    </div>

    <div>

    optional uint64 kilometers = 4;

    </div>

    <div>

    optional uint64 speed = 5;

    </div>

    <div>

    };

    </div>

    </div>

3.  编写发送方 talker 代码，talker.cc 代码如下：

    <div>

    <div>

    \#include "communication/proto/communication.pb.h"

    </div>

    <div>

    \#include "cyber/cyber.h"

    </div>

    <div>

    \#include "cyber/time/rate.h"

    </div>

    <div>

    </div>

    <div>

    //car数据定义的引用，可以看出其定义来源于一个proto

    </div>

    <div>

    using apollo::communication::proto::Car;

    </div>

    <div>

    </div>

    <div>

    int main(int argc, char \*argv\[\]) {

    </div>

    <div>

    // 初始化一个cyber框架

    </div>

    <div>

    apollo::cyber::Init(argv\[0\]);

    </div>

    <div>

    // 创建talker节点

    </div>

    <div>

    auto talker_node = apollo::cyber::CreateNode("talker");

    </div>

    <div>

    // 从节点创建一个Topic,来实现对车速的查看

    </div>

    <div>

    auto talker = talker_node-\>CreateWriter\<Car\>("car_speed");

    </div>

    <div>

    AINFO \<\< "I'll start telling you the current speed of the car.";

    </div>

    <div>

    </div>

    <div>

    //设置初始速度为0，然后速度每秒增加5km/h

    </div>

    <div>

    uint64_t speed = 0;

    </div>

    <div>

    while (apollo::cyber::OK()) {

    </div>

    <div>

    auto msg = std::make_shared\<Car\>();

    </div>

    <div>

    msg-\>set_speed(speed);

    </div>

    <div>

    //假设车速持续增加

    </div>

    <div>

    speed += 5;

    </div>

    <div>

    talker-\>Write(msg);

    </div>

    <div>

    sleep(1);

    </div>

    <div>

    }

    </div>

    <div>

    return 0;

    </div>

    <div>

    }

    </div>

    </div>

4.  编写接受方 listener 代码，listener.cc 代码如下：

    <div>

    <div>

    \#include "communication/proto/communication.pb.h"

    </div>

    <div>

    \#include "cyber/cyber.h"

    </div>

    <div>

    </div>

    <div>

    using apollo::communication::proto::Car;

    </div>

    <div>

    </div>

    <div>

    //接收到消息后的响应函数

    </div>

    <div>

    void message_callback(

    </div>

    <div>

    const std::shared_ptr\<Car\>& msg) {

    </div>

    <div>

    AINFO \<\< "now speed is: " \<\< msg-\>speed();

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    int main(int argc, char\* argv\[\]) {

    </div>

    <div>

    //初始化cyber框架

    </div>

    <div>

    apollo::cyber::Init(argv\[0\]);

    </div>

    <div>

    //创建监听节点

    </div>

    <div>

    auto listener_node = apollo::cyber::CreateNode("listener");

    </div>

    <div>

    //创建监听响应进行消息读取

    </div>

    <div>

    auto listener = listener_node-\>CreateReader\<Car\>(

    </div>

    <div>

    "car_speed", message_callback);

    </div>

    <div>

    apollo::cyber::WaitForShutdown();

    </div>

    <div>

    return 0;

    </div>

    <div>

    }

    </div>

    </div>

5.  修改 BUILD 文件，将新写的代码加入到编译中，`communication/BUILD`文件修改如下：

    <div>

    <div>

    load("//tools:apollo_package.bzl", "apollo_cc_library", "apollo_cc_binary", "apollo_package", "apollo_component")

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

    apollo_cc_binary(

    </div>

    <div>

    name = "talker",

    </div>

    <div>

    srcs = \["talker.cc"\],

    </div>

    <div>

    deps = \[

    </div>

    <div>

    "//cyber",

    </div>

    <div>

    "//communication/proto:communication_proto",

    </div>

    <div>

    \],

    </div>

    <div>

    linkstatic = True,

    </div>

    <div>

    )

    </div>

    <div>

    apollo_cc_binary(

    </div>

    <div>

    name = "listener",

    </div>

    <div>

    srcs = \["listener.cc"\],

    </div>

    <div>

    deps = \[

    </div>

    <div>

    "//cyber",

    </div>

    <div>

    "//communication/proto:communication_proto",

    </div>

    <div>

    \],

    </div>

    <div>

    linkstatic = True,

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

###  2. 编译程序

<div>

<div>

//回到 /apollo_workspace目录下编译


<div>

cd /apollo_workspace


<div>

buildtool build -p communication



编译成功后显示如下信息：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_ff7ffc5.png)

###  3. 运行通信程序

####  1. 运行 talker 程序

打开新的终端，执行以下命令。

<div>

<div>

// 设置将输出结果到控制台


<div>

export GLOG_alsologtostderr=1


<div>

// 编译产生的可执行文件在 /opt/apollo/neo/bin/


<div>

cd /opt/apollo/neo/bin/


<div>

// 执行talker


<div>

./talker



####  2. 运行 listener 程序

再次打开一个新的终端，执行以下命令。

<div>

<div>

// 设置将输出结果到控制台


<div>

export GLOG_alsologtostderr=1


<div>

// 编译产生的可执行文件在 /opt/apollo/neo/bin/


<div>

cd /opt/apollo/neo/bin/


<div>

// 执行listener


<div>

./listener



###  4. 运行结果

talker 会一直给 listener 发送实时速度信息。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_151fd6c.png)

listener 收到后会将速度输出到控制台。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a5150d7.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

