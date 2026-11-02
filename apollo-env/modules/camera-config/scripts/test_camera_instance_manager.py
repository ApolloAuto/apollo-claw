#!/usr/bin/env python3
"""Isolated camera manager fixtures. Never reads/writes live Apollo config."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('camera_manager', str(Path(__file__).with_name('camera_instance_manager.py')))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def component(name, conf, cls='CameraComponent', disabled=False, readers=''):
    block = '''    components {
      class_name: "%s"
      config {
        name: "%s"
        config_file_path: "%s"
        flag_file_path: "/flags/keep.conf"
        %s
      }
    }
''' % (cls, name, conf, readers)
    return m.encode_component(block, not disabled)


def module(body, lib='camera.so'):
    return 'module_config {\n module_library: "%s"\n%s}\n' % (lib, body)


class CameraTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.dags = self.root / 'modules/drivers/camera/dag'
        self.confs = self.root / 'profile/runtime/conf'
        self.dags.mkdir(parents=True)
        self.confs.mkdir(parents=True)
        self.saved = m.DAG_DIR
        m.DAG_DIR = self.dags
        self.a = self.confs / 'camera_a.pb.txt'
        self.b = self.confs / 'camera_b.pb.txt'
        self.a.write_text('''# braces in comments: } {
camera_dev: "/dev/video0"
frame_id: "camera_a"
width: 1920
frame_rate: 10
auto_exposure: true
raw_channel_name: "/camera/a/raw"
channel_name: "/camera/a/image"
compress_conf { output_channel: "/camera/a/compressed" image_pool_size: 100 }
time_compensator_conf { enable_compensator: true }
description: "keep { } # // escaped \\\" text"
''')
        self.b.write_text(self.a.read_text().replace('camera_a', 'camera_b').replace('/camera/a/', '/camera/b/').replace('/dev/video0', '/dev/video1'))
        self.dag = self.dags / 'camera.dag'
        self.reader = 'readers { channel: "/camera/a/raw" pending_queue_size: 17 }'
        self.sibling = component('camera_b', self.b, disabled=True)
        self.dag.write_text(module(component('camera_a', self.a) + self.sibling) + module(component('camera_a_compress', self.a, 'CompressComponent', readers=self.reader), 'compress.so'))
        self.other = self.dags / 'alternate.dag'
        self.other.write_text(module(component('other_b', self.b)))

    def tearDown(self):
        m.DAG_DIR = self.saved
        self.tmp.cleanup()

    def request(self, action, **kw):
        detail = m.inspect(str(self.dag))
        result = dict(action=action, dag=str(self.dag), version=detail['version'], name='camera_a', conf=str(self.a))
        result.update(kw)
        return result

    def apply(self, req):
        return m.mutate(req['dag'], req)

    def test_inspect_comment_and_fields(self):
        d = m.inspect(str(self.dag))
        self.assertEqual([(c['name'], c['enabled']) for c in d['cameras']], [('camera_a', True), ('camera_b', False)])
        self.assertEqual(len(d['cameras'][0]['linked']), 1)
        self.assertTrue(any(f['key'] == 'compress_conf/0/output_channel/0' for f in d['cameras'][0]['fields']))
        self.assertEqual(d['cameras'][0]['dev'], '/dev/video0')

    def test_toggle_preserves_sibling_and_readers(self):
        before_other = self.other.read_text()
        self.apply(self.request('disable'))
        d = m.inspect(str(self.dag))
        self.assertFalse(d['cameras'][0]['enabled'])
        self.assertFalse(d['cameras'][0]['linked'][0]['enabled'])
        self.assertIn(self.sibling, self.dag.read_text())
        self.apply(self.request('enable'))
        self.assertIn(self.reader, self.dag.read_text())
        self.assertIn('flag_file_path: "/flags/keep.conf"', self.dag.read_text())
        self.assertIn(self.sibling, self.dag.read_text())
        self.assertEqual(before_other, self.other.read_text())

    def test_edit_nested_and_channel_link(self):
        self.apply(self.request('edit', values={'pb:/frame_rate/0': '15', 'pb:/raw_channel_name/0': '/new/raw', 'pb:/compress_conf/0/image_pool_size/0': '250'}))
        self.assertIn('frame_rate: 15', self.a.read_text())
        self.assertIn('image_pool_size: 250', self.a.read_text())
        self.assertIn('channel: "/new/raw" pending_queue_size: 17', self.dag.read_text())
        self.assertIn('description: "keep { }', self.a.read_text())
        self.assertIn(self.sibling, self.dag.read_text())

    def test_add_disabled_explicit_reference(self):
        req = self.request('add', name='new_camera', reference='camera_b', dev='/dev/video8', frameId='new_camera', enabled=False)
        self.apply(req)
        d = m.inspect(str(self.dag))
        camera = next(c for c in d['cameras'] if c['name'] == 'new_camera')
        self.assertFalse(camera['enabled'])
        self.assertEqual(camera['dev'], '/dev/video8')
        self.assertTrue(Path(camera['conf']).is_file())
        self.assertEqual(camera['channel'], '/camera/b/image/new_camera')
        self.assertIn('flag_file_path: "/flags/keep.conf"', self.dag.read_text())
        self.assertIn(self.sibling, self.dag.read_text())

    def test_add_clones_compression_and_preserves_sibling(self):
        before_a = self.a.read_text()
        self.apply(self.request('add', name='new_a', reference='camera_a', dev='/dev/video8', frameId='new_a', enabled=True))
        d = m.inspect(str(self.dag))
        c = next(c for c in d['cameras'] if c['name'] == 'new_a')
        self.assertTrue(c['enabled'])
        self.assertEqual(len(c['linked']), 1)
        self.assertIn('channel: "/camera/a/raw/new_a" pending_queue_size: 17', self.dag.read_text())
        self.assertEqual(self.a.read_text(), before_a)
        self.assertIn(self.sibling, self.dag.read_text())

    def test_linked_separate_dag(self):
        separate = self.dags / 'compress.dag'
        separate.write_text(module(component('separate_compress', self.a, 'CompressComponent', readers=self.reader), 'compress.so'))
        self.apply(self.request('disable'))
        self.assertFalse(m.dag_components(separate.read_text(), separate)[0]['enabled'])
        self.apply(self.request('edit', values={'pb:/raw_channel_name/0': '/other/raw'}))
        self.assertIn('/other/raw', separate.read_text())
        self.assertIn('pending_queue_size: 17', separate.read_text())

    def test_stale_version_rejected_without_write(self):
        req = self.request('edit', values={'pb:/width/0': '2000'})
        self.a.write_text(self.a.read_text() + '\n# external change\n')
        before = self.a.read_text()
        with self.assertRaises(ValueError): self.apply(req)
        self.assertEqual(before, self.a.read_text())

    def test_arbitrary_path_and_missing_identity_rejected(self):
        outside = self.root / 'unrelated.pb.txt'
        outside.write_text('width: 10')
        for params in [dict(conf=str(outside)), dict(name='camera_b', conf=str(self.a))]:
            with self.assertRaises(ValueError): self.apply(self.request('edit', values={'pb:/width/0': '20'}, **params))
        self.assertEqual(outside.read_text(), 'width: 10')

    def test_invalid_values_rejected(self):
        before = self.a.read_text()
        for key, val in [('pb:/width/0', '0'), ('pb:/width/0', '2 } injected {'), ('pb:/auto_exposure/0', 'maybe'), ('pb:/frame_id/0', 'bad\nvalue'), ('pb:/unknown/0', '1')]:
            with self.assertRaises(ValueError): self.apply(self.request('edit', values={key: val}))
        self.assertEqual(before, self.a.read_text())

    def test_add_path_traversal_duplicate_missing_reference(self):
        for params in [dict(name='../escape'), dict(name='camera_a'), dict(reference='missing'), dict(reference=''), dict(frameId='camera_a')]:
            req = self.request('add', name='new_cam', reference='camera_a', dev='/dev/video8', frameId='new_cam')
            req.update(params)
            before = self.dag.read_text()
            with self.assertRaises(ValueError): self.apply(req)
            self.assertEqual(self.dag.read_text(), before)

    def test_malformed_and_duplicate_dag_rejected(self):
        for text in ['module_config {', module(component('same', self.a) + component('same', self.b)), module(component('a', self.a) + component('b', self.a))]:
            self.dag.write_text(text)
            with self.assertRaises(ValueError): m.inspect(str(self.dag))
            self.assertEqual(self.dag.read_text(), text)

    def test_symlink_write_preserves_link(self):
        alias = self.root / 'alias.pb.txt'
        alias.symlink_to(self.a)
        self.dag.write_text(module(component('camera_a', alias)))
        self.apply(self.request('edit', conf=str(alias), values={'pb:/frame_rate/0': '20'}))
        self.assertTrue(alias.is_symlink())
        self.assertIn('frame_rate: 20', self.a.read_text())

    def test_explicit_other_dag_only(self):
        before = self.dag.read_text()
        d = m.inspect(str(self.other))
        m.mutate(str(self.other), dict(action='disable', version=d['version'], name='other_b', conf=str(self.b)))
        self.assertEqual(self.dag.read_text(), before)

    def test_add_same_compress_name_in_multiple_dags(self):
        for filename in ('compress.dag', 'compress_arm.dag'):
            (self.dags / filename).write_text(module(component('shared_compress_name', self.a, 'CompressComponent', readers=self.reader), 'compress.so'))
        self.apply(self.request('add', name='new_multi', reference='camera_a', dev='/dev/video8', frameId='new_multi', enabled=False))
        d = m.inspect(str(self.dag))
        camera = next(c for c in d['cameras'] if c['name'] == 'new_multi')
        self.assertEqual(len(camera['linked']), 3)
        for filename in ('compress.dag', 'compress_arm.dag'):
            text = (self.dags / filename).read_text()
            comps = m.dag_components(text, self.dags / filename)
            self.assertEqual(len(comps), 2)
            self.assertFalse(comps[1]['enabled'])
            self.assertIn('/camera/a/raw/new_multi', text)
            self.assertIn(self.reader, text)

    def test_aliases_same_conf_are_not_independent_drivers(self):
        alias = self.root / 'alias.pb.txt'
        alias.symlink_to(self.a)
        self.dag.write_text(module(component('camera_a', self.a) + component('alias_camera', alias)))
        with self.assertRaises(ValueError): m.inspect(str(self.dag))

    def test_transaction_rolls_back_on_failure(self):
        before_a, before_dag = self.a.read_text(), self.dag.read_text()
        original = m.os.replace
        calls = [0]
        def fail_second(src, dst):
            calls[0] += 1
            if calls[0] == 2: raise OSError('injected disk failure')
            return original(src, dst)
        with mock.patch.object(m.os, 'replace', side_effect=fail_second):
            with self.assertRaises(OSError): self.apply(self.request('edit', values={'pb:/raw_channel_name/0': '/failed/raw'}))
        self.assertEqual(self.a.read_text(), before_a)
        self.assertEqual(self.dag.read_text(), before_dag)


if __name__ == '__main__':
    unittest.main()
