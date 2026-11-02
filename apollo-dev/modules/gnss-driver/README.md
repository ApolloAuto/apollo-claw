# Apollo GNSS/INS 驱动改代码作业指导书

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/drivers/gnss/...` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；**要改** → 先
> `buildtool install <pkg>`，落到 `/apollo_workspace/modules/drivers/gnss/...`（保留完整仓库相对路径，不用换算）。
> 编译用 `buildtool build -p <相对工作区的包路径>`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **改串口/波特率/杆臂等 conf 试效果**：走 `/apollo/<src_path>/conf/*`（符号链接，立即生效）；
> 改工作区源码副本的 conf 要重编才生效。
> **本环境现场核对**：gnss 已完整安装可直接跑 —— `.so` 在 `/opt/apollo/neo/lib/modules/drivers/gnss/`
> （`libgnss_component.so`、`libapollo_drivers_gnss.so`），运行期入口
> `/apollo/modules/drivers/gnss/{conf/gnss_conf.pb.txt,dag/gnss.dag,launch/gnss.launch}` 三个符号链接都在，
> 起法 `cyber_launch start /apollo/modules/drivers/gnss/launch/gnss.launch`（`buildtool bootstrap start gnss`
> **起不来** —— launch 不在 `modules/gnss/launch/` 下，见 `modules/debug/` 适配段 ③）。
> 当前 conf 是 `format: NOVATEL_BINARY` + `serial{device:"/dev/ttyACM0" baud_rate:115200}`，
> **没接真设备时组件根本不上线**（现场核对调用链：`RawStream::Init` 在
> `stream/raw_stream.cc:294` 就调 `Connect()`，失败即 `AERROR "gnss driver connect failed."` + return false
> → `gnss_component.cc:40-44` 返 false → Component 不上线；串口打不开的具体 errno 在
> `stream/serial_stream.cc:113-129` 的 `open()` 里打）。调试解析器请用 record 回放或改成 tcp/udp 模式。
> 完整对照见仓库根 `CLAUDE.md`。

长知识（Parser 基类全枚举、5 种 Stream 对照、conf 逐字段、13 channel 全表、38 条已确认问题、20 项死代码、localization 接口契约）见 `reference.md`。

## 1. 目录地图与三层结构

`modules/drivers/gnss/`，52 文件。改代码前先定位到层：

```
gnss_component.{h,cc}   GnssDriverComponent : Component<>   只有 Init()，没有 Proc()
  └─ stream/ (10 文件) 物理连接 serial/tcp/udp/ntrip/can + RawStream 调度
  └─ parser/ (26 文件) 协议解析 novatel/huace/broadgnss/asensing/rtcm3
  └─ proto/ conf/ dag/ launch/ util/ test/ test_data/
```

- **component 层**：`gnss_component.cc:28-48` 全部逻辑就是读 conf → `new RawStream` → `Init()` → `Start()`。**不要往这里加业务代码**，它连 Proc 都没有。
- **stream 层**：`RawStream::Start()`（`stream/raw_stream.cc:324-332`）起 2 条 `std::thread`：`DataSpin`（`:498`）读主数据流，`RtkSpin`（`:535`）读差分。外加 1 个可选 1 Hz `cyber::Timer`（`:334` 车速回灌，仅 conf 有 `wheel_parameters` 时）+ 2 个 cyber Reader 回调（gpsbin 落盘 `:586`、chassis 缓存 `:319`）。**没有协程**，两条线程都是 `while (cyber::OK())` 靠 `read()` 超时限速。
- **parser 层**：只被 DataSpin 单线程调用。

数据往下流（一条数据的完整旅程）：

```
设备 → Stream::read(buffer_, 2048)                    raw_stream.h:68 BUFFER_SIZE
 → RawStream::DataSpin                                raw_stream.cc:498
    ├→ raw_writer_->Write(RawData) :510 → raw_data channel →(绕一圈 cyber)→ GpsbinCallback :586 落盘
    └→ DataParser::ParseRawData(msg, 0)  :511
        ├→ Parser::Update(msg)  parser.h:112  只存两个裸指针，不拷贝
        ├→ Parser::GetMessagesByChannel(0,&v)  parser.h:127
        │   └→ XxxParser::GetMessages(&v) → PrepareMessage() 拆帧校验 → Fill*() 填 protobuf
        └→ DataParser::DispatchMessage 逐条分发  data_parser.cc:165-219
```

差分链路：`RtkSpin` → `PublishRtkData`（`:559`）→ rtcm_data channel + `RtcmParser::ParseRtcmData`（`rtcm_parser.cc:55`）→ `Rtcm3Parser::GetMessage`（旧接口）→ rtk_eph / rtk_obs。

## 2. 输出 channel 清单（13 个）

gflag 全部定义在 `modules/common/adapters/adapter_gflags.cc`。

| channel | 类型 | gflag | 频率 | Writer 创建于 |
|---|---|---|---|---|
| `/apollo/sensor/gnss/stream_status` | `gnss.StreamStatus` | `stream_status_topic` (`:260`) | 状态跳变时 | `raw_stream.cc:307`（`:195` 重复创建一次，见 reference 9.10） |
| `.../raw_data` | `gnss.RawData` | `gnss_raw_data_topic` (`:258`) | 每次 read>0，几百 Hz | `raw_stream.cc:308` |
| `.../rtcm_data` | `gnss.RawData` | `rtcm_data_topic` (`:264`) | NTRIP 下行，~1 Hz | `raw_stream.cc:309` |
| `.../gnss_status` | `gnss.GnssStatus` | `gnss_status_topic` (`:140`) | 仅 NovAtel 产 GNSS 类型，~1 Hz | `data_parser.cc:78` |
| `.../ins_status` | `gnss.InsStatus` | `ins_status_topic` (`:138`) | 变化时或 ≥1 s | `data_parser.cc:79` |
| `.../best_pose` | `gnss.GnssBestPose` | `gnss_best_pose_topic` (`:222`) | ~1 Hz（文本 parser 被 `RateControl` 限到 ~1.11 Hz，`parser_common.h:54` 周期 900 ms） | `data_parser.cc:81` |
| `.../corrected_imu` | `localization.CorrectedImu` | `imu_topic` (`:23`) | 每个 INS | `data_parser.cc:82` |
| `.../ins_stat` | `gnss.InsStat` | `ins_stat_topic` (`:136`) | INSPVAX 直发或 `GetInsStat` 兜底 | `data_parser.cc:83` |
| `.../rtk_eph` | `gnss.GnssEphemeris` | `gnss_rtk_eph_topic` (`:220`) | 星历 | `data_parser.cc:85` **和** `rtcm_parser.cc:48`（两个 Writer） |
| `.../rtk_obs` | `gnss.EpochObservation` | `gnss_rtk_obs_topic` (`:218`) | RANGE | `data_parser.cc:87` **和** `rtcm_parser.cc:50` |
| `.../heading` | `gnss.Heading` | `heading_topic` (`:262`) | 每个 HEADING | `data_parser.cc:88` |
| `.../imu` | `gnss.Imu` | `raw_imu_topic` (`:24`) | 设备 IMU 率 | `data_parser.cc:89` |
| `.../odometry` | `localization.Gps` | `gps_topic` (`:22`) | 每个 INS | `data_parser.cc:90` |

另有 tf 广播（不是 channel）：`conf` 的 `tf.enable` 为 true 时每个 INS 发一个 `TransformStamped`（`data_parser.cc:303`）。
订阅：`/apollo/canbus/chassis`（`raw_stream.cc:317`）、自订阅 `raw_data` 落盘（`:310`）。

## 3. 支持的协议 parser 清单（已现场核对）

`proto/config.proto:8-29` 有 **15 个 Format 枚举**，`Parser::CreateParser`（`parser.h:87-102`）**只实现 5 个**：

| Format | 值 | 工厂 | 定义在 | 状态 |
|---|---|---|---|---|
| `NOVATEL_BINARY` | 11 | `CreateNovatel` | `novatel_parser.cc:182` | 已实现，1116 行，最复杂 |
| `HUACE_TEXT` | 12 | `CreateHuaCeText` | `huace_parser/huace_text_parser.cc:59` | 已实现 |
| `ASENSING_BINARY` | 15 | `CreateAsensingBinary` | `asensing_parser/asensing_binary_parser.cc:41` | 已实现（BDDB 协议） |
| `ASENSING_CAN` | 16 | `CreateAsensingCan` | `asensing_parser/asensing_can_parser.cc:146` | 已实现（CAN ID 0x500-0x512） |
| `BROADGNSS_TEXT` | 30 | `CreateBroadGnssText` | `broadgnss_parser/broadgnss_text_parser.cc:53` | 已实现 |
| `RTCM_V3` | 3 | `CreateRtcmV3`（`parser.h:105`） | `rtcm3_parser.cc:35` | 实现了但**不走 CreateParser**，只被 `rtcm_parser.cc:40` 硬编码 `new Rtcm3Parser(true)` |
| `NMEA`/`RTCM_V2`/`NOVATEL_TEXT`/`HUACE_CAN`/`ASENSING_TEXT`/`UBLOX_TEXT`/`UBLOX_BINARY` | 1,2,10,13,14,20,21 | — | — | **枚举存在，零实现**。ublox 在 11.0 已移除，仅剩 `config.proto:75` 一个空 `UbloxConfig` |
| `BROADGNSS_BINARY` | 31 | — | — | 无实现，`broadgnss_message.h:39` 留了 `BraodGnss101BMessage` 空骨架（注意拼写是 Braod） |
| `UNKNOWN` | 0 | — | — | `default: return nullptr` → `data_parser.cc:100` AFATAL 崩进程 |

`conf/gnss_conf.pb.txt:2` 的注释漏了 `ASENSING_CAN`，改代码时顺手补上。

## 4. 新增一个 protocol parser（8 步，无插件机制、无自动注册）

1. **`proto/config.proto:8-29` 加 Format 枚举**。用未占用的值（建议按厂商分段），**绝不复用 `UBLOX_BINARY = 21` 这类空枚举**，老 conf 可能还在用。
2. **`parser/parser.h` 两处都改**：`:85` 后加 `static Parser *CreateMyVendor(const config::Config &);`，`:98` 后加对应 `case`。工厂声明在基类、定义在子类 .cc 是本模块既定风格（子类完全不暴露头文件），**照抄，不要改成注册表** —— `ProtocolAsensing` 的 static map 已证明注册表在此库会带来跨实例污染（reference 9.21）。
3. **建 `parser/myvendor_parser/`，照抄 `broadgnss_parser/` 或 `huace_parser/` 的两层结构**（base parser 负责 `GetMessages` + `Fill*`，具体 parser 负责 `PrepareMessage`）。**不要照抄 `novatel_parser.cc`**，它用的是旧单条接口。
4. **实现 `PrepareMessage()` 的返回语义 —— 这里最反直觉**：
   - 新接口：`GetMessages(MessageInfoVec*)`（`asensing_base_parser.cc:31` / `huace_base_parser.cc:35` / `broadgnss_base_parser.cc:40`）内部 `if (!PrepareMessage()) return;` —— **返回 false = 本次 Update 不产任何消息**（拆帧没凑齐 / 校验失败 / 门控不通过）。
   - 旧接口：`GetMessage(MessagePtr*)` 返回 `MessageType`，调用者反复调至返回 `NONE`。NovAtel 的各 `Handle*` 函数**返回 false 表示"消息还没凑齐、只更新了内部状态、先别发布"**，不是错误（`HandleInsCov` 就是无条件 `return false`，`novatel_parser.cc:684`）。这是刻意设计：BESTPOS+BESTVEL 要凑齐才发一条 `Gnss`。**新写 parser 时别把 false 当错误码用。**
   - `*message_ptr` 必须指向 **parser 内部成员对象**（零拷贝），调用者在下次调用前消费（`parser.h:120-122`）。
5. **CRC / 校验**：二进制协议必须校验。NovAtel 是 CRC32 私有多项式（`novatel_parser.cc:292-296`，失败 `AERROR << "CRC check failed."` `:300` 并清 `buffer_`）；Asensing 是 XOR（`decode_0A.cc:39-43`）；HuaCe/BroadGnss **完全不校验**（`huace_text_parser.cc:91` 直接把 `*XX` 切掉扔了），新写文本 parser 建议补上。
6. **BUILD 不用改**：`BUILD:10-20` 的 `srcs = glob(["parser/*.cc","parser/**/*.cc","stream/*.cc"])` 自动收编新子目录。**但新增外部依赖（新 proto、新第三方库）必须加到 `BUILD:22-54` 的 `deps`，第三方库还要加 `cyberfile.xml` 的 `<depend>`。**
7. **conf 里选**：`conf/gnss_conf.pb.txt:3` 改 `format:`，同步更新 `:2` 的注释。
8. **编译验证**：`buildtool build -p modules/drivers/gnss`，或 `bazel build //modules/drivers/gnss:libgnss_component.so //modules/drivers/gnss:parser_cli`。编译能挡住：`static_assert` 结构体大小、工厂未定义（`undefined reference to Parser::CreateMyVendor`）、枚举拼错。**挡不住且必须走 §9 离线验证的**：字段偏移、字节序、单位、轴系方向、时间戳时基 —— 全是静默错误。

二进制协议额外要求：结构体用 `#pragma pack(push,1)` 包住 + 每个都写 `static_assert(sizeof(X)==N)`（照抄 `novatel_messages.h:67,112`）；**读多字节字段用 `memcpy` 或显式逐字节组装（`asensing_can_parser.cc:98-110` 的 `ToValue`），不要用 `*reinterpret_cast<const T*>(ptr+off)`** —— `protocol_asensing.h:71,78` 就是反面教材（未对齐读 + 硬编码小端，ARM 上 float/double 有真实崩溃风险）。

## 5. 新增一种 Stream（连接方式）（4 步）

1. **`proto/config.proto:32-67`** 加子消息 + 加入 `oneof type`。**字段号从 9 开始**（1-6 已用，7=`push_location`、8=`is_data_stream`）。加入 oneof 后 `type_case()` 自动多出 `kXxx`。
2. **`stream/stream.h:39-56`** 加 `static Stream *create_xxx(...)` 声明（已有 5 个：`create_tcp:39` / `create_udp:42` / `create_serial:47` / `create_ntrip:50` / `create_can:55`）。**这一步触发全模块重编译。**
3. **写 `stream/xxx_stream.cc`**。默认把类定义放在 .cc 内（`SerialStream`/`UdpStream`/`NtripStream` 的做法），只有需要被别的文件引用时才开独立头（`tcp_stream.h` 因被 `NtripStream` 复用、`can_stream.h` 因要暴露 canbus 类型）。必须实现 `Connect/Disconnect/read/write` 并维护 `status_`。
4. **`stream/raw_stream.cc:73-158` 的 `create_stream` 加 `case config::Stream::kXxx`**，必填字段缺失时 `AERROR + return nullptr`（照抄 `:75-136` 现有 5 个 case 的风格）。返回 nullptr → `RawStream::Init` 返回 false（`:207-210`），组件加载失败。

BUILD 不用改（glob 覆盖 `stream/*.cc`）。**format 与连接方式正交**，任何 format 配任何连接方式都行 —— 唯一例外是 `ASENSING_CAN` 必须配 `can_card_parameter`，因为 `CanStream::read` 往 buffer 里 memcpy 的是整个 `CanFrame` 结构体（`can_stream.cc:65`）而不是字节流，下游靠 `reinterpret_cast<const CanFrame*>` 还原（`asensing_can_parser.cc:194`）。串口波特率只接受 8 个枚举值（`serial_stream.cc:37-58`：9600/19200/38400/57600/115200/230400/460800/921600），其他返回 nullptr。

## 6. 给已有 parser 加一种报文 ID（按协议分类）

**NovAtel（二进制）**：① `novatel_messages.h:35-61` 加 `MessageId` 枚举值 ② 在 `#pragma pack(push,1)`（`:67`）与 `pop`（`:518`）之间加结构体 + `static_assert(sizeof(...)==N)` ③ `novatel_parser.cc` 三处：类内加 `HandleXxx` 声明（`:98-137` 区）、`PrepareMessage` 的 switch 加 case（`:324-498` 之间，先比 `message_length != sizeof(struct)` 否则 `AERROR << "Incorrect message_length"`）、写 `HandleXxx` 实现 ④ conf 的 `login_commands`（`:73-98` 注释区）加 `log xxxb ontime N`。**只补已有消息字段的报文，`Handle*` 返回 false 即可**（照抄 `HandleInsCov`，`:674-685`）。

**文本协议（BroadGnss / HuaCe）**：① `broadgnss_message.h:30-37` 加 `constexpr char XXX_MESSAGE_ID[]` + `XXX_MESSAGE_SIZE`（字段数，含 ID 本身）② 需要新数据项就在 `BroadGnssMessage` 加字段 ③ `broadgnss_text_parser.cc:42-47` 加私有方法声明 ④ `:89-123` 的 if-else 链加分支（先精确比 `fields.size() != XXX_MESSAGE_SIZE`）⑤ 写 `PrepareMessageXXX` ⑥ 若要独立发布路径，在 `broadgnss_base_parser.cc:49-61` 加分支并**别忘 `return`**，否则会继续发 IMU/INS。HuaCe 同理，报文表在 `huace_text_parser.cc:36` 的 `HuaCeProtocol` struct 里。

**Asensing Binary（BDDB）**：① 新建 `class Decode_0C : public ProtocolAsensing`（照抄 `protocol_asensing.h:121-135`）② 构造函数里 `registProtocol("BDDB0C", 长度, this)`（照抄 `decode_0A.cc:29`）③ 实现 `subData`：**必须 XOR 校验，成功 `index += dataLength`，失败 `index += 3`**（`decode_0A.cc:39-91`），index 推进错了会死循环或漏帧 ④ 在 `AsensingBinaryParser` 加成员 `Decode_0C decode_c;`（`asensing_binary_parser.cc:36-38`）—— **仅声明成员就完成注册**（构造函数副作用），这是全模块最隐蔽的设计 ⑤ 大概率还要重写 `asensing_binary_parser.cc:49` 那个 `getProtocol() != decode_b.m_typeImu` 门控（见 §8）。

**Asensing CAN**：① `asensing_can_parser.cc:35-47` 加 `constexpr uint32_t FRAME_xxx = 0x50D;`（现有 13 个 ID：0x500-0x50A、0x50C、0x512）② `:49-96` 的 `AsensingData` 加字段 ③ `:126-140` 加 `DecodeXxx` 声明 ④ `:202-247` 的 switch 加 case ⑤ 实现用 `ToValue<uint16_t,float>(frame.data, offset)`（大端，`:98-110`）⑥ 要触发发布则改 `GetMessages` 的 if-else 链（`:156-168`）⑦ **新单位常量必须加括号或改用 scale/offset 两个常量** —— `:25-33` 那批宏（`ACC_UNIT 0.0001220703 - 4` 等）没括号，只在 `raw * ACC_UNIT` 这一种写法下恰好正确。

## 7. 新增一个输出 channel（5 步）

1. **消息类型放哪**：驱动私有状态 → `proto/gnss_status.proto`（照抄 `GnssStatus`）；跨模块共享 → `modules/common_msgs/sensor_msgs/` 并在 `BUILD:22-54` 加 `_cc_proto` 依赖。
2. **加 gflag**：`modules/common/adapters/adapter_gflags.cc` 照抄 `:258` 的 `DEFINE_string(gnss_raw_data_topic, ...)`。别硬编码字符串。
3. **`parser/data_parser.h:82-97` 加 Writer 成员，`data_parser.cc:78-90` 创建**。注意 `:92-95` 在创建完 Writer 后立刻发了两帧初始状态，新 channel 需要初始帧就加在这里。
4. **`parser/parser.h:35-52` 加 `MessageType` 枚举 + `data_parser.cc:165-219` 的 switch 加 case + 写 `PublishXxx`**（照抄 `PublishInsStat`，`:222-226`，别忘 `common::util::FillHeader("gnss", ...)`）。**不加 case 会走 `default: break`（`:217`）静默丢弃。**
5. **parser 侧 push**：`messages->push_back({MessageType::MY_X, (MessagePtr)&my_x_});`。注意 parser 用 `reinterpret_cast` push、`data_parser` 用 `As<T>`（= `dynamic_cast`，`parser.h:72`）取，**类型不匹配就是 nullptr 解引用崩溃，没有运行时保护**。

纯状态上报不必走 `MessageType`：照抄 `RawStream` 发 `StreamStatus` 的做法（`raw_stream.cc:307` 建 Writer、`:492-495` Write）。删 channel 时注意 `rtk_eph`/`rtk_obs` 各有两个 Writer。

## 8. 时间戳：GPS 周秒 → Unix

- **唯一换算实现**：`util/time_conversion.h:117-136` 的 `unix2gps` / `gps2unix`，常量 `GPS_AND_SYSTEM_DIFF_SECONDS = 315964800`（`:115`）。
- **闰秒表**：`util/time_conversion.h:93-105`，8 行，按 Unix 时间**降序**，取第一个满足条件的。**表停在 `{1483228800, 18} // 2017/01/01`**，文件头注释写着 `// File expires on: December 2017`（`:30`）—— 2017 后无新闰秒，所以当前值仍正确。改闰秒时还要同步改 `modules/localization/msf/common/util/time_conversion.h:43-52`（另一份不一致的表）和 `asensing_parser/decode_0B.cc:159` 的硬编码 `-18`。
- **越界静默返回 0 的陷阱**：`time_conversion.h:124`、`:135` 都是 `return static_cast<T>(0);`，**无日志无断言**。设备时间未同步（GPS 周数为 0）→ 时间戳变成 0 → 下游收到 1970 年。这是现场"时间戳为 0"的根源。Asensing CAN 启动瞬间 INS 时间戳为 0 是必然的（`ins_gps_sec` 要等 0x50A 的 `gps_week`，`asensing_can_parser.cc:278-279`）。
- **parser 不要自己调 `gps2unix`**：`novatel_parser.cc:739-741` 转好的时间会被 `DataParser::PublishInsStat` 的 `FillHeader`（`data_parser.cc:222-226`）覆盖成 `Time::Now()`。统一由 `DataParser` 在 `use_gnss_time` 为真时转（如 `:268-271`）。
- `parser.h:68` 的 `#define EPOCH_AND_SYSTEM_DIFF_SECONDS 315964800` 是死宏，从未使用。

**UTM/WGS84 转换不在 `util/`**，在 `parser/data_parser.cc:280` 的 `pj_transform(wgs84pj_source_, utm_target_, 1, 1, &x, &y, NULL)`（`PublishOdometry` 内）。两个 `projPJ` 由 `:63-64` 的 `pj_init_plus` 建，**返回值不检查**；`proj4_text` 空或语法错 → nullptr → 崩或静默错。用的是废弃的 proj4 API（`data_parser.h:23-24` 靠 `ACCEPT_USE_OF_DEPRECATED_PROJ_API_H` 放行）。

## 9. 改代码前必读的 10 个坑

| # | 现象 | 原因 | file:line |
|---|---|---|---|
| 1 | Asensing CAN 下 MSF 角速度异常 | **真实 bug**：`gyro_y` 位置写成了 `gyro_x`（对比正确的 `FillIns` `:402`） | `parser/asensing_parser/asensing_can_parser.cc:431` |
| 2 | `pseudo_type` 永远走 else、`i>=7` 时越界读、NovAtel 侧疯狂刷 AINFO | **真实 bug**：内层循环变量是 `j` 却写成 `code[i]`，两文件各一处（复制粘贴传播） | `parser/rtcm3_parser.cc:241,244`；`parser/novatel_parser.cc:1084,1087` |
| 3 | ARM（Orin/Xavier）上解析 Asensing 崩溃 | 模板 `toValue` 用 `*reinterpret_cast<const T*>(add+index)`，未对齐读 + 硬依赖小端，被 decode_0A/0B 大量调用读 float/double | `parser/asensing_parser/protocol_asensing.h:71,78` |
| 4 | Asensing Binary 偶发越界读 | `while (start_index < receive_data_.size() - 11 ...)`，`size()<11` 时 size_t 下溢成 ~2^64，条件恒真，`data_address[start_index+2]` 立刻越界 | `parser/asensing_parser/protocol_asensing.cc:86` |
| 5 | conf 配了 `rtk_to`，`/dev/ttyACM1` 却从不打开，无任何日志 | `rtk_to` 的解析嵌套在 `if (config_.has_rtk_from())` 内。当前 conf 正是 `rtk_from` 注释掉、`rtk_to` 保留 | `stream/raw_stream.cc:258`（外层 if 在 `:239`），conf `:26-45` |
| 6 | Asensing Binary 完全不产消息 | `if (asensing.getProtocol() != decode_b.m_typeImu) return false;` —— `getProtocol()` 是本包**最后一次**匹配的头，设备按 0B→10→0A 输出时永远不通过 | `parser/asensing_parser/asensing_binary_parser.cc:49` |
| 7 | HuaCe 日志刷 `HUACE message has been truncated`，100 Hz 只出 ~1/10 | 从 `data_end_`（尾后指针）向前找最后一个 `'$'`，只保留最后一条报文，之前全丢；且首次解引用就是越界读（靠 `data()[size()]=='\0'` 侥幸不崩） | `parser/huace_parser/huace_text_parser.cc:66-75` |
| 8 | 200 Hz IMU 只发 ~几 Hz | `NovatelParser::GetMessages` 用 `std::set` 按类型去重，同类型多帧只 push 第一个。**这是刻意的**（`*message_ptr` 都指向同一个成员对象 `imu_`，不去重会把最后一帧发 36 次），但确实丢了时间序列。要不丢帧必须改成流式 Dispatch | `parser/novatel_parser.cc:277-290` |
| 9 | 南半球 BESTPOSA 数据被忽略 | 用"纬度 > 0"当"已收到 BESTPOS"的数值哨兵（初值 -1.0） | `broadgnss_parser/broadgnss_base_parser.cc:63,129`；`asensing_can_parser.cc:173,367` |
| 10 | 改了 parser 的轴系，结果没变 / 变反了 | parser 的 `rfu_to_flu`（`parser_common.h:47-52`：x=f, y=-r, z=u）之上，`PublishImu`（`data_parser.cc:244-251`）又做一次变换，两次**恰好抵消**；`PublishCorrimu`（`:319-326`）也变换但 `PublishOdometry` 不变换 → `CorrectedImu` 与 `Gps` 轴系约定不同 | `data_parser.cc:240-262,310-334` |

再补两个高频：`CanStream::read` 在 `frames` 为空时 `frames[0]` 越界（`can_stream.cc:65`）且 `recv_frame_num` 是 `static`（`:59`，被回写 0 后永远收不到数据）；重连时 parser 内部缓冲不清空（`ProtocolAsensing::clearCache()` 存在但从未被调用，`protocol_asensing.h:95`），残留半帧会产生一次校验失败后自愈。完整 38 条见 `reference.md`。

## 10. 不接真实设备的调试

`test/` 只有 `parser_cli.cc`（98 行），**不是单测**，是回放工具。**全模块没有任何 gtest，BUILD 里没有 `apollo_cc_test`。**

```bash
bazel build //modules/drivers/gnss:parser_cli        # → bazel-bin/modules/drivers/gnss/parser_cli
./parser_cli modules/drivers/gnss/test_data/novatel.bin bin     # 裸二进制，每次读 128 B
./parser_cli /apollo/data/bag/xxx.record record                 # 只挑 raw_data channel，每帧 sleep 2 ms
```

关键特性：**conf 路径硬编码**为 `/apollo/modules/drivers/gnss/conf/gnss_conf.pb.txt`（`parser_cli.cc:67-69`），所以想测新 parser 就改这份 conf 的 `format`；它创建真正的 `DataParser`（`:72-73`），**会真往 cyber channel 发消息**，配 `cyber_monitor` 看输出；**完全绕过 stream 层**，测不了重连、状态上报、gpsbin、车速回灌、RTCM 转发；**读取粒度 128 B**（`:37`）vs 线上 2048 B（`raw_stream.h:68`）—— 这个差异是测跨包拼接的好办法，128 下过但 2048 下丢数据（或反之）说明拆帧逻辑有问题。

测试数据：`test_data/novatel.bin`（1.1 MB，仓库唯一样本，是"没破坏 NovAtel 通路"的现成回归数据）；或从 `gpsbin_folder`（conf `:68` = `/apollo/data/gpsbin`，`raw_stream.cc:57-71` 落盘 `YYYYmmdd_HHMMSS.bin`）取真实录制；文本协议可 `printf '$GPCHC,...*7A\r\n' > /tmp/t.bin` 手工造。

看原始帧：`xxd -p x.bin | tr -d '\n' | grep -bo 'aa4412'`（NovAtel 长头）/ `'bddb0b'`（Asensing）；`strings`/`grep -a '^\$GPCHC'`（文本）；`cyber_channel {echo,hz,bw} /apollo/sensor/gnss/raw_data`；`candump can0,500:7FF`（CAN）；`screen /dev/ttyUSB2 115200`（绕过驱动，需先停驱动，`conf/readme.txt:2`）。

日志锚点（按启动顺序）：`Gnss config: <整份 conf>`（`gnss_component.cc:36`，第一锚点，确认 format/imu_type/proj4_text）→ `Creating data parser of format: N`（`data_parser.cc:97`）→ `Failed to create data parser.` AFATAL（`:100`，忘注册工厂）→ `Open device ... failed`（`serial_stream.cc:125`）→ `gnss is started.`（`gnss_component.cc:46`，Init 全成功）。运行期：`CRC check failed.`（`novatel_parser.cc:300`）、`Incorrect message_length`（`:327` 等，加新报文最常见）、`Solution status:`/`Position type:`（`:553`/`:557`，**只在变化时打印**，50=NARROW_INT 或 56=INS_RTKFIXED 才是固定解）、`IMU type: ...; Gyro scale: ...`（`:755-758`，**只打一次**，是验证 imu_type 配对了的唯一手段）。`export GLOG_v=4 GLOG_minloglevel=0 GLOG_alsologtostderr=1` 打开 ADEBUG。

## 11. 排错表

| 症状 | 检查顺序 |
|---|---|
| **进程直接崩** | AFATAL → `data_parser.cc:100`（format 不支持/忘加 case）；ACHECK → `raw_stream.cc:66`（`gpsbin_folder` 建不了，权限/磁盘满） |
| **Init 失败无更多信息** | `raw_stream.cc:203` 的 `Error: Config file must provide the data stream.` 是 **AINFO 级别**，极易漏看 → 没配 `data` 段；再看 `:208` `Failed to create data stream.` → `create_stream` 返回 nullptr，往上找 `:77,81,90,94...` 的"缺哪个字段" |
| **串口打不开且无日志** | ① `serial_stream.cc:125` `Open device ... failed` ② 波特率是否在 8 个枚举内（`:37-58`，非法值 → `create_serial` 返回 nullptr）③ 设备被别的进程独占 ④ 若是 `rtk_to` 的串口，看坑 #5 |
| **完全无数据** | ① `cyber_channel hz /apollo/sensor/gnss/raw_data` 判断是 stream 层还是 parser 层 ② raw_data 无数据 → 查 stream 连接日志 + `screen`/`candump` 确认设备在输出 ③ raw_data 有数据但下游全空 → `data_parser.cc:97` 确认 format 走对，再看有无 CRC/format error |
| **CRC 校验失败** | 偶发正常（重连残留、缓冲边界，坑 #12）；**持续出现** → 波特率错 / format 与设备不匹配 / 拆帧状态机写错。用 `xxd` 确认同步头密度，再用 `parser_cli` 以 128 B 粒度回放定位跨包拼接问题 |
| **消息不发布** | ① parser 有没有 `push_back`（或旧接口 `Handle*` 是不是返回了 false，见 §4.4）② `MessageType` 在 `data_parser.cc:165-219` 有没有 case（无 case = `default: break` 静默丢弃）③ Writer 建了吗（`data_parser.cc:78-90`）④ 文本 parser 被 `RateControl` 限速了吗（`parser_common.h:54`，900 ms）⑤ Asensing Binary 看坑 #6 ⑥ `gnss_status` 一直不更新 → 只 log 了 bestposb 没 log bestvelb，`Gnss` 凑不齐（`novatel_parser.cc:622-627`） |
| **时间戳为 0** | `time_conversion.h:124,135` 越界静默返回 0 → 设备时间未同步（GPS 周数 0）。Asensing CAN 启动瞬间必然为 0（等 0x50A）。见 §8 |
| **时间戳差约 3.16e8 秒（≈10 年）** | 双重 `gps2unix` 或漏了一次。重点查 `data_parser.cc:268-271` 与 parser 内部是否都转了；heading 还要核 `msf/local_integ/measure_republish_process.cc:557-559` |
| **定位状态异常 / 位置偏几百公里** | ① `proj4_text` 的 UTM zone 配错（conf `:57`，无任何报错）② `imu_type` 配错导致 acc/gyro 整体缩放错（conf `:56`，看 `IMU type:` 那条日志）③ acc 的 z 是 -9.8 → 轴系符号，看坑 #10；`imu_frame_mapping_` 硬编码 5（`novatel_parser.cc:146`），`novatel_config.imu_orientation` 是死配置 |
| **CPU 单核 100% / 日志刷屏 / 磁盘写满 / 启动慢几秒** | 依次对应 `raw_stream.cc:501`（read 无限速，CAN 或非阻塞 UDP）、`asensing_binary_parser.cc:48`（每包一条 AINFO）、gpsbin 无轮转（`raw_stream.cc:57-71`，115200 满速 ≈1 GB/天）、`raw_stream.cc:444`（每条 `login_commands` sleep 0.5 s） |

