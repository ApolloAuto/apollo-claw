<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Cyber RT 之 Component 实践

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_f6248ca93a3ec4aadf57748118219b6d.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_f6248ca93a3ec4aadf57748118219b6d.html)
> 抓取时间：2026-09-08


##  实验内容

Component 是 Cyber RT 提供的用来构建功能模块的基础类，Component 有两种类型，分别为 Component 和 TimerComponent。Component 提供消息融合机制，最多可以支持 4 路消息融合，当 从多个 Channel 读取数据的时候，以第一个 Channel 为主 Channel。当主 Channel 有消息到达，Cyber RT会调用 Component的 Proc() 进行一次数据处理。本实验将编写一个 Component 消息融合实例，输入消息为上一个 TimerComponent 实验产生的数据，输出融合后的数据。

##  体验地址

<https://apollo.baidu.com/community/course/42>

##  实验目的

- 深入理解 Component 的特性。
- 掌握实现 Component 的方法及流程。

##  实验流程

###  1. 前期准备

由于本实验是以上一个 TimerCoponent 实验为基础的，本实验要使用到TimerCoponent实验的输出数据，对其输出数据进行数据融合，上一个实验源码已经为大家准备好了，请按照如下步骤进行实验前的准备工作：

1.  使用以下命令解压 TimerCoponent 源码压缩文件

    <div>

    <div>

    tar -zxvf component.tar.gz

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_58eeec9.png)

2.  使用以下命令编译解压的 TimerComponent 实验源码：

    <div>

    <div>

    buildtool build -p component/timer_component_sensor/

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_d222781.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_8c56f76.png)

3.  修改`timer_component_sensor`配置文件，产生一路新的消息：

1）新增`timer_component_sensor_second.pb.txt`文件。复制`timer_component_sensor.pb.txt`文件，并重命名为`timer_component_sensor_second.pb.txt`，修改该文件内的配置项。

<div>

<div>

name: "sensor_second"


<div>

sensor_topic:"/sensor/second"



将 name 值修改为 sensor_second；将 sensor_topic 值修改为 /sensor/second。

> ‍注意：这里timer_component_sensor_second.pb.txt文件与timer_component_sensor.pb.txt文件位于同一文件夹内。

2）新增`timer_component_sensor_second.dag`文件。复制`timer_component_sensor.dag`文件，并重命名为`timer_component_sensor_second.dag`，修改该文件内的配置项。

<div>

<div>

module_config {


<div>

module_library : "component/timer_component_sensor/libtimer_component_sensor_component.so"


<div>

timer_components {


<div>

class_name : "TimerComponentSensor"


<div>

config {


<div>

name: "timer_component_sensor_second"


<div>

config_file_path: "component/timer_component_sensor/conf/timer_component_sensor_second.pb.txt"


<div>

flag_file_path: "component/timer_component_sensor/conf/timer_component_sensor.conf"


<div>

interval: 800


<div>

}


<div>

}


<div>

}



将 config 中的 name 值修改为`timer_component_sensor_second`；

将 config_file_path 值修改为`timer_component_sensor_second.pb.txt`文件所在路径；

将 intercal 值修改 800 。

> ‍注意：这里`timer_component_sensor_second.dag`文件与`timer_component_sensor.dag`文件位于同一文件夹内。

3）新增`timer_component_sensor_second.launch`文件，复制`timer_component_sensor.launch`文件，并重命名为`timer_component_sensor_second.launch`，修改该文件内的配置项。

<div>

<div>

\<cyber\>


<div>

\<module\>


<div>

\<name\>timer_component_sensor\</name\>


<div>

\<dag_conf\>./component/timer_component_sensor/dag/timer_component_sensor_second.dag\</dag_conf\>


<div>

\<process_name\>timer_component_sensor\</process_name\>


<div>

\</module\>


<div>

\</cyber\>



将 dag_conf 修改为`timer_component_sensor_second.dag`文件所在的路径。

> ‍注意：这里`timer_component_sensor_second.launch`文件与`timer_component_sensor.launch`文件位于同一文件夹内。

1.  使用以下命令，运行`timer_component_sensor_second.launch`文件。

    <div>

    <div>

    cyber_launch start component/timer_component_sensor/launch/timer_component_sensor_second.launch

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_2e0d265.png)

2.  使用 cyber_monitor 工具验证，配置是否生效。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_bf22ba3.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_d2cf9b1.png)

    若 /sensor/second channel 有数据、数据帧率为 1.25、且数据内容与配置的一致，表示配置成功。

3.  最后，在终端中，使用 **Ctrl+C** 组合键，结束程序运行。

###  2. 创建Component模板实例

1.  在终端中，执行以下指令，在 component 文件夹下生成 component_fusion_message 模板实例（功能包）。

    <div>

    <div>

    buildtool create --template component component/component_fusion_message

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_d97f121.png)

