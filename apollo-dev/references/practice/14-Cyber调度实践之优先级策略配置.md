<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Cyber调度实践之优先级策略配置

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_374532c9cc6b5e4880dcfda8775f2e3e.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_374532c9cc6b5e4880dcfda8775f2e3e.html)
> 抓取时间：2026-09-08


##  实验内容

Apollo Cyber 是首个专为自动驾驶定制的高性能开源的运行时框架，它主要解决了自动驾驶系统的高并发、低延迟、高吞吐、任务调度等问题，同时还提供了多种通信机制和用户级的协程，在资源有限的情况下会根据任务的优先级来进行调度处理。本实验将讲述任务的优先级配置和调度。

##  体验地址

<https://apollo.baidu.com/community/course/41#>

##  实验目的

掌握 Apollo 如何设置 Cyber 的调度策略，任务优先级配置。

##  实验流程

本实验涉及到的目录结构如下：

<div>

<div>

/apollo


<div>

\|-- cyber


<div>

\| \| -- conf


<div>

\| \| -- example_sched_choreography.conf -----------task配置文件


<div>

\| \| -- examples


<div>

\| \| -- common_component_example


<div>

\| \| -- common.dag -----------启动的dag文件


<div>

\| \| -- common.launch -----------启动的launch文件


<div>

\|-- data


<div>

\| \|-- log


<div>

\| \|-- mainboard.INFO -----------log文件


<div>

\|-- modules


<div>

\|-- scripts



1.  修改`/apollo/cyber/conf/example_sched_choreography.conf`，通过更改配置可以设置任务的优先级。这里面设置了 common0，common1，common2，common3 四个任务，以及对应的优先级，tasks：这里是对 task 任务进行配置，name 表示 task 的名字，prio 表示任务的优先级，值越大表明优先级越高，这四个任务的优先级顺序，从高到低依次为 common3，common2，common1，common0。

    <div>

    <div>

    scheduler_conf {

    </div>

    <div>

    policy: "choreography"

    </div>

    <div>

    process_level_cpuset: "0" \# all threads in the process are on the cpuset

    </div>

    <div>

    </div>

    <div>

    choreography_conf {

    </div>

    <div>

    choreography_processor_num: 4

    </div>

    <div>

    choreography_affinity: "range"

    </div>

    <div>

    choreography_cpuset: "0"

    </div>

    <div>

    choreography_processor_policy: "SCHED_FIFO" \# policy: SCHED_OTHER,SCHED_RR,SCHED_FIFO

    </div>

    <div>

    choreography_processor_prio: 10

    </div>

    <div>

    </div>

    <div>

    pool_processor_num: 4

    </div>

    <div>

    pool_affinity: "range"

    </div>

    <div>

    pool_cpuset: "0"

    </div>

    <div>

    pool_processor_policy: "SCHED_OTHER"

    </div>

    <div>

    pool_processor_prio: 0

    </div>

    <div>

    </div>

    <div>

    tasks: \[

    </div>

    <div>

    {

    </div>

    <div>

    name: "common0"

    </div>

    <div>

    processor: 0

    </div>

    <div>

    prio: 1

    </div>

    <div>

    },

    </div>

    <div>

    {

    </div>

    <div>

    name: "common1"

    </div>

    <div>

    processor: 0

    </div>

    <div>

    prio: 2

    </div>

    <div>

    },

    </div>

    <div>

    {

    </div>

    <div>

    name: "common2"

    </div>

    <div>

    processor: 0

    </div>

    <div>

    prio: 3

    </div>

    <div>

    },

    </div>

    <div>

    {

    </div>

    <div>

    name: "common3"

    </div>

    <div>

    processor: 0

    </div>

    <div>

    prio: 4

    </div>

    <div>

    }

    </div>

    <div>

    \]

    </div>

    <div>

    }

    </div>

    <div>

    }

    </div>

    </div>

