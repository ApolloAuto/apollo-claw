# Apollo查看日志以及输出日志

> 作者: 宇新 | 发布时间: 2023-05-24 11:28 | 链接: https://apollo.baidu.com/community/article/1072

# 日志分析：

在Apollo运行时，会生成一些输出日志，但是一些开发者可能对于如何查看这些日志还不够了解。因此，本次教程的目的是教会开发者如何使用Apollo的日志功能，通过查看日志来了解Apollo所执行的函数以及查看一些变量的实际输出值。

本次教程以Apollo的planning模块为例进行说明。开发者可以使用Apollo包管理器，将Apollo Studio平台的场景集同步到本地进行代码验证和日志查看。我们以**交通灯仿真场景**作为示例。

通过对日志的分析和查看，开发者可以深入了解Apollo在运行过程中的细节和执行流程。这有助于排查问题、优化算法，并对系统行为有更全面的了解。请按照教程的步骤进行操作，以充分利用Apollo日志功能并提升开发效率。

> **INFO**
> 本实验需要请您在ApolloStudio工作台仿真中创建场景集，场景集需包含以下系统场景：
> 场景名称：Traffic light scene
> 场景  ID：Sunnyvale_3

[](../images/07_FAQ故障排查/ec62ee169155b36510b97c0eb246759d.png)

首先，让我们让主车在该场景下运行。在Apollo工程的目录路径下，例如EDU 版本，你可以在以下路径找到刚刚生成的运行日志。这个日志是在默认情况下（没有进行任何修改）所生成的。

在Apollo工程目录路径下，你可以找到日志的路径，例如：

## 以EDU 版本planning为例：

`pnc-competition/data/log/planning.log.INFO.时间`
[](../images/07_FAQ故障排查/ef4f1b05bbf8c9ce247c184e0af3f2b2.png)

在指定的路径下，我们可以看到有很多日志文件，但是你可能不确定应该查看哪一个。在这里，我们以planning为例进行说明：

在指定路径下，你可以看到一些以"planning"开头的文件。这些文件通常是与Apollo的planning模块相关的日志文件。为了查看最新的日志包，你可以打开最新的一个日志文件。

你可以按以下步骤找到最新的日志文件：

> **INFO**
> 检查以"planning"开头的日志文件。
> 选择最新的一个文件，通常是按照时间顺序排序的，可以通过文件的创建时间或修改时间来判断。
> 打开最新的日志文件以查看其中的内容。

通过打开最新的日志文件，你可以查看其中记录的最新的planning模块的运行信息和输出。这有助于你了解planning模块在指定场景下的执行情况和相关的变量输出。请根据这些步骤找到最新的日志文件，并开始分析所需的信息。

`planning.log.INFO.20220902-151551.271`

## 日志包大致内容如下：

[](../images/07_FAQ故障排查/3f21d72fa80cd16f6d064fbf56142d96.png)

## 日志分析：

```
I0114 11:36:22.108013  3646 scenario.cc:90] switch stage from TRAFFIC_LIGHT_PROTECTED_APPROACH to TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE
```

**scenario.cc：**文件名字

**scenario.cc：99 ：**该文件下第90行输出的日志

[](../images/07_FAQ故障排查/a3f190d4a2d5045a3d0a1e60fca184f4.png)

是的，细心的小伙伴可能会注意到日志中的"AINFO"语句。这些语句是Apollo输出日志中的一部分，用于在运行时输出函数的执行情况以及一些变量的值。

通过使用"AINFO"语句，我们可以在Apollo运行时观察特定函数的执行情况和关注变量的输出值。这对于了解代码的执行流程、调试问题以及优化算法非常有帮助。

为了让大家更好地理解如何使用"AINFO"语句，我们可以再次查看刚刚生成的日志。请注意找到包含"AINFO"的语句，并仔细观察其中记录的函数名称和相关变量的值。

通过观察日志中的"AINFO"语句，你可以深入了解Apollo在运行时所使用的函数及其参数，以及关键变量的实际输出值。这有助于你理解代码的执行过程、进行问题排查，并优化算法的性能。

