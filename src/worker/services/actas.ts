import { richTextToPlain } from '../lib/richtext';
import { getInstitutionConfig } from './cms';

/**
 * Membrete que encabeza un acta. Es un subconjunto de la configuración
 * institucional: solo lo que tiene sentido en un documento formal.
 */
export interface ActaInstitution {
  name: string;
  number: string;
  address: string;
  commune: string;
  region: string;
  country: string;
  emergencyNumber: string;
  phones: string[];
  shieldObjectId: number | null;
  logoObjectId: number | null;
  corpsInfo: string;
}

/**
 * Datos de la institución para el encabezado de un acta.
 *
 * `corpsInfo` se entrega como **texto plano**: el campo se escribe con el
 * editor enriquecido, y un acta impresa no debe llevar etiquetas ni formato
 * heredado del editor.
 */
export async function actaInstitution(db: D1Database): Promise<ActaInstitution> {
  const config = await getInstitutionConfig(db);
  return {
    name: config.name,
    number: config.number,
    address: config.address,
    commune: config.commune,
    region: config.region,
    country: config.country,
    emergencyNumber: config.emergencyNumber,
    phones: config.phones,
    shieldObjectId: config.shieldObjectId,
    logoObjectId: config.logoObjectId,
    corpsInfo: richTextToPlain(config.corpsInfo),
  };
}