2.  在`/apollo/cyber/examples/common_component_example`路径下新建 common0.dag，common1.dag，common2.dag，common3.dag，修改common.launch。

    命令为：

    <div>

    <div>

    touch common0.dag common1.dag common2.dag common3.dag

    </div>

    </div>

    四个文件的内容分别如下：

    <div>

    <div>

    \# Define all coms in DAG streaming.

    </div>

    <div>

    module_config {

    </div>

    <div>

    module_library : "cyber/examples/common_component_example/libcommon_component_example.so"

    </div>

    <div>

    components {

    </div>

    <div>

    class_name : "CommonComponentSample"

    </div>

    <div>

    config {

    </div>

    <div>

    name : "common0"

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/prediction"

    </div>

    <div>

    }

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/test"

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

    <div>

    }

    </div>

    </div>

    <div>

    <div>

    \# Define all coms in DAG streaming.

    </div>

    <div>

    module_config {

    </div>

    <div>

    module_library : "cyber/examples/common_component_example/libcommon_component_example.so"

    </div>

    <div>

    components {

    </div>

    <div>

    class_name : "CommonComponentSample"

    </div>

    <div>

    config {

    </div>

    <div>

    name : "common1"

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/prediction"

    </div>

    <div>

    }

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/test"

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

    <div>

    }

    </div>

    </div>

    <div>

    <div>

    \# Define all coms in DAG streaming.

    </div>

    <div>

    module_config {

    </div>

    <div>

    module_library : "cyber/examples/common_component_example/libcommon_component_example.so"

    </div>

    <div>

    components {

    </div>

    <div>

    class_name : "CommonComponentSample"

    </div>

    <div>

    config {

    </div>

    <div>

    name : "common2"

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/prediction"

    </div>

    <div>

    }

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/test"

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

    <div>

    }

    </div>

    </div>

    <div>

    <div>

    \# Define all coms in DAG streaming.

    </div>

    <div>

    module_config {

    </div>

    <div>

    module_library : "cyber/examples/common_component_example/libcommon_component_example.so"

    </div>

    <div>

    components {

    </div>

    <div>

    class_name : "CommonComponentSample"

    </div>

    <div>

    config {

    </div>

    <div>

    name : "common3"

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/prediction"

    </div>

    <div>

    }

    </div>

    <div>

    readers {

    </div>

    <div>

    channel: "/apollo/test"

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

    <div>

    }

    </div>

    </div>

    [common.launch](https://apollo.baidu.com/docs/apollo/latest/common_8launch.html) 配置如下：

    <div>

    <div>

    \<cyber\>

    </div>

    <div>

    \<module\>

    </div>

    <div>

    \<name\>common\</name\>

    </div>

    <div>

    \<dag_conf\>/apollo/cyber/examples/common_component_example/common0.dag\</dag_conf\>

    </div>

    <div>

    \<dag_conf\>/apollo/cyber/examples/common_component_example/common1.dag\</dag_conf\>

    </div>

    <div>

    \<dag_conf\>/apollo/cyber/examples/common_component_example/common2.dag\</dag_conf\>

    </div>

    <div>

    \<dag_conf\>/apollo/cyber/examples/common_component_example/common3.dag\</dag_conf\>

    </div>

    <div>

    \<process_name\>example_sched_choreography\</process_name\>

    </div>

    <div>

    \</module\>

    </div>

    <div>

    \</cyber\>

    </div>

    </div>

3.  执行：

    <div>

    <div>

    channel_prediction_writer &

    </div>

    <div>

    channel_test_writer &

    </div>

    </div>

    往 channel /apollo/prediction 和 /apollo/test 发送消息。

4.  启动

    <div>

    <div>

    cyber_launch start /apollo/cyber/examples/common_component_example/common.launch

    </div>

    </div>

    用于消费 channel 中的消息。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_7874cef.png)

5.  新打开一个 Terminal，进入`/apollo/data/log`目录中，查看 mainboard.INFO 日志，可以看到任务的执行顺序，依次是 common3，common2，common1，common0，符合预期。

    <div>

    <div>

    cd /apollo/data/log

    </div>

    <div>

    ll

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_08e9f94.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_4632854.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_37aa354.png)

    至此，实验结束。

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

