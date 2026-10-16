import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { sanitizeRichText } from '../lib/richtext';
import { isUniqueViolation } from '../lib/sql';
import { nowIso } from '../lib/time';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import { CONDITION_CODES } from '../../shared/inventory';
import * as personsRepo from '../repositories/persons';
import * as assignmentsRepo from '../repositories/assignments';
import * as catalog from '../repositories/catalog';
import { actaInstitution } from '../services/actas';
import { assignMaterial, returnMaterial } from '../services/assignments';
import { requireScopedObject } from '../services/storage';
import { withIdempotency } from '../services/idempotency';

type AppEnv = { Bindings: Env; Variables: Variables };

export const personRoutes = new Hono<AppEnv>();

const idParam = z.coerce.number().int().positive();

function parseId(raw: string | undefined, label = 'identificador'): number {
  const parsed = idParam.safeParse(raw);
  if (!parsed.success) throw AppError.badRequest(`${label} inválido.`);
  return parsed.data;
}

// --- Esquemas ---------------------------------------------------------------

// Las notas de la persona se escriben con el editor enriquecido, así que se
// guardan como HTML y se sanean aquí, al escribir (igual que el contenido del
// sitio): el cliente no es una defensa.
const richNotes = z
  .string()
  .trim()
  .max(4000)
  .transform((value) => sanitizeRichText(value));

const personBodySchema = z.object({
  fullName: z.string().trim().min(1, 'El nombre es obligatorio.').max(160),
  rut: z.string().trim().max(20).nullable().optional(),
  qualityId: z.number().int().positive().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email('Correo inválido.').max(160).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  birthDate: z.string().trim().max(20).nullable().optional(),
  joinDate: z.string().trim().max(20).nullable().optional(),
  registryNo: z.string().trim().max(60).nullable().optional(),
  emergencyName: z.string().trim().max(160).nullable().optional(),
  emergencyPhone: z.string().trim().max(40).nullable().optional(),
  history: richNotes.nullable().optional(),
  /** Foto de la persona: objeto privado, es un dato personal. */
  photoObjectId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

// --- Catálogos de apoyo -----------------------------------------------------

personRoutes.get('/catalog', requireAuth, requirePermission('persons.read'), async (c) => {
  const [positionTypes, qualities] = await Promise.all([
    personsRepo.listPositionTypes(c.env.DB),
    personsRepo.listQualities(c.env.DB),
  ]);
  return ok(c, { positionTypes, qualities });
});

// --- Administración del catálogo (cargos y calidades) -----------------------
//
// Los cargos y las calidades ya asignados conservan su referencia: dar de baja
// una entrada es archivarla, no borrarla.

const catalogNameSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
});

function catalogConflict(error: unknown, message: string): never {
  if (isUniqueViolation(error)) throw AppError.conflict(message);
  throw error;
}

for (const entry of [
  {
    segment: 'position-types',
    label: 'cargo',
    insert: personsRepo.insertPositionType,
    update: personsRepo.updatePositionType,
    archive: personsRepo.archivePositionType,
  },
  {
    segment: 'qualities',
    label: 'calidad',
    insert: personsRepo.insertQuality,
    update: personsRepo.updateQuality,
    archive: personsRepo.archiveQuality,
  },
] as const) {
  const duplicate = `Ya existe ${entry.label === 'cargo' ? 'ese' : 'esa'} ${entry.label} con ese nombre.`;
  const missing = `${entry.label === 'cargo' ? 'Ese' : 'Esa'} ${entry.label} no existe.`;

  personRoutes.post(
    `/catalog/${entry.segment}`,
    requireAuth,
    requireCsrf,
    requirePermission('persons.write'),
    async (c) => {
      const body = await readJson(c, catalogNameSchema);
      try {
        const id = await entry.insert(c.env.DB, body.name);
        return ok(c, { id }, 201);
      } catch (error) {
        catalogConflict(error, duplicate);
      }
    },
  );

  personRoutes.put(
    `/catalog/${entry.segment}/:id`,
    requireAuth,
    requireCsrf,
    requirePermission('persons.write'),
    async (c) => {
      const id = parseId(c.req.param('id'), entry.label);
      const body = await readJson(c, catalogNameSchema);
      try {
        const changes = await entry.update(c.env.DB, id, body.name);
        if (changes === 0) throw AppError.notFound(missing);
        return ok(c, { updated: true });
      } catch (error) {
        catalogConflict(error, duplicate);
      }
    },
  );

  personRoutes.delete(
    `/catalog/${entry.segment}/:id`,
    requireAuth,
    requireCsrf,
    requirePermission('persons.write'),
    async (c) => {
      const id = parseId(c.req.param('id'), entry.label);
      const changes = await entry.archive(c.env.DB, id);
      if (changes === 0) throw AppError.notFound(missing);
      return ok(c, { archived: true });
    },
  );
}

