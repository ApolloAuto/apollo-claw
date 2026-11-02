<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# 利用Apollo工具生成CANBUS适配代码

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE8_xBD_xA6_xE8_xBE_x86_xE9_x9B_x86_7d065809ffd5a5553ae36e38ceb38870.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE8_xBD_xA6_xE8_xBE_x86_xE9_x9B_x86_7d065809ffd5a5553ae36e38ceb38870.html)
> 抓取时间：2026-09-08


本文档将介绍如何使用 Apollo 的工具，生成适配 Apollo 的 CANBUS 代码。

##  前提条件

您需要先阅读以下内容:

- 概览
- 符合 Apollo 线控标准的车辆

##  将 CANBUS 适配 Apollo

###  1. DBC 文件转换成 canbus 模板代码

[Canbus](https://apollo.baidu.com/docs/apollo/latest/classCanbus.html "canbus module main class.") 适配代码可以使用 Apollo 的工具生成。在转换代码前，要保证 DBC 按照上述 DBC 文件要求完成，并通过 gedit 打开 DBC 文件，另存转码为 UTF-8 格式保存。

1.  将 DBC 文件放置指定目录 `apollo/modules/tools/gen_vehicle_protocol` 内。

2.  修改 DBC 转换脚本的配置文件。

    下面以 GE3 车型添加为例，在 `apollo/modules/tools/gen_vehicle_protocol` 目录下，复制默认存在的 `mkz_conf.yml` 文件并重命名为 `ge3_conf.yml`，修改该配置文件，如下图所示：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_7fbaf21.png)

- `dbc_file`：填写对应你的 DBC 文件名称，DBC 文件名称一般以车型名称命名，并以 `.dbc` 结束。
- `protocol_conf`：与上述 DBC 文件名称命名相同，填写`ge3.yml`。
- `car_type`：填入车型名称。
- `sender_list：[ ]`：发送列表，这里默认为空。
- `sender`：此处修改为与 DBC 内定义的 Apollo 的名称一致，ge3 的 DBC 内定义 Apollo 名称为 SCU。

1.  完成 `ge3_conf.yml` 配置文件设置，启动 docker，进入 Apollo 的容器后，在 `apollo/modules/tools/gen_vehicle_protocol` 目录下，找到 DBC 转化工具 `gen.py`，执行代码：

    <div>

    <div>

    cd modules/tools/gen_vehicle_protocol

    </div>

    <div>

    python gen.py ge3_conf.ymal

    </div>

    </div>

    执行完成上述脚本后，在终端内会显示生成 5 个控制协议，11 个反馈协议。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_f1f6517.png)

    这时在 `apollo/modules/tools/gen_vehicle_protocol` 目录下，会生成一个 `output` 文件夹，文件夹内有 2 个文件夹：`proto` 和 `vehicle` 文件夹。这两个文件内的代码内容就是要适配 canbus 的基本代码模板。把文件内的代码 **拷贝** 到 Apollo 的 canbus 层内，进行代码适配添加。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_e0260ae.png)

> ‍注意：把这个 output 文件夹内生成的代码模板拷贝至相应的 Apollo 目录后，要删除该文件夹，如果不删除该文件夹，后期编译 Apollo 时会报错。该文件夹有保护权限，请在 Apollo 的 docker 内执行删除代码。

<div>

<div>

rm -rf output/



###  2. 适配代码合入 Apollo 文件内

下面以添加 ge3 车型为例，将该代码添加至 Apollo 内：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_7f49ca5.png)

1.  将 `apollo/modules/tools/gen_vehicle_protocol/output/proto` 文件夹内 [`ge3.proto`](https://apollo.baidu.com/docs/apollo/latest/ge3_8proto.html) 文件拷贝至 `apollo/modules/canbus/proto` 文件夹内，并在该文件夹内修改 [`chassis_detail.proto`](https://apollo.baidu.com/docs/apollo/latest/chassis__detail_8proto.html)，在该文件头部添加头文件 `import "modules/canbus/proto/ge3.proto"`。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_7d03448.png)

在 `message ChassisDetail{}` 结构体内的最后一行添加要增加的新车型变量定义：`Ge3 ge3 = 21`：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_ce56d91.png)

在 `pollo/modules/canbus/proto`目录的 `BUILD` 文件内添加上述新 `proto` 的依赖：`"ge3.proto"`：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_ccdf17d.png)

1.  将 `apollo/modules/tools/gen_vehicle_protocol/output/vehicle/` 内的 ge3 文件夹拷贝至 `apollo/modules/canbus/vehicle/` 文件夹下。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_20984df.png)

###  3. 实现新的车辆控制逻辑

实现新的车辆控制逻辑，在 `apollo/modules/canbus/vehicle/ge3/ge3_controller.cc` 文件编写控制逻辑代码。

控制代码主要包含将解析的底盘反馈报文的信息，通过 `chassis` 和 `chassis_detail` 广播出车辆底盘信息。

