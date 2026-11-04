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
        allowed = {'index.html', 'app.js', 'call-alerts.js', 'map.js', 'map-shapes.json', 'markets.js', 'forecast.js', 'crashout.js',
                   'styles.css', 'races.json', '_headers', '_routes.json', '404.html'}
        self.assertTrue({p.name for p in directory.iterdir()}.issubset(allowed))
        self.assertFalse(any(p.is_symlink() for p in directory.iterdir()))

    def test_public_page_has_no_personal_api_dependency(self):
        source = '\n'.join(path.read_text() for path in (ROOT / 'public').glob('*.js'))
        self.assertNotIn('/api/results', source)
        self.assertNotIn('127.0.0.1', source)
        self.assertIn('https://watch.vote', source)
        self.assertEqual(set(re.findall(r'https?://[^/\s\'"`]+', source.replace('http://www.w3.org/2000/svg', ''))),
                         {'https://watch.vote', 'https://embed.polymarket.com', 'https://polymarket.com',
                          'https://public.api.bsky.app', 'https://bsky.app', 'https://apps.npr.org'})

    def test_map_shapes_match_the_race_directory(self):
        shapes = json.loads((ROOT / 'public/map-shapes.json').read_text())
        races = json.loads((ROOT / 'public/races.json').read_text())
        self.assertEqual((shapes['width'], shapes['height']), (960, 620))
        self.assertEqual({r['state'] for r in races}, {s['id'] for s in shapes['states']})
        self.assertEqual({r['id'] for r in races if r['office'] in ('House', 'Delegate')},
                         {s['id'] for s in shapes['districts']})
        self.assertEqual(len(shapes['districts']), 436)
        self.assertEqual(len(shapes['states']), 51)
        for shape in shapes['states'] + shapes['districts']:
            self.assertTrue(shape['path'].startswith('M'))
            self.assertNotRegex(shape['path'], 'NaN|Infinity')
            self.assertLess(shape['bounds'][0][0], shape['bounds'][1][0])
            self.assertLess(shape['bounds'][0][1], shape['bounds'][1][1])
        routes = json.loads((ROOT / 'public/_routes.json').read_text())
        self.assertEqual(routes['include'], ['/api/map-results'])


if __name__ == '__main__':
    unittest.main()
