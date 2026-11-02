#!/usr/bin/env python3
"""Preserving, versioned camera DAG/PB editor. No module start or profile switching.

Supported textproto syntax is parsed (not regenerated). Unsupported/malformed input
fails closed. Mutations are restricted to the selected DAG's camera graph. Multi-file
writes are staged, backed up and rolled back on failure; readers stay intact.
"""
import argparse
import ast
import contextlib
import fcntl
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

APOLLO_ROOT = Path(os.environ.get('APOLLO_ROOT_DIR', '/apollo'))
DAG_DIR = APOLLO_ROOT / 'modules/drivers/camera/dag'
TOKEN = re.compile(r'\s+|\#[^\n]*|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_][A-Za-z0-9_./+-]*|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[{}<>\[\]:,;]')
NAME = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,63}\Z')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def tokens(text):
    result, pos = [], 0
    while pos < len(text):
        match = TOKEN.match(text, pos)
        require(match is not None, '无法解析配置，位置 %d；未写入' % pos)
        value = match.group()
        if not value.isspace() and not value.startswith(('#', '//')):
            result.append((value, pos, match.end()))
        pos = match.end()
    return result


def parse(text):
    ts, cursor = tokens(text), [0]
    def message(end=None, prefix=''):
        out, counts = [], {}
        while cursor[0] < len(ts):
            word, start, _ = ts[cursor[0]]
            if word == end:
                cursor[0] += 1
                return out
            if word in (',', ';'):
                cursor[0] += 1
                continue
            require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', word), '非法字段或括号: ' + word)
            index = counts.get(word, 0)
            counts[word] = index + 1
            path = prefix + '/' + word + '/' + str(index)
            cursor[0] += 1
            if cursor[0] < len(ts) and ts[cursor[0]][0] == ':':
                cursor[0] += 1
            require(cursor[0] < len(ts), '缺少字段值: ' + word)
            raw, vs, ve = ts[cursor[0]]
            cursor[0] += 1
            node = dict(name=word, start=start, valueStart=vs, valueEnd=ve, path=path)
            if raw in ('{', '<'):
                node['children'] = message('}' if raw == '{' else '>', path)
                node['end'] = ts[cursor[0]-1][2]
            elif raw == '[':
                while cursor[0] < len(ts) and ts[cursor[0]][0] != ']':
                    require(ts[cursor[0]][0] not in ('{', '}', '<', '>', '['), '暂不支持 message 列表；未写入')
                    cursor[0] += 1
                require(cursor[0] < len(ts), '列表缺少结束括号')
                node['end'] = ts[cursor[0]][2]
                cursor[0] += 1
                node['list'] = True
            else:
                require(raw not in ('}', '>', ']', ':', ',', ';'), '非法字段值: ' + word)
                node['raw'] = raw
                node['value'] = ast.literal_eval(raw) if raw.startswith(('"', "'")) else raw
                node['end'] = ve
            out.append(node)
        require(end is None, '配置缺少结束括号 ' + str(end))
        return out
    return message()


def leaves(nodes):
    for node in nodes:
        if 'children' in node:
            yield from leaves(node['children'])
        elif 'raw' in node:
            yield node


def child(nodes, name):
    matches = [n for n in nodes if n['name'] == name]
    require(len(matches) == 1, '需要唯一字段: ' + name)
    return matches[0]


def scalar(nodes, name, default=''):
    matches = [n for n in nodes if n['name'] == name and 'value' in n]
    require(len(matches) <= 1, '重复字段: ' + name)
    return matches[0]['value'] if matches else default


def read(path):
    return Path(path).read_text(encoding='utf-8')


def files():
    return sorted(str(p) for p in DAG_DIR.glob('*.dag') if p.is_file())


def resolve_dag(requested=None):
    path = Path(requested) if requested else DAG_DIR / 'camera.dag'
    if not path.is_absolute():
        path = DAG_DIR / path
    require(str(path) in files(), 'DAG 不在当前相机目录中: ' + str(path))
    return path


def decode_component(block, enabled):
    if enabled:
        return block
    return ''.join(re.sub(r'^([ \t]*)# ?', r'\1', line) for line in block.splitlines(True))


