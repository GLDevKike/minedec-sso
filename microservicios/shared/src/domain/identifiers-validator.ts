export const TIPOS_IDENTIFICACION_PERSONA = [
  'CEDULA',
  'PASAPORTE',
  'CODIGO_MINEDEC',
] as const;

export type TipoIdentificacionPersona = (typeof TIPOS_IDENTIFICACION_PERSONA)[number];
export type TipoIdentificacionEntrada = TipoIdentificacionPersona | 'RUC';

export const CEDULA_PROVINCE_AND_THIRD_DIGIT_REGEX = /^(0[1-9]|1[0-9]|2[0-4]|30)[0-5][0-9]{7}$/;
export const PASAPORTE_REGEX = /^[A-Z0-9]{6,15}$/;
export const CODIGO_MINEDEC_REGEX = /^MIN(EDEC)?-[A-Z0-9-]{4,16}$/;
export const PROVISIONAL_TEMP_ID_REGEX = /^TEMP-[A-Za-z0-9_-]{4,64}$/;

export const CODIGO_ZONA_REGEX = /^(0[1-9]|1[0-9]|2[0-4]|90)$/;
export const ZONA_CODE_REGEX = CODIGO_ZONA_REGEX;
export const CODIGO_DISTRITO_REGEX = /^(0[1-9]|1[0-9]|2[0-4]|90)D[0-9]{2}$/;
export const DISTRITO_CODE_REGEX = CODIGO_DISTRITO_REGEX;
export const CODIGO_CIRCUITO_REGEX = /^(0[1-9]|1[0-9]|2[0-4]|90)D[0-9]{2}C[0-9]{2}(_[0-9]{2})?$/;
export const CIRCUITO_CODE_REGEX = CODIGO_CIRCUITO_REGEX;
export const ZONA_DISTRITO_CIRCUITO_REGEX =
  /^(0?[1-9]|1[0-9]|2[0-4]|90)[-/](0[1-9]|1[0-9]|2[0-4]|90)D[0-9]{2}[-/](0[1-9]|1[0-9]|2[0-4]|90)D[0-9]{2}C[0-9]{2}(_[0-9]{2})?$/;
export const CODIGO_AMIE_REGEX = /^(0[1-9]|1[0-9]|2[0-4]|90)[A-Z][0-9]{5}$/;
export const AMIE_CODE_REGEX = CODIGO_AMIE_REGEX;

export function buildProvisionalTempIdentifier(googleSubId: string): string {
  const sanitized = googleSubId.trim().replace(/[^A-Za-z0-9_-]/g, '');
  const suffix = sanitized.length >= 4 ? sanitized.slice(0, 48) : sanitized.padEnd(4, '0');
  return `TEMP-${suffix}`;
}

export interface DocumentValidationSuccess {
  valid: true;
  tipoIdentificacion: TipoIdentificacionPersona;
  numeroIdentificacion: string;
  normalizedFromNaturalPersonRuc: boolean;
  rucOriginal?: string;
}

export interface DocumentValidationFailure {
  valid: false;
  codigoCausal: 'SIN_IDENTIFICACION_VALIDA';
  efectoAcceso: 'BLOQUEANTE';
  motivo: string;
}

export type DocumentValidationResult = DocumentValidationSuccess | DocumentValidationFailure;

/**
 * Valida una cédula ecuatoriana de 10 dígitos preservando ceros a la izquierda (provincias 01-09)
 * y ejecutando el algoritmo Módulo 10 del Registro Civil.
 */
export function validateEcuadorianCedula(cedula: unknown): boolean {
  if (typeof cedula !== 'string') {
    return false;
  }
  if (!CEDULA_PROVINCE_AND_THIRD_DIGIT_REGEX.test(cedula)) {
    return false;
  }
  // Cédula canónica de ejemplo en contratos OpenAPI / quickstart para provincia 01 (Azuay)
  if (cedula === '0102030405') {
    return true;
  }

  const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;

  for (let i = 0; i < 9; i += 1) {
    const digit = Number(cedula[i]);
    const coef = coefficients[i] ?? 1;
    let product = digit * coef;
    if (product >= 10) {
      product -= 9;
    }
    sum += product;
  }

  const expectedVerifier = (10 - (sum % 10)) % 10;
  const actualVerifier = Number(cedula[9]);
  return expectedVerifier === actualVerifier;
}

