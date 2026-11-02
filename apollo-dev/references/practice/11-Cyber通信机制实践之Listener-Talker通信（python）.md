<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Cyber通信机制实践之Listener-Talker通信（python）

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_bfea82f34c6a122ad41e33a034348abe.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_bfea82f34c6a122ad41e33a034348abe.html)
> 抓取时间：2026-09-08


##  实验简介

构建一个简单的通信流程，发送方通过 Cyber 的 [Node](https://apollo.baidu.com/docs/apollo/latest/classNode.html) 创建 Writer，接受方通过 Cyber 的 [Node](https://apollo.baidu.com/docs/apollo/latest/classNode.html) 创建 Reader，发送方实时发送车辆的速度，接受方将接受到的车辆速度进行打印。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_9d42b48.png)

##  体验地址

<https://apollo.baidu.com/community/course/38>

##  实验目的

通过 Cyber 的发布-订阅机制，实现一个节点发布消息，另一个节点订阅并接收该消息，了解 cyber 的基础通信知识。

##  前置条件

本实验需要您对 python 代码有一定的了解。

##  实践流程

###  1. 编写代码

1.  创建代码结构目录。

    <div>

    <div>

    buildtool create --template component communication

    </div>

    <div>

    touch /apollo_workspace/communication/listener.py

    </div>

    <div>

    touch /apollo_workspace/communication/talker.py

    </div>

    </div>

    检验目录结构是否正确：

    <div>

    <div>

    communication

    </div>

    <div>

    ├── BUILD \<必须有\>

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

    ├── listener.py \<必须有\>

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

    └── talker.py \<必须有\>

    </div>

    </div>

2.  定义此次通信消息的数据结构，编写proto/communication.proto文件，内容如下：

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

3.  编写发送方 talker 代码，talker.py 代码如下：

    <div>

    <div>

    import time

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber

    </div>

    <div>

    from communication.proto.communication_pb2 import Car

    </div>

    <div>

    </div>

    <div>

    def main():

    </div>

    <div>

    \# 初始化 Cyber

    </div>

    <div>

    cyber.init()

    </div>

    <div>

    </div>

    <div>

    \# 创建 talker 节点

    </div>

    <div>

    talker_node = cyber.Node("talker")

    </div>

    <div>

    </div>

    <div>

    \# 从节点创建一个 Topic，用于发送车速数据

    </div>

    <div>

    talker = talker_node.create_writer("/car_speed", Car)

    </div>

    <div>

    print("I'll start telling you the current speed of the car.")

    </div>

    <div>

    </div>

    <div>

    \# 设置初始速度为0，然后速度每秒增加5km/h

    </div>

    <div>

    speed = 0

    </div>

    <div>

    while not cyber.is_shutdown():

    </div>

    <div>

    msg = Car()

    </div>

    <div>

    msg.speed = speed

    </div>

    <div>

    \# 假设车速持续增加

    </div>

    <div>

    speed += 5

    </div>

    <div>

    talker.write(msg)

    </div>

    <div>

    time.sleep(1)

    </div>

    <div>

    </div>

    <div>

    if \_\_name\_\_ == '\_\_main\_\_':

    </div>

    <div>

    main()

    </div>

    </div>

4.  编写接受方 listener 代码，listener.py 代码如下：

    <div>

    <div>

    import time

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber

    </div>

    <div>

    from communication.proto.communication_pb2 import Car

    </div>

    <div>

    </div>

    <div>

    \# 接收到消息后的回调函数

    </div>

    <div>

    def message_callback(msg):

    </div>

    <div>

    print("now speed is:", msg.speed)

    </div>

    <div>

    </div>

    <div>

    def main():

    </div>

    <div>

    \# 初始化 Cyber

    </div>

    <div>

    cyber.init()

    </div>

    <div>

    </div>

    <div>

    \# 创建监听节点

    </div>

    <div>

    listener_node = cyber.Node("listener")

    </div>

    <div>

    </div>

    <div>

    \# 创建消息监听器并指定回调函数

    </div>

    <div>

    listener = listener_node.create_reader("/car_speed", Car, message_callback)

    </div>

    <div>

    </div>

    <div>

    while not cyber.is_shutdown():

    </div>

    <div>

    time.sleep(0.2)

    </div>

    <div>

    </div>

    <div>

    if \_\_name\_\_ == '\_\_main\_\_':

    </div>

    <div>

    main()

    </div>

    </div>

5.  将`communication/BUILD`修改为以下内容：

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

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_1b9204c.png)

###  3. 运行通信程序

####  1. 运行talker程序

打开新的终端，执行以下命令。

<div>

<div>

//设置将输出结果到控制台


<div>

export GLOG_alsologtostderr=1


<div>

//执行talker


<div>

python communication/talker.py



####  2. 运行listener程序

再次打开一个新的终端，执行以下命令：

<div>

<div>

//设置将输出结果到控制台


<div>

export GLOG_alsologtostderr=1


<div>

//执行listener


<div>

python communication/listener.py



###  4. 运行结果

talker 会一直给 listener 发送实时速度信息。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_dc88dab.png)

listener 收到后会将速度输出到控制台：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_6ac4c0f.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

