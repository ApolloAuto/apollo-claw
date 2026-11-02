<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Apollo工具开发之路径设置工具制作

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_ab9c152fb35e96c54dae9ae6027ceecc.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_ab9c152fb35e96c54dae9ae6027ceecc.html)
> 抓取时间：2026-09-08


##  实验内容

本实验旨在使用 Apollo Cyber RT 开发路径设置工具，通过该工具创建并发送路由请求消息。

##  体验地址

<https://apollo.baidu.com/community/course/40>

##  实验目的

通过本实验，学习如何使用 Apollo Cyber RT 开发路径设置工具，并利用该工具创建并发送路由请求，以使小车运动起来。

- 建立一个 cyber 工程，
- 熟悉cyber工具制作。

##  实践步骤

###  步骤一：启动仿真环境

1.  在终端中，执行 DreamView+ 启动指令，执行成功后，点击菜单栏 dreamview+ 按钮，进入 dreamview+ 界面。

    <div>

    <div>

    aem bootstrap start --plus

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_9b5696d.png)

    当出现如下，即表示 dreamview+ 启动成功了。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_204edc0.png)

2.  左侧导航栏打开 **Mode Settings** 面板，模式选择 **PnC** Mode，操作选择 \*\*Sim_Control\*\*，进入仿真模式。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c8bc6e9.png)

3.  选择地图。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_984ecea.png)

4.  从左侧 **Modules** 模块种启动 Planning 模块。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_c4c0ba6.png)

###  步骤二：编辑代码实现任务功能

####  前置条件：

在`/apollo_workspace`目录创建一个名为`cyber_routing.py`的文件：

1.  导入必要的库和模块。

    首先，导入所需的 Python 库和 Apollo Cyber RT 模块。这些库和模块将帮助我们初始化 Cyber 框架并创建路由请求消息。

    <div>

    <div>

    import argparseimport time

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber_time

    </div>

    <div>

    from modules.common_msgs.external_command_msgs import lane_follow_command_pb2

    </div>

    <div>

    from modules.common_msgs.external_command_msgs import command_status_pb2

    </div>

    </div>

2.  初始化 Cyber 框架。

    在主函数中，我们需要初始化Cyber框架，以便与Cyber节点进行通信。这是实现与其他模块交互的第一步。

    <div>

    <div>

    def main():

    </div>

    <div>

    \# 初始化Cyber

    </div>

    <div>

    cyber.init()

    </div>

    <div>

    node = cyber.Node("mock_routing_requester")

    </div>

    <div>

    sequence_num = 1

    </div>

    </div>

3.  创建路由请求消息。

    在此步骤中，我们将创建一个路由请求消息（LaneFollowCommand），并设置一些必要的属性，如时间戳、模块名称和序列号。

    <div>

    <div>

    routing_request = lane_follow_command_pb2.LaneFollowCommand()

    </div>

    <div>

    routing_request.header.timestamp_sec = cyber_time.Time.now().to_sec()

    </div>

    <div>

    routing_request.header.module_name = 'cyber_routing'

    </div>

    <div>

    routing_request.header.sequence_num = sequence_num

    </div>

    <div>

    routing_request.is_start_pose_set = True

    </div>

    </div>

4.  输入起点和终点坐标。

    设置从命令行获取用户输入的起点和终点坐标信息，包括起始航向、起始 X 坐标、起始 Y 坐标、终点航向、终点 X 坐标和终点 Y 坐标。

    <div>

    <div>

    start_heading = float(input("start_heading : "))

    </div>

    <div>

    start_x = float(input("start_x : "))

    </div>

    <div>

    start_y = float(input("start_y : "))

    </div>

    <div>

    end_heading = float(input("end_heading: "))

    </div>

    <div>

    end_x = float(input("end_x : "))

    </div>

    <div>

    end_y = float(input("end_y: "))

    </div>

    </div>

5.  添加路径信息。

    在这一步中，输入的起点和终点坐标信息添加到路由请求消息中，包括起点和终点的坐标信息。

    <div>

    <div>

    waypoint = routing_request.way_point.add()

    </div>

    <div>

    waypoint.heading = start_heading

    </div>

    <div>

    waypoint.x = start_x

    </div>

    <div>

    waypoint.y = start_y

    </div>

    <div>

    </div>

    <div>

    waypoint1 = routing_request.end_pose

    </div>

    <div>

    waypoint1.heading = end_heading

    </div>

    <div>

    waypoint1.x = end_x

    </div>

    <div>

    waypoint1.y = end_y

    </div>

    </div>