// --- Personas ---------------------------------------------------------------

personRoutes.get('/', requireAuth, requirePermission('persons.read'), async (c) => {
  // La búsqueda se acota igual que la de materiales: sin cota, un `q` enorme
  // alimentaría un `LIKE` innecesariamente costoso.
  const search = (c.req.query('q') ?? '').trim().slice(0, 120);
  const people = await personsRepo.listPersons(c.env.DB, search || undefined);
  return ok(c, people);
});

personRoutes.post('/', requireAuth, requireCsrf, requirePermission('persons.write'), async (c) => {
  const body = await readJson(c, personBodySchema);
  // La foto referida debe ser un objeto de ámbito «persona»: así una ficha no
  // puede enlazar (y por tanto exponer) la foto privada de otro apartado.
  if (body.photoObjectId !== undefined && body.photoObjectId !== null) {
    await requireScopedObject(c.env.DB, body.photoObjectId, 'person');
  }
  const id = await personsRepo.insertPerson(c.env.DB, {
    fullName: body.fullName,
    rut: body.rut ?? null,
    qualityId: body.qualityId ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    address: body.address ?? null,
    birthDate: body.birthDate ?? null,
    joinDate: body.joinDate ?? null,
    registryNo: body.registryNo ?? null,
    emergencyName: body.emergencyName ?? null,
    emergencyPhone: body.emergencyPhone ?? null,
    history: body.history ?? null,
    photoObjectId: body.photoObjectId ?? null,
    isActive: body.isActive,
  });
  return ok(c, { id }, 201);
});

personRoutes.get('/:id', requireAuth, requirePermission('persons.read'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const db = c.env.DB;
  const person = await personsRepo.findPersonById(db, id);
  if (!person) throw AppError.notFound('Persona no encontrada.');
  const [positions, pending] = await Promise.all([
    personsRepo.listPositions(db, id),
    assignmentsRepo.listPendingLinesForPerson(db, id),
  ]);
  return ok(c, { person, positions, assignments: pending });
});

/**
 * Ficha imprimible del integrante: datos, notas, cargos y el material que tiene
 * **pendiente de devolución**. El PDF lo produce el navegador.
 */
