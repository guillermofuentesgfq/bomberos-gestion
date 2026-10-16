import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

/**
 * Se ejecuta una vez por archivo de prueba: aplica las migraciones versionadas
 * a la base D1 de ese archivo.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/**
 * El plugin no aísla el almacenamiento entre pruebas, así que se vacían las
 * tablas de datos antes de cada una. Las tablas de referencia creadas por las
 * migraciones (permisos, roles, condiciones, calidades y secciones del sitio)
 * se conservan.
 *
 * El orden respeta las claves foráneas: primero las hijas.
 */
const DATA_TABLES = [
  'return_lines',
  'returns',
  'assignment_lines',
  'assignments',
  'transfers',
  'writeoffs',
  'maintenance_records',
  'movements',
  'idempotency_keys',
  'gallery_photos',
  'galleries',
  'news',
  'pages',
  'activities',
  'material_units',
  'lots',
  'stock_levels',
  'materials',
  'person_positions',
  'persons',
  'storage_objects',
  'login_attempts',
  'sessions',
  'audit_log',
  'user_roles',
  'users',
  'locations',
  'categories',
  'material_types',
  'seo_settings',
  'institution_settings',
] as const;

beforeEach(async () => {
  for (const table of DATA_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});
