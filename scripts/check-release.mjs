#!/usr/bin/env node
/**
 * Guarda de publicación.
 *
 * Comprueba que el tag que se va a publicar (`vX.Y.Z`) coincide con la versión
 * declarada en `package.json` y que el `CHANGELOG.md` tiene una sección cerrada
 * para esa versión, sin contenido pendiente en «[No publicado]».
 *
 * Se ejecuta en CI sobre los tags y también a mano antes de etiquetar:
 *
 *     node scripts/check-release.mjs v0.1.0
 *     node scripts/check-release.mjs        # usa GITHUB_REF_NAME si existe
 *
 * No publica nada: solo comprueba. La publicación (tag y release) la decide una
 * persona, nunca una máquina.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

const version = String(pkg.version ?? '');
const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  problems.push(`La versión de package.json («${version}») no es semántica (X.Y.Z).`);
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? null;
if (tag !== null && tag !== `v${version}`) {
  problems.push(
    `El tag «${tag}» no corresponde a la versión de package.json («v${version}»).`,
  );
}

/** Cuerpo de una sección `## [...]`, hasta la siguiente sección de nivel 2. */
function sectionBody(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

// La versión debe tener su sección cerrada en el historial.
const escaped = version.replace(/\./g, '\\.');
if (!new RegExp(`^##\\s+\\[${escaped}\\]\\s`, 'm').test(changelog)) {
  problems.push(`El CHANGELOG.md no tiene una sección «## [${version}]» para esta versión.`);
}

// Y no debe quedar nada sin publicar.
const unpublished = sectionBody(changelog, '## [No publicado]');
if (unpublished !== null && unpublished.trim().length > 0) {
  problems.push(
    'El CHANGELOG.md conserva contenido en «[No publicado]»: muévelo a la versión que publicas.',
  );
}

if (problems.length > 0) {
  console.error('La publicación no puede cerrarse:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`OK: versión ${version} lista para publicar${tag === null ? '' : ` como ${tag}`}.`);
