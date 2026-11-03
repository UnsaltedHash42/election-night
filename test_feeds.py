import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock

from feeds import FeedStore, parse_nc, parse_enhanced, parse_openamerica, parse_npr, parse_california, parse_sherwood, chamber_summary, merged_races
from server import load_source, dashboard_payload


def nc_archive(rows):
    output = io.StringIO()
    writer = csv.writer(output, delimiter='\t')
    writer.writerow(['County', 'Election Date', 'Precinct', 'Contest Name', 'Choice', 'Choice Party', 'Total Votes'])
    writer.writerows(rows)
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as archive:
        archive.writestr('results_pct_20261103.txt', output.getvalue())
    return data.getvalue()


def enhanced(votes=12):
    return {
        'election': {'electionDate': '2026-11-03', 'isProduction': True, 'isPrimary': False, 'asOf': '2026-11-04T01:00:00Z'},
        'ballotItems': [{
            'id': 'senate', 'name': [{'languageId': 'en', 'text': 'Member, United States Senate'}],
            'voteTotal': votes + 10, 'reportingStatus': {'reportingUnits': 1, 'totalUnits': 133},
            'summaryResults': {'ballotOptions': [
                {'id': 'a', 'name': [{'languageId': 'en', 'text': 'Alpha'}], 'party': {'abbreviation': 'D'}, 'voteCount': votes, 'groupResults': [{'voteCount': votes}]},
                {'id': 'b', 'name': [{'languageId': 'en', 'text': 'Beta'}], 'party': {'abbreviation': 'R'}, 'voteCount': 10}
            ]}
        }]
    }


