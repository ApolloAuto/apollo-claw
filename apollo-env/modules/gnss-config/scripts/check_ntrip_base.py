#!/usr/bin/env python3
"""Check an active Apollo GNSS rtk_from NTRIP configuration."""

import argparse
import base64
import re
import socket
import sys
import io
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
elif hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


DEFAULT_CONF = "/apollo/modules/drivers/gnss/conf/gnss_conf.pb.txt"


class NtripConfig:
    def __init__(self, address, port, mount_point, user, password, timeout_s):
        self.address = address
        self.port = port
        self.mount_point = mount_point
        self.user = user
        self.password = password
        self.timeout_s = timeout_s


def uncommented(text):
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def block(text, name):
    match = re.search(rf"\b{re.escape(name)}\s*\{{", text)
    if not match:
        return None
    start = match.end()
    depth = 1
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start:index]
    raise ValueError(f"配置块 {name} 缺少结束括号")


def field(text, name, required=True):
    match = re.search(rf"\b{re.escape(name)}\s*:\s*(?:\"([^\"]*)\"|([^\s#]+))", text)
    if match:
        return match.group(1) if match.group(1) is not None else match.group(2)
    if required:
        raise ValueError(f"缺少字段 {name}")
    return None


def read_config(path):
    text = uncommented(path.read_text(encoding="utf-8"))
    rtk = block(text, "rtk_from")
    if rtk is None:
        return None
    ntrip = block(rtk, "ntrip")
    if ntrip is None:
        raise ValueError("已启用 rtk_from，但缺少 ntrip 配置块")
    return NtripConfig(
        address=field(ntrip, "address"),
        port=int(field(ntrip, "port")),
        mount_point=field(ntrip, "mount_point"),
        user=field(ntrip, "user"),
        password=field(ntrip, "password"),
        timeout_s=float(field(ntrip, "timeout_s", required=False) or "5"),
    )


def read_response(sock, limit=65536):
    """Read the response header plus one short RTCM window.

    NTRIP casters keep the connection open after the status line, so we
    never wait for EOF. Two bounded recv calls are enough to capture the
    status line and, when present, an initial RTCM3 frame.
    """
    data = bytearray()
    for _ in range(2):
        try:
            chunk = sock.recv(min(4096, limit - len(data)))
        except socket.timeout:
            break
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def rtcm_frame_count(data):
    """Count plausible RTCM3 frames in a byte window."""
    count = 0
    index = 0
    while index + 3 <= len(data):
        if data[index] != 0xD3:
            index += 1
            continue
        length = ((data[index + 1] & 0x03) << 8) | data[index + 2]
        frame_end = index + 3 + length + 3
        if frame_end <= len(data):
            count += 1
            index = frame_end
        else:
            index += 1
    return count


def check(config):
    print(f"基站地址：{config.address}:{config.port}")
    print(f"挂载点：{config.mount_point}")
    print(f"账号：{config.user}")
    print("密码：已读取（不显示）")
    print(f"超时：{config.timeout_s:g}s")

    request_path = "/" + config.mount_point.lstrip("/")
    credentials = base64.b64encode(f"{config.user}:{config.password}".encode()).decode()
    request = (
        f"GET {request_path} HTTP/1.0\r\n"
        "User-Agent: NTRIP apollo-env/2.1\r\n"
        "Accept: */*\r\n"
        f"Authorization: Basic {credentials}\r\n"
        "Connection: close\r\n\r\n"
    ).encode("ascii")

    try:
        with socket.create_connection((config.address, config.port), config.timeout_s) as sock:
            sock.settimeout(config.timeout_s)
            sock.sendall(request)
            response = read_response(sock)
    except socket.gaierror as exc:
        print(f"结果：失败，地址解析失败：{exc}")
        return 2
    except (socket.timeout, TimeoutError):
        print("结果：失败，连接或读取超时")
        return 2
    except OSError as exc:
        print(f"结果：失败，网络连接错误：{exc}")
        return 2

    header_end = response.find(b"\r\n\r\n")
    if header_end < 0:
        header = response
        body = b""
    else:
        header = response[:header_end]
        body = response[header_end + 4 :]
    status = header.splitlines()[0].decode("latin1", errors="replace") if header else ""
    print(f"响应：{status or '空响应'}")

    if re.search(r"\b200\b", status) is None:
        if re.search(r"\b401\b", status):
            print("结果：失败，账号或密码认证失败")
        elif re.search(r"\b404\b", status):
            print("结果：失败，挂载点不存在或不可用")
        else:
            print("结果：失败，NTRIP caster 未返回成功状态")
        return 2

    frames = rtcm_frame_count(body)
    if frames:
        print(f"RTCM 数据：收到 {len(body)} 字节，识别到 {frames} 个 RTCM3 帧")
        print("结果：基站账号、挂载点和 RTCM 数据验证通过")
        return 0
    print(f"RTCM 数据：认证成功但当前窗口未识别到完整 RTCM3 帧（{len(body)} 字节）")
    print("结果：部分通过，连接和认证成功，但未确认有效 RTCM 数据")
    return 3


def main():
    parser = argparse.ArgumentParser(description="验证 Apollo GNSS rtk_from NTRIP 基站账号和 RTCM 数据")
    parser.add_argument("--conf", default=DEFAULT_CONF, help=f"GNSS 配置文件（默认：{DEFAULT_CONF}）")
    args = parser.parse_args()
    path = Path(args.conf)
    if not path.is_file():
        print(f"结果：失败，配置文件不存在：{path}", file=sys.stderr)
        return 2
    try:
        config = read_config(path)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"结果：失败，配置解析错误：{exc}", file=sys.stderr)
        return 2
    if config is None:
        print(f"配置文件：{path}")
        print("结果：未启用 rtk_from.ntrip；当前配置没有可验证的 NTRIP 基站账号")
        return 4
    return check(config)


if __name__ == "__main__":
    raise SystemExit(main())