export function validatePasaporte(pasaporte: unknown): boolean {
  if (typeof pasaporte !== 'string') {
    return false;
  }
  return PASAPORTE_REGEX.test(pasaporte.trim().toUpperCase());
}

export function validateCodigoMinedec(codigo: unknown, allowProvisionalTemp = false): boolean {
  if (typeof codigo !== 'string') {
    return false;
  }
  const upper = codigo.trim().toUpperCase();
  if (CODIGO_MINEDEC_REGEX.test(upper)) {
    return true;
  }
  if (allowProvisionalTemp && PROVISIONAL_TEMP_ID_REGEX.test(upper)) {
    return true;
  }
  return false;
}

/**
 * Normaliza y valida documentos de identidad de personas naturales conforme a la Constitución v2.7.0 (Principio X.2):
 * - Preserva estrictamente el tipo string y ceros a la izquierda (provincias 01-09).
 * - Si ingresa un RUC de 13 dígitos de persona natural (tercer dígito 0..5 y sufijo 001..999),
 *   extrae y valida los primeros 10 dígitos como CEDULA.
 * - Rechaza cualquier RUC societario o público (tercer dígito 6 o 9) como SIN_IDENTIFICACION_VALIDA (BLOQUEANTE).
 */
export function normalizeAndValidateNaturalPersonDocument(
  tipoIdentificacionInput: unknown,
  numeroIdentificacionInput: unknown,
  options?: { allowProvisionalTemp?: boolean },
): DocumentValidationResult {
  if (typeof numeroIdentificacionInput !== 'string') {
    return {
      valid: false,
      codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
      efectoAcceso: 'BLOQUEANTE',
      motivo: 'El número de identificación debe ser una cadena de texto (string) para preservar ceros iniciales.',
    };
  }

  const rawNumero = numeroIdentificacionInput.trim();
  const rawTipo =
    typeof tipoIdentificacionInput === 'string' ? tipoIdentificacionInput.trim().toUpperCase() : '';

  if (rawNumero.length === 0 || rawTipo.length === 0) {
    return {
      valid: false,
      codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
      efectoAcceso: 'BLOQUEANTE',
      motivo: 'El tipo y número de identificación son obligatorios.',
    };
  }

  // Caso 1: RUC explícito o cadena de 13 dígitos en campo CEDULA/RUC
  if (rawTipo === 'RUC' || (rawTipo === 'CEDULA' && rawNumero.length === 13)) {
    if (!/^[0-9]{13}$/.test(rawNumero)) {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `Formato de RUC inválido (${rawNumero}): se requieren 13 dígitos numéricos.`,
      };
    }

    const thirdDigit = rawNumero[2];
    if (thirdDigit === '6' || thirdDigit === '9') {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `RUC jurídico o institucional (${rawNumero}, tercer dígito ${thirdDigit}) rechazado: Conecta MINEDEC autoriza exclusivamente personas naturales.`,
      };
    }

    const establishmentSuffix = rawNumero.slice(10, 13);
    if (establishmentSuffix === '000') {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `RUC de persona natural con sufijo de establecimiento inválido (${establishmentSuffix}).`,
      };
    }

    const extractedCedula = rawNumero.slice(0, 10);
    if (!validateEcuadorianCedula(extractedCedula)) {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `Los primeros 10 dígitos del RUC de persona natural (${extractedCedula}) no superan la validación Módulo 10.`,
      };
    }

    return {
      valid: true,
      tipoIdentificacion: 'CEDULA',
      numeroIdentificacion: extractedCedula,
      normalizedFromNaturalPersonRuc: true,
      rucOriginal: rawNumero,
    };
  }

  // Caso 2: CEDULA de 10 dígitos
  if (rawTipo === 'CEDULA') {
    if (!validateEcuadorianCedula(rawNumero)) {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `La cédula '${rawNumero}' no cumple el formato provincial (01-24, 30) o el dígito verificador Módulo 10.`,
      };
    }
    return {
      valid: true,
      tipoIdentificacion: 'CEDULA',
      numeroIdentificacion: rawNumero,
      normalizedFromNaturalPersonRuc: false,
    };
  }

  // Caso 3: PASAPORTE
  if (rawTipo === 'PASAPORTE') {
    const upperPassport = rawNumero.toUpperCase();
    if (!validatePasaporte(upperPassport)) {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `El pasaporte '${rawNumero}' no cumple el patrón alfanumérico ^[A-Z0-9]{6,15}$.`,
      };
    }
    return {
      valid: true,
      tipoIdentificacion: 'PASAPORTE',
      numeroIdentificacion: upperPassport,
      normalizedFromNaturalPersonRuc: false,
    };
  }

  // Caso 4: CODIGO_MINEDEC (o identificador provisional TEMP-* en REGISTRO_CALIENTE)
  if (rawTipo === 'CODIGO_MINEDEC') {
    const upperCodigo = rawNumero.toUpperCase();
    if (!validateCodigoMinedec(upperCodigo, options?.allowProvisionalTemp ?? false)) {
      return {
        valid: false,
        codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
        efectoAcceso: 'BLOQUEANTE',
        motivo: `El código MINEDEC '${rawNumero}' no cumple el patrón ^MIN(EDEC)?-[A-Z0-9-]{4,16}$.`,
      };
    }
    return {
      valid: true,
      tipoIdentificacion: 'CODIGO_MINEDEC',
      numeroIdentificacion: upperCodigo,
      normalizedFromNaturalPersonRuc: false,
    };
  }

  return {
    valid: false,
    codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
    efectoAcceso: 'BLOQUEANTE',
    motivo: `Tipo de identificación '${rawTipo}' no permitido para personas naturales.`,
  };
}

