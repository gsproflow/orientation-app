// Fond de carte de l'application Alumni GSJC Rabat.
//
// Construit à partir de Natural Earth (données du domaine public, via le paquet npm "world-atlas").
// Le Maroc est présenté avec son Sahara : les deux territoires sont fusionnés, il n'y a donc aucune
// frontière entre eux. Toutes les autres frontières sont conservées.
//
// Régénérer le fichier :
//   npm install world-atlas@2 topojson-client@3 topojson-simplify@3 i18n-iso-countries@7
//   node build-world-map.js <dossier-alumni>/data/world.geojson [seuil de simplification, 0.002 par défaut] <dossier-alumni>/data/countries.json
const fs = require('fs');
const topo = require('topojson-client');
const simp = require('topojson-simplify');
const ic = require('i18n-iso-countries');
ic.registerLocale(require('i18n-iso-countries/langs/fr.json'));

const out = process.argv[2] || 'world.geojson';
const minWeight = Number(process.argv[3] || 0.002); // seuil de simplification des contours (0 = aucune)
const countriesFile = process.argv[4]; // data/countries.json : noms français retenus par l'application

let t = require('world-atlas/countries-50m.json');
t = simp.simplify(simp.presimplify(t), minWeight);

const frByAlpha2 = countriesFile ? Object.fromEntries(JSON.parse(fs.readFileSync(countriesFile, 'utf8'))) : {};
const EXTRA = { Somaliland: 'Somaliland', Kosovo: 'Kosovo', 'N. Cyprus': 'Chypre du Nord', 'Indian Ocean Ter.': 'Territoires de l’océan Indien', 'Siachen Glacier': 'Glacier de Siachen' };
const frName = (g) => {
  const a2 = ic.numericToAlpha2(g.id);
  return (a2 && (frByAlpha2[a2] || ic.getName(a2, 'fr'))) || EXTRA[g.properties.name] || g.properties.name;
};

const geoms = t.objects.countries.geometries;
const find = (id) => geoms.find((g) => g.id === id);
const round = (c) => (Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]);
const keepCountry = (g) => g.id !== '010'; // sans l'Antarctique

// Les territoires qui chevauchent la ligne de changement de date (Russie, Fidji) produiraient des traits
// horizontaux sur toute la carte : on coupe leurs contours à cet endroit et on referme chaque morceau.
function splitRing(ring) {
  const chains = [];
  let cur = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) { chains.push(cur); cur = [ring[i]]; } else cur.push(ring[i]);
  }
  chains.push(cur);
  if (chains.length > 1) { const last = chains.pop(); chains[0] = last.concat(chains[0].slice(1)); }
  return chains.filter((c) => c.length > 2).map((c) => [...c, c[0]]);
}
function fixAntimeridian(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const res = [];
  for (const rings of polys) {
    const jumps = rings.some((r) => r.some((p, i) => i && Math.abs(p[0] - r[i - 1][0]) > 180));
    if (!jumps) { res.push(rings); continue; }
    splitRing(rings[0]).forEach((piece) => res.push([piece]));
  }
  return res.length === 1 ? { type: 'Polygon', coordinates: res[0] } : { type: 'MultiPolygon', coordinates: res };
}
const geometryOf = (g) => fixAntimeridian({ type: g.type, coordinates: round(g.coordinates) });

const others = geoms.filter((g) => g.id !== '504' && g.id !== '732' && keepCountry(g));
const features = topo.feature(t, { type: 'GeometryCollection', geometries: others }).features.map((f, i) => ({
  type: 'Feature', properties: { n: frName(others[i]) }, geometry: geometryOf(f.geometry),
}));
const maroc = topo.merge(t, [find('504'), find('732')]); // Maroc + Sahara : un seul territoire
features.push({ type: 'Feature', properties: { n: 'Maroc' }, geometry: geometryOf(maroc) });

fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(out, Math.round(fs.statSync(out).size / 1024), 'Ko,', features.length, 'territoires');
