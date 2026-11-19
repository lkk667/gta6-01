// Solmar City — entrypoint for the make.fun gta6-01 bounty.
// Copies this repo's game/ and screenshots/ into the output directory and
// writes the entry dossier there, using the kit's own buildDossier.
//
//   node main.ts [output-dir]     (default: /output)

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || '/output');

mkdirSync(outDir, { recursive: true });
cpSync(resolve(here, 'game'), resolve(outDir, 'game'), { recursive: true });
cpSync(resolve(here, 'screenshots'), resolve(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(resolve(outDir, 'dossier.json'), dossier);
console.log(`Solmar City entry written to ${outDir} (dossier.json: ${dossier.length} bytes)`);