personRoutes.get('/:id/ficha', requireAuth, requirePermission('persons.read'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const db = c.env.DB;

  const [person, positions, assignments, conditions] = await Promise.all([
    personsRepo.findPersonForFicha(db, id),
    personsRepo.listPositionsWithType(db, id),
    assignmentsRepo.listPendingLinesForPerson(db, id),
    catalog.listConditions(db),
  ]);
  if (!person) throw AppError.notFound('Ficha no encontrada.');

  const nameByCode = new Map(conditions.map((row) => [row.code, row.name]));

  return ok(c, {
    institution: await actaInstitution(db),
    person: {
      id: person.id,
      fullName: person.full_name,
      rut: person.rut,
      registryNo: person.registry_no,
      qualityName: person.quality_name,
      phone: person.phone,
      email: person.email,
      address: person.address,
      birthDate: person.birth_date,
      joinDate: person.join_date,
      emergencyName: person.emergency_name,
      emergencyPhone: person.emergency_phone,
      history: person.history,
      photoObjectId: person.photo_object_id,
      isActive: person.is_active === 1,
    },
    positions: positions.map((position) => ({
      id: position.id,
      name: position.type_name ?? position.position_label ?? 'Cargo',
      startDate: position.start_date,
      endDate: position.end_date,
      notes: position.notes,
    })),
    assignments: assignments.map((line) => ({
      code: line.code,
      itemName: line.item_name,
      size: line.size,
      serial: line.serial,
      quantity: line.quantity,
      returnedQty: line.returned_qty,
      conditionName:
        line.condition_out === null ? null : (nameByCode.get(line.condition_out) ?? null),
    })),
    generatedAt: nowIso(),
  });
});

/**
 * Acta de entrega de un `batch_id`.
 *
 * Devuelve la entrega **completa** (incluidas las líneas ya devueltas), no solo
 * lo pendiente: un acta documenta lo que se entregó, no lo que queda. La vista
 * es imprimible y el PDF lo produce el navegador.
 */
personRoutes.get(
  '/:id/batches/:batchId/acta',
  requireAuth,
  requirePermission('persons.read'),
  async (c) => {
    const personId = parseId(c.req.param('id'), 'persona');
    const batchId = c.req.param('batchId');
    if (!batchId) throw AppError.badRequest('Entrega inválida.');
    const db = c.env.DB;

    const [person, assignment, lines, conditions] = await Promise.all([
      personsRepo.findPersonForActa(db, personId),
      assignmentsRepo.findAssignmentByBatch(db, personId, batchId),
      assignmentsRepo.listLinesForBatch(db, personId, batchId),
      catalog.listConditions(db),
    ]);
    if (!person || !assignment) throw AppError.notFound('Acta no encontrada.');

    const nameByCode = new Map(conditions.map((row) => [row.code, row.name]));

    return ok(c, {
      institution: await actaInstitution(db),
      acta: {
        kind: 'entrega',
        batchId: assignment.batch_id,
        deliveredAt: assignment.delivered_at,
        deliveredBy: assignment.delivered_by,
        notes: assignment.notes,
        person: {
          id: person.id,
          fullName: person.full_name,
          rut: person.rut,
          registryNo: person.registry_no,
          qualityName: person.quality_name,
        },
        lines: lines.map((line) => ({
          code: line.code,
          itemName: line.item_name,
          size: line.size,
          serial: line.serial,
          quantity: line.quantity,
          returnedQty: line.returned_qty,
          conditionOut: line.condition_out,
          conditionOutName:
            line.condition_out === null ? null : (nameByCode.get(line.condition_out) ?? null),
        })),
      },
    });
  },
);

personRoutes.put('/:id', requireAuth, requireCsrf, requirePermission('persons.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const body = await readJson(c, personBodySchema);
  const person = await personsRepo.findPersonById(c.env.DB, id);
  if (!person) throw AppError.notFound('Persona no encontrada.');
  if (body.photoObjectId !== undefined && body.photoObjectId !== null) {
    await requireScopedObject(c.env.DB, body.photoObjectId, 'person');
  }
  await personsRepo.updatePerson(c.env.DB, id, {
    fullName: body.fullName,
    rut: body.rut ?? null,
    qualityId: body.qualityId ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    address: body.address ?? null,
    birthDate: body.birthDate ?? null,
    joinDate: body.joinDate ?? null,
    registryNo: body.registryNo ?? null,
    emergencyName: body.emergencyName ?? null,
    emergencyPhone: body.emergencyPhone ?? null,
    history: body.history ?? null,
    photoObjectId: body.photoObjectId ?? null,
    isActive: body.isActive,
  });
  return ok(c, { updated: true });
});

