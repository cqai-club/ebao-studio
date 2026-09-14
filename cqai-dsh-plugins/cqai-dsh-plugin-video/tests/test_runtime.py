import importlib.util
from pathlib import Path
import sys
import unittest

RUNTIME = Path(__file__).resolve().parents[1] / 'runtime'
sys.path.insert(0, str(RUNTIME / 'stages'))
from stage_script import offline_plan
spec = importlib.util.spec_from_file_location('align_semantic', RUNTIME / 'align-engine/align_semantic.py')
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)

class RuntimeTests(unittest.TestCase):
    def test_long_sentence_and_first_paragraph_preserved(self):
        raw = '重要标题\n' + '长句' * 100 + '。'
        plan, text = offline_plan(raw, '测试', 2)
        self.assertIn('重要标题', text)
        self.assertEqual(len(plan['captions']), 1)
        self.assertTrue(text.endswith('。'))

    def test_fewer_pauses_keeps_caption_identity(self):
        captions = ['第一句话', '第二句', '第三句']
        result = align.align_energy(captions, [(1, 5)])
        self.assertEqual([c['text'] for c in result], captions)
        self.assertEqual(result[0]['start'], 1)
        self.assertEqual(result[-1]['end'], 5)

    def test_no_pauses_is_explicit_fallback(self):
        self.assertEqual(align.align_energy(['句子'], []), [])

if __name__ == '__main__':
    unittest.main()