class FeedTests(unittest.TestCase):
    def test_nc_aggregates_across_counties_without_combining_offices(self):
        rows = [
            ['A', '11/03/2026', '01', 'US SENATE', 'Alpha', 'DEM', 4],
            ['B', '11/03/2026', '01', 'US SENATE', 'Alpha', 'DEM', 6],
            ['A', '11/03/2026', '01', 'US SENATE', 'Beta', 'REP', 3],
            ['A', '11/03/2026', '01', 'US HOUSE OF REPRESENTATIVES DISTRICT 01', 'Alpha', 'DEM', 8],
            ['A', '11/03/2026', '01', 'COUNTY SHERIFF', 'Other', 'REP', 100],
        ]
        races, _ = parse_nc(nc_archive(rows))
        self.assertEqual(len(races), 2)
        senate = next(r for r in races if r['office'] == 'Senate')
        self.assertEqual(senate['totalVotes'], 13)
        self.assertEqual(senate['candidates'][0]['votes'], 10)
        self.assertIsNone(senate['reporting'])

    def test_nc_rejects_wrong_election_and_bad_votes(self):
        for date, votes in [('11/05/2024', 10), ('11/03/2026', -1), ('11/03/2026', 'oops')]:
            with self.assertRaises(ValueError):
                parse_nc(nc_archive([['A', date, '01', 'US SENATE', 'A', 'DEM', votes]]))

    def test_enhanced_uses_summary_once_and_locality_units(self):
        races, timestamp = parse_enhanced(enhanced(), 'VA')
        self.assertEqual(races[0]['totalVotes'], 22)
        self.assertEqual(races[0]['candidates'][0]['votes'], 12)
        self.assertEqual(races[0]['reporting']['label'], 'localities')
        self.assertEqual(timestamp, '2026-11-04T01:00:00Z')

    def test_enhanced_rejects_test_or_wrong_election(self):
        for field, value in [('isProduction', False), ('electionDate', '2024-11-05'), ('isPrimary', True)]:
            data = enhanced()
            data['election'][field] = value
            with self.assertRaises(ValueError):
                parse_enhanced(data, 'VA')

    def test_enhanced_zero_is_awaiting_and_correction_allowed(self):
        data = enhanced(0)
        data['ballotItems'][0]['voteTotal'] = 0
        data['ballotItems'][0]['summaryResults']['ballotOptions'][1]['voteCount'] = 0
        races, _ = parse_enhanced(data, 'VA')
        self.assertEqual(races[0]['status'], 'awaiting')

    def test_openamerica_checks_version_year_office_and_special_seat(self):
        data = {'api': 1, 'year': 2026, 'office': 'Senate', 'as_of': None, 'races': {'FL-special': {
            'total': 30, 'pct_in': 100, 'called': True, 'cands': [{'n': 'A', 'p': 'D', 'v': 20}, {'n': 'B', 'p': 'R', 'v': 10}]
        }}}
        races, _ = parse_openamerica(data, 'Senate')
        self.assertEqual(races[0]['id'], 'FL-Senate-special')
        self.assertEqual(races[0]['status'], 'reporting')
        self.assertIsNone(races[0]['reporting'])
        for field, value in [('api', 2), ('year', 2024), ('office', 'House')]:
            invalid = dict(data, **{field: value})
            with self.assertRaises(ValueError):
                parse_openamerica(invalid, 'Senate')

    def test_store_retains_last_good_counts_and_history_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            store = FeedStore(Path(directory))
            races, _ = parse_enhanced(enhanced(), 'VA')
            store.success('va', races, '2026-11-04T01:00:00Z', '2026-11-04T01:01:00Z')
            store.failure('va', 'Unavailable', '2026-11-04T01:02:00Z')
            current = store.snapshot()['va']
            self.assertEqual(current['races'][0]['totalVotes'], 22)
            self.assertEqual(current['status'], 'error')
            self.assertEqual(current['lastSuccess'], '2026-11-04T01:01:00Z')
            races, _ = parse_enhanced(enhanced(11), 'VA')
            store.success('va', races, '2026-11-04T01:03:00Z', '2026-11-04T01:04:00Z')
            current = store.snapshot()['va']
            self.assertEqual(current['races'][0]['totalVotes'], 21)
            self.assertEqual(len(current['races'][0]['history']), 2)
            store.success('va', races, '2026-11-04T01:03:00Z', '2026-11-04T01:05:00Z')
            self.assertEqual(len(store.snapshot()['va']['races'][0]['history']), 2)
            self.assertEqual(FeedStore(Path(directory)).snapshot()['va']['races'][0]['totalVotes'], 21)

    def test_direct_state_results_win_over_aggregator(self):
        data = {'oa-house': {'races': [{'id': 'NC-House-01', 'totalVotes': 99}]}, 'nc': {'races': [{'id': 'NC-House-01', 'totalVotes': 12}]}}
        self.assertEqual(merged_races(data)[0]['totalVotes'], 12)

    def test_npr_call_survives_overlapping_direct_and_aggregated_counts(self):
        official = {'id': 'NC-House-01', 'office': 'House', 'sourceId': 'npr', 'totalVotes': 80,
                    'called': True, 'winnerParty': 'DEM', 'previousParty': 'REP', 'flip': True}
        snapshot = {source: {'races': [dict(official, sourceId=source, totalVotes=100, called=False, flip=False)]}
                    for source in ('nc', 'oa-house')}
        snapshot['npr'] = {'races': [official]}
        store = Mock()
        store.snapshot.return_value = snapshot
        result = dashboard_payload(store)
        self.assertEqual(result['races'], [official])
        self.assertEqual(result['flips'], [official])
        house = next(c for c in result['chambers'] if c['office'] == 'House')
        self.assertEqual((house['dem'], house['uncalled'], house['loaded']), (1, 434, 1))

    def test_senate_independent_caucuses_and_unavailable_totals(self):
        for chamber in chamber_summary([], {}):
            self.assertIsNone(chamber['dem'])
            self.assertIsNone(chamber['rep'])
            self.assertIsNone(chamber['uncalled'])
        races = [{'office': 'Senate', 'sourceId': 'npr', 'called': True, 'winnerParty': 'IND', 'caucusWith': caucus}
                 for caucus in ('DEM', 'REP', None)]
        senate = next(c for c in chamber_summary(races, {}) if c['office'] == 'Senate')
        self.assertEqual((senate['dem'], senate['rep'], senate['other'], senate['uncalled']), (35, 32, 1, 32))

    def test_npr_calls_and_flips_require_explicit_winner(self):
        row = {'test': False, 'office': 'S', 'resultsType': 'live', 'type': 'General', 'state': 'AR', 'updated': 1793731625437,
               'previousParty': 'GOP', 'keyRace': 'yes', 'candidates': [{'id': 'a', 'first': 'Alpha', 'last': 'Jones', 'party': 'Dem', 'votes': 10},
               {'id': 'b', 'first': 'Beta', 'last': 'Smith', 'party': 'GOP', 'votes': 8}]}
        races, _ = parse_npr({'results': [row]}, 'Senate')
        self.assertFalse(races[0]['called'])
        self.assertFalse(races[0]['flip'])
        row['candidates'][0]['winner'] = 'R'
        self.assertFalse(parse_npr({'results': [row]}, 'Senate')[0][0]['called'])
        row['candidates'][0]['winner'] = 'X'
        races, _ = parse_npr({'results': [row]}, 'Senate')
        self.assertTrue(races[0]['called'])
        self.assertTrue(races[0]['flip'])
        summary = chamber_summary(races, {})
        senate = next(item for item in summary if item['office'] == 'Senate')
        self.assertEqual(senate['dem'], 35)
        self.assertEqual(senate['rep'], 31)
        self.assertEqual(senate['uncalled'], 34)
        row['type'] = 'Special General'
        self.assertEqual(parse_npr({'results': [row]}, 'Senate')[0][0]['id'], 'AR-Senate-special')
        row['type'] = 'Nonpartisan Election'
        self.assertTrue(parse_npr({'results': [row]}, 'Senate')[0][0]['called'])
        row['test'] = True
        with self.assertRaises(ValueError):
            parse_npr({'results': [row]}, 'Senate')

    def test_california_counts_summary_not_county_rows(self):
        data = [{'raceTitle': 'United States Representative District 1 - Districtwide Results', 'Reporting': '20% (10 of 50) precincts reporting', 'candidates': [{'Name': 'A', 'Party': 'Dem', 'Votes': '1,200'}]},
                {'raceTitle': 'United States Representative District 1 - County Results', 'Reporting': '', 'candidates': [{'Name': 'A', 'Party': 'Dem', 'Votes': '800'}]}]
        races, _ = parse_california(data, 'House')
        self.assertEqual(len(races), 1)
        self.assertEqual(races[0]['totalVotes'], 1200)
        self.assertEqual(races[0]['reporting']['count'], 10)

    def test_npr_office_failure_keeps_other_offices_updating(self):
        def payload(office):
            return json.dumps({'results': [{'test': False, 'office': office, 'resultsType': 'live',
                'type': 'General', 'state': 'AR', 'seatNumber': 1, 'updated': 1793731625437,
                'previousParty': 'GOP', 'candidates': [{'id': 'a', 'first': 'Alpha', 'last': 'Jones',
                'party': 'Dem', 'votes': 10, 'winner': 'X'}]}]}).encode(), None
        previous, _ = parse_npr(json.loads(payload('G')[0]), 'Governor')
        client = Mock()
        client.get.side_effect = [payload('H'), payload('S'), OSError('Temporary outage')]
        races, _, warning, interval = load_source('npr', client, previous)
        self.assertEqual({r['office'] for r in races}, {'House', 'Senate', 'Governor'})
        self.assertTrue(next(r for r in races if r['office'] == 'House')['called'])
        self.assertEqual(next(r for r in races if r['office'] == 'Governor'), previous[0])
        self.assertIn('Governor', warning)
        self.assertEqual(interval, 120)
        client.get.side_effect = OSError('Temporary outage')
        with self.assertRaisesRegex(ValueError, 'House.*Senate.*Governor'):
            load_source('npr', client, previous)

    def test_sherwood_counts_summary_not_location_duplicate(self):
        eid = '11b07106-031e-4d7c-911a-d01fb473d6dd'
        metadata = {'electionID': eid, 'response': {'contests': {'mayor': {'contestName': 'Sherwood Mayor', 'choices': {'a': {'name': 'IND Alpha'}, 'b': {'name': 'IND Beta'}}}}}}
        payload = {'electionID': eid, 'lastUpdated': '2026-11-04T02:00:00Z', 'response': {'contestID': 'mayor', 'totalVotes': 12, 'precinctsReporting': 1, 'totalPrecincts': 15,
                   'choices': [{'choiceID': 'a', 'totalVotes': 7}, {'choiceID': 'b', 'totalVotes': 5}], 'locations': {'county': {'totalVotes': 12}}}}
        races, _ = parse_sherwood(metadata, [payload])
        self.assertEqual(races[0]['totalVotes'], 12)
        self.assertEqual(races[0]['candidates'][0]['name'], 'Alpha')
        self.assertEqual(races[0]['office'], 'Other')
        payload['electionID'] = 'wrong'
        with self.assertRaises(ValueError):
            parse_sherwood(metadata, [payload])


if __name__ == '__main__':
    unittest.main()