2.  切换目录到生成的`component_fusion_message`目录下，使用 tree 命令查看生成的 component 功能包的目录结构。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_e5320f8.png)

    其中，`BUILD`、`component_fusion_message.cc`和`component_fusion_message.h`三个文件分别为 component_fusion_message 功能包的源码编译规则文件、源文件和头文件；conf 目录下，`component_fusion_message.conf`为全局变量配置文件，`component_fusion_message.pb.txt`为用户在`protobuffer`文件中定义的可配置项的配置文件；`cyberfile.xml`为`component_fusion_message`功能包的描述文件；dag 目录下的`component_fusion_message.dag`文件中描述了`component_fusion_message`功能包的依赖关系；launch 文件夹下的`component_fusion_message.launch`为`component_fusion_message`功能包的 launch 启动文件；proto 文件夹下的 BUILD 为用户在 proto 文件夹下定义的`protobuffer`文件的编译规则文件，`component_fusion_message.proto`文件中用户可以定义自己的消息结构。

###  3. 定义Component消息结构

1.  在`component_fusion_message.proto`中，添加以下消息数据结构。

    <div>

    <div>

    syntax = "proto2";

    </div>

    <div>

    </div>

    <div>

    package apollo;

    </div>

    <div>

    </div>

    <div>

    // message type of channel, just a placeholder for demo,

    </div>

    <div>

    // you should use \`--channel_message_type\` option to specify the real message type

    </div>

    <div>

    message ComponentFusionMessageMsg {

    </div>

    <div>

    optional string fusion_content = 1;

    </div>

    <div>

    optional uint64 fusion_msg_id = 2;

    </div>

    <div>

    optional uint64 timestamp = 3;

    </div>

    <div>

    </div>

    <div>

    }

    </div>

    <div>

    </div>

    <div>

    message ComponentFusionMessageConfig {

    </div>

    <div>

    optional string name = 1;

    </div>

    <div>

    optional string fusion_topic = 2;

    </div>

    <div>

    };

    </div>

    </div>

    在`ComponentFusionMessageMsg`中添加 fusion_content、fusion_msg_id 和 timestamp 3 项，分别表示消息内容，消息编号和消息发出时的时间戳。

    在`ComponentFusionMessageConfig`中添加可配置项 name 和 fusion_topic ，用来配置 `ComponentFusionMessageConfig`的名称标识和输出数据的 channel。

2.  在 proto 文件夹下的 BUILD 文件中，添加`protobuffer`文件的编译规则。

    <div>

    <div>

    load("//tools:apollo_package.bzl", "apollo_package")

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

    name = "component_fusion_message_proto",

    </div>

    <div>

    srcs = \["component_fusion_message.proto"\],

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

    由于没有新增`protobuffer`文件，这里无需修改 BUILD 文件，如若新增`protobuffer`文件，可参考 BUILD 文件中已有的配置规则，添加对应`protobuffer`的编译规则。

###  4. 配置Component的配置文件

由于本实验没有涉及全局变量，这里无需对component_fusion_message.conf文件进行修改；在`component_fusion_message.pb.txt`中，配置`proto`文件中定义的可配置项。

<div>

<div>

name: "fusion_message"


<div>

fusion_topic: "/fusion/message"



将`component_fusion_message.proto`文件中`ComponentFusionMessageConfig`消息中定义的 name 配置为 fusion_message，将 sensor_topic 配置为 /fusion/message。

###  5. 编写Component的源文件