`chassis` 主要包括获取底盘的车速、轮速、发动机转速、踏板反馈、转角反馈等信息， `chassis_detail` 是每一帧报文的实际信息，这一部分编写的代码如下所示：

<div>

<div>

// 3


<div>

chassis\_.set_engine_started(true);


<div>


<div>

// check if there is not ge3, no chassis detail can be retrieved and return


<div>

if (!chassis_detail.has_ge3()) {


<div>

AERROR \<\< "NO GE3 chassis information!";


<div>

return chassis\_;


<div>

}


<div>

Ge3 ge3 = chassis_detail.ge3();


<div>

// 5


<div>

if (ge3.has_scu_bcs_3_308()) {


<div>

Scu_bcs_3_308 scu_bcs_3_308 = ge3.scu_bcs_3_308();


<div>

if (scu_bcs_3_308.has_bcs_rrwheelspd()) {


<div>

if (chassis\_.has_wheel_speed()) {


<div>

chassis\_.mutable_wheel_speed()-\>set_is_wheel_spd_rr_valid(


<div>

scu_bcs_3_308.bcs_rrwheelspdvd());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_direction_rr(


<div>

(WheelSpeed::WheelSpeedType)scu_bcs_3_308.bcs_rrwheeldirection());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_spd_rr(


<div>

scu_bcs_3_308.bcs_rrwheelspd());


<div>

}


<div>

}


<div>


<div>

if (scu_bcs_3_308.has_bcs_rlwheelspd()) {


<div>

if (chassis\_.has_wheel_speed()) {


<div>

chassis\_.mutable_wheel_speed()-\>set_is_wheel_spd_rl_valid(


<div>

scu_bcs_3_308.bcs_rlwheelspdvd());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_direction_rl(


<div>

(WheelSpeed::WheelSpeedType)scu_bcs_3_308.bcs_rlwheeldirection());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_spd_rl(


<div>

scu_bcs_3_308.bcs_rlwheelspd());


<div>

}


<div>

}


<div>


<div>

if (scu_bcs_3_308.has_bcs_frwheelspd()) {


<div>

if (chassis\_.has_wheel_speed()) {


<div>

chassis\_.mutable_wheel_speed()-\>set_is_wheel_spd_fr_valid(


<div>

scu_bcs_3_308.bcs_frwheelspdvd());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_direction_fr(


<div>

(WheelSpeed::WheelSpeedType)scu_bcs_3_308.bcs_frwheeldirection());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_spd_fr(


<div>

scu_bcs_3_308.bcs_frwheelspd());


<div>

}


<div>

}


<div>


<div>

if (scu_bcs_3_308.has_bcs_flwheelspd()) {


<div>

if (chassis\_.has_wheel_speed()) {


<div>

chassis\_.mutable_wheel_speed()-\>set_is_wheel_spd_fl_valid(


<div>

scu_bcs_3_308.bcs_flwheelspdvd());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_direction_fl(


<div>

(WheelSpeed::WheelSpeedType)scu_bcs_3_308.bcs_flwheeldirection());


<div>

chassis\_.mutable_wheel_speed()-\>set_wheel_spd_fl(


<div>

scu_bcs_3_308.bcs_flwheelspd());


<div>

}


<div>

}


<div>

}


<div>


<div>

if (ge3.has_scu_bcs_2_307() && ge3.scu_bcs_2_307().has_bcs_vehspd()) {


<div>

chassis\_.set_speed_mps(


<div>

static_cast\<float\>(ge3.scu_bcs_2_307().bcs_vehspd()));


<div>

} else {


<div>

chassis\_.set_speed_mps(0);


<div>

}


<div>


<div>

// 7


<div>

// ge3 only has fuel percentage


<div>

// to avoid confusing, just don't set


<div>

chassis\_.set_fuel_range_m(0);


<div>


<div>

if (ge3.has_scu_vcu_1_312() && ge3.scu_vcu_1_312().has_vcu_accpedact()) {


<div>

chassis\_.set_throttle_percentage(


<div>

static_cast\<float\>(ge3.scu_vcu_1_312().vcu_accpedact()));


<div>

} else {


<div>

chassis\_.set_throttle_percentage(0);


<div>

}


<div>

// 9


<div>

if (ge3.has_scu_bcs_1_306() && ge3.scu_bcs_1_306().has_bcs_brkpedact()) {


<div>

chassis\_.set_brake_percentage(


<div>

static_cast\<float\>(ge3.scu_bcs_1_306().bcs_brkpedact()));


<div>

} else {


<div>

chassis\_.set_brake_percentage(0);


<div>

}


<div>

// 23, previously 10


<div>

