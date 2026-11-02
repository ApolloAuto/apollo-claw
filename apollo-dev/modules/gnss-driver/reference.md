# apollo-gnss-driver 参考资料

主素材：`（原始精读材料，未随包分发）`（3018 行全量精读，52 文件 8510 行 = 100% 覆盖）。
drivers 通用约定见 `（原始精读材料，未随包分发）`。

## 1. `Parser` 基类与 MessageType

`modules/drivers/gnss/parser/parser.h:78-150`。**两套并存的取消息 API**（历史包袱）：

```cpp
// 旧接口（单条式，NovatelParser 与 Rtcm3Parser 用）
void Update(const uint8_t *data, size_t length);          // :112 只存 data_/data_end_ 裸指针，不拷贝
void Update(const std::string &data);                      // :117
virtual MessageType GetMessage(MessagePtr *message_ptr);   // :123 反复调至返回 NONE

// 新接口（批量式，huace/broadgnss/asensing 用）
void GetMessagesByChannel(const uint8_t &channel, MessageInfoVec *messages);  // :127
virtual void GetMessages(const uint8_t &channel, MessageInfoVec *messages) {} // :135 基类空实现
virtual void GetMessages(MessageInfoVec *messages) {}                          // :137 基类空实现
virtual bool GetInsStat(MessagePtr *message_ptr) { return false; }             // :139 只 NovAtel 实现
```

`DataParser::ParseRawData` 只调新接口（`data_parser.cc:117`）；旧接口经 `NovatelParser::GetMessages`（`novatel_parser.cc:277-290`）间接调用。RTCM 通路直接调旧接口（`rtcm_parser.cc:65`）。`GetInsStat` 只 `NovatelParser` 实现（`novatel_parser.cc:732`，无条件返回 true），`DataParser` 在收到 INS 且 `!has_ins_stat_message_` 时兜底调用（`data_parser.cc:188`）。

`MessageType` 全 16 值（`parser.h:35-52`）：

| 值 | 谁产生 | `DispatchMessage`（`data_parser.cc:165`）如何处理 |
|---|---|---|
| `NONE` | 表示"没有更多消息" | 旧接口循环终止条件 |
| `GNSS` | 仅 NovAtel（BESTPOS/BESTVEL/PSRPOS/PSRVEL） | `CheckGnssStatus` → gnss_status（`:168-171`） |
| `GNSS_RANGE` | **无人产生，死枚举** | 未处理 |
| `IMU` | NovAtel RAWIMU(X)、HuaCe、BroadGnss、Asensing | `PublishImu`（`:176`） |
| `INS` | NovAtel CORRIMUDATA/INSCOV/INSPVA、HuaCe、BroadGnss、Asensing | `CheckInsStatus` + `PublishCorrimu` + `PublishOdometry` + ins_stat 兜底（`:180-197`） |
| `INS_STAT` | NovAtel INSPVAX、HuaCe、BroadGnss、Asensing | `PublishInsStat` + 置 `has_ins_stat_message_`（`:198-201`） |
| `WHEEL` | **无人产生，死枚举** | 未处理 |
| `EPHEMERIDES` | 仅 `Rtcm3Parser`（`rtcm3_parser.cc:174`） | **`DataParser` 不处理**，只在 `rtcm_parser.cc:75` |
| `OBSERVATION` | NovAtel RANGE + `Rtcm3Parser` | 两边都处理（`data_parser.cc:209`、`rtcm_parser.cc:79`） |
| `GPGGA` | **无人产生，死枚举** | 未处理 |
| `BDSEPHEMERIDES` | NovAtel BDSEPHEMERIS | `PublishEphemeris`（`:203-206`） |
| `RAWIMU` | **无人产生，死枚举**（NovAtel RAWIMU 报文返回的是 `IMU`） | 未处理 |
| `GPSEPHEMERIDES` | NovAtel GPSEPHEMERIS | `PublishEphemeris` |
| `GLOEPHEMERIDES` | NovAtel GLOEPHEMERIS | `PublishEphemeris` |
| `BEST_GNSS_POS` | NovAtel BESTGNSSPOS、HuaCe、BroadGnss、Asensing | `PublishBestpos`（`:172`） |
| `HEADING` | NovAtel HEADING(971)、HuaCe、BroadGnss、Asensing | `PublishHeading`（`:213`） |

