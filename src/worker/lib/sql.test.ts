import { describe, expect, it } from 'vitest';
import {
  errorMessage,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from './sql';

describe('sql — interpretación de errores de D1/SQLite', () => {
  it('reconoce una violación de CHECK', () => {
    const error = new Error('D1_ERROR: CHECK constraint failed: quantity >= 0');
    expect(isCheckViolation(error)).toBe(true);
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('reconoce una violación de UNIQUE', () => {
    const error = new Error('D1_ERROR: UNIQUE constraint failed: materials.code');
    expect(isUniqueViolation(error)).toBe(true);
    expect(isCheckViolation(error)).toBe(false);
  });

  it('reconoce una violación de clave foránea', () => {
    const error = new Error('FOREIGN KEY constraint failed');
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it('no confunde errores no relacionados', () => {
    const error = new Error('no such table: materials');
    expect(isCheckViolation(error)).toBe(false);
    expect(isUniqueViolation(error)).toBe(false);
    expect(isForeignKeyViolation(error)).toBe(false);
  });

  it('tolera valores que no son Error', () => {
    expect(errorMessage('texto plano')).toBe('texto plano');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(isCheckViolation(null)).toBe(false);
  });
});