def encode_component(block, enabled):
    if enabled:
        return block
    return ''.join(re.sub(r'^([ \t]*)(?=\S)', r'\1# ', line) for line in block.splitlines(True))


def dag_components(text, path):
    roots = parse(text)
    require(all(n['name'] == 'module_config' for n in roots), 'DAG 含孤立组件/非 module_config 内容；请先修复文件')
    modules = roots
    result = []
    def record(node, module, enabled, start=None, end=None, body=None):
        config = child(node['children'], 'config')['children']
        name = scalar(config, 'name')
        conf = scalar(config, 'config_file_path')
        cls = scalar(node['children'], 'class_name')
        if not (name and conf and cls):
            return
        require(Path(conf).is_absolute(), 'conf 必须为绝对路径: ' + conf)
        result.append(dict(name=name, conf=conf, className=cls, enabled=enabled,
                           start=node['start'] if start is None else start,
                           end=node['end'] if end is None else end,
                           body=text[node['start']:node['end']] if body is None else body,
                           module=module['start'], dag=str(path)))
    for module in modules:
        require('children' in module, 'module_config 缺少内容')
        for node in module['children']:
            if node['name'] == 'components':
                record(node, module, True)
    # Disabled components are complete, line-commented blocks inside an active module.
    lines = text.splitlines(True)
    offsets, pos = [], 0
    for line in lines:
        offsets.append(pos)
        pos += len(line)
    i = 0
    while i < len(lines):
        if not re.match(r'^\s*#\s*components\s*:?\s*[{<]', lines[i]):
            i += 1
            continue
        start, j, body, depth = offsets[i], i, '', 0
        while j < len(lines):
            require(not lines[j].strip() or re.match(r'^\s*#', lines[j]), '注释组件中混入活动行')
            decoded = decode_component(lines[j], False)
            body += decoded
            for raw, _, _ in tokens(decoded):
                depth += 1 if raw in ('{', '<') else -1 if raw in ('}', '>') else 0
            j += 1
            if depth == 0:
                break
        require(depth == 0, '注释组件括号不完整')
        nodes = parse(body)
        require(len(nodes) == 1 and nodes[0]['name'] == 'components', '无效注释组件')
        end = offsets[j] if j < len(lines) else len(text)
        parents = [m for m in modules if m['start'] < start < end < m['end']]
        require(len(parents) == 1, '注释组件不在唯一 module_config 内')
        record(nodes[0], parents[0], False, start, end, body)
        i = j
    names = [c['name'] for c in result]
    require(len(names) == len(set(names)), 'DAG 中组件名称重复')
    return sorted(result, key=lambda c: c['start'])


def conf_identity(path):
    return str(Path(path).resolve())


def same_conf(a, b):
    return conf_identity(a) == conf_identity(b)


def is_driver(component):
    return component['className'] == 'CameraComponent'


def is_compress(component):
    return 'Compress' in component['className']


def graph(requested=None):
    dag = resolve_dag(requested)
    text = read(dag)
    components = dag_components(text, dag)
    drivers = [c for c in components if is_driver(c)]
    require(len({conf_identity(c['conf']) for c in drivers}) == len(drivers), '多个相机共享同一 conf（包括软链别名），无法安全独立编辑')
    texts = {str(dag): text}
    others = list(components)
    # Preserve and link compression components in other actual DAG files by conf identity.
    for other in files():
        if other == str(dag):
            continue
        other_text = read(other)
        try:
            found = dag_components(other_text, other)
        except ValueError:
            # Do not mutate a malformed linked compression DAG silently.
            if any(c['conf'] in other_text for c in drivers) and 'Compress' in other_text:
                raise ValueError('关联压缩 DAG 结构无效: ' + other)
            continue
        linked = [c for c in found if is_compress(c) and any(same_conf(c['conf'], d['conf']) for d in drivers)]
        if linked:
            texts[other] = other_text
            others.extend(linked)
    confs = {}
    for driver in drivers:
        path = driver['conf']
        if Path(path).is_file():
            confs[path] = read(path)
    version = hashlib.sha256()
    for path, value in sorted(dict(texts, **confs).items()):
        version.update((path + '\0' + str(Path(path).resolve()) + '\0' + value).encode('utf-8'))
    return dict(dag=str(dag), drivers=drivers, components=others, texts=texts, confs=confs, version=version.hexdigest())