辅助：`MessagePtr = ::google::protobuf::Message*`（`:34`）；`As<T>(ptr)` 是 `dynamic_cast`（`:72`）；`MessageInfo{type, message_ptr}`（`:53-56`）；`DISABLE_COPY_AND_ASSIGN`（`util/macros.h`）。

各 base parser 的 `Fill*` 契约：`asensing_base_parser.h:46-50` 是 5 个纯虚（`FillGnssBestpos`/`FillIns`/`FillInsStat`/`FillImu`/`FillHeading`），`huace_base_parser.h:98-102` 与 `broadgnss_base_parser.h:54-58` 是同名的 5 个具体方法。**新写 parser 照抄这 5 个的命名与职责划分。**

## 2. 五种 Stream 实现多维对照

基类 `stream/stream.h`，5 个静态工厂：`create_tcp`（`:39`）/ `create_udp`（`:42`）/ `create_serial`（`:47`）/ `create_ntrip`（`:50`）/ `create_can`（`:55`）。`create_stream` 工厂 switch 在 `raw_stream.cc:73-158`（case 分别在 `:75,88,100,112,137`）。

| 维度 | Serial | Tcp | Udp | Ntrip | Can |
|---|---|---|---|---|---|
| 类定义在 | `serial_stream.cc:60`（cc 内） | `tcp_stream.h:23`（独立头） | `udp_stream.cc:33`（cc 内） | `ntrip_stream.cc:40`（cc 内） | `can_stream.h:30`（独立头） |
| 阻塞模型 | `O_NONBLOCK` + `pselect` 5 ms 预等（`:285`） | timeout≠0 → 阻塞 + `SO_RCVTIMEO`；=0 → 非阻塞（`:65-106`） | 同 Tcp（`:94-142`） | 内含 `timeout=0` 的 TcpStream（`:80`），纯非阻塞 | 由 `CanClient::Receive` 决定 |
| read 预等 | `wait_readable(5000)` | `Readable(10000)`（`:255`） | **无预等**，直接 `recvfrom` | 委派内层 TcpStream | 无 |
| 断线检测 | `check_remove()` 0 长度 write 探 EBADF/EIO（`:258`） | `recv` 返回 0（`:274`） | **永不检测** | `timeout_s_` 无数据则重连（`:203`） | 无 |
| 自动重连 | `read`/`write` 里 Disconnect+Connect（`:300`、`:354`） | `Reconnect()`，受 `auto_reconnect_` 控制（`:131`） | **无** | 自己的 `Reconnect()` 带互斥锁（`:165`） | **无** |
| 重连重发 login | 是（`:235`） | 是（`:231`） | **否**（`:168` 明确注释掉了 `Login()`） | NTRIP 自有 HTTP 登录 | **否** |
| write | 有，5 次重试（`:342`） | 有 | 有 | 有，加 HTTP 前缀（`:226`） | **空实现，永远返回 0**（`can_stream.cc:69` TODO） |
| 波特率约束 | 仅 8 值（`:37-58`） | — | — | — | — |

**CAN 传 `CanFrame` 而非字节流（最重要的语义差异）**：`CanStream::read` 把整个 `apollo::drivers::canbus::CanFrame` 结构体 `memcpy` 进 buffer 并返回 `sizeof(frames[0])`（`can_stream.cc:57-67`）。所以 CAN 路径上 `RawStream::buffer_` 里装的**不是字节流，而是一个 C++ 结构体**；下游 `AsensingCanParser::PrepareMessage` 靠 `reinterpret_cast<const CanFrame*>(data_)` 还原（`asensing_can_parser.cc:194`）。后果：① CAN 路径发到 `/apollo/sensor/gnss/raw_data` 的字节是结构体内存镜像，用 `xxd` 看没有意义 ② 任何 format 都能配任何连接方式，**唯独 `ASENSING_CAN` 只能配 `can_card_parameter`** ③ 每次 read 只出 1 帧，且 `recv_frame_num` 是 static（`:59`）。