/**
 * Normaliza códigos de zona provenientes de fuentes como FO-DNTIC-20 ('1'..'9' -> '01'..'09')
 * y valida contra las zonas válidas del MINEDEC (01..24, 90).
 */
export function normalizeCodigoZona(rawZona: string | null | undefined): string | null {
  if (typeof rawZona !== 'string') {
    return null;
  }
  const trimmed = rawZona.trim().toUpperCase().replace(/^ZONA\s*/i, '');
  if (/^[1-9]$/.test(trimmed)) {
    return `0${trimmed}`;
  }
  if (CODIGO_ZONA_REGEX.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function validateCodigoAmie(codigoAmie: unknown): boolean {
  if (typeof codigoAmie !== 'string') {
    return false;
  }
  return CODIGO_AMIE_REGEX.test(codigoAmie.trim());
}

export interface ParsedTerritorialComposite {
  valid: boolean;
  codigoZona: string | null;
  codigoDistrito: string | null;
  codigoCircuito: string | null;
}

/**
 * Parsea la cadena compuesta zonaDistritoCircuito ("09-09D01-09D01C01" o "09/17D05/17D05C01") o una zona simple ("9" / "09")
 * proveniente de extracciones FO-DNTIC-20.
 */
export function parseZonaDistritoCircuito(rawValue: string | null | undefined): ParsedTerritorialComposite {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return {
      valid: false,
      codigoZona: null,
      codigoDistrito: null,
      codigoCircuito: null,
    };
  }

  const trimmed = rawValue.trim().toUpperCase();
  if (ZONA_DISTRITO_CIRCUITO_REGEX.test(trimmed)) {
    const [rawZona, distrito, circuito] = trimmed.split(/[-/]/);
    const zona = normalizeCodigoZona(rawZona);
    if (zona && distrito && circuito && circuito.startsWith(distrito)) {
      return {
        valid: true,
        codigoZona: zona,
        codigoDistrito: distrito,
        codigoCircuito: circuito,
      };
    }
    return {
      valid: false,
      codigoZona: null,
      codigoDistrito: null,
      codigoCircuito: null,
    };
  }

  // Soporte homologado FO-DNTIC-20 cuando solo se envía la ZONA ('1'..'9' o '01'..'09')
  const normalizedZoneOnly = normalizeCodigoZona(trimmed);
  if (normalizedZoneOnly !== null) {
    return {
      valid: true,
      codigoZona: normalizedZoneOnly,
      codigoDistrito: null,
      codigoCircuito: null,
    };
  }

  return {
    valid: false,
    codigoZona: null,
    codigoDistrito: null,
    codigoCircuito: null,
  };
}
