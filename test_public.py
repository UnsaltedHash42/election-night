import json
import re
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class PublicEditionTests(unittest.TestCase):
    def test_catalogue_identifies_seats_without_copying_results(self):
        races = json.loads((ROOT / 'public/races.json').read_text())
        self.assertEqual(Counter(r['office'] for r in races),
                         {'House': 435, 'Senate': 35, 'Governor': 36, 'Delegate': 1})
        self.assertEqual(len({r['id'] for r in races}), len(races))
        self.assertEqual(len({r['state'] for r in races}), 51)
        for race in races:
            self.assertEqual(set(race), {'id', 'slug', 'state', 'office', 'name', 'featured'})
            self.assertRegex(race['slug'], r'^[a-z]{2}-(?:senate|governor|house-\d{2})$')
        for state in ('AK', 'DE', 'ND', 'SD', 'VT', 'WY'):
            self.assertIn(state.lower() + '-house-00', {r['id'] for r in races})

    def test_deployment_contains_only_the_public_edition(self):
        config = json.loads((ROOT / 'wrangler.jsonc').read_text())
        directory = (ROOT / config['pages_build_output_dir']).resolve()
        self.assertEqual(directory, ROOT / 'public')
        allowed = {'index.html', 'app.js', 'styles.css', 'races.json', '_headers', '404.html'}
        self.assertTrue({p.name for p in directory.iterdir()}.issubset(allowed))
        self.assertFalse(any(p.is_symlink() for p in directory.iterdir()))

    def test_public_page_has_no_personal_api_dependency(self):
        source = (ROOT / 'public/app.js').read_text()
        self.assertNotIn('/api/results', source)
        self.assertNotIn('127.0.0.1', source)
        self.assertNotIn('apps.npr.org/2026-election-results/data', source)
        self.assertIn('https://watch.vote', source)
        self.assertFalse(re.search(r'fetch\([^\n]*https?://', source))


if __name__ == '__main__':
    unittest.main()
