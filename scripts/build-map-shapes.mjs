import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [buildDirectory, districtsFile, headersFile] = process.argv.slice(2);
if (!buildDirectory || !districtsFile || !headersFile) {
  throw new Error('Usage: node scripts/build-map-shapes.mjs BUILD_DIRECTORY DISTRICTS_JSON RESPONSE_HEADERS');
}
const require = createRequire(resolve(buildDirectory, 'package.json'));
const { geoAlbersUsa, geoArea, geoPath } = await import(pathToFileURL(require.resolve('d3-geo')));
const { feature } = require('topojson-client');
const root = fileURLToPath(new URL('../', import.meta.url));
const catalogue = JSON.parse(await readFile(resolve(root, 'public/races.json'), 'utf8'));
const stateNames = new Map(catalogue.map(race => [race.name.split(' · ')[0], race.state]));
const houseRaces = new Map(catalogue.filter(race => ['House', 'Delegate'].includes(race.office)).map(race => [race.id, race]));
const atlasBytes = await readFile(require.resolve('us-atlas/states-10m.json'));
const districtBytes = await readFile(districtsFile);
const atlas = JSON.parse(atlasBytes);
const districtCollection = JSON.parse(districtBytes);
const headers = await readFile(headersFile, 'utf8');
const header = name => headers.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1].trim();
const vintage = header('x-data-vintage');
if (!vintage || !Number.isFinite(Date.parse(vintage))) throw new Error('Missing district snapshot date');
for (const [name, version] of [['d3-geo', '3.1.1'], ['topojson-client', '3.1.0'], ['us-atlas', '3.0.1']]) {
  const metadata = JSON.parse(await readFile(resolve(buildDirectory, 'node_modules', name, 'package.json'), 'utf8'));
  if (metadata.version !== version) throw new Error(`Expected ${name}@${version}`);
}

const stateFeatures = feature(atlas, atlas.objects.states).features.filter(item => stateNames.has(item.properties.name));
if (stateFeatures.length !== 51 || districtCollection.type !== 'FeatureCollection' || districtCollection.features.length !== 436) {
  throw new Error('Expected 50 states plus D.C. and 436 House/delegate districts');
}
const width = 960, height = 620;
const projection = geoAlbersUsa().fitExtent([[20, 20], [940, 600]], { type:'FeatureCollection', features:stateFeatures });
const path = geoPath(projection).digits(2);
const round = number => Math.round(number * 100) / 100;

function project(item, identity) {
  const geometry = item.geometry;
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error(`Invalid geometry: ${identity.id}`);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const coordinates = polygons.map(rings => {
    // D3 uses the opposite exterior-ring winding from RFC 7946 GeoJSON.
    return geoArea({ type:'Polygon', coordinates:rings }) > 2 * Math.PI ? rings.map(ring => [...ring].reverse()) : rings;
  });
  const normalized = { ...item, geometry:{ ...geometry, coordinates:geometry.type === 'Polygon' ? coordinates[0] : coordinates } };
  const shape = path(normalized);
  const centroid = path.centroid(normalized).map(round);
  const bounds = path.bounds(normalized).map(point => point.map(round));
  const area = path.area(normalized);
  if (!shape || /NaN|Infinity/.test(shape) || [...centroid, ...bounds.flat()].some(number => !Number.isFinite(number))
    || bounds[0][0] < 0 || bounds[0][1] < 0 || bounds[1][0] > width || bounds[1][1] > height
    || area <= 0 || area >= width * height / 2) throw new Error(`Invalid projected shape: ${identity.id}`);
  return { ...identity, path:shape, centroid, bounds };
}

const states = stateFeatures.map(item => project(item, { id:stateNames.get(item.properties.name), name:item.properties.name }))
  .sort((a, b) => a.id.localeCompare(b.id));
const districts = districtCollection.features.map(item => {
  const match = /^([A-Z]{2})-(\d{2})$/.exec(item.properties?.district);
  if (!match || match[1] !== item.properties.state) throw new Error('Invalid district identifier');
  const number = match[1] === 'DC' && match[2] === '98' ? '00' : match[2];
  const id = `${match[1].toLowerCase()}-house-${number}`;
  const race = houseRaces.get(id);
  if (!race) throw new Error(`District is absent from the race directory: ${id}`);
  return project(item, { id, state:race.state, name:race.name });
}).sort((a, b) => a.id.localeCompare(b.id));
if (new Set(states.map(item => item.id)).size !== 51 || new Set(districts.map(item => item.id)).size !== houseRaces.size) {
  throw new Error('Duplicate or missing map identifiers');
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  { label:'U.S. Census state outlines via us-atlas 3.0.1', url:'https://github.com/topojson/us-atlas', vintage:'2017',
    sha256:sha256(atlasBytes), license:await readFile(resolve(buildDirectory, 'node_modules/us-atlas/LICENSE'), 'utf8') },
  { label:'2026 House districts: Census TIGERweb via watch.vote', url:'https://watch.vote/api/elections/2026/districts/national',
    vintage, layer:header('x-data-source'), simplification:header('x-data-simplification'), sha256:sha256(districtBytes) }
];
const output = JSON.stringify({ width, height, states, districts, sources }) + '\n';
await writeFile(resolve(root, 'public/map-shapes.json'), output);
console.log(`Wrote ${states.length} state shapes and ${districts.length} district shapes (${Buffer.byteLength(output)} bytes)`);