```
I0114 11:36:22.108013  3646 scenario.cc:90] switch stage from TRAFFIC_LIGHT_PROTECTED_APPROACH to TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE
```

根据提供的代码，我们可以得知在红绿灯场景中，Apollo的一个运行场景阶段是从TRAFFIC_LIGHT_PROTECTED_APPROACH到TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE。

这个阶段描述了车辆在接近受保护的交通灯、穿过交通灯控制的路口之间的行驶过程。在TRAFFIC_LIGHT_PROTECTED_APPROACH阶段，车辆将接近交通灯并准备停车。而在TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE阶段，车辆通过交通灯控制的路口，继续巡航行驶。

通过Dreamview的PNC Monitor（路径规划与控制监控）功能，我们可以实时查看场景的变换情况。PNC Monitor提供了一个图形化界面，显示车辆所处的场景、规划路径、障碍物信息等。通过观察PNC Monitor中的显示，我们可以了解车辆在红绿灯场景中的阶段切换情况，包括从TRAFFIC_LIGHT_PROTECTED_APPROACH到TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE的变化。

通过代码和Dreamview的PNC Monitor，我们可以更深入地了解Apollo在红绿灯场景中的运行阶段和行为变化，以便进行调试和分析。

[](../images/07_FAQ故障排查/760fcbc85658f78a906d9ba55028bcae.png)

# 日志书写：

## 利用ADEBUG书写简单的日志：

刚才我们提到，在红绿灯场景中，运行场景阶段从TRAFFIC_LIGHT_PROTECTED_APPROACH到TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE。

现在我们以TRAFFIC_LIGHT_PROTECTED_APPROACH场景为例。各位小伙伴可以在代码中搜索以下内容：

`TRAFFIC_LIGHT_PROTECTED_APPROACH`

### 找到该场景的代码文件夹：

[](../images/07_FAQ故障排查/7d5a3d8633470079e378653120c92ef7.png)

我们这里以stage_approach.cc，代码为例：

我们可以发现在该文件下有许多ADEBUG的语句：

[](../images/07_FAQ故障排查/6ddea872712d5693f956c233e255a19a.png)

有了﻿ADEBUG﻿后，各位小伙伴可以通过该语句改写输出日志。具体步骤如下：

﻿

> **INFO**
> 
> 复制﻿ADEBUG﻿代码段。
> 在﻿ADEBUG﻿代码段的下方粘贴一份副本。
> 将复制的代码段中的﻿ADEBUG﻿改为﻿AINFO﻿。
> 保存修改后的代码。
> 运行编译命令，对代码进行重新编译。
> 在红绿灯场景下重新运行Apollo。
> 运行完成后，观察日志输出。

﻿

通过将﻿ADEBUG﻿改为﻿AINFO﻿，我们将输出日志级别从调试级别改为信息级别。这样修改后的日志将更具可读性，方便我们观察和分析。请按照以上步骤进行操作，并在重新运行后观察修改后的日志输出。

[](../images/07_FAQ故障排查/317a8cfb7c8ccb2f51775460674fd5eb.png)

### 修改完之后的日志：

[](../images/07_FAQ故障排查/874af6ad2cf212797d54380067efc528.png)

## 自己书写AINFO：

通过自己书写AINFO 的方式可以判断在车辆在运行时是否运用到该函数，或者通过写AINFO 的方式查看变量的实时值。添加完成后需要编译代码，具体书写方式如下：

[](../images/07_FAQ故障排查/0d83889fea8bf424decf9c43fd1e7652.png)

### 重新运行该场景，生成日志如下：

[](../images/07_FAQ故障排查/686e49974fa4d258fe5b880c5bcc42c7.png)

我们可以从日志中可以看出，当TRAFFIC_LIGHT_PROTECTED_APPROACH阶段完成时，会进入：

```cpp
Stage::StageStatus TrafficLightProtectedStageApproach::FinishStage() {}
```
﻿

函数，当运行至该函数时，此时AINFO 会输出日志，而next_stage_，这个变量则为我们场景的下一个阶段，401为TRAFFIC_LIGHT_PROTECTED_INTERSECTION_CRUISE阶段：


[](../images/07_FAQ故障排查/d4f810c989390f01186c1bd65db2ca19.png)
