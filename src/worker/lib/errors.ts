/**
 * Errores de aplicación uniformes.
 *
 * Toda la API responde con la misma forma de error, sin filtrar detalles
 * internos ni consultas SQL al cliente.
 */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'too_many_requests'
  | 'unprocessable_entity'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  too_many_requests: 429,
  unprocessable_entity: 422,
  internal_error: 500,
};

export interface FieldIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues?: FieldIssue[];

  constructor(code: ErrorCode, message: string, issues?: FieldIssue[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (issues) this.issues = issues;
  }

  static badRequest(message = 'Solicitud inválida.', issues?: FieldIssue[]) {
    return new AppError('bad_request', message, issues);
  }
  static unauthorized(message = 'Autenticación requerida.') {
    return new AppError('unauthorized', message);
  }
  static forbidden(message = 'No tienes permisos para esta operación.') {
    return new AppError('forbidden', message);
  }
  static notFound(message = 'Recurso no encontrado.') {
    return new AppError('not_found', message);
  }
  static conflict(message = 'La operación entra en conflicto con el estado actual.') {
    return new AppError('conflict', message);
  }
  static unprocessable(message = 'No se pudo procesar la solicitud.', issues?: FieldIssue[]) {
    return new AppError('unprocessable_entity', message, issues);
  }
  static payloadTooLarge(message = 'El contenido supera el tamaño permitido.') {
    return new AppError('payload_too_large', message);
  }
  static tooManyRequests(message = 'Demasiados intentos. Inténtalo más tarde.') {
    return new AppError('too_many_requests', message);
  }
  static internal(message = 'Error interno.') {
    return new AppError('internal_error', message);
  }
}