def fields(text, path):
    return [dict(id='pb:' + n['path'], key=n['path'].strip('/'), value=str(n['value']),
                 sourceField=n['name'], sourcePath=path, sourceType='pb') for n in leaves(parse(text))]


def inspect(requested=None):
    g = graph(requested)
    cameras = []
    for driver in g['drivers']:
        text = g['confs'].get(driver['conf'])
        parsed = parse(text) if text is not None else []
        linked = [c for c in g['components'] if is_compress(c) and same_conf(c['conf'], driver['conf'])]
        cameras.append(dict(name=driver['name'], className=driver['className'], conf=driver['conf'],
                            enabled=driver['enabled'], dev=scalar(parsed, 'camera_dev'),
                            frameId=scalar(parsed, 'frame_id'), channel=scalar(parsed, 'channel_name'),
                            confExists=text is not None, fields=fields(text, driver['conf']) if text is not None else [],
                            linked=[dict(name=c['name'], dag=c['dag'], enabled=c['enabled']) for c in linked]))
    return dict(ok=True, dag=g['dag'], dags=files(), profile='', valid=True, version=g['version'], cameras=cameras)


def select(g, request):
    found = [c for c in g['drivers'] if c['name'] == request.get('name') and c['conf'] == request.get('conf')]
    require(len(found) == 1, '请选择当前 DAG 中的实际相机实例（名称与 conf 必须匹配）')
    return found[0]


def apply_spans(text, changes):
    for start, end, value in sorted(changes, reverse=True):
        text = text[:start] + value + text[end:]
    return text


def quote(value):
    require(isinstance(value, str) and not any(ord(c) < 32 for c in value), '字符串不能含换行或控制字符')
    return json.dumps(value, ensure_ascii=False)


