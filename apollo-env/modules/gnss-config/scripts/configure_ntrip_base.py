#!/usr/bin/env python3
"""Interactively configure Apollo GNSS rtk_from.ntrip and verify it."""

import argparse
import datetime
import getpass
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from check_ntrip_base import DEFAULT_CONF, NtripConfig, check, read_config  # noqa: E402


class ConfigError(Exception):
    pass


def output_encoding():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def block_span(text, name):
    match = re.search(rf"(?m)^[ \t]*{re.escape(name)}\s*\{{", text)
    if not match:
        return None
    depth = 0
    index = match.start()
    opening = text.find("{", match.start())
    for pos in range(opening, len(text)):
        if text[pos] == "{":
            depth += 1
        elif text[pos] == "}":
            depth -= 1
            if depth == 0:
                end = pos + 1
                if end < len(text) and text[end] == "\n":
                    end += 1
                return index, end
    raise ConfigError("rtk_from 配置块缺少结束括号")


def prompt_text(label, current=None, required=True):
    suffix = ""
    if current is not None:
        suffix = " [当前: {}]".format(current)
    while True:
        value = input("{}{}: ".format(label, suffix)).strip()
        if not value and current is not None:
            return current
        if value or not required:
            return value
        print("该项不能为空。")


def prompt_int(label, current, minimum, maximum):
    while True:
        value = prompt_text(label, str(current))
        try:
            number = int(value)
        except ValueError:
            number = -1
        if minimum <= number <= maximum:
            return number
        print("请输入 {} 到 {} 之间的整数。".format(minimum, maximum))


def configure(path, overrides=None, assume_yes=False):
    overrides = overrides or {}
    text = path.read_text(encoding="utf-8")
    current = read_config(path)
    if current is None:
        current = NtripConfig("", 8002, "AUTO", "", "", 5)
        print("当前配置没有启用 rtk_from.ntrip，将新增配置块。")
    else:
        print("当前已存在 rtk_from.ntrip；回车保留现值。")

    if assume_yes:
        address = overrides.get("address") or current.address
        port = int(overrides.get("port") or current.port or 8002)
        mount = overrides.get("mount_point") or current.mount_point or "AUTO"
        user = overrides.get("user") or current.user
        password = overrides.get("password") or current.password
        if not address or not user or not password:
            raise ConfigError("非交互配置需要 address / user / password")
    else:
        address = prompt_text("基站 IP 或域名", current.address or None)
        port = prompt_int("端口", current.port, 1, 65535)
        mount = prompt_text("挂载点", current.mount_point or "AUTO")
        user = prompt_text("账号", current.user or None)
        password = getpass.getpass("密码（输入不回显，回车保留当前密码）: ")
        if not password:
            password = current.password
        if not password:
            raise ConfigError("密码不能为空")
    timeout = 5  # 超时固定 5 秒，不询问

    print("\n即将写入：")
    print("  地址：{}:{}".format(address, port))
    print("  挂载点：{}".format(mount))
    print("  账号：{}".format(user))
    print("  密码：已填写（不显示）")
    print("  超时：{}s（固定）".format(timeout))
    if not assume_yes and input("确认写入并检查？ [Y/n]: ").strip().lower() in ("n", "no"):
        print("已取消，未修改配置。")
        return 1

    new_block = (
        "rtk_from {\n"
        "    format: RTCM_V3\n"
        "    ntrip {\n"
        "        address: \"%s\"\n"
        "        port: %d\n"
        "        mount_point: \"%s\"\n"
        "        user: \"%s\"\n"
        "        password: \"%s\"\n"
        "        timeout_s: %g\n"
        "    }\n"
        "    push_location: true\n"
        "}\n"
    ) % (address, port, mount, user, password, timeout)

    span = block_span(text, "rtk_from")
    if span:
        start, end = span
        updated = text[:start] + new_block + text[end:]
    else:
        updated = text.rstrip() + "\n\n" + new_block

    # /apollo 下的配置通常是软链；必须写入最终目标，不能替换软链本身。
    write_path = Path(os.path.realpath(str(path)))
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = write_path.with_name(write_path.name + ".bak." + stamp)
    shutil.copy2(str(write_path), str(backup))
    fd, temp_name = tempfile.mkstemp(prefix=write_path.name + ".", dir=str(write_path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, str(write_path))
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise

    print("配置已写入：{}".format(path))
    print("原配置备份：{}".format(backup))
    print("开始验证 NTRIP 连接和 RTCM 数据……")
    result = check(NtripConfig(address, port, mount, user, password, timeout))
    print()
    print("提示：配置文件已更新，但正在运行的 GNSS 驱动仍使用旧配置。")
    print("如需立即生效，重启 GNSS 驱动：")
    print("  cyber_launch stop  /apollo/modules/drivers/gnss/launch/gnss.launch")
    print("  cyber_launch start /apollo/modules/drivers/gnss/launch/gnss.launch")
    return result


def main():
    output_encoding()
    parser = argparse.ArgumentParser(description="交互式配置 Apollo GNSS NTRIP 基站账号")
    parser.add_argument("--conf", default=DEFAULT_CONF, help="GNSS 配置文件")
    parser.add_argument("--yes", action="store_true", help="非交互：跳过确认并使用命令行参数")
    parser.add_argument("--address", help="基站 IP 或域名")
    parser.add_argument("--port", type=int, help="端口")
    parser.add_argument("--mount-point", dest="mount_point", help="挂载点")
    parser.add_argument("--user", help="账号")
    parser.add_argument("--password", help="密码")
    args = parser.parse_args()
    path = Path(args.conf)
    if not path.is_file():
        print("配置文件不存在：{}".format(path), file=sys.stderr)
        return 2
    try:
        return configure(
            path,
            overrides={
                "address": args.address,
                "port": args.port,
                "mount_point": args.mount_point,
                "user": args.user,
                "password": args.password,
            },
            assume_yes=args.yes,
        )
    except (ConfigError, OSError, UnicodeError, ValueError) as exc:
        print("配置失败：{}".format(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