if (ge3.has_scu_vcu_1_312() && ge3.scu_vcu_1_312().has_vcu_gearact()) {


<div>

switch (ge3.scu_vcu_1_312().vcu_gearact()) {


<div>

case Scu_vcu_1_312::VCU_GEARACT_INVALID: {


<div>

chassis\_.set_gear_location(Chassis::GEAR_INVALID);


<div>

} break;


<div>

case Scu_vcu_1_312::VCU_GEARACT_DRIVE: {


<div>

chassis\_.set_gear_location(Chassis::GEAR_DRIVE);


<div>

} break;


<div>

case Scu_vcu_1_312::VCU_GEARACT_NEUTRAL: {


<div>

chassis\_.set_gear_location(Chassis::GEAR_NEUTRAL);


<div>

} break;


<div>

case Scu_vcu_1_312::VCU_GEARACT_REVERSE: {


<div>

chassis\_.set_gear_location(Chassis::GEAR_REVERSE);


<div>

} break;


<div>

case Scu_vcu_1_312::VCU_GEARACT_PARK: {


<div>

chassis\_.set_gear_location(Chassis::GEAR_PARKING);


<div>

} break;


<div>

default:


<div>

chassis\_.set_gear_location(Chassis::GEAR_INVALID);


<div>

break;


<div>

}


<div>

} else {


<div>

chassis\_.set_gear_location(Chassis::GEAR_INVALID);


<div>

}


<div>


<div>

// 11


<div>

if (ge3.has_scu_eps_311() && ge3.scu_eps_311().has_eps_steerangle()) {


<div>

chassis\_.set_steering_percentage(


<div>

static_cast\<float\>(ge3.scu_eps_311().eps_steerangle() /


<div>

vehicle_params\_.max_steer_angle() \* M_PI / 1.80));


<div>

} else {


<div>

chassis\_.set_steering_percentage(0);


<div>

}


<div>


<div>

// 13


<div>

if (ge3.has_scu_epb_310() && ge3.scu_epb_310().has_epb_sysst()) {


<div>

chassis\_.set_parking_brake(ge3.scu_epb_310().epb_sysst() ==


<div>

Scu_epb_310::EPB_SYSST_APPLIED);


<div>

} else {


<div>

chassis\_.set_parking_brake(false);


<div>

}


<div>


<div>

// 14, 15: ge3 light control


<div>

if (ge3.has_scu_bcm_304() && ge3.scu_bcm_304().has_bcm_highbeamst() &&


<div>

Scu_bcm_304::BCM_HIGHBEAMST_ACTIVE ==


<div>

ge3.scu_bcm_304().bcm_highbeamst()) {


<div>

if (chassis\_.has_signal()) {


<div>

chassis\_.mutable_signal()-\>set_high_beam(true);


<div>

}


<div>

} else {


<div>

if (chassis\_.has_signal()) {


<div>

chassis\_.mutable_signal()-\>set_high_beam(false);


<div>

}


<div>

}


<div>


<div>

// 16, 17


<div>

if (ge3.has_scu_bcm_304()) {


<div>

Scu_bcm_304 scu_bcm_304 = ge3.scu_bcm_304();


<div>

if (scu_bcm_304.has_bcm_leftturnlampst() &&


<div>

Scu_bcm_304::BCM_LEFTTURNLAMPST_ACTIVE ==


<div>

scu_bcm_304.bcm_leftturnlampst()) {


<div>

chassis\_.mutable_signal()-\>set_turn_signal(


<div>

common::VehicleSignal::TURN_LEFT);


<div>

} else if (scu_bcm_304.has_bcm_rightturnlampst() &&


<div>

Scu_bcm_304::BCM_RIGHTTURNLAMPST_ACTIVE ==


<div>

scu_bcm_304.bcm_rightturnlampst()) {


<div>

chassis\_.mutable_signal()-\>set_turn_signal(


<div>

common::VehicleSignal::TURN_RIGHT);


<div>

} else {


<div>

chassis\_.mutable_signal()-\>set_turn_signal(


<div>

common::VehicleSignal::TURN_NONE);


<div>

}


<div>

} else {


<div>

chassis\_.mutable_signal()-\>set_turn_signal(


<div>

common::VehicleSignal::TURN_NONE);


<div>

}


<div>

// 18


<div>

if (ge3.has_scu_bcm_304() && ge3.scu_bcm_304().has_bcm_hornst() &&


<div>

Scu_bcm_304::BCM_HORNST_ACTIVE == ge3.scu_bcm_304().bcm_hornst()) {


<div>

chassis\_.mutable_signal()-\>set_horn(true);


<div>

} else {


<div>

chassis\_.mutable_signal()-\>set_horn(false);


<div>

}


<div>


<div>

// vin number will be written into KVDB once.


<div>

chassis\_.mutable_vehicle_id()-\>set_vin("");


<div>