def validate_value(node, value):
    require(isinstance(value, str), '字段值必须为字符串')
    old = node['raw']
    if old.startswith(('"', "'")):
        if node['name'] in ('frame_id', 'camera_dev'):
            require(bool(value.strip()), node['name'] + ' 不能为空')
        if node['name'] == 'camera_dev':
            require(Path(value).is_absolute(), 'camera_dev 必须为绝对设备路径')
        if 'channel' in node['name']:
            require(value.startswith('/') and not re.search(r'\s', value), 'channel 必须是无空格的绝对通道名')
        return quote(value)
    if old in ('true', 'false'):
        require(value in ('true', 'false'), node['name'] + ' 必须为 true/false')
    elif re.fullmatch(r'[-+]?\d+', old):
        require(re.fullmatch(r'[-+]?\d+', value) is not None, node['name'] + ' 必须为整数')
        if node['name'] in ('width', 'height', 'frame_rate', 'spin_rate', 'bytes_per_pixel'):
            require(int(value) > 0, node['name'] + ' 必须大于 0')
    elif re.fullmatch(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', old):
        require(re.fullmatch(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', value) is not None and math.isfinite(float(value)), '非法数值')
    else:
        require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', value) is not None, '非法枚举值')
    return value


def replace_values(text, mapping):
    return apply_spans(text, [(n['valueStart'], n['valueEnd'], quote(mapping[n['value']]))
                             for n in leaves(parse(text)) if n['raw'].startswith(('"', "'")) and n['value'] in mapping])


def linked_components(g, driver):
    return [driver] + [c for c in g['components'] if is_compress(c) and same_conf(c['conf'], driver['conf'])]


def commit(g, changes, creates=None):
    creates = creates or {}
    originals = dict(g['texts'], **g['confs'])
    require(graph(g['dag'])['version'] == g['version'], '配置已被其他操作修改，请刷新后重试')
    updates = {p: t for p, t in changes.items() if originals.get(p) != t}
    for path, text in dict(updates, **creates).items():
        if path.endswith('.dag'):
            dag_components(text, path)
        else:
            parse(text)
    staged, committed, backups = {}, [], []
    try:
        for path, text in dict(updates, **creates).items():
            target = Path(path).resolve()
            require(target.parent.is_dir(), '目标目录不存在: ' + str(target.parent))
            if path in creates:
                require(not os.path.lexists(str(target)), '目标 conf 已存在: ' + str(target))
            fd, tmp = tempfile.mkstemp(prefix='.camera-stage-', dir=str(target.parent))
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(tmp, target.stat().st_mode & 0o777 if target.exists() else 0o644)
            staged[path] = (target, tmp)
        require(graph(g['dag'])['version'] == g['version'], '配置已变化，放弃写入')
        for path in updates:
            target = staged[path][0]
            backup = str(target) + '.bak.' + uuid.uuid4().hex
            shutil.copy2(str(target), backup)
            backups.append(backup)
        # New files use O_EXCL semantics; never overwrite an existing unrelated conf.
        for path in creates:
            target, tmp = staged[path]
            os.link(tmp, str(target))
            committed.append(path)
        for path in updates:
            target, tmp = staged[path]
            os.replace(tmp, str(target))
            committed.append(path)
        for path in committed:
            require(read(staged[path][0]) == dict(updates, **creates)[path], '写入回读校验失败')
    except Exception:
        for path in reversed(committed):
            target = staged[path][0]
            if path in creates:
                target.unlink()
            else:
                fd, tmp = tempfile.mkstemp(prefix='.camera-rollback-', dir=str(target.parent))
                with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                    stream.write(originals[path])
                os.replace(tmp, str(target))
        raise
    finally:
        for target, tmp in staged.values():
            if os.path.exists(tmp):
                os.unlink(tmp)
    return backups


def mutate(requested, request):
    g = graph(requested)
    require(request.get('version') == g['version'], '配置版本已变化或缺失，请刷新后重试')
    action = request.get('action')
    changes, creates = {}, {}
    if action in ('enable', 'disable'):
        driver = select(g, request)
        grouped = {}
        for comp in linked_components(g, driver):
            if comp['enabled'] == (action == 'enable'):
                continue
            # Active span starts at keyword; comment must begin at the same position.
            replacement = encode_component(comp['body'], action == 'enable')
            if not replacement.endswith('\n'):
                replacement += '\n'
            grouped.setdefault(comp['dag'], []).append((comp['start'], comp['end'], replacement))
        for path, spans in grouped.items():
            changes[path] = apply_spans(g['texts'][path], spans)
        message = '已写入启用状态' if action == 'enable' else '已写入停用（注释）状态'
    elif action == 'edit':
        driver = select(g, request)
        conf = driver['conf']
        require(conf in g['confs'], '相机 conf 不存在')
        text, spans, channel_map = g['confs'][conf], [], {}
        known = {'pb:' + n['path']: n for n in leaves(parse(text))}
        values = request.get('values')
        require(isinstance(values, dict), 'values 必须为字段映射')
        for key, value in values.items():
            require(key in known, '未知字段，未写入: ' + key)
            node = known[key]
            if str(node['value']) == value:
                continue
            raw = validate_value(node, value)
            spans.append((node['valueStart'], node['valueEnd'], raw))
            if 'channel' in node['name']:
                channel_map[node['value']] = value
        changes[conf] = apply_spans(text, spans)
        if changes[conf] != text:
            # Only a changed frame/channel needs a uniqueness check; existing unrelated
            # legacy collisions must not block a frame-rate-only/no-op save.
            old_nodes, new_nodes = list(leaves(parse(text))), list(leaves(parse(changes[conf])))
            if any(a['value'] != b['value'] for a, b in zip(old_nodes, new_nodes) if a['name'] == 'frame_id' or 'channel' in a['name']):
                check_unique(g, driver, changes[conf])
        grouped = {}
        for comp in linked_components(g, driver):
            if not is_compress(comp):
                continue
            body = replace_values(comp['body'], channel_map)
            grouped.setdefault(comp['dag'], []).append((comp['start'], comp['end'], encode_component(body, comp['enabled'])))
        for path, spans in grouped.items():
            changes[path] = apply_spans(g['texts'][path], spans)
        message = '相机配置已保存并回读验证；关联压缩 readers 已同步'
    elif action == 'add':
        name = request.get('name', '')
        require(isinstance(name, str) and NAME.fullmatch(name), '实例名只允许字母开头的字母、数字、下划线和短横线（最多64位）')
        refs = [c for c in g['drivers'] if c['name'] == request.get('reference')]
        require(len(refs) == 1, '必须明确选择当前 DAG 中的真实参考相机')
        ref = refs[0]
        require(ref['conf'] in g['confs'], '参考 conf 不存在')
        require(all(c['name'] != name for c in g['components']), '实例名称已存在')
        dev, frame = request.get('dev', ''), request.get('frameId', '')
        require(isinstance(dev, str) and Path(dev).is_absolute(), '请填写绝对设备路径')
        require(isinstance(frame, str) and NAME.fullmatch(frame), '请填写独立 frame_id（字母/数字/下划线/短横线）')
        conf = str(Path(ref['conf']).resolve().parent / (name + '.pb.txt'))
        require(not os.path.lexists(conf), '新 conf 已存在，不能覆盖')
        nodes = parse(g['confs'][ref['conf']])
        replacements, channel_map = [], {}
        for node in leaves(nodes):
            value = None
            if node['name'] == 'camera_dev': value = dev
            elif node['name'] == 'frame_id': value = frame
            elif 'channel' in node['name'] and node['raw'].startswith(('"', "'")):
                # Explicit independent topic namespace; never share template channels.
                value = node['value'].rstrip('/') + '/' + name
                channel_map[node['value']] = value
            if value is not None:
                replacements.append((node['valueStart'], node['valueEnd'], validate_value(node, value)))
        require(scalar(nodes, 'camera_dev') and scalar(nodes, 'frame_id'), '参考文件缺少 camera_dev/frame_id')
        creates[conf] = apply_spans(g['confs'][ref['conf']], replacements)
        check_unique(g, None, creates[conf])
        grouped, new_names = {}, set()
        for comp in linked_components(g, ref):
            new_name = name if comp is ref else name + '__' + comp['name']
            identity = (comp['dag'], new_name)
            require(identity not in new_names and all((c['dag'], c['name']) != identity for c in g['components']), '关联组件名冲突')
            new_names.add(identity)
            mapping = dict(channel_map)
            mapping.update({comp['name']: new_name, ref['conf']: conf})
            body = replace_values(comp['body'], mapping)
            # A new camera starts disabled by default; user explicitly opts into enabling.
            enabled = request.get('enabled', False)
            require(isinstance(enabled, bool), 'enabled 必须为布尔值')
            body = encode_component(body, enabled)
            grouped.setdefault(comp['dag'], []).append((comp['end'], comp['end'], '\n' + body + '\n'))
        for path, spans in grouped.items():
            changes[path] = apply_spans(g['texts'][path], spans)
        message = '相机已添加，独立 conf/通道及压缩组件已建立（未启动进程）'
    else:
        raise ValueError('不支持的操作；不会自动修复或覆盖 DAG')
    backups = commit(g, changes, creates)
    return dict(ok=True, message=message + '。驱动重新加载 DAG/conf 后生效。', backups=backups, detail=inspect(g['dag']))


def check_unique(g, selected, new_text):
    nodes = parse(new_text)
    frame = scalar(nodes, 'frame_id')
    channels = {n['value'] for n in leaves(nodes) if 'channel' in n['name'] and n['raw'].startswith(('"', "'"))}
    for comp in g['drivers']:
        if selected is not None and comp['name'] == selected['name']:
            continue
        if comp['conf'] not in g['confs']:
            continue
        other = parse(g['confs'][comp['conf']])
        require(not frame or frame != scalar(other, 'frame_id'), 'frame_id 与其他相机重复')
        other_channels = {n['value'] for n in leaves(other) if 'channel' in n['name'] and n['raw'].startswith(('"', "'"))}
        require(not channels.intersection(other_channels), '输出通道与其他相机重复')


@contextlib.contextmanager
def lock():
    with open(str(DAG_DIR / '.camera-instance.lock'), 'a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['inspect', 'apply'])
    parser.add_argument('--dag')
    parser.add_argument('--request')
    args = parser.parse_args()
    try:
        if args.command == 'inspect':
            result = inspect(args.dag)
        else:
            require(bool(args.request), 'request 文件缺失')
            request = json.loads(read(args.request))
            require(isinstance(request, dict), 'request 必须为对象')
            requested = args.dag or request.get('dag')
            with lock():
                result = mutate(requested, request)
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except Exception as error:
        print(json.dumps(dict(ok=False, error=str(error)), ensure_ascii=True))
        return 2


if __name__ == '__main__':
    sys.exit(main())