6.  创建 Cyber Writer 并发送路由请求。

    最后，创建一个 Cyber Writer，并使用它来将路由请求消息发送到"/apollo/external_command/lane_follow"。

    <div>

    <div>

    writer = node.create_client('/apollo/external_command/lane_follow', lane_follow_command_pb2.LaneFollowCommand, command_status_pb2.CommandStatus)

    </div>

    <div>

    time.sleep(2.0)

    </div>

    <div>

    print("routing", routing_request)

    </div>

    <div>

    writer.send_request(routing_request)

    </div>

    </div>

    cyber 工具代码：

    <div>

    <div>

    from cyber.python.cyber_py3 import cyber

    </div>

    <div>

    from cyber.python.cyber_py3 import cyber_time

    </div>

    <div>

    from modules.common_msgs.external_command_msgs import lane_follow_command_pb2

    </div>

    <div>

    from modules.common_msgs.external_command_msgs import command_status_pb2

    </div>

    <div>

    </div>

    <div>

    def main():

    </div>

    <div>

    """

    </div>

    <div>

    主函数

    </div>

    <div>

    """

    </div>

    <div>

    \# 初始化Cyber

    </div>

    <div>

    cyber.init()

    </div>

    <div>

    node = cyber.Node("mock_routing_requester")

    </div>

    <div>

    sequence_num = 1

    </div>

    <div>

    </div>

    <div>

    routing_request = lane_follow_command_pb2.LaneFollowCommand()

    </div>

    <div>

    </div>

    <div>

    routing_request.header.timestamp_sec = cyber_time.Time.now().to_sec()

    </div>

    <div>

    routing_request.header.module_name = '111'

    </div>

    <div>

    routing_request.header.sequence_num = sequence_num

    </div>

    <div>

    </div>

    <div>

    routing_request.is_start_pose_set = True

    </div>

    <div>

    </div>

    <div>

    sequence_num = sequence_num + 1

    </div>

    <div>

    </div>

    <div>

    \# 从命令行选择起点坐标

    </div>

    <div>

    start_heading = float(input("start_heading : "))

    </div>

    <div>

    start_x = float(input("start_x : "))

    </div>

    <div>

    start_y = float(input("start_y : "))

    </div>

    <div>

    </div>

    <div>

    \# 从命令行选择终点坐标

    </div>

    <div>

    end_heading = float(input("end_heading: "))

    </div>

    <div>

    end_x = float(input("end_x : "))

    </div>

    <div>

    end_y = float(input("end_y: "))

    </div>

    <div>

    </div>

    <div>

    \# 添加路径起点

    </div>

    <div>

    waypoint = routing_request.way_point.add()

    </div>

    <div>

    waypoint.heading = start_heading

    </div>

    <div>

    waypoint.x = start_x

    </div>

    <div>

    waypoint.y = start_y

    </div>

    <div>

    </div>

    <div>

    \# 设置终点坐标

    </div>

    <div>

    waypoint1 = routing_request.end_pose

    </div>

    <div>

    waypoint1.heading = end_heading

    </div>

    <div>

    waypoint1.x = end_x

    </div>

    <div>

    waypoint1.y = end_y

    </div>

    <div>

    </div>

    <div>

    \# 创建Cyber writer

    </div>

    <div>

    writer = node.create_client('/apollo/external_command/lane_follow', lane_follow_command_pb2.LaneFollowCommand, command_status_pb2.CommandStatus)

    </div>

    <div>

    time.sleep(2.0)

    </div>

    <div>

    print("routing", routing_request)

    </div>

    <div>

    writer.send_request(routing_request)

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

###  步骤三：路径设置工具的使用

1.  运行路径设置工具。

    <div>

    <div>

    python cyber_routing.py

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_efc8ef9.png)

2.  打开 Dreamview+ routing editing。

    在地图上找任意两点作为起点、终点：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_cccb399.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_5d65e9e.png)

3.  在工具中输入起点坐标和终点坐标以及朝向。

    <div>

    <div>

    start_heading : 0.03

    </div>

    <div>

    start_x : 752517.91

    </div>

    <div>

    start_y : 2563962.54

    </div>

    <div>

    end_heading: 0.00

    </div>

    <div>

    end_x : 752754.52

    </div>

    <div>

    end_y: 2563960.03

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_d1a0429.png)

    【车辆运行】

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_3919a2f.png)

【车辆运行】

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