其他实现细节：`SerialStream::configure_port` 固定 8N1、raw、无流控（`:152-202`），**不可配**，proto 里也没有字段；`read` 的 switch 里 `EBADF/EIO` 重连失败时**刻意 fallthrough 到 default**（`:296-313`），改的时候别顺手加 `break`。`UdpStream::open` 把 socket `bind` 到 `INADDR_ANY:peer_port_`（`:87`）即**服务端语义**，conf 里 udp 的 `address` 只用于 `write` 的 `sendto`（`:217`），收包时任何源地址都收下。`NtripStream` 是组合而非继承，登录是标准 NTRIP v1（`GET /mountpoint HTTP/1.0` + Basic 认证，`:73-78`），判据是响应含 `"ICY 200 OK\r\n"`（`:128`）；失败分类日志很有用（`:135-141`：`SOURCETABLE 200 OK` = 挂载点不存在，`HTTP/` = 认证失败）；`write` 用 `try_lock`，拿不到就放弃（`:216`），所以 VRS 位置回推**可能静默丢弃**。

## 3. `conf/gnss_conf.pb.txt` 逐字段

类型 `apollo.drivers.gnss.config.Config`（`proto/config.proto:100-138`）。**唯一的运行时配置文件**，路径由 `dag/gnss.dag:9` 硬编码为 `/apollo/modules/drivers/gnss/conf/gnss_conf.pb.txt`（绝对路径，容器外跑要改）。

| 字段 | proto 行 | conf 行 | 作用 / 改了影响什么 |
|---|---|---|---|
| `data` | `:102` | `:1-24` | **必填**。没配 `Init` 直接失败（`raw_stream.cc:202`，AINFO 级别） |
| `data.format` | `:30` | `:3` | 选 parser。只有 5 个值可用；不支持的值 → `AFATAL` 崩进程（`data_parser.cc:100`） |
| `data.serial.device` | `:33` | `:7` | 当前 `/dev/ttyACM0`。不存在 → Connect 失败 → Init 失败 |
| `data.serial.baud_rate` | `:34` | `:8` | 当前 115200，default 9600。**只能是 8 个枚举值**（`serial_stream.cc:37-58`），非法值 → nullptr |
| `data.tcp.address/port` | `:40-41` | 注释 `:12-15` | port default 3001 |
| `data.udp.address/port` | `:45-46` | — | **address 只用于发送，收包 bind 到 ANY** |
| `data.ntrip.*` | `:50-55` | 注释 `:28-34` | port default 2101，timeout_s default 30。5 字段缺一不可（`raw_stream.cc:113-132`） |
| `data.can_card_parameter` | `:63` | 注释 `:18-23` | 复用 canbus 的 `CANCardParameter`。只有 `ASENSING_CAN` 用 |
| `data.push_location` | `:65` | — | **只在 `rtk_from` 上有意义** |
| `data.is_data_stream` | `:66` | — | **只在 `rtk_to` 上有意义**，default false。true 时 `DataSpin` 反向读并以 channel=1 喂 parser（`raw_stream.cc:528`），**只有 BroadGnss 能处理 channel 1** |
| `command` | `:106` | `:47-53` | 命令下发口（当前 `/dev/ttyACM2`）。不配则复用 data 流 |
| `rtk_from` | `:110` | **全部注释掉 `:26-37`** | 差分源。不配则 `RtkSpin` 立刻退出（`raw_stream.cc:536`） |
| `rtk_from.push_location` | `:65` | 注释 `:36` | true 时把 data 流里的 `$GPGGA` 回推给 caster（VRS 必需），`raw_stream.cc:247-249` 读、`:512` 用 |
| `rtk_to` | `:114` | `:39-45`（`/dev/ttyACM1`） | **陷阱：解析嵌套在 `has_rtk_from()` 内（`raw_stream.cc:258`），当前 conf 正是只配 rtk_to → 完全被忽略，无日志** |
| `login_commands` | `:116` | 全部注释 `:73-98` | 启动时逐条写给 data 流，**每条后 sleep 0.5 s**（`raw_stream.cc:444`）。conf `:70-72` 警告"仅调试用" |
| `logout_commands` | `:118` | `:100-101` | 析构时写出（`raw_stream.cc:168`），无 sleep |
| `novatel_config.imu_orientation` | `:72` | — | **死配置**，从不读；`novatel_parser.cc:146` 硬编码 `imu_frame_mapping_ = 5` |
| `ublox_config` | `:76` | — | 空 message，完全无用 |
| `rtk_solution_type` | `:129` | `:55` = `RTK_RECEIVER_SOLUTION` | 枚举在 `:125-128`。SOFTWARE 时不把 RTCM 转发给接收机（`raw_stream.cc:542-554`）；**两种情况下软解算都在跑** |
| `imu_type` | `:130` | `:56` = `CPT_XW5651` | 11 个枚举（`config.proto:81-91`）。**配错导致 acc/gyro 整体缩放错误，无任何报错**。只有 NovAtel parser 用（`novatel_parser.cc:203`） |
| `proj4_text` | `:131` | `:57`（zone 50） | **zone 配错 → 位置偏几百公里，无报错**。`pj_init_plus` 返回值不检查 |
| `tf.frame_id` / `child_frame_id` / `enable` | `:95-97` | `:60-62`（`world`→`imu`，enable true） | `enable` proto default **false**，conf 改成 true（`data_parser.cc:303`） |
| `wheel_parameters` | `:134` | `:66` | **有这个字段就会起 Timer 线程并订阅 chassis**（`raw_stream.cc:327`）。不需要车速回灌就删掉 |
| `gpsbin_folder` | `:135` | `:68` = `/apollo/data/gpsbin` | **创建失败会 ACHECK 崩进程**（`raw_stream.cc:66`）；**无轮转无上限，会写满磁盘** |
| `use_gnss_time` | `:136` | `:103` = true | false → 所有 measurement_time 用本机时间 |
| `auto_fill_gps_msg` | `:137` | — | default false。true 时 BroadGnss/AsensingCan 用融合结果冒充 bestpos/heading（`broadgnss_base_parser.cc:63,70`） |

