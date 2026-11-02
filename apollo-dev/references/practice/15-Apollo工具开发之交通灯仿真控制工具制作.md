<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Apollo工具开发之交通灯仿真控制工具制作

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_7b61f27581e04d3c77ebdd515d77df7f.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_7b61f27581e04d3c77ebdd515d77df7f.html)
> 抓取时间：2026-09-08


##  实验内容

本实验旨在使用 Apollo Cyber RT 开发交通灯仿真控制工具，通过该工具控制红绿灯状态。

##  体验地址

<https://apollo.baidu.com/community/course/39>

##  实验目的

通过本实验，学习如何使用 Apollo Cyber RT 开发交通灯仿真控制工具，并利用该工具控制红绿灯状态。

- 建立一个 cyber 工程，
- 熟悉 cyber 工具制作。

##  实践步骤

###  步骤一：启动仿真环境

1.  在终端中，执行 DreamView+ 启动指令，执行成功后，点击菜单栏 dreamview+ 按钮，进入 dreamview+ 界面。

    <div>

    <div>

    aem bootstrap start --plus

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_372016d.png)

    当出现如下，即表示 dreamview+ 启动成功了。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_bf50bff.png)

2.  左侧导航栏打开 **Mode Settings** 面板，模式选择 **PnC** Mode，操作选择 \*\*Sim_Control\*\*，进入仿真模式。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_3f6490d.png)

3.  选择地图。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c93b265.png)

4.  从左侧 **Modules** 模块种启动 Planning 模块。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_badef52.png)

###  步骤二：编辑代码实现任务功能

####  前置条件

在`/apollo_workspace`目录创建一个名为`cyber_trafficlight.py`的文件。

<div>

<div>

touch cyber_trafficlight.py



1.  导入必要的库和模块。

    首先，导入所需的 Python 库和 Apollo Cyber RT 模块。这些库和模块将帮助我们初始化 Cyber 框架并使用 Cyber RT 工具。

    <div>

    <div>

    import argparse

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber_time

    </div>

    <div>

    import modules.common_msgs.perception_msgs.traffic_light_detection_pb2 as traffic_light_detection_pb2

    </div>

    <div>

    import threading

    </div>

    <div>

    import time

    </div>

    </div>

2.  定义相关功能函数。

    在这一步中，我们将定义几个功能函数，用于实现脚本的不同功能。

    1）添加交通灯信息的函数。

    <div>

    <div>

    def add_traffic_light(color, traffic_light_pb):

    </div>

    <div>

    light = traffic_light_pb.traffic_light.add()

    </div>

    <div>

    light.color = color

    </div>

    <div>

    light.id = "红绿灯ID" \# 需要自行设置，这是交通灯的唯一标识

    </div>

    <div>

    light.tracking_time = 10.0 \# 设置跟踪时间，单位秒

    </div>

    </div>

    2）添加消息头信息的函数。

    <div>

    <div>

    seq_num = 0

    </div>

    <div>

    </div>

    <div>

    def add_header(msg):

    </div>

    <div>

    global seq_num

    </div>

    <div>

    msg.header.sequence_num = seq_num

    </div>

    <div>

    msg.header.timestamp_sec = cyber_time.Time.now().to_sec()

    </div>

    <div>

    msg.header.module_name = "manual_traffic_light"

    </div>

    <div>

    seq_num += 1 \# 递增序列号

    </div>

    </div>

    3）发布交通灯消息的函数。

    <div>

    <div>

    def publish_traffic_light(writer, traffic_light_msg):

    </div>

    <div>

    while not cyber.is_shutdown():

    </div>

    <div>

    add_header(traffic_light_msg) \# 添加消息头信息

    </div>

    <div>

    writer.write(traffic_light_msg) \# 发布交通灯消息

    </div>

    <div>

    time.sleep(0.1) \# 控制消息发布速率

    </div>

    </div>

3.  初始化 Cyber 框架和相关对象。

    在主函数中，我们需要初始化 Cyber 框架和相关对象，以便使用 Cyber RT 工具。

    <div>

    <div>

    if \_\_name\_\_ == '\_\_main\_\_':

    </div>

    <div>

    \# 初始化交通灯检测消息对象

    </div>

    <div>

    traffic_light_msg = traffic_light_detection_pb2.TrafficLightDetection()

    </div>

    <div>

    </div>

    <div>

    \# 初始化Cyber框架

    </div>

    <div>

    cyber.init()

    </div>

    <div>

    node = cyber.Node("traffic_light_command")

    </div>

    <div>

    </div>

    <div>

    \# 创建消息写入器

    </div>

    <div>

    writer = node.create_writer(

    </div>

    <div>

    "/apollo/perception/traffic_light", traffic_light_detection_pb2.TrafficLightDetection)

    </div>

    <div>

    </div>

    <div>

    \# 创建发布交通灯消息的线程

    </div>

    <div>

    thread = threading.Thread(target=publish_traffic_light, args=(writer, traffic_light_msg))

    </div>

    <div>

    thread.start()

    </div>

    </div>

