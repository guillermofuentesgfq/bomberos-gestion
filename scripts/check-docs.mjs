#!/usr/bin/env node
/**
 * Verifica que los documentos exigidos por el proyecto existan y no estén
 * vacíos. Se ejecuta en CI. No valida el contenido, solo la presencia.
 */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'LICENSE',
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/DATA_MODEL.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
];

const missing = [];
const empty = [];

for (const rel of required) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    missing.push(rel);
    continue;
  }
  if (statSync(path).size === 0) empty.push(rel);
}

if (missing.length === 0 && empty.length === 0) {
  console.log(`OK: ${required.length} documentos presentes.`);
  process.exit(0);
}

if (missing.length) console.error(`Faltan documentos:\n  - ${missing.join('\n  - ')}`);
if (empty.length) console.error(`Documentos vacíos:\n  - ${empty.join('\n  - ')}`);
process.exit(1);