if (ge3.has_scu_1_301() && ge3.has_scu_2_302() && ge3.has_scu_3_303()) {


<div>

Scu_1_301 scu_1_301 = ge3.scu_1_301();


<div>

Scu_2_302 scu_2_302 = ge3.scu_2_302();


<div>

Scu_3_303 scu_3_303 = ge3.scu_3_303();


<div>

if (scu_2_302.has_vin00() && scu_2_302.has_vin01() &&


<div>

scu_2_302.has_vin02() && scu_2_302.has_vin03() &&


<div>

scu_2_302.has_vin04() && scu_2_302.has_vin05() &&


<div>

scu_2_302.has_vin06() && scu_2_302.has_vin07() &&


<div>

scu_3_303.has_vin08() && scu_3_303.has_vin09() &&


<div>

scu_3_303.has_vin10() && scu_3_303.has_vin11() &&


<div>

scu_3_303.has_vin12() && scu_3_303.has_vin13() &&


<div>

scu_3_303.has_vin14() && scu_3_303.has_vin15() &&


<div>

scu_1_301.has_vin16()) {


<div>

int n\[17\];


<div>

n\[0\] = scu_2_302.vin00();


<div>

n\[1\] = scu_2_302.vin01();


<div>

n\[2\] = scu_2_302.vin02();


<div>

n\[3\] = scu_2_302.vin03();


<div>

n\[4\] = scu_2_302.vin04();


<div>

n\[5\] = scu_2_302.vin05();


<div>

n\[6\] = scu_2_302.vin06();


<div>

n\[7\] = scu_2_302.vin07();


<div>

n\[8\] = scu_3_303.vin08();


<div>

n\[9\] = scu_3_303.vin09();


<div>

n\[10\] = scu_3_303.vin10();


<div>

n\[11\] = scu_3_303.vin11();


<div>

n\[12\] = scu_3_303.vin12();


<div>

n\[13\] = scu_3_303.vin13();


<div>

n\[14\] = scu_3_303.vin14();


<div>

n\[15\] = scu_3_303.vin15();


<div>

n\[16\] = scu_1_301.vin16();


<div>


<div>

char ch\[17\];


<div>

memset(&ch, '\0', sizeof(ch));


<div>

for (int i = 0; i \< 17; i++) {


<div>

ch\[i\] = static_cast\<char\>(n\[i\]);


<div>

}


<div>

if (chassis\_.has_vehicle_id()) {


<div>

chassis\_.mutable_vehicle_id()-\>set_vin(ch);


<div>

}


<div>

}


<div>

}


<div>


<div>

// give engage_advice based on error_code and canbus feedback


<div>

if (chassis_error_mask\_) {


<div>

if (chassis\_.has_engage_advice()) {


<div>

chassis\_.mutable_engage_advice()-\>set_advice(


<div>

apollo::common::EngageAdvice::DISALLOW_ENGAGE);


<div>

chassis\_.mutable_engage_advice()-\>set_reason("Chassis error!");


<div>

}


<div>

} else if (chassis\_.parking_brake() \|\| CheckSafetyError(chassis_detail)) {


<div>

if (chassis\_.has_engage_advice()) {


<div>

chassis\_.mutable_engage_advice()-\>set_advice(


<div>

apollo::common::EngageAdvice::DISALLOW_ENGAGE);


<div>

chassis\_.mutable_engage_advice()-\>set_reason(


<div>

"Vehicle is not in a safe state to engage!");


<div>

}


<div>

} else {


<div>

if (chassis\_.has_engage_advice()) {


<div>

chassis\_.mutable_engage_advice()-\>set_advice(


<div>

apollo::common::EngageAdvice::READY_TO_ENGAGE);


<div>

}


<div>

}



设置自动驾驶模式，编辑相关使能逻辑，在 Apollo 中，车辆的驾驶模式主要包含：

- 完全自动驾驶模式（`COMPLETE_AUTO_DRIVE`）：横向、纵向都使能，
- 横向自动驾驶模式（`AUTO_STEER_ONLY`）：横向使能，纵向不使能，
- 纵向自动驾驶模式（`AUTO_SPEED_ONLY`）：横向不使能，纵向使能。

车辆使能控制信号控制逻辑如下所示：

<div>

<div>

ErrorCode Ge3Controller::EnableAutoMode() {


<div>

if (driving_mode() == Chassis::COMPLETE_AUTO_DRIVE) {


<div>

AINFO \<\< "already in COMPLETE_AUTO_DRIVE mode";


<div>

return ErrorCode::OK;


<div>

}


<div>

pc_bcs_202\_-\>set_pc_brkpedenable(Pc_bcs_202::PC_BRKPEDENABLE_ENABLE);


<div>

pc_vcu_205\_-\>set_pc_accpedenable(Pc_vcu_205::PC_ACCPEDENABLE_ENABLE);


<div>

pc_vcu_205\_-\>set_pc_gearenable(Pc_vcu_205::PC_GEARENABLE_ENABLE);


<div>

pc_epb_203\_-\>set_pc_epbenable(Pc_epb_203::PC_EPBENABLE_ENABLE);


<div>

pc_eps_204\_-\>set_pc_steerenable(Pc_eps_204::PC_STEERENABLE_ENABLE);


<div>


<div>

can_sender\_-\>Update();


<div>

const int32_t flag =


<div>

CHECK_RESPONSE_STEER_UNIT_FLAG \| CHECK_RESPONSE_SPEED_UNIT_FLAG;


<div>

if (!CheckResponse(flag, true)) {


<div>

AERROR \<\< "Failed to switch to COMPLETE_AUTO_DRIVE mode.";


<div>

Emergency();


<div>

set_chassis_error_code(Chassis::CHASSIS_ERROR);


<div>

return ErrorCode::CANBUS_ERROR;


<div>

}


<div>

set_driving_mode(Chassis::COMPLETE_AUTO_DRIVE);


<div>

// If the auto mode can be set normally, the harzad lamp should be off.


<div>

pc_bcm_201\_-\>set_pc_hazardlampreq(Pc_bcm_201::PC_HAZARDLAMPREQ_NOREQ);


<div>

AINFO \<\< "Switch to COMPLETE_AUTO_DRIVE mode ok.";


<div>

return ErrorCode::OK;


<div>

}


