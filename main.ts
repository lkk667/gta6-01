// Solmar City — entrypoint for the make.fun gta6-01 bounty.
// Copies this repo's game/ and screenshots/ into the output directory and
// writes the entry dossier there, using the kit's own buildDossier.
//
//   node main.ts [output-dir]     (default: /output)

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
// argv[2] names the output dir; without it the entry goes to /output.
const targetDir = resolve(process.argv[2] || '/output');

function copyEntryFolder(name) {
  cpSync(resolve(repoRoot, name), resolve(targetDir, name), { recursive: true });
}

mkdirSync(targetDir, { recursive: true });
for (const folder of ['game', 'screenshots']) copyEntryFolder(folder);

const dossierLimits = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};
const dossier = buildDossier(targetDir, dossierLimits);
writeFileSync(resolve(targetDir, 'dossier.json'), dossier);
console.log(`Solmar City entry written to ${targetDir} (dossier.json: ${dossier.length} bytes)`);