personRoutes.post('/:id/positions', requireAuth, requireCsrf, requirePermission('persons.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const body = await readJson(
    c,
    z.object({
      positionTypeId: z.number().int().positive().nullable().optional(),
      positionLabel: z.string().trim().max(120).nullable().optional(),
      startDate: z.string().trim().max(20).nullable().optional(),
      endDate: z.string().trim().max(20).nullable().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
    }),
  );
  if ((body.positionTypeId ?? null) === null && !(body.positionLabel ?? '').trim()) {
    throw AppError.unprocessable('Indica el cargo (del catálogo o con una etiqueta libre).');
  }
  const person = await personsRepo.findPersonById(c.env.DB, id);
  if (!person) throw AppError.notFound('Persona no encontrada.');
  const positionId = await personsRepo.insertPosition(c.env.DB, {
    personId: id,
    positionTypeId: body.positionTypeId ?? null,
    positionLabel: body.positionLabel ?? null,
    startDate: body.startDate ?? null,
    endDate: body.endDate ?? null,
    notes: body.notes ?? null,
  });
  return ok(c, { id: positionId }, 201);
});

personRoutes.delete('/:id/positions/:positionId', requireAuth, requireCsrf, requirePermission('persons.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const positionId = parseId(c.req.param('positionId'), 'cargo');
  const changes = await personsRepo.archivePosition(c.env.DB, id, positionId);
  if (changes === 0) throw AppError.notFound('Cargo no encontrado.');
  return ok(c, { archived: true });
});

// --- Asignaciones -----------------------------------------------------------

const assignSchema = z.object({
  deliveredBy: z.string().trim().min(1, 'Indica quién entrega.').max(160),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.number().int().positive(),
        unitId: z.number().int().positive().nullable().optional(),
        locationId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(1_000_000),
        conditionOut: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .min(1, 'Agrega al menos un material.'),
});

personRoutes.post('/:id/assignments', requireAuth, requireCsrf, requirePermission('inventory.assign'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const body = await readJson(c, assignSchema);
  const idempotencyKey = c.req.header('idempotency-key') ?? null;
  const userId = c.get('user')?.id ?? null;

  const { replayed, response } = await withIdempotency(
    c.env.DB,
    idempotencyKey,
    'assignment',
    userId,
    () =>
      assignMaterial(
        { DB: c.env.DB },
        {
          personId: id,
          deliveredBy: body.deliveredBy,
          notes: body.notes ?? null,
          lines: body.lines.map((line) => ({
            materialId: line.materialId,
            unitId: line.unitId ?? null,
            locationId: line.locationId,
            quantity: line.quantity,
            conditionOut: line.conditionOut ?? null,
          })),
        },
        actorFrom(c),
      ),
  );

  return ok(c, response, replayed ? 200 : 201);
});

// --- Devoluciones -----------------------------------------------------------

const returnSchema = z.object({
  receivedBy: z.string().trim().min(1, 'Indica quién recibe.').max(160),
  toLocationId: z.number().int().positive(),
  conditionCode: z.enum(CONDITION_CODES),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        assignmentLineId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(1_000_000),
      }),
    )
    .min(1, 'Agrega al menos un material.'),
});

personRoutes.post('/:id/returns', requireAuth, requireCsrf, requirePermission('inventory.return'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const body = await readJson(c, returnSchema);
  const idempotencyKey = c.req.header('idempotency-key') ?? null;
  const userId = c.get('user')?.id ?? null;

  const { replayed, response } = await withIdempotency(
    c.env.DB,
    idempotencyKey,
    'return',
    userId,
    () =>
      returnMaterial(
        { DB: c.env.DB },
        {
          personId: id,
          lines: body.lines,
          toLocationId: body.toLocationId,
          conditionCode: body.conditionCode,
          receivedBy: body.receivedBy,
          notes: body.notes ?? null,
        },
        actorFrom(c),
      ),
  );

  return ok(c, response, replayed ? 200 : 201);
});
