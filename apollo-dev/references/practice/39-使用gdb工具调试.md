<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# 使用gdb工具调试

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_bfaa3375e8dcb340ba2350ab2afbdd9d.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_bfaa3375e8dcb340ba2350ab2afbdd9d.html)
> 抓取时间：2026-09-08


###  如何使用gdb工具调试？

![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_mind.png)

####  GDB概述

GDB，GNU项目调试器，允许您查看另一个程序在执行时“内部”发生了什么，或者其他程序在崩溃时正在做什么。

GDB可以做四种主要的事情（加上其他支持这些事情的事情）来帮助您在行动中捕捉错误：

- 启动程序，指定任何可能影响其行为的内容
- 使程序在指定条件下停止
- 检查程序停止时发生了什么
- 更改程序中的内容，以便您可以尝试纠正一个错误的影响，然后继续了解另一个错误

这些程序可能与GDB（本地）在同一台机器上执行，也可能在另一台机器（远程）上执行，或者在模拟器上执行。GDB可以在大多数流行的UNIX和Microsoft Windows变体以及macOS上运行。

####  下载gdb工具

在apollo容器中没有内置gdb调试工具，需要用户自行下载

<div>

<div>

sudo apt install gdb



####  使用gdb编译Apollo代码

在使用buildtool工具编译代码时，可通过参数–dbg将调试信息加到编译结果中

<div>

<div>

buildtool build --dbg



####  启动GDB

##### gdb program

在Apollo中，启动一个模块通常是通过mainboard+dag文件的方式启动，所以我们可以将mainboard作为progarm, dag文件作为参数传入

<div>

<div>

gdb --args mainboard -d modules/my_component/dag/my_component.dag



![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_mainboard.png)

输出 "Reading symbols from mainboard...done." 表明程序已加载

####  调试程序

##### 设置断点

设置断点的命令是break, 缩写形式为b

- 设置断点在MyComponent::Init()函数入口处

  <div>

  <div>

  (gdb) b MyComponent::Init

  </div>

  </div>

![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_b_init.png)

注：命令行会提示“Function "MyComponent::Init" not defined”，这是因为我们想要调试的程序是动态库，此时还没有被调用。下一行“Make breakpoint pending on future shared library load? (y or \[n\])”会询问在之后共享库加载后设置断点，此时输入"y"即可

##### 查看断点信息

查看断点信息的命令是info break, 缩写形式为i b

<div>

<div>

(gdb) info break



在上一步中我们在MyComponent::Init函数处设置了断点，通过info break，我们可以看到设置的断点信息

![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_info_command.png)

##### 运行程序

当我们设置好断点后，此时我们再次运行，断点等信息即可加入到调试中

<div>

<div>

(gdb) r



![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_r_command.png)

程序运行到断点处(MyComponent::Init)

##### 单条语句执行

单条运行程序命令是next和step,缩写形式为n和s

next: 单步执行程序，跳过函数调用

step: 单步执行程序，进入函数调用

<div>

<div>

(gdb) n



<div>

<div>

(gdb) s



![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_n_command.png)

##### 查看函数堆栈信息

查看函数堆栈信息的命令是backtrace, 缩写形式为bt

<div>

<div>

(gdb) bt



![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_bt_command.png)

##### 继续运行，直到结束

<div>

<div>

(gdb) c



![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/开发工具使用实践/images/gdb_third_c_command.png)

这时我们已经简单的调试了我们的程序，如果您有更多的调试项，可参考[gdb官方文档](https://www.sourceware.org/gdb/documentation/)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

