# aem profile use 报 recover conf failed

> 来源：实测排查（Apollo EDU 9.1.1，容器内 /apollo_workspace）

## 报错样貌

```
[INFO]    begin recover conf...
[INFO]    begin recover file: /apollo/modules/control 2/control_component/conf/control.conf
[WARNING] recover /apollo/modules/control 2/... error, recovered file not exists.
[ERROR]   recover conf failed!
[FATAL]   recover invalid conf failed.
```

## 原因

`aem profile use` 在应用新参数前先调用 `/opt/apollo/aem/conf_manager.py` 的 `recover()`：

- 遍历 `$APOLLO_ROOT_DIR`（通常是 `/apollo`）
- 找出**断链的软链**（是 symlink 但目标不存在）
- 试着把它重新指向 `$APOLLO_ROOT_DIR/<相对路径>`
- 只要有一个源文件不存在，就 `succ = False`，最终整体中止

上一次 `aem profile use` 时按当时的参数目录结构建了软链。如果之后参数目录里的文件被**改名或删除**（常见于改正 macOS 复制出的 `xxx 2` 目录名、清理 `.DS_Store`），这些软链就变成断链，下次切 profile 必然失败。

## 排查

```bash
# 列出所有断链（注意范围是整个 /apollo，不只是 /apollo/modules）
find /apollo -xtype l

# 看某个断链指向哪里
readlink /apollo/.DS_Store
```

`-xtype l` 精确匹配「是软链且目标不存在」，不会误伤正常软链。

## 处理选项

断链不一定需要处理，更不需要默认删除。先列出断链、确认它们的来源和影响，再由使用者选择：

- **保留并人工排查**：不修改系统，后续再确认断链来源。
- **确认后删除**：仅在确认断链已失效且不再需要时删除，通常需要 sudo。
- **不处理**：保持现状继续使用；断链本身通常不会影响当前 Apollo 使用。

Skill 不默认替用户删除断链，也不因为存在断链就擅自修改参数目录。下面的删除命令仅作为用户明确选择“确认后删除”后的处理示例：

```bash
# 1. 陈旧的重复目录（先确认里面没有真实文件：find "路径" ! -type d ! -xtype l 应为空）
sudo rm -rf "/apollo/modules/control 2"

# 2. .DS_Store 等垃圾文件的断链
sudo find /apollo -xtype l -name ".DS_Store" -delete

# 3. 运行时 dump 和 .bak 被误纳管产生的断链
sudo find /apollo/modules/localization -xtype l -delete
```

如果选择删除并完成清理，可以重新执行 `aem profile use <参数包名>`；如果选择保留或不处理，则记录断链即可继续使用。无论哪种选择，都应检查 `readlink -f /apollo/modules/...` 确认参数是否实际生效。

## 易踩的坑

- **检查范围要覆盖整个 `/apollo`**，不能只查 `/apollo/modules`。`/apollo/.DS_Store` 这类根目录下的断链同样可能导致失败。是否删除由使用者确认。
- **`update conf` 在 `recover` 之前执行**，所以即使命令返回非零，参数也可能已经挂上了。判断是否生效要看运行时路径，不要看命令退出码。
- **验证参数是否生效，要看 `/apollo/modules/...`**，那才是 Apollo 实际读取的路径。`/opt/apollo/neo/share/modules/...` 是包的默认安装位置，内容不随 profile 变化，用它做对比会得出错误结论。

```bash
# 正确的验证方式
readlink -f /apollo/modules/control/control_component/conf/control.conf
# 应指向 /apollo_workspace/profiles/<参数包名>/modules/control/control_component/conf/control.conf
```

## 预防

macOS 拷贝参数目录到 Linux 前先清理：

```bash
find <参数目录> -name ".DS_Store" -o -name "._*" -delete
find <参数目录> -name "* 2" -o -name "* 3"   # 检查 Finder 复制产生的重复目录名
```

目录名必须与 Apollo 模块名严格一致。`control 2` 这种名字 Apollo 永远不会读取，参数会静默失效——不报错，但车辆跑的是默认参数。
