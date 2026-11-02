<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Apollo系统安装

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE8_xBD_xA6_xE8_xBE_x86_xE9_x9B_x86_198b9d5eba7441fcce7da389fd2e5c0d.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE8_xBD_xA6_xE8_xBE_x86_xE9_x9B_x86_198b9d5eba7441fcce7da389fd2e5c0d.html)
> 抓取时间：2026-09-08


本文档以 Lincoln MKZ 作为目标车辆，介绍 Apollo 软件系统的集成安装，您可以了解到如何在车辆计算单元 Hardware3.0（HW3.0）上完成 Apollo 自动驾驶软件系统的集成安装和配置。本文档针对于 Apollo 6.0 及以上版本。

##  前提条件

在 MKZ 上进行软件集成安装之前，您需要先按照 车辆集成 完成车辆硬件集成。

##  软件集成安装

请按照以下步骤进行软件集成安装。

###  1. 安装 Ubuntu 系统

请参考安装指南步骤安装 Ubuntu 系统。

###  2. 安装实时内核

您可以按照 [ROS2: 构建实时 Linux](https://docs.ros.org/en/foxy/Tutorials/Building-Realtime-rt_preempt-kernel-for-ROS-2.html) 构建一个实时内核，或者直接安装使用我们预构建的版本：

<div>

<div>

wget https://apollo-system.cdn.bcebos.com/release_installer/linux-kernel-5.4.115-apollo-rt.zip


<div>

unzip linux-kernel-5.4.115-apollo-rt.zip


<div>

cd linux-kernel-5.4.115-apollo-rt


<div>

sudo dpkg -i \*.deb



###  3. 安装 CANBUS 驱动

1.  下载 [apollo-contrib](https://github.com/ApolloAuto/apollo-contrib/tree/master/baidu) 下的源码在本地编译，编译完生成 basa.ko 模块文件。
2.  设置系统上电自动加载驱动：

<div>

<div>

sudo su


<div>

mkdir -p /lib/modules/\$(uname -r)/kernel/drivers/baidu/basa/


<div>

cp basa.ko /lib/modules/\$(uname -r)/kernel/drivers/baidu/basa/


<div>

echo "basa" \>\>/etc/modules


<div>

depmod -a


<div>

modprobe basa



###  4. 安装实时内核下的 Nvidia 驱动

请先参考安装指南步骤中的方法完成 Nvidia 驱动的初步安装。

注意：由于 Nvidia 驱动不支持实时内核，在上面执行 `sudo apt-get install nvidia-driver-455` 时会报如下错误消息：

<div>

<div>

The kernel you are installing for is a PREEMPT_RT kernel!


<div>


<div>

The NVIDIA driver does not support real-time kernels. If you


<div>

are using a stock distribution kernel, please install


<div>

a variant of this kernel that does not have the PREEMPT_RT


<div>

patch set applied; if this is a custom kernel, please


<div>

install a standard Linux kernel. Then try installing the


<div>

NVIDIA kernel module again.


<div>


<div>

\*\*\* Failed PREEMPT_RT sanity check. Bailing out! \*\*\*



您可以通过在编译 Nvidia 驱动的时候设置 `IGNORE_PREEMPT_RT_PRESENCE=1` 来绕过这 一点。步骤如下：

1.  运行如下命令来编译 Nvidia 驱动：

<div>

<div>

\# 切换到Nvidia 驱动的源码目录


<div>

cd "\$(dpkg -L nvidia-kernel-source-455 \| grep -m 1 "nvidia-drm" \| xargs dirname)"


<div>


<div>

\# 设置 IGNORE_PREEMPT_RT_PRESENCE=1 来编译Nvidia 驱动


<div>

sudo env NV_VERBOSE=1 \\


<div>

make -j8 NV_EXCLUDE_BUILD_MODULES='' \\


<div>

KERNEL_UNAME=\$(uname -r) \\


<div>

IGNORE_XEN_PRESENCE=1 \\


<div>

IGNORE_CC_MISMATCH=1 \\


<div>

IGNORE_PREEMPT_RT_PRESENCE=1 \\


<div>

SYSSRC=/lib/modules/\$(uname -r)/build \\


<div>

LD=/usr/bin/ld.bfd \\


<div>

modules


<div>


<div>

sudo mv \*.ko /lib/modules/\$(uname -r)/updates/dkms/


<div>

sudo depmod -a



1.  重启系统。
2.  运行 `nvidia-smi` 来检查 `Nvidia` 驱动是否正常工作。

###  5. 安装其他必备软件

请先参考安装指南中的方法安装 Docker Engine 和 Nvidia Container Toolkit。

###  6. 安装 Apollo 系统

参考安装指南进行安装。

###  7. 系统配置

在运行 Apollo 软件之前，建议先对系统的一些配置进行修改。

- 禁止软件自动更新

  Ubuntu 默认没有关闭软件自动更新选项，软件自动更新有时会带来一些难以预知的后果。比如，内核的自动升级会让已安装的一些驱动失效。您可以通过修改配置文件来禁止软件自动更新。

对于修改 `/etc/apt/apt.conf.d/10periodic` 为以下内容：

<div>

<div>

APT::Periodic::Update-Package-Lists "0";


<div>

APT::Periodic::Download-Upgradeable-Packages "0";


<div>

APT::Periodic::AutocleanInterval "0";


<div>

APT::Periodic::Unattended-Upgrade "0";



修改 `/etc/apt/apt.conf.d/20auto-upgrades` 为以下内容：

<div>

<div>

APT::Periodic::Update-Package-Lists "0";


<div>

APT::Periodic::Download-Upgradeable-Packages "0";


<div>

APT::Periodic::AutocleanInterval "0";


<div>

APT::Periodic::Unattended-Upgrade "0";



- 设置固定 IP

IP 的频繁变动不利于调试。

对于 Hardware3.0，可以修改 `/etc/netplan/01-network-manager-all.yaml` 为如下内容：

<div>

<div>

\# Let NetworkManager manage all devices on this system


<div>

network:


<div>

version: 2


<div>

renderer: NetworkManager


<div>

ethernets:


<div>

eth0:


<div>

addresses: \[192.168.10.6/24\]


<div>

gateway4: 192.168.10.1


<div>

nameservers:


<div>

addresses: \[192.168.10.1\]


<div>

eth1:


<div>

addresses: \[192.168.20.8/24, 192.168.1.6/24, 192.168.19.250/24\]


<div>

routes:


<div>

\- to: 224.100.100.0/24


<div>

via: 192.168.20.1



##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