当前 conf 两个可疑处：① `rtk_to` 配了但 `rtk_from` 注释掉 → `/dev/ttyACM1` 永不打开 ② `novatel_messages.h:451-465` 那段被注释的旧 `ImuType` 枚举里 `G320N = 40, CPT_X25651 = 41`，**与现行 `config.proto` 的 40/41 恰好对调**，读代码时极易被误导（以 `config.proto` 为准）。

`dag/gnss.dag`：唯一 component `GnssDriverComponent`（`:6`），`.so` 名由 `BUILD:69` 的 `apollo_component(name = "libgnss_component.so")` 决定，**没有 `readers` 段**（`Component<>` 无消息输入）。`launch/gnss.launch`：8 行纯转发，`process_name: gnss` 独占进程。启动 `cyber_launch start modules/drivers/gnss/launch/gnss.launch`。

## 4. `proto/` 各文件用途与枚举归属

| 文件 | 用途 | 关键 message |
|---|---|---|
| `proto/config.proto`（139 行） | **驱动私有配置**，只在驱动内用 | `Stream`（5 种连接的 oneof + 15 个 Format 枚举）、`Config`、`ImuType`、`TF`、`NovatelConfig`、`UbloxConfig` |
| `proto/gnss_status.proto`（44 行） | **驱动对外发布的三种状态** | `StreamStatus`（3 条流连通性）、`InsStatus`（INVALID/CONVERGING/GOOD）、`GnssStatus` |
| `proto/BUILD`（23 行） | bazel 规则 | `config_proto`、`gnss_status_proto`。**加新 .proto 文件才需要改它**（srcs 是具体文件名） |

驱动发布的其他消息类型都在 `modules/common_msgs/`：`sensor_msgs/gnss.proto`（`Gnss`、`RawData`、`SolutionStatus`、`SolutionType`）、`sensor_msgs/imu.proto`、`sensor_msgs/ins.proto`（`Ins`、`InsStat`）、`sensor_msgs/gnss_best_pose.proto`、`sensor_msgs/heading.proto`、`sensor_msgs/gnss_raw_observation.proto`（`GnssEphemeris`、`EpochObservation`、`GnssType`、`GnssBandID`、`PseudoType`）、`localization_msgs/gps.proto`（`Gps`）、`localization_msgs/imu.proto`（`CorrectedImu`）。

**`SolutionStatus`/`SolutionType` 有两套同名枚举，是本模块最易混淆处**：各 base parser 的 `PrepareMessageStatus` 映射到 `common_msgs/sensor_msgs/gnss.proto` 那套；`novatel_parser.cc` 内部用 `novatel::` 前缀那套（定义在 `novatel_messages.h`），通过 `static_cast` 互转（`novatel_parser.cc:506-508`）。

## 5. 38 条已确认问题全表

确信度：**确认** = 读代码可直接判定；**中** = 依赖运行时条件。按踩到概率排序，编号沿用 `33-gnss-driver.md` §9。

