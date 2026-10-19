/**
 * Rutas del apartado de postulaciones (panel interno).
 *
 * Leer exige `applicants.read` y gestionar `applicants.write`. La conversión a
 * ficha de integrante exige además `persons.write`, porque crea una persona.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../lib/env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { nowIso } from '../lib/time';
import { readJson } from '../lib/validate';
import { requireAuth, requireCsrf, requirePermission } from '../security/middleware';
import { actorFrom } from '../security/actor';
import { buildWorkbook, XLSX_CONTENT_TYPE } from '../services/xlsx';
import {
  addContact,
  addNote,
  archiveApplicant,
  convertToPerson,
  getApplicantDetail,
  listApplicants,
  setStatus,
  APPLICANT_STATUSES,
} from '../services/applicants';

type AppEnv = { Bindings: Env; Variables: Variables };

export const applicantRoutes = new Hono<AppEnv>();

function parseId(raw: string | undefined): number {
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (!parsed.success) throw AppError.badRequest('Postulación inválida.');
  return parsed.data;
}

applicantRoutes.get('/', requireAuth, requirePermission('applicants.read'), async (c) => {
  const status = (c.req.query('status') ?? '').trim();
  const search = (c.req.query('q') ?? '').trim().slice(0, 120);
  const data = await listApplicants(c.env.DB, {
    status: status.length > 0 ? status : undefined,
    search: search.length > 0 ? search : undefined,
  });
  return ok(c, data);
});

/** Exportación a Excel de las postulaciones visibles. */
applicantRoutes.get('/export.xlsx', requireAuth, requirePermission('applicants.read'), async (c) => {
  const status = (c.req.query('status') ?? '').trim();
  const data = await listApplicants(c.env.DB, { status: status.length > 0 ? status : undefined });

  const rows: (string | number | null)[][] = [
    [
      'nombre_completo',
      'rut',
      'nacimiento',
      'correo',
      'telefono',
      'comuna',
      'direccion',
      'disponibilidad',
      'estado',
      'recibida',
      'motivacion',
    ],
    ...data.applicants.map((applicant) => [
      applicant.fullName,
      applicant.rut,
      applicant.birthDate,
      applicant.email,
      applicant.phone,
      applicant.commune,
      applicant.address,
      applicant.availability,
      applicant.status,
      applicant.createdAt,
      applicant.motivation,
    ]),
  ];

  const bytes = buildWorkbook([{ name: 'Postulantes', rows }]);
  c.header('content-type', XLSX_CONTENT_TYPE);
  c.header(
    'content-disposition',
    `attachment; filename="postulantes-${nowIso().slice(0, 10)}.xlsx"`,
  );
  c.header('content-length', String(bytes.byteLength));
  return c.body(bytes, 200);
});

applicantRoutes.get('/:id', requireAuth, requirePermission('applicants.read'), async (c) => {
  const id = parseId(c.req.param('id'));
  return ok(c, await getApplicantDetail(c.env.DB, id));
});

applicantRoutes.put('/:id/status', requireAuth, requireCsrf, requirePermission('applicants.write'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await readJson(
    c,
    z.object({ status: z.enum(APPLICANT_STATUSES) }),
  );
  await setStatus(c.env.DB, id, body.status, actorFrom(c));
  return ok(c, { updated: true });
});

applicantRoutes.post('/:id/notes', requireAuth, requireCsrf, requirePermission('applicants.write'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await readJson(c, z.object({ body: z.string().trim().min(1, 'La nota no puede estar vacía.').max(2000) }));
  const noteId = await addNote(c.env.DB, id, body.body, actorFrom(c));
  return ok(c, { id: noteId }, 201);
});

applicantRoutes.post('/:id/contacts', requireAuth, requireCsrf, requirePermission('applicants.write'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await readJson(
    c,
    z.object({
      channel: z.enum(['telefono', 'whatsapp', 'presencial', 'otro']),
      summary: z.string().trim().min(1, 'Describe el contacto.').max(1000),
      contactedAt: z.string().trim().max(40).nullable().optional(),
    }),
  );
  const contactId = await addContact(
    c.env.DB,
    id,
    { channel: body.channel, summary: body.summary, contactedAt: body.contactedAt ?? undefined },
    actorFrom(c),
  );
  return ok(c, { id: contactId }, 201);
});

applicantRoutes.post(
  '/:id/convert',
  requireAuth,
  requireCsrf,
  requirePermission('applicants.write'),
  requirePermission('persons.write'),
  async (c) => {
    const id = parseId(c.req.param('id'));
    const result = await convertToPerson(c.env.DB, id, actorFrom(c));
    return ok(c, result, 201);
  },
);

applicantRoutes.delete('/:id', requireAuth, requireCsrf, requirePermission('applicants.write'), async (c) => {
  const id = parseId(c.req.param('id'));
  await archiveApplicant(c.env.DB, id, actorFrom(c));
  return ok(c, { archived: true });
});