<div>


<div>

ErrorCode Ge3Controller::DisableAutoMode() {


<div>

ResetProtocol();


<div>

can_sender\_-\>Update();


<div>

set_driving_mode(Chassis::COMPLETE_MANUAL);


<div>

set_chassis_error_code(Chassis::NO_ERROR);


<div>

AINFO \<\< "Switch to COMPLETE_MANUAL OK.";


<div>

return ErrorCode::OK;


<div>

}


<div>


<div>

ErrorCode Ge3Controller::EnableSteeringOnlyMode() {


<div>

if (driving_mode() == Chassis::COMPLETE_AUTO_DRIVE \|\|


<div>

driving_mode() == Chassis::AUTO_STEER_ONLY) {


<div>

set_driving_mode(Chassis::AUTO_STEER_ONLY);


<div>

AINFO \<\< "Already in AUTO_STEER_ONLY mode";


<div>

return ErrorCode::OK;


<div>

}


<div>

pc_bcs_202\_-\>set_pc_brkpedenable(Pc_bcs_202::PC_BRKPEDENABLE_DISABLE);


<div>

pc_vcu_205\_-\>set_pc_accpedenable(Pc_vcu_205::PC_ACCPEDENABLE_DISABLE);


<div>

pc_vcu_205\_-\>set_pc_gearenable(Pc_vcu_205::PC_GEARENABLE_DISABLE);


<div>

pc_epb_203\_-\>set_pc_epbenable(Pc_epb_203::PC_EPBENABLE_DISABLE);


<div>

pc_eps_204\_-\>set_pc_steerenable(Pc_eps_204::PC_STEERENABLE_ENABLE);


<div>


<div>

can_sender\_-\>Update();


<div>

if (!CheckResponse(CHECK_RESPONSE_STEER_UNIT_FLAG, true)) {


<div>

AERROR \<\< "Failed to switch to AUTO_STEER_ONLY mode.";


<div>

Emergency();


<div>

set_chassis_error_code(Chassis::CHASSIS_ERROR);


<div>

return ErrorCode::CANBUS_ERROR;


<div>

}


<div>

set_driving_mode(Chassis::AUTO_STEER_ONLY);


<div>

// If the auto mode can be set normally, the harzad lamp should be off.


<div>

pc_bcm_201\_-\>set_pc_hazardlampreq(Pc_bcm_201::PC_HAZARDLAMPREQ_NOREQ);


<div>

AINFO \<\< "Switch to AUTO_STEER_ONLY mode ok.";


<div>

return ErrorCode::OK;


<div>

}


<div>


<div>

ErrorCode Ge3Controller::EnableSpeedOnlyMode() {


<div>

if (driving_mode() == Chassis::COMPLETE_AUTO_DRIVE \|\|


<div>

driving_mode() == Chassis::AUTO_SPEED_ONLY) {


<div>

set_driving_mode(Chassis::AUTO_SPEED_ONLY);


<div>

AINFO \<\< "Already in AUTO_SPEED_ONLY mode";


<div>

return ErrorCode::OK;


<div>

}


<div>

pc_bcs_202\_-\>set_pc_brkpedenable(Pc_bcs_202::PC_BRKPEDENABLE_ENABLE);


<div>

pc_vcu_205\_-\>set_pc_accpedenable(Pc_vcu_205::PC_ACCPEDENABLE_ENABLE);


<div>

pc_vcu_205\_-\>set_pc_gearenable(Pc_vcu_205::PC_GEARENABLE_ENABLE);


<div>

pc_epb_203\_-\>set_pc_epbenable(Pc_epb_203::PC_EPBENABLE_ENABLE);


<div>

pc_eps_204\_-\>set_pc_steerenable(Pc_eps_204::PC_STEERENABLE_DISABLE);


<div>


<div>

can_sender\_-\>Update();


<div>

if (!CheckResponse(CHECK_RESPONSE_SPEED_UNIT_FLAG, true)) {


<div>

AERROR \<\< "Failed to switch to AUTO_STEER_ONLY mode.";


<div>

Emergency();


<div>

set_chassis_error_code(Chassis::CHASSIS_ERROR);


<div>

return ErrorCode::CANBUS_ERROR;


<div>

}


<div>

set_driving_mode(Chassis::AUTO_SPEED_ONLY);


<div>

// If the auto mode can be set normally, the harzad lamp should be off.


<div>

pc_bcm_201\_-\>set_pc_hazardlampreq(Pc_bcm_201::PC_HAZARDLAMPREQ_NOREQ);


<div>

AINFO \<\< "Switch to AUTO_SPEED_ONLY mode ok.";


<div>

return ErrorCode::OK;


<div>

}