1.  修改`component_fusion_message.h`文件。

    <div>

    <div>

    \#pragma once

    </div>

    <div>

    \#include \<memory\>

    </div>

    <div>

    </div>

    <div>

    \#include "cyber/cyber.h"

    </div>

    <div>

    \#include "cyber/component/component.h"

    </div>

    <div>

    \#include "component/component_fusion_message/proto/component_fusion_message.pb.h"

    </div>

    <div>

    \#include "component/timer_component_sensor/proto/timer_component_sensor.pb.h"

    </div>

    <div>

    </div>

    <div>

    using apollo::cyber::Time;

    </div>

    <div>

    using apollo::cyber::Writer;

    </div>

    <div>

    </div>

    <div>

    namespace apollo {

    </div>

    <div>

    </div>

    <div>

    class ComponentFusionMessage final

    </div>

    <div>

    : public cyber::Component\<apollo::TimerComponentSensorMsg, apollo::TimerComponentSensorMsg\> {

    </div>

    <div>

    public:

    </div>

    <div>

    bool Init() override;

    </div>

    <div>

    bool Proc(const std::shared_ptr\<apollo::TimerComponentSensorMsg\>& msg0, const std::shared_ptr\<apollo::TimerComponentSensorMsg\>& msg1) override;

    </div>

    <div>

    </div>

    <div>

    private:

    </div>

    <div>

    apollo::ComponentFusionMessageConfig config\_;

    </div>

    <div>

    std::shared_ptr\<Writer\<ComponentFusionMessageMsg\>\> fusion_writer\_ = nullptr;

    </div>

    <div>

    };

    </div>

    <div>

    </div>

    <div>

    CYBER_REGISTER_COMPONENT(ComponentFusionMessage)

    </div>

    <div>

    </div>

    <div>

    } // namespace apollo

    </div>

    </div>

    由于 component 要融合的消息类型是`TimerComponentSensorMsg`，这里需要包含（include）定义`TimerComponentSensorMsg`的头文件（timer_component_sensor.pb.h）。

    使用 **using** 引入将 **[apollo::cyber](https://apollo.baidu.com/docs/apollo/latest/namespaceapollo_1_1cyber.html)** 命名空间下的 **Time** 和 **Write** 注入当前作用域中；

    修改类继承 component 的模板参数；将模板参数改为要融合的消息类型，两个参数。

    修改 Proc 函数的输入参数；将 Proc 函数的输入参数修改为 **TimerComponentSensorMsg** 的指针。

    ComponentFusionMessage 类增加私有成员 fusion\*writer\*，fusion\*writer\* 是智能指针，指向 Writer 对象，Writer 对象可以写出`ComponentFusionMessageMsg`数据。

2.  修改`component_fusion_message.cc`文件。

    <div>

    <div>

    \#include "component/component_fusion_message/component_fusion_message_component.h"

    </div>

    <div>

    </div>

    <div>

    namespace apollo {

    </div>

    <div>

    </div>

    <div>

    bool ComponentFusionMessage::Init() {

    </div>

    <div>

    </div>

    <div>

    ACHECK(ComponentBase::GetProtoConfig(&config\_))

    </div>

    <div>

    \<\< "failed to load component_fusion_message config file "

    </div>

    <div>

    \<\< ComponentBase::ConfigFilePath();

    </div>

    <div>

    </div>

    <div>

    AINFO \<\< "Load config succedded.\n" \<\< config\_.DebugString();

    </div>

    <div>

    </div>

    <div>

    fusion_writer\_ = node\_-\>CreateWriter\<ComponentFusionMessageMsg\>(config\_.fusion_topic().c_str());

    </div>

    <div>

    </div>

    <div>

    AINFO \<\< "Init ComponentFusionMessage succedded.";

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

    bool ComponentFusionMessage::Proc(const std::shared_ptr\<apollo::TimerComponentSensorMsg\>& msg0, const std::shared_ptr\<apollo::TimerComponentSensorMsg\>& msg1) {

    </div>

    <div>

    static int i = 0;

    </div>

    <div>

    auto out_msg = std::make_shared\<ComponentFusionMessageMsg\>();

    </div>

    <div>

    out_msg-\>set_fusion_msg_id(i++);

    </div>

    <div>

    </div>

    <div>

    std::string merged_content = msg0-\>content() + ":msg" + std::to_string(msg0-\>msg_id()) +

    </div>

    <div>

    " \<---\> " +

    </div>

    <div>

    msg1-\>content() + ":msg" + std::to_string(msg1-\>msg_id());

    </div>

    <div>

    </div>

    <div>

    out_msg-\>set_fusion_content(merged_content);

    </div>

    <div>

    out_msg-\>set_timestamp(Time::Now().ToNanosecond());

    </div>

    <div>

    fusion_writer\_-\>Write(out_msg);

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

    } // namespace apollo

    </div>

    </div>

    在 Init 函数中增加智能指针 fusion\*write\* 的初始化；

    修改 Proc 函数的输入参数与头文件中的定义一致；

    在 Proc 函数中创建`ComponentFusionMessageMsg`消息，并通过 fusion\*writer\* 发出消息到对应的 channel。

3.  修改`BUILD`文件。

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

    filegroup(

    </div>

    <div>

    name = "component_fusion_message_files",

    </div>

    <div>

    srcs = glob(\[

    </div>

    <div>

    "dag/\*\*",

    </div>

    <div>

    "launch/\*\*",

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

    apollo_component(

    </div>

    <div>

    name = "libcomponent_fusion_message_component.so",

    </div>

    <div>

    srcs = \[

    </div>

    <div>

    "component_fusion_message_component.cc",

    </div>

    <div>

    \],

    </div>

    <div>

    hdrs = \[

    </div>

    <div>

    "component_fusion_message_component.h",

    </div>

    <div>

    \],

    </div>

    <div>

    linkstatic = True,

    </div>

    <div>

    deps = \[

    </div>

    <div>

    "//cyber",

    </div>

    <div>

    "//component/component_fusion_message/proto:component_fusion_message_proto",

    </div>

    <div>

    "//component/timer_component_sensor/proto:timer_component_sensor_proto",

    </div>

    <div>

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

    由于源文件中由于包含了`timer_component_sensor.pb.h`，需要在编译的依赖项中添加对应的依赖项。

###  6. 编译TimerComponent功能包

在终端中，执行以下指令，编译`component_fusion_message`功能包。

<div>

<div>

buildtool build -p component/component_fusion_message/



![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_f489afb.png)

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_5187f81.png)

编译成功，没有报错，若编译报错，请按照报错提示，修改代码后，重新编译，直到编译成功。

###  7. 修改Component的dag文件

在`component_fusion_message.dag`文件中，将第一个 readers 相中的 channel 值改为 component 中融合的主 channel， 在主 channel readers下面添加需要融合的其它 readers 配置，并配置正确的 channel。

<div>

<div>

module_config {


<div>

module_library : "component/component_fusion_message/libcomponent_fusion_message_component.so"


<div>

components {


<div>

class_name : "ComponentFusionMessage"


<div>

config {


<div>

name : "component_fusion_message"


<div>

config_file_path: "component/component_fusion_message/conf/component_fusion_message.pb.txt"


<div>

flag_file_path: "component/component_fusion_message/conf/component_fusion_message.conf"


<div>

readers {


<div>

channel: "/sensor/first"


<div>

}


<div>

readers {


<div>

channel: "/sensor/second"


<div>

}


<div>

}


<div>

}


<div>

}



这里将 readers 中的 channel 值修改为 /sensor/first ，并在 readers 项下面添加新的 readers 项，并将其 channel 值配置为 /sensor/second。

###  8. 修改Component的launch文件

<div>

<div>

\<cyber\>


<div>

\<module\>


<div>

\<name\>component_fusion_message\</name\>


<div>

\<dag_conf\>./component/component_fusion_message/dag/component_fusion_message.dag\</dag_conf\>


<div>

\<process_name\>component_fusion_message\</process_name\>


<div>

\</module\>


<div>

\</cyber\>



这里在 \<dag_conf\> 标签内的 dag 文件路径前加上“ ./ ” 。由于目前 cyber 与 apollo 绑定的比较紧密，编译完成后，系统会把编译产出及配置文件拷贝到 apollo 相应目录下，且执行文件时，系统会优先执行 apollo 目录下的文件，这样就会导致此处的配置无法起作用，这里加上“ ./ ”，就是告诉系统使用此处的dag文件来运行 component 。

###  9. 运行Component

1.  使用两个终端分别启动两个 TimerComponent，产生两路消息。

    产生 /sensor/first 消息

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_3f455b3.png)

    产生 /sensor/second 消息

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_4d1d207.png)

2.  新启一个终端，在其中启动`component_fusion_message`，进行两路消息融合处理。

    将 /sensor/first 与 /sensor/second 融合后，产生 /fusion/message 消息。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_81ebe14.png)

###  10. 查看Component运行结果

1.  使用 cyber_monitor 工具查看`component_fusion_message`运行结果。

    可以看到 /fusion/message 的帧率与 主 channel 消息 /sensor/first 的帧率一致。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_1774b35.png)

2.  使用 cyber_channel 工具打印 /fusion/message 消息。

    可以看到主 channel 的消息 msg_id 变化了，而另一个 channel 的消息却没的现象，这也验证了 component 是由主 channel 消息出发的。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_ed1ff48.png)

###  11. 一个launch文件启动多个component

复制`component_fusion_message.launch`文件，并重命名为`component_fusion_message_all.launch`，将`timer_component_sensor.launch`文件和`timer_component_sensor_second.launch`文件中的 \<module\> 标签内容拷贝到`component_fusion_message_all.launch`中的 \<cyber\> 标签内。这样，就可以只启动此`component_fusion_message_all.launch`文件即可一次启动 3 个 component 了。

<div>

<div>

\<cyber\>


<div>

\<module\>


<div>

\<name\>timer_component_sensor\</name\>


<div>

\<dag_conf\>./component/timer_component_sensor/dag/timer_component_sensor.dag\</dag_conf\>


<div>

\<process_name\>timer_component_sensor\</process_name\>


<div>

\</module\>


<div>


<div>

\<module\>


<div>

\<name\>timer_component_sensor\</name\>


<div>

\<dag_conf\>./component/timer_component_sensor/dag/timer_component_sensor_second.dag\</dag_conf\>


<div>

\<process_name\>timer_component_sensor\</process_name\>


<div>

\</module\>


<div>


<div>

\<module\>


<div>

\<name\>component_fusion_message\</name\>


<div>

\<dag_conf\>./component/component_fusion_message/dag/component_fusion_message.dag\</dag_conf\>


<div>

\<process_name\>component_fusion_message\</process_name\>


<div>

\</module\>


<div>

\</cyber\>



![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_fb11746.png)

好的，本次实验到此结束。

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