| # | file:line | 问题 | 影响 | 确信度 |
|---|---|---|---|---|
| 9.1 | `stream/raw_stream.cc:258`（外层 if `:239`） | `rtk_to` 解析嵌套在 `has_rtk_from()` 内 | 只配 rtk_to 时该串口永不打开，无任何日志。**当前 conf 正是这种情况** | 确认 |
| 9.2 | `parser.h:135`；`raw_stream.cc:528` | channel=1 的 `GetMessages(channel,vec)` 只有 `BroadGnssBaseParser` 重写 | 配了 `rtk_to.is_data_stream: true` 但用其他 format 时第二路数据被静默丢弃 | 确认 |
| 9.3 | `stream/can_stream.cc:65` | `frames` 为空时 `frames[0]` 是 UB | CAN 收到 0 帧时越界访问 | 确认 |
| 9.4 | `stream/can_stream.cc:59` | `static int32_t recv_frame_num = 1` 是入出参且 static | 若某次被回写 0，**从此永远收不到 CAN 数据** | 确认 |
| 9.5 | `stream/ntrip_stream.cc:88-91` | `tcp_stream_` 为空时 `return true` | 上层误认为 NTRIP 已连上（实践中不为空） | 确认 |
| 9.6 | `stream/serial_stream.cc:215-216` | `byte_time_us_` 用硬编码 `1e6/115200`，与 `baud_rate_` 无关 | 低波特率下 `wait_writable` 过早超时，**写命令可能不完整** | 确认 |
| 9.7 | `stream/tcp_stream.cc:206,275` 等 | `errno_ = errno` 赋在成功调用之后 | 仅影响日志（`errno_` 从未被读） | 确认 |
| 9.8 | `stream/raw_stream.cc:319` 写 / `:335-342` 读 | `chassis_ptr_` 跨线程无锁 | 理论上撕裂，x86 上概率极低 | 确认 |
| 9.9 | `parser/data_parser.cc:114` | `data_mutex_` 目前是纯开销（只有 DataSpin 一条线程调） | 无害。**channel 1 若挪到独立线程它就成必需，不要删** | 确认 |
| 9.10 | `stream/raw_stream.cc:195` 与 `:307` | `stream_writer_` 创建两次 | 纯冗余 | 确认 |
| 9.11 | `stream/raw_stream.cc:310-316`、`:586-591`、`:57-71` | gpsbin 绕一圈 cyber 落盘；`pending_queue_size=100`；**无轮转无上限**；目录建不了 ACHECK 崩 | 115200 满速 ≈1 GB/天，会写满磁盘 | 确认 |
| 9.12 | `novatel_parser.cc:150`、`huace_text_parser.cc:56`、`parser_common.h:108`、`protocol_asensing.h:114` | 重连时 parser 内部缓冲不清空 | 残留半帧污染新数据，通常自愈代价丢 1-2 帧。`clearCache()`（`protocol_asensing.h:95`）从未被调用 | 确认 |
| 9.13 | `parser/novatel_parser.cc:277-290` | `std::set` 按类型去重，同类型多帧只 push 第一个 | 200 Hz IMU 只发 1 帧/包（~36 帧丢 35）。**去重是刻意的**（指针都指向同一成员对象），发布的是最后一帧内容。`<set>` 头文件也漏了 include | 确认 |
| 9.14 | `stream/raw_stream.cc:539-556` | `rtk_software_solution_` 名不副实，两个分支都调 `PublishRtkData` | 开关唯一作用是"是否转发 RTCM 给接收机"，软解算一直在跑 | 确认 |
| 9.15 | `stream/raw_stream.cc:572-583` | 在二进制 `uint8_t buffer_[2048]` 上用 `strstr`/`strchr` | 无 NUL 终止时读越界（实践中残留字节里几乎总有 0） | 确认 |
| 9.16 | `protocol_asensing.h:71,78`；`novatel_parser.cc:295,310,317` | 未对齐读 + 隐式小端假设（3 处） | x86 无表现；**ARM 上 `toValue<float>/<double>` 有真实崩溃风险**。模板那处最危险（被 decode_0A/0B 大量调用） | 确认 |
| 9.17 | `proto/config.proto:70-73`；`novatel_parser.cc:146` | `imu_orientation` 是死配置，`imu_frame_mapping_ = 5` 硬编码 | IMU 装反的车无法通过配置修正 | 确认 |
| 9.18 | `parser/huace_parser/huace_text_parser.cc:66-75` | 从 `data_end_` 向前找最后一个 `'$'`：越界读 + 只保留最后一条 | 100 Hz GPCHC 下 2048 B 装 ~10 条**丢 9 条**，日志刷 `HUACE message has been truncated` | 确认 |
| 9.19 | `broadgnss_base_parser.cc:63,129`；`asensing_can_parser.cc:173,367` | 用"纬度 > 0"当"已收到 BESTPOS"的数值哨兵 | **南半球 BESTPOSA 数据被忽略**，永远走融合结果 | 确认 |
| 9.20 | `parser/parser_common.h:80,108` | `channel_messages_{5}` 固定 5 槽且下标无边界检查 | 当前只用 0/1 所以安全；加数据流必须同步改 5。同包多帧仍只留最后一帧（`:91`） | 确认 |
| 9.21 | `protocol_asensing.h:117-118`；`.cc:146-150` | 两个 map 是 static，`registProtocol` 用 `insert` 不覆盖 | 第二个实例的注册被忽略；**第一个实例销毁后 map 里是悬垂指针，`subData` 会崩**。parser_cli 与主进程同跑即触发 | 确认 |
| 9.22 | `protocol_asensing.cc:86` | `while (start_index < receive_data_.size() - 11)` size_t 下溢 | `size()<11` 时条件恒真，`data_address[start_index+2]`（`:91`）立刻越界读。串口 read 返回 1-2 字节很常见 | 确认 |
| 9.23 | `decode_0B.cc:159,161`；`asensing_binary_parser.cc:63`；`data_parser.cc:235` | 时间做 GPS→Unix→GPS 往返，两套闰秒实现（硬编码 -18 + 查表） | 当前恰好抵消；下次闰秒变化要改两处；设备刚上电时链式返回 0 | 确认 |
| 9.24 | `parser/asensing_parser/asensing_binary_parser.cc:49-51` | `getProtocol() != decode_b.m_typeImu` 门控用的是本包**最后一次**匹配的头 | 设备按 0B→10→0A 输出时**永远不产消息**。建议改用 `decode_b.update_ins` 标志（`protocol_asensing.h:147`，已置位但从未被读） | 确认 |
| 9.25 | `asensing_binary_parser.cc:48`；`decode_0B.cc:91`；`protocol_asensing.h:90-91` | 数据循环里无频率控制的 AINFO / 裸 printf | 刷屏。其他 parser 都用了 `_EVERY(N)` | 确认 |
| 9.26 | `parser/asensing_parser/asensing_can_parser.cc:25-33` | 单位宏没括号：`#define ACC_UNIT 0.0001220703 - 4` 等 6 个 | 只在 `raw * ACC_UNIT` 这一种写法下恰好正确；换写法即错。建议改成 scale/offset 两个 constexpr | 确认 |
| 9.27 | `asensing_can_parser.cc:318-324` | `DecodeGnssUtc` 用 `mktime` 解释 UTC | 非 UTC 时区的宿主机上直接跑会偏 -8 小时（容器内 TZ=UTC 时正确）。建议 `timegm` | 确认 |
| 9.28 | `parser/asensing_parser/asensing_can_parser.cc:431` | `rfu_to_flu(gyro_x, gyro_x, gyro_z, ...)` —— 第二参应为 `gyro_y`（对比正确的 `:402`） | **真实功能 bug**：`/apollo/sensor/gnss/imu` 的 `angular_velocity.y` 是错的，MSF 用的正是这个 channel | 确认 |
| 9.29 | `asensing_can_parser.cc:404` vs `:364`（数据源 `:278-279`、`:327`） | INS 与 BESTPOS 时间戳来自不同 CAN 帧（0x50A+0x503 vs 0x508） | **启动瞬间 INS 时间戳为 0 是必然的**，直到收到第一帧 0x50A | 确认 |
| 9.30 | `parser/rtcm3_parser.cc:40-44` | `if (1 != init_rtcm(&rtcm_)) init_flag_ = true;` 逻辑反了 | 无影响（`init_flag_` 从未被读）。对比正确写法 `novatel_parser.cc:192-194` | 确认 |
| 9.31 | `rtcm3_parser.cc:241,244`；`novatel_parser.cc:1084,1087` | 内层循环变量是 `j` 却写 `code[i]`（两文件各一处） | **真实 bug**：`i>=7` 越界读 + `pseudo_type` 判断始终不可靠；NovAtel 侧 `:1091` 的 AINFO 会疯狂刷。另 `:1100-1101` 有重复 `set_snr` | 确认 |
| 9.32 | `data_parser.cc:244-251,319-326`；`parser_common.h:47-52` | `PublishImu`/`PublishCorrimu` 在 parser 的 `rfu_to_flu` 之上又变换一次 | 对文本/Asensing parser **两次恰好抵消**（发布的就是设备原始轴系）；NovAtel 不同；`PublishOdometry` 不变换 → `CorrectedImu` 与 `Gps` 轴系约定不同 | 确认，需实车验证 |
| 9.33 | `parser/data_parser.cc:282-284` vs `:298-300` | `Gps` 的 position 是 UTM 米、velocity 是 ENU | zone 边缘网格收敛角可达 ±3°，速度方向有误差。无任何注释说明 | 确认 |
| 9.34 | `parser/data_parser.cc:336-345`；`rtcm_parser.cc:88-97` | `PublishEphemeris`/`PublishObservation` 不填 header | `rtk_eph`/`rtk_obs` 的 `header.timestamp_sec` 是 0。MSF 用这两个 channel | 确认 |
| 9.35 | `util/time_conversion.h:124,135` | `gps2unix`/`unix2gps` 越界静默 `return 0`，无日志无断言 | **现场"时间戳为 0"的根源**。下游 `rtk_localization.cc:51` 只会报"延迟过大"，误导排查方向 | 确认 |
| 9.36 | `novatel_parser.cc:739-741` + `data_parser.cc:222-226` | `HandleInsPvax` 里算的 `gps2unix` 被 `FillHeader` 覆盖成 `Time::Now()` | 那次转换白做。**印证：parser 不要自己调 `gps2unix`** | 确认 |
| 9.37 | `data_parser.cc:349-354` + `msf/local_integ/measure_republish_process.cc:557-559` | heading 时间戳在 `if (is_trans_gpstime_to_utctime_)` 下被二次 `GpsToUnixSeconds`（已现场核对该条件名） | 该标志为真时偏 ≈315964782 秒（≈10 年）。**改 heading 时间戳前必须核实这个标志的取值** | 中 |
| 9.38 | `parser/data_parser.cc:63-64`、`:280` | `pj_init_plus` 与 `pj_transform` 返回值都不检查；`proj4_text` 无 default | 配置为空/语法错 → nullptr → 崩或静默错。建议 `Init` 里 `CHECK_NOTNULL` | 确认 |