> ‍说明：添加控制信号的相关功能，必须要添加的控制信号包括车辆的油门、刹车踏板控制，转向控制，和档位控制。

其它控制信号包括车大灯控制、喇叭控制、转向灯控制、电子手刹控制。代码如下所示：

<div>

<div>

// NEUTRAL, REVERSE, DRIVE


<div>

void Ge3Controller::Gear(Chassis::GearPosition gear_position) {


<div>

if (driving_mode() != Chassis::COMPLETE_AUTO_DRIVE &&


<div>

driving_mode() != Chassis::AUTO_SPEED_ONLY) {


<div>

AINFO \<\< "This drive mode no need to set gear.";


<div>

return;


<div>

}


<div>

switch (gear_position) {


<div>

case Chassis::GEAR_NEUTRAL: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_NEUTRAL);


<div>

break;


<div>

}


<div>

case Chassis::GEAR_REVERSE: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_REVERSE);


<div>

break;


<div>

}


<div>

case Chassis::GEAR_DRIVE: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_DRIVE);


<div>

break;


<div>

}


<div>

case Chassis::GEAR_PARKING: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_PARK);


<div>

break;


<div>

}


<div>

case Chassis::GEAR_LOW: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_INVALID);


<div>

break;


<div>

}


<div>

case Chassis::GEAR_NONE: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_INVALID);


<div>

break;


<div>

}


<div>

case Chassis::GEAR_INVALID: {


<div>

AERROR \<\< "Gear command is invalid!";


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_INVALID);


<div>

break;


<div>

}


<div>

default: {


<div>

pc_vcu_205\_-\>set_pc_gearreq(Pc_vcu_205::PC_GEARREQ_INVALID);


<div>

break;


<div>

}


<div>

}


<div>

}


<div>


<div>

// brake with new acceleration


<div>

// acceleration:0.00~99.99, unit:


<div>

// acceleration:0.0 ~ 7.0, unit:m/s^2


<div>

// acceleration_spd:60 ~ 100, suggest: 90


<div>

// -\> pedal


<div>

void Ge3Controller::Brake(double pedal) {


<div>

// Update brake value based on mode


<div>

if (driving_mode() != Chassis::COMPLETE_AUTO_DRIVE &&


<div>

driving_mode() != Chassis::AUTO_SPEED_ONLY) {


<div>

AINFO \<\< "The current drive mode does not need to set acceleration.";


<div>

return;


<div>

}


<div>

pc_bcs_202\_-\>set_pc_brkpedreq(pedal);


<div>

}


<div>


<div>

// drive with old acceleration


<div>

// gas:0.00~99.99 unit:


<div>

void Ge3Controller::Throttle(double pedal) {


<div>

if (driving_mode() != Chassis::COMPLETE_AUTO_DRIVE &&


<div>

driving_mode() != Chassis::AUTO_SPEED_ONLY) {


<div>

AINFO \<\< "The current drive mode does not need to set acceleration.";


<div>

return;


<div>

}


<div>

pc_vcu_205\_-\>set_pc_accpedreq(pedal);


<div>

}


<div>


<div>

// ge3 default, -470 ~ 470, left:+, right:-


<div>

// need to be compatible with control module, so reverse


<div>

// steering with old angle speed


<div>

// angle:-99.99~0.00~99.99, unit:, left:-, right:+


<div>

void Ge3Controller::Steer(double angle) {


<div>

if (!(driving_mode() == Chassis::COMPLETE_AUTO_DRIVE \|\|


<div>

driving_mode() == Chassis::AUTO_STEER_ONLY)) {


<div>

AINFO \<\< "The current driving mode does not need to set steer.";


<div>

return;


<div>

}


<div>

const double real_angle =


<div>

vehicle_params\_.max_steer_angle() / M_PI \* 180 \* angle / 100.0;


<div>

pc_eps_204\_-\>set_pc_steerangreq(real_angle)-\>set_pc_steerspdreq(500);


<div>

}


<div>


<div>

// drive with acceleration/deceleration


<div>

// acc:-7.0 ~ 5.0, unit:m/s^2


<div>

void Ge3Controller::Acceleration(double acc) {


<div>

if (driving_mode() != Chassis::COMPLETE_AUTO_DRIVE &&


<div>

driving_mode() != Chassis::AUTO_SPEED_ONLY) {


<div>

AINFO \<\< "The current drive mode does not need to set acceleration.";


<div>

return;


<div>

}


<div>

// None


<div>

}


<div>


<div>

// steering with new angle speed


<div>

// angle:-99.99~0.00~99.99, unit:, left:-, right:+


<div>

// angle_spd:0.00~99.99, unit:deg/s


<div>

