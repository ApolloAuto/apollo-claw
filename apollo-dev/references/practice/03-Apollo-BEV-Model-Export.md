<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Apollo-BEV-Model-Export

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_337ccf708ac2a55dcec9e39fa5057a2d.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_337ccf708ac2a55dcec9e39fa5057a2d.html)
> 抓取时间：2026-09-08


#  使用说明

##  创建与登录开发机

根据部署环境要求成功创建开发机后，点击登录开发机，进入开发机webIDE，并打开VScode中的terminal

![](https://apollo.baidu.com/docs/apollo/latest/docs/应用实践/开发调试教程/Apollo百舸实践/images/webIDE.png)

- 代码保存路径：/root/Apollo-Vision-Net-Deployment
- 数据默认挂载路径：/mnt/pfs/nuscenes_data/bev_data/nuscenes

##  数据集挂载

开发机内数据集挂载(建议与Apollo-BEV-Train开发机pfs磁盘共用，不共用需要重新处理数据集)

<div>

<div>

cd ~/Apollo-Vision-Net-Deployment/data


<div>


<div>

\# 创建符号链接（注意使用正确的 -s 参数）


<div>

ln -s /mnt/pfs/nuscenes_data/bev_data/nuscenes nuscenes


<div>

ln -s /mnt/pfs/nuscenes_data/bev_data/occ_gt_release_v1_0 occ_gt_release_v1_0


<div>

ln -s /mnt/pfs/nuscenes_data/bev_data/can_bus can_bus



##  模型导出

###  生成onnx文件

运行下面的命令，提供pth文件，生成onnx文件

<div>

<div>

cd ~/Apollo-Vision-Net-Deployment/


<div>

python tools/pth2onnx.py configs/apollo_bev/bev_tiny_det_occ_apollo_trt.py bos路径/epoch\_\*.pth --opset_version 13 --cuda


<div>

\#使用4090卡导出onnx模型需要去掉--cuda参数



##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

