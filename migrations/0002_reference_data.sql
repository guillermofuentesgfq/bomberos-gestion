-- ---------------------------------------------------------------------------
-- 0002 — Datos de referencia del sistema
--
-- Solo datos del modelo de dominio (permisos, roles, condiciones, secciones).
-- NO se incluyen datos personales ni datos de ninguna institución concreta:
-- ubicaciones, categorías, personas y contenido los crea cada instalación.
-- ---------------------------------------------------------------------------

-- === Permisos ==============================================================
INSERT INTO permissions (code, description) VALUES
  ('institution.read',   'Ver la configuración institucional'),
  ('institution.write',  'Modificar la configuración institucional'),
  ('users.read',         'Ver usuarios y roles'),
  ('users.write',        'Crear y modificar usuarios'),
  ('roles.write',        'Modificar roles y permisos'),
  ('inventory.read',     'Consultar inventario y movimientos'),
  ('inventory.write',    'Crear y editar materiales, unidades y catálogos'),
  ('inventory.assign',   'Registrar entregas de material'),
  ('inventory.return',   'Registrar devoluciones de material'),
  ('inventory.transfer', 'Registrar traslados entre ubicaciones'),
  ('inventory.writeoff', 'Registrar bajas de material'),
  ('inventory.maintenance', 'Registrar mantenciones y revisiones'),
  ('inventory.import',   'Importar y catastrar material'),
  ('inventory.export',   'Exportar informes y planillas'),
  ('persons.read',       'Consultar fichas de personal'),
  ('persons.write',      'Crear y editar fichas de personal y cargos'),
  ('site.read',          'Ver el contenido del sitio público'),
  ('site.write',         'Crear y editar contenido del sitio'),
  ('site.publish',       'Publicar, despublicar y archivar contenido'),
  ('audit.read',         'Consultar el registro de auditoría');

-- === Roles iniciales configurables =========================================
INSERT INTO roles (id, code, name, description, is_system) VALUES
  (1, 'admin',              'Administrador',              'Acceso completo a la instalación.', 1),
  (2, 'inventory_manager',  'Responsable de inventario',  'Gestiona catálogo, existencias, movimientos y bajas.', 1),
  (3, 'assignment_manager', 'Responsable de asignaciones','Registra entregas, devoluciones y catastro.', 1),
  (4, 'site_editor',        'Editor del sitio web',       'Administra el contenido del sitio público.', 1),
  (5, 'viewer',             'Usuario de consulta',        'Solo lectura del inventario y las fichas.', 1);

-- Administrador: todos los permisos.
INSERT INTO role_permissions (role_id, permission_code)
  SELECT 1, code FROM permissions;

-- Responsable de inventario.
INSERT INTO role_permissions (role_id, permission_code) VALUES
  (2, 'institution.read'),
  (2, 'inventory.read'),
  (2, 'inventory.write'),
  (2, 'inventory.transfer'),
  (2, 'inventory.writeoff'),
  (2, 'inventory.maintenance'),
  (2, 'inventory.import'),
  (2, 'inventory.export'),
  (2, 'persons.read');

-- Responsable de asignaciones.
INSERT INTO role_permissions (role_id, permission_code) VALUES
  (3, 'institution.read'),
  (3, 'inventory.read'),
  (3, 'inventory.assign'),
  (3, 'inventory.return'),
  (3, 'inventory.import'),
  (3, 'inventory.export'),
  (3, 'persons.read'),
  (3, 'persons.write');

-- Editor del sitio web.
INSERT INTO role_permissions (role_id, permission_code) VALUES
  (4, 'institution.read'),
  (4, 'site.read'),
  (4, 'site.write'),
  (4, 'site.publish');

-- Usuario de consulta.
INSERT INTO role_permissions (role_id, permission_code) VALUES
  (5, 'institution.read'),
  (5, 'inventory.read'),
  (5, 'persons.read'),
  (5, 'site.read');

-- === Condiciones físicas del material ======================================
-- is_available = 1 solo para lo que puede entregarse.
INSERT INTO material_conditions (code, name, is_available, sort_order) VALUES
  ('operativo',        'Operativo',           1, 1),
  ('observacion',      'Observación',         0, 2),
  ('en_reparacion',    'En reparación',       0, 3),
  ('mal_estado',       'Mal estado',          0, 4),
  ('fuera_de_servicio','Fuera de servicio',   0, 5),
  ('dado_de_baja',     'Dado de baja',        0, 6);

-- === Calidades de integrante ===============================================
INSERT INTO qualities (id, name, sort_order) VALUES
  (1, 'Activo',       1),
  (2, 'Abanderado',   2),
  (3, 'Aspirante',    3),
  (4, 'Postulante',   4),
  (5, 'Honorario',    5),
  (6, 'Otro',         6);

-- === Secciones del sitio público ===========================================
-- Todas configurables desde el panel. Orden inicial razonable.
INSERT INTO site_sections (section_key, is_enabled, sort_order) VALUES
  ('hero',       1, 1),
  ('about',      1, 2),
  ('history',    1, 3),
  ('mission',    1, 4),
  ('specialties',1, 5),
  ('gallery',    1, 6),
  ('news',       1, 7),
  ('activities', 1, 8),
  ('contact',    1, 9),
  ('footer',     1, 10);