## 6. 20 项死代码（"改了为什么没效果"）

| 位置 | 内容 |
|---|---|
| `parser/parser.h:68` | `#define EPOCH_AND_SYSTEM_DIFF_SECONDS 315964800` 从未使用（第三份重复定义） |
| `parser/parser.h:37,42,45,47` | `GNSS_RANGE`/`WHEEL`/`GPGGA`/`RAWIMU` 四个 MessageType 无人产生 |
| `proto/config.proto:70-73` | `NovatelConfig.imu_orientation` 从未被读（见 9.17） |
| `proto/config.proto:75` | `UbloxConfig` 空 message；全仓库搜 `ublox` 只命中这一处 |
| `stream/raw_stream.h:46` | `bool filter[Stream::NUM_STATUS]` 从未使用 |
| `stream/udp_stream.cc:82` | `socklen_t socklenth` 声明未用 |
| `parser/data_parser.cc:52-54` | `POSE_COVAR` 常量从未使用（注释说是 inscov 兜底，没实现） |
| `parser/data_parser.cc:48` | `DEG_TO_RAD_LOCAL` 与 `parser_common.h:35` 的 `DEG_TO_RAD` 重复定义同值 |
| `parser/rtcm_decode.h:26-53` | `baud_obs_num()` 从未调用；**全文把 band（频段）拼成 baud（波特率）** |
| `parser/rtcm3_parser.h:52` | `init_flag_` 从未被读（见 9.30） |
| `parser/novatel_parser.cc:1100-1101` | `set_snr` 重复调用两次 |
| `parser/novatel_messages.h:451-465` | 被注释的旧 `ImuType` 枚举，**40/41 映射与现行 proto 相反**，极易误导 |
| `parser/novatel_messages.h:53-54` | `MARK1PVA = 1067`、`GPGGA = 218` 有枚举无 case |
| `parser/broadgnss_parser/broadgnss_message.h:28,39-69` | `Message101B_ID` + `BraodGnss101BMessage`（拼写 Braod）—— BROADGNSS_BINARY 未完成骨架 |
| `parser/asensing_parser/protocol_asensing.h:147` | `update_ins` 置位后从未被读（本该用于替换 9.24 的门控） |
| `parser/asensing_parser/protocol_asensing.h:95` | `clearCache()` 从未被调用（本该用于 9.12 的重连清缓冲） |
| `parser/asensing_parser/protocol_asensing.cc:25-63` | 34 个值的 `ERROR_CODE` 枚举从未使用 |
| `parser/asensing_parser/decode_0A.cc:48,50,52,56,58,60,64,68` | `m_msg_gx` 等 6 个变量 + `pubMsg_temperature`、`time` 赋值后从未使用（CSV 落盘被注释） |
| `parser/asensing_parser/decode_0B.cc:242-289` | `parseGnss` 解出 20+ 字段，只有 4 个被用（`:293-298`） |
| `parser/asensing_parser/decode_0B.cc:28-55` | `epoch2time_sdk`/`gpst2time_sdk` 与 rtklib 同名函数重复 |
| `cyberfile.xml:26-32` | 声明了 opencv/portaudio/ffmpeg/adv_plat/pcl/libpcap/yaml-cpp，gnss 完全不用 |