void Ge3Controller::Steer(double angle, double angle_spd) {


<div>

if (driving_mode() != Chassis::COMPLETE_AUTO_DRIVE &&


<div>

driving_mode() != Chassis::AUTO_STEER_ONLY) {


<div>

AINFO \<\< "The current driving mode does not need to set steer.";


<div>

return;


<div>

}


<div>

const double real_angle =


<div>

vehicle_params\_.max_steer_angle() / M_PI \* 180 \* angle / 100.0;


<div>

const double real_angle_spd =


<div>

ProtocolData\<::apollo::canbus::ChassisDetail\>::BoundedValue(


<div>

vehicle_params\_.min_steer_angle_rate() / M_PI \* 180,


<div>

vehicle_params\_.max_steer_angle_rate() / M_PI \* 180,


<div>

vehicle_params\_.max_steer_angle_rate() / M_PI \* 180 \* angle_spd /


<div>

100.0);


<div>

pc_eps_204\_-\>set_pc_steerangreq(real_angle)


<div>

-\>set_pc_steerspdreq(static_cast\<int\>(real_angle_spd));


<div>

}


<div>


<div>

void Ge3Controller::SetEpbBreak(const ControlCommand& command) {


<div>

if (command.parking_brake()) {


<div>

pc_epb_203\_-\>set_pc_epbreq(Pc_epb_203::PC_EPBREQ_APPLY);


<div>

} else {


<div>

pc_epb_203\_-\>set_pc_epbreq(Pc_epb_203::PC_EPBREQ_RELEASE);


<div>

}


<div>

}


<div>


<div>

void Ge3Controller::SetBeam(const ControlCommand& command) {


<div>

if (command.signal().high_beam()) {


<div>

pc_bcm_201\_-\>set_pc_lowbeamreq(Pc_bcm_201::PC_LOWBEAMREQ_NOREQ);


<div>

pc_bcm_201\_-\>set_pc_highbeamreq(Pc_bcm_201::PC_HIGHBEAMREQ_REQ);


<div>

} else if (command.signal().low_beam()) {


<div>

pc_bcm_201\_-\>set_pc_lowbeamreq(Pc_bcm_201::PC_LOWBEAMREQ_REQ);


<div>

pc_bcm_201\_-\>set_pc_highbeamreq(Pc_bcm_201::PC_HIGHBEAMREQ_NOREQ);


<div>

} else {


<div>

pc_bcm_201\_-\>set_pc_lowbeamreq(Pc_bcm_201::PC_LOWBEAMREQ_NOREQ);


<div>

pc_bcm_201\_-\>set_pc_highbeamreq(Pc_bcm_201::PC_HIGHBEAMREQ_NOREQ);


<div>

}


<div>

}


<div>


<div>

void Ge3Controller::SetHorn(const ControlCommand& command) {


<div>

if (command.signal().horn()) {


<div>

pc_bcm_201\_-\>set_pc_hornreq(Pc_bcm_201::PC_HORNREQ_REQ);


<div>

} else {


<div>

pc_bcm_201\_-\>set_pc_hornreq(Pc_bcm_201::PC_HORNREQ_NOREQ);


<div>

}


<div>

}


<div>


<div>

void Ge3Controller::SetTurningSignal(const ControlCommand& command) {


<div>

// Set Turn Signal


<div>

auto signal = command.signal().turn_signal();


<div>

if (signal == common::VehicleSignal::TURN_LEFT) {


<div>

pc_bcm_201\_-\>set_pc_leftturnlampreq(Pc_bcm_201::PC_LEFTTURNLAMPREQ_REQ);


<div>

pc_bcm_201\_-\>set_pc_rightturnlampreq(Pc_bcm_201::PC_RIGHTTURNLAMPREQ_NOREQ);


<div>

} else if (signal == common::VehicleSignal::TURN_RIGHT) {


<div>

pc_bcm_201\_-\>set_pc_leftturnlampreq(Pc_bcm_201::PC_LEFTTURNLAMPREQ_NOREQ);


<div>

pc_bcm_201\_-\>set_pc_rightturnlampreq(Pc_bcm_201::PC_RIGHTTURNLAMPREQ_REQ);


<div>

} else {


<div>

pc_bcm_201\_-\>set_pc_leftturnlampreq(Pc_bcm_201::PC_LEFTTURNLAMPREQ_NOREQ);


<div>

pc_bcm_201\_-\>set_pc_rightturnlampreq(Pc_bcm_201::PC_RIGHTTURNLAMPREQ_NOREQ);


<div>

}


<div>

}



添加 `CheckResponse` 逻辑，Apollo 程序内增加了对车辆底层是否在自动驾驶模式的监控，即车辆横向、驱动、制动模块的驾驶模式反馈是否处于自动驾驶状态。

如果在一个 `CheckResponse` 周期内，车辆某个模块驾驶模块反馈处于接管或者手动驾驶模式，则 Apollo 会控制车辆使能为紧急停车模式（`Emergency`），即各模块均控制为手动模式，确保控制车辆时的安全。

不同的车辆 `CheckResponse` 周期可能不同，需要开发者根据情况通过设置 `retry_num` 设定 `check` 周期。