4.  进入用户输入循环。

    在一个无限循环中，等待用户的输入。用户可以输入不同的命令，执行相应的操作。

    <div>

    <div>

    while not cyber.is_shutdown():

    </div>

    <div>

    user_input = input(

    </div>

    <div>

    "1: 设置交通灯为红色 2: 设置交通灯为绿色 3: 退出\n")

    </div>

    <div>

    traffic_light_msg.ClearField('traffic_light') \# 清空交通灯信息

    </div>

    <div>

    if user_input == '1':

    </div>

    <div>

    \# 用户输入1，设置交通灯为红色

    </div>

    <div>

    add_traffic_light(

    </div>

    <div>

    traffic_light_detection_pb2.TrafficLight.RED, traffic_light_msg)

    </div>

    <div>

    elif user_input == "2":

    </div>

    <div>

    \# 用户输入2，设置交通灯为绿色

    </div>

    <div>

    add_traffic_light(

    </div>

    <div>

    traffic_light_detection_pb2.TrafficLight.GREEN, traffic_light_msg)

    </div>

    <div>

    elif user_input == "3":

    </div>

    <div>

    \# 用户输入3，退出循环

    </div>

    <div>

    break

    </div>

    <div>

    </div>

    <div>

    \# 关闭Cyber框架

    </div>

    <div>

    cyber.shutdown()

    </div>

    </div>

    总体：

    <div>

    <div>

    from cyber.python.cyber_py3 import cyber

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber_time

    </div>

    <div>

    import modules.common_msgs.perception_msgs.traffic_light_detection_pb2 as traffic_light_detection_pb2

    </div>

    <div>

    import threading

    </div>

    <div>

    import time

    </div>

    <div>

    </div>

    <div>

    def add_forward_light(color, traffic_light_pb):

    </div>

    <div>

    light = traffic_light_pb.traffic_light.add()

    </div>

    <div>

    light.color = color

    </div>

    <div>

    light.id = "红绿灯ID" \#需要自行设置

    </div>

    <div>

    light.tracking_time = 10.0

    </div>

    <div>

    </div>

    <div>

    seq_num = 0

    </div>

    <div>

    </div>

    <div>

    def add_header(msg):

    </div>

    <div>

    global seq_num

    </div>

    <div>

    msg.header.sequence_num = seq_num

    </div>

    <div>

    msg.header.timestamp_sec = cyber_time.Time.now().to_sec()

    </div>

    <div>

    msg.header.module_name = "manual_traffic_light"

    </div>

    <div>

    seq_num = seq_num + 1

    </div>

    <div>

    </div>

    <div>

    def pub_func(writer):

    </div>

    <div>

    while not cyber.is_shutdown():

    </div>

    <div>

    global traffic_light_msg

    </div>

    <div>

    add_header(traffic_light_msg)

    </div>

    <div>

    writer.write(traffic_light_msg)

    </div>

    <div>

    time.sleep(0.1)

    </div>

    <div>

    </div>

    <div>

    traffic_light_msg = None

    </div>

    <div>

    </div>

    <div>

    if \_\_name\_\_ == '\_\_main\_\_':

    </div>

    <div>

    traffic_light_msg = traffic_light_detection_pb2.TrafficLightDetection()

    </div>

    <div>

    cyber.init()

    </div>

    <div>

    node = cyber.Node("traffic_light_command")

    </div>

    <div>

    writer = node.create_writer(

    </div>

    <div>

    "/apollo/perception/traffic_light", traffic_light_detection_pb2.TrafficLightDetection)

    </div>

    <div>

    thread = threading.Thread(target=pub_func, args=(writer,))

    </div>

    <div>

    thread.start()

    </div>

    <div>

    while not cyber.is_shutdown():

    </div>

    <div>

    m = input(

    </div>

    <div>

    "1: forward red 2: forward green\n")

    </div>

    <div>

    traffic_light_msg.ClearField('traffic_light')

    </div>

    <div>

    print(m)

    </div>

    <div>

    if m == '1':

    </div>

    <div>

    add_forward_light(

    </div>

    <div>

    traffic_light_detection_pb2.TrafficLight.RED, traffic_light_msg)

    </div>

    <div>

    elif m == "2":

    </div>

    <div>

    add_forward_light(

    </div>

    <div>

    traffic_light_detection_pb2.TrafficLight.GREEN, traffic_light_msg)

    </div>

    <div>

    </div>

    <div>

    cyber.shutdown()

    </div>

    </div>

###  步骤三：路径设置工具的使用

1.  打开 Dreamview+ routing editing。

    在地图上选择起点、终点并保存。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_43361d3.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_55e489f.png)

    点击播放按钮，车辆启动：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_1b1a0ee.png)

2.  查看红绿灯 ID。

    回到终端，打开 cyber_monitor

    <div>

    <div>

    cyber_monitor

    </div>

    </div>

    找到 planning 的 channel。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a1fa25f.png)

    通过键盘的 PgUp 键进行翻页找到车辆停止原因。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_7165b76.png)

> ‍注意：TL_后面的数字就是红绿灯的ID。

1.  修改红绿灯 ID。

    在工具中添加交通灯 ID：

    <div>

    <div>

    def add_traffic_light(color, traffic_light_pb):

    </div>

    <div>

    light = traffic_light_pb.traffic_light.add()

    </div>

    <div>

    light.color = color

    </div>

    <div>

    \#light.id = "红绿灯ID" \#修改前

    </div>

    <div>

    light.id = "451089196 \#修改后

    </div>

    <div>

    light.tracking_time = 10.0

    </div>

    </div>

2.  运行交通灯仿真控制工具。

    <div>

    <div>

    python cyber_trafficlight.py

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_02a8989.png)

> ‍注意：数字 1 是控制交通灯为红灯；数字 2 是控制交通灯为绿灯。

数字 1：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_92bee2e.png)

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_dc4fad6.png)

数字 2：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_f562f17.png)

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_21fdb15.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