**另外没有的东西（别去找）**：没有任何 gtest 单测（`BUILD` 无 `apollo_cc_test`，`test/` 只有 `parser_cli.cc`）；没有 mock Stream（测不了重连逻辑）；没有 fuzz/边界测试；没有性能基准。

## 7. 与 localization 侧的接口契约

驱动是 localization 的上游数据源，改输出格式前必须核对下游：

| channel | 下游消费者 | 契约要点 |
|---|---|---|
| `.../odometry`（`localization.Gps`） | `rtk_localization`（`modules/localization/rtk/`） | position 是 **UTM 米**（`data_parser.cc:280` 的 `pj_transform`），velocity 是 **ENU**（`:298-300`），两者坐标系不一致（9.33）。orientation 由 `:287-291` 合成（航向减 90°） |
| `.../corrected_imu`（`localization.CorrectedImu`） | `rtk_localization` | 轴系被 `PublishCorrimu`（`:319-326`）二次变换，与 `Gps` 约定不同（9.32） |
| `.../imu`（`gnss.Imu`） | **MSF** `MSFLocalization::OnRawImu`（`msf_localization.cc:215`，内有 `FLAGS_imu_coord_rfu` 分支 `:217`） | 这是 9.28 那个 `gyro_y` bug 的直接受害通路 |
| `.../heading`（`gnss.Heading`） | MSF `measure_republish_process.cc:557-559` | 在 `is_trans_gpstime_to_utctime_` 为真时**被二次 `GpsToUnixSeconds`**（9.37），改时间戳前必须核实 |
| `.../ins_stat`、`.../best_pose` | MSF / rtk | `ins_stat` 有两条产出路径（INSPVAX 直发或 `GetInsStat` 兜底） |
| `.../rtk_eph`、`.../rtk_obs` | MSF `OnGnssRtkObs`（`msf_localization.cc:275`） | **header 不填，timestamp_sec 是 0**（9.34）；且各有两个 Writer（DataParser + RtcmParser），`RTK_RECEIVER_SOLUTION` 下会混合接收机直出与 NTRIP 软解算数据 |
| 时间戳看门狗 | `rtk_localization.cc:48-54` | `time_delay > gps_time_delay_tolerance_` 时 `monitor_logger_.WARN`。时间戳为 0 时报的是"延迟过大"而非"非法" |
| 闰秒表 | `modules/localization/msf/common/util/time_conversion.h:43-52` | 另一份**不一致**的 `LEAP_SECONDS`（只到 2006-01-01）+ 同样的 `315964800`。改闰秒必须同改两处 |

深入 localization 侧行为请切到 `apollo-localization-dev` skill，或读 `（原始精读材料，未随包分发）`（RTK/融合主流程）与 `（原始精读材料，未随包分发）`（MSF 与 measure_republish 细节）。

