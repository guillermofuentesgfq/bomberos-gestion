import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { readJson } from '../lib/validate';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import { CONDITION_CODES } from '../../shared/inventory';
import * as personsRepo from '../repositories/persons';
import * as assignmentsRepo from '../repositories/assignments';
import { assignMaterial, returnMaterial } from '../services/assignments';
import {
  inFlightError,
  reserveIdempotency,
  saveIdempotencyResponse,
} from '../services/idempotency';

type AppEnv = { Bindings: Env; Variables: Variables };

export const personRoutes = new Hono<AppEnv>();

const idParam = z.coerce.number().int().positive();

function parseId(raw: string | undefined, label = 'identificador'): number {
  const parsed = idParam.safeParse(raw);
  if (!parsed.success) throw AppError.badRequest(`${label} inválido.`);
  return parsed.data;
}

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
  history: z.string().trim().max(4000).nullable().optional(),
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

// --- Personas ---------------------------------------------------------------

personRoutes.get('/', requireAuth, requirePermission('persons.read'), async (c) => {
  const search = c.req.query('q')?.trim();
  const people = await personsRepo.listPersons(c.env.DB, search || undefined);
  return ok(c, people);
});

personRoutes.post('/', requireAuth, requireCsrf, requirePermission('persons.write'), async (c) => {
  const body = await readJson(c, personBodySchema);
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

personRoutes.put('/:id', requireAuth, requireCsrf, requirePermission('persons.write'), async (c) => {
  const id = parseId(c.req.param('id'), 'persona');
  const body = await readJson(c, personBodySchema);
  const person = await personsRepo.findPersonById(c.env.DB, id);
  if (!person) throw AppError.notFound('Persona no encontrada.');
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
  const idempotencyKey = c.req.header('idempotency-key');

  if (idempotencyKey) {
    const reservation = await reserveIdempotency(c.env.DB, {
      key: idempotencyKey,
      scope: 'assignment',
      userId: c.get('user')?.id ?? null,
    });
    if (reservation.status === 'replay') return ok(c, JSON.parse(reservation.response));
    if (reservation.status === 'in_flight') throw inFlightError();
  }

  const result = await assignMaterial(
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
  );

  if (idempotencyKey) {
    await saveIdempotencyResponse(c.env.DB, idempotencyKey, 'assignment', result);
  }
  return ok(c, result, 201);
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
  const idempotencyKey = c.req.header('idempotency-key');

  if (idempotencyKey) {
    const reservation = await reserveIdempotency(c.env.DB, {
      key: idempotencyKey,
      scope: 'return',
      userId: c.get('user')?.id ?? null,
    });
    if (reservation.status === 'replay') return ok(c, JSON.parse(reservation.response));
    if (reservation.status === 'in_flight') throw inFlightError();
  }

  const result = await returnMaterial(
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
  );

  if (idempotencyKey) {
    await saveIdempotencyResponse(c.env.DB, idempotencyKey, 'return', result);
  }
  return ok(c, result, 201);
});
