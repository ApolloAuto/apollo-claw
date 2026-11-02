#!/usr/bin/env bash
# 下载感知模型到指定车型参数目录
# 用法：bash download_perception_models.sh --target ARCF_40P
set -euo pipefail

TARGET=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target) TARGET="${2:-}"; shift 2 ;;
        *) shift ;;
    esac
done

if [[ -z "$TARGET" ]]; then
    echo "必须指定 --target <车型>，例如 --target ARCF_40P" >&2
    exit 2
fi

declare -A dic
models_dir="/apollo_workspace/profiles/${TARGET}/modules/perception/data/models/"

dic=([yolox3d_onnx.zip]="https://apollo-perception.bj.bcebos.com/park_model/yolox3d_onnx.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A51%3A45Z%2F-1%2Fhost%2F9589d1189b12a35bbd41518a8c3acad64cee659b07c5435577f3b19b12754954" \
     [center_point_paddle.zip]="https://apollo-perception.bj.bcebos.com/park_model/center_point_paddle_0719.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A54%3A45Z%2F-1%2Fhost%2F4d105f92bb9253b1ddc1b2469be86faab24803bcf247c22896eb3827625c3287" \
     [cpdet.zip]="https://apollo-perception.bj.bcebos.com/park_model/cpdet_0910.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A55%3A11Z%2F-1%2Fhost%2F0a00eead1884f57871fab0e32ed8f38289a7b9e55127f79d21b8f7bf3b324bae" \
     [pointwise_unet.zip]="https://apollo-perception.bj.bcebos.com/park_model/pointwise_unet_1105.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A56%3A24Z%2F-1%2Fhost%2Fc5c36675c094c04da246dff2622695c21701bd94cb523851239ca735c5f8e7f2" \
     [efficient_net.zip]="https://apollo-perception.bj.bcebos.com/park_model/efficient_net.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A56%3A45Z%2F-1%2Fhost%2F988ee9dc1f6f266d7b2b945af3c5ec4a7e40c31718c6f4dde8fa67bd7a821cc3" \
     [tl_detection_yolox.zip]="https://apollo-perception.bj.bcebos.com/park_model/tl_detection_yolox.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A57%3A05Z%2F-1%2Fhost%2Fca5fc65f3aac5f59d1fe9b3d4863c11c8e40eaf9a9f9e5a987ba79727628572d" \
     [yolox_garbage_onnx.zip]="https://apollo-perception.bj.bcebos.com/park_model/yolox_garbage_onnx_1105.zip?authorization=bce-auth-v1%2FALTAK6fleneBT08Sn61Gseah1T%2F2024-11-25T02%3A57%3A24Z%2F-1%2Fhost%2F2e5273a227e6f9b70f0e840013a00a13c341fd827f6e97471f14874c87c74b00" \
    )

cd "/apollo_workspace"

# 确保目标目录存在
mkdir -p "$models_dir"

for key in $(echo ${!dic[*]}); do
    download_link=${dic[$key]}
    model_name=${key::-4}
    echo "==> 下载 ${key}"
    wget -O "${key}" "${download_link}"
    unzip -o "${key}"
    mkdir -p "${models_dir}${model_name}"
    for i in $(ls "${model_name}"); do
        [[ -e "${models_dir}${model_name}/${i}" ]] && rm -f "${models_dir}${model_name}/${i}"
        mv -f "${model_name}/${i}" "${models_dir}${model_name}/"
    done
    rm -rf "${model_name}" "${key}"
done

echo "==> 模型下载完成：${models_dir}"
echo "==> 请执行: aem profile use ${TARGET} 使模型软链生效"
