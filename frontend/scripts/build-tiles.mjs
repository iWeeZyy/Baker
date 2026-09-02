/**
 * Rend les vignettes dessinées : assets/images/{families,products}/*.svg -> *.png
 *
 * Deux jeux, même traitement : les vignettes de **famille** ouvrent le
 * catalogue, celles de **produit** illustrent une fiche qui n'a pas de photo.
 *
 * Les écrans affichent des PNG et non les SVG : `react-native-svg` n'est pas
 * installé, et un PNG s'affiche à l'identique sur iOS, Android et web via
 * `expo-image`, déjà utilisé partout. Les sources SVG restent dans le dépôt
 * pour que les vignettes soient modifiables — un binaire sans source ne se
 * corrige pas.
 *
 * Ne tourne pas pendant le build : à relancer à la main après avoir touché
 * un SVG.
 *
 *   npm i -D playwright && node scripts/build-tiles.mjs
 *
 * CHROMIUM_PATH permet de pointer un Chromium déjà installé.
 *
 * Quelques familles (voir CLAUDE.md, section « Recipe families ») utilisent
 * une vraie photo plutôt qu'un dessin, à la demande explicite de Lucas —
 * `src/families.ts` pointe alors sur un fichier `<clé>-photo.jpg` distinct,
 * jamais sur le `.png` que ce script régénère ici. Relancer ce script après
 * une modification de `<clé>.svg` reste donc sans risque pour ces familles :
 * ça régénère un `.png` qui n'est simplement plus référencé.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright n'est pas une dépendance du projet : il n'a rien à faire dans un
// build d'application. On le résout depuis le répertoire courant, ce qui laisse
// le choix de l'installer où l'on veut (`npm i -D playwright`, ou un
// node_modules quelconque d'où l'on lance la commande).
const require = createRequire(join(process.cwd(), 'noop.js'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error("playwright est introuvable — `npm i -D playwright`, puis relancer depuis ce dossier.");
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/images');
const DIRS = ['families', 'products'].map(d => join(ROOT, d));
// 4:3. Une vignette occupe une demi-largeur d'écran (~200 pt), donc 1200 px
// couvre déjà le triple de la densité la plus élevée ; doubler encore
// quadruplerait le poids du bundle pour un gain invisible.
const WIDTH = 1200, HEIGHT = 900, SCALE = 1;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: SCALE,
});

let count = 0;
for (const dir of DIRS) {
  const files = (await readdir(dir)).filter(f => f.endsWith('.svg')).sort();
  for (const file of files) {
    const svg = await readFile(join(dir, file), 'utf8');
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block}</style>${svg}`,
      { waitUntil: 'load' },
    );
    const out = join(dir, file.replace(/\.svg$/, '.png'));
    await page.screenshot({ path: out, omitBackground: false });
    console.log(`${dir.split('/').pop()}/${file} -> ${out.split('/').pop()}`);
    count += 1;
  }
}

await browser.close();
console.log(`${count} vignettes rendues`);