开发者可以不改原 check 代码方案，将 3 个驾驶模式反馈报文与 Apollo 内 `chassis_detail` 做映射：

`is_eps_online->转向模式反馈信号`

`is_vcu_online->驱动模式反馈信号`

`is_esp_online->制动模式反馈信号`

在 `apollo/modules/canbus/vehicle/ge3/protocol/scu_eps_311.cc` 文件内，增加以下代码：

<div>

<div>

chassis-\>mutable_check_response()-\>set_is_eps_online(eps_drvmode(bytes, length) == 3);



在 `apollo/modules/canbus/vehicle/ge3/protocol/scu_vcu_1_312.cc` 文件内，增加以下代码：

<div>

<div>

chassis-\>mutable_check_response()-\>set_is_vcu_online(vcu_drvmode(bytes, length) == 3);



在 `apollo/modules/canbus/vehicle/ge3/protocol/scu_bcs_1_306.cc` 文件内，增加以下代码：

<div>

<div>

chassis-\>mutable_check_response()-\>set_is_esp_online(bcs_drvmode(bytes, length) == 3);



`CheckResponse` 实现代码如下：

<div>

<div>

bool Ge3Controller::CheckResponse(const int32_t flags, bool need_wait) {


<div>

int32_t retry_num = 20;


<div>

ChassisDetail chassis_detail;


<div>

bool is_eps_online = false;


<div>

bool is_vcu_online = false;


<div>

bool is_esp_online = false;


<div>


<div>

do {


<div>

if (message_manager\_-\>GetSensorData(&chassis_detail) != ErrorCode::OK) {


<div>

AERROR_EVERY(100) \<\< "get chassis detail failed.";


<div>

return false;


<div>

}


<div>

bool check_ok = true;


<div>

if (flags & CHECK_RESPONSE_STEER_UNIT_FLAG) {


<div>

is_eps_online = chassis_detail.has_check_response() &&


<div>

chassis_detail.check_response().has_is_eps_online() &&


<div>

chassis_detail.check_response().is_eps_online();


<div>

check_ok = check_ok && is_eps_online;


<div>

}


<div>


<div>

if (flags & CHECK_RESPONSE_SPEED_UNIT_FLAG) {


<div>

is_vcu_online = chassis_detail.has_check_response() &&


<div>

chassis_detail.check_response().has_is_vcu_online() &&


<div>

chassis_detail.check_response().is_vcu_online();


<div>

is_esp_online = chassis_detail.has_check_response() &&


<div>

chassis_detail.check_response().has_is_esp_online() &&


<div>

chassis_detail.check_response().is_esp_online();


<div>

check_ok = check_ok && is_vcu_online && is_esp_online;


<div>

}


<div>

if (check_ok) {


<div>

return true;


<div>

}


<div>

AINFO \<\< "Need to check response again.";


<div>

if (need_wait) {


<div>

--retry_num;


<div>

std::this_thread::sleep_for(


<div>

std::chrono::duration\<double, std::milli\>(20));


<div>

}


<div>

} while (need_wait && retry_num);


<div>


<div>

AINFO \<\< "check_response fail: is_eps_online:" \<\< is_eps_online


<div>

\<\< ", is_vcu_online:" \<\< is_vcu_online


<div>

\<\< ", is_esp_online:" \<\< is_esp_online;


<div>

return false;


<div>

}



###  4. 修改底盘车速反馈协议

\*\*重点：将车速反馈单位由 km/h 转化为 m/s \*\*

Apollo 系统内默认使用车速反馈量为 `m/s`，底盘车速信息对 Apollo 非常重要，在车辆标定、控制、规划等都需要采集该数据，所以在开发适配代码时，要重点检查车速反馈的单位。车速由`km/h`转化为 `m/s` 时，在反馈车速的信号除以 `3.6` 即可。 找到 Ge3 车辆反馈车速的报文在文件 `apollo/modules/canbus/vehicle/ge3/protocol/scu_bcs_2_307.cc` 下，反馈车速消息为`Scubcs2307::bcs_vehspd{}`，如下图所示：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_9e7ea07.png)

###  5. 注册新车辆

1.  在 `modules/canbus/vehicle/vehicle_factory.cc` 里注册新的车辆，在该文件内新建如下类：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_2ecd09d.png)

1.  添加头文件：

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_3a20644.png)

1.  添加 BUILD 依赖库，在 `apollo/modules/canbus/vehicle/BUILD` 文件内添加 `ge3_vehicle_factory` 依赖库。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_45e5eb6.png)

###  6. 更新配置文件

1.  在 `apollo/modules/common/configs/proto/vehicle_config.proto` 文件内添加 GE3 车辆分支。

![add_ge3_proto.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/add_ge3_proto_7a42ba6.png)

1.  在 [`apollo/modules/canbus/conf/canbus_conf.pb.txt`](https://apollo.baidu.com/docs/apollo/latest/canbus__conf_8pb_8txt.html) 更新配置，改为 ge3 的 canbus 通信程序。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Doc_CN_6_0/image_1baf464.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

