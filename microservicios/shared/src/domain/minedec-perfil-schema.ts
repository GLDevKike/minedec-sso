import { z } from 'zod';
import {
  normalizeAndValidateNaturalPersonDocument,
  parseZonaDistritoCircuito,
  TIPOS_IDENTIFICACION_PERSONA,
  TipoIdentificacionPersona,
  validateCodigoAmie,
  validateEcuadorianCedula,
} from './identifiers-validator';

export type TipoUsuarioPoblacion = 'ESTUDIANTE' | 'DOCENTE' | 'ADMINISTRATIVO' | 'EXTERNO';

export const NIVELES_ESTRUCTURA_ORGANIZACIONAL = [
  'PLANTA_CENTRAL',
  'ZONA',
  'DISTRITO',
  'CIRCUITO',
  'INSTITUCION_EDUCATIVA',
] as const;

export type NivelEstructuraOrganizacional =
  (typeof NIVELES_ESTRUCTURA_ORGANIZACIONAL)[number];

export const CODIGOS_CAUSAL_ANOMALIA = [
  'SIN_IDENTIFICACION_VALIDA',
  'COLISION_IDENTIFICADOR',
  'VIGENCIA_INVALIDA',
  'ATRIBUTO_OBLIGATORIO_FALTANTE',
  'FORMATO_AMIE_INVALIDO',
] as const;

export type CodigoCausalAnomalia = (typeof CODIGOS_CAUSAL_ANOMALIA)[number];

export type EfectoAccesoAnomalia = 'BLOQUEANTE' | 'RESTRINGIDA';

export const DEFAULT_GRADO_CURSO_DERIVATION_MAP: Readonly<Record<string, string>> = {
  INICIAL_1: 'INICIAL',
  INICIAL_2: 'INICIAL',
  EGB_1: 'EGB_PREPARATORIA',
  '1EGB': 'EGB_PREPARATORIA',
  EGB_2: 'EGB_ELEMENTAL',
  '2EGB': 'EGB_ELEMENTAL',
  EGB_3: 'EGB_ELEMENTAL',
  '3EGB': 'EGB_ELEMENTAL',
  EGB_4: 'EGB_ELEMENTAL',
  '4EGB': 'EGB_ELEMENTAL',
  EGB_5: 'EGB_MEDIA',
  '5EGB': 'EGB_MEDIA',
  EGB_6: 'EGB_MEDIA',
  '6EGB': 'EGB_MEDIA',
  EGB_7: 'EGB_MEDIA',
  '7EGB': 'EGB_MEDIA',
  EGB_8: 'EGB_SUPERIOR',
  '8EGB': 'EGB_SUPERIOR',
  EGB_9: 'EGB_SUPERIOR',
  '9EGB': 'EGB_SUPERIOR',
  EGB_10: 'EGB_SUPERIOR',
  '10EGB': 'EGB_SUPERIOR',
  BGU_1: 'BGU',
  '1BGU': 'BGU',
  BGU_2: 'BGU',
  '2BGU': 'BGU',
  BGU_3: 'BGU',
  '3BGU': 'BGU',
  BT_3: 'BGU',
  SUPERIOR_1: 'EDUCACION_SUPERIOR',
  SUPERIOR_2: 'EDUCACION_SUPERIOR',
  SUPERIOR_3: 'EDUCACION_SUPERIOR',
  SIN_NIVEL: 'NO_APLICA',
};

export const DEFAULT_TEMPORAL_SUBTIPOS: ReadonlySet<string> = new Set([
  'BECARIO',
  'DEVENGANTE',
  'CONTRATO_OCASIONAL',
  'NOMBRAMIENTO_PROVISIONAL',
  'HONORARIOS_PROFESIONALES',
  'PASANTE',
  'CONSULTOR',
  'CONTRATISTA',
  'REPRESENTANTE_LEGAL',
  'PROVEEDOR',
  'AUDITOR_EXTERNO',
  'COOPERANTE',
]);

export const MinedecPerfilInputSchema = z.object({
  idInterno: z.string().uuid().nullable().optional(),
  tipoIdentificacion: z.string().min(1).optional(),
  numeroIdentificacion: z.string().min(1).optional(),
  fechaNacimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaNacimiento debe tener formato ISO YYYY-MM-DD')
    .nullable()
    .optional(),
  tipoUsuario: z.string().min(1).optional(),
  subtipoUsuario: z.string().min(1).optional(),
  cargoFuncion: z.string().nullable().optional(),
  nivelEstructura: z.string().min(1).optional(),
  zonaDistritoCircuito: z.string().nullable().optional(),
  viceministerio: z.string().nullable().optional(),
  codigoInstitucion: z.string().nullable().optional(),
  codigoDependenciaAdmin: z.string().nullable().optional(),
  regimenEscolar: z.string().nullable().optional(),
  nivelAcademico: z.string().nullable().optional(),
  gradoCurso: z.string().nullable().optional(),
  modalidadEducativa: z.string().nullable().optional(),
  jornada: z.string().nullable().optional(),
  docenteMultisede: z.boolean().nullable().optional(),
  representanteLegalCedula: z.string().nullable().optional(),
  fechaInicioVigencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaInicioVigencia debe tener formato ISO YYYY-MM-DD')
    .nullable()
    .optional(),
  fechaFinVigencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaFinVigencia debe tener formato ISO YYYY-MM-DD')
    .nullable()
    .optional(),
});

export type MinedecPerfilInput = z.infer<typeof MinedecPerfilInputSchema>;

export const UpsertWorkspaceAccountRequestSchema = z.object({
  googleSubId: z.string().min(1),
  emailPrincipal: z.string().email(),
  givenName: z.string().nullable().optional(),
  familyName: z.string().nullable().optional(),
  nombreCompleto: z.string().min(1),
  orgUnitPath: z.string().min(1),
  suspendedEnGws: z.boolean(),
  deletedEnGws: z.boolean().optional(),
  hashPayloadGws: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'hashPayloadGws debe ser un digest SHA-256 hexadecimal de 64 caracteres')
    .nullable()
    .optional(),
  forceUpsert: z.boolean().optional(),
  skipIfHashUnchanged: z.boolean().optional(),
  captureCedulaMutationAsAnomaly: z.boolean().optional(),
  origenSincronizacion: z.enum([
    'EVENTO_AUDIT_LOG',
    'BARRIDO_DELTA_2MIN',
    'CONCILIACION_BATCH',
    'CONCILIACION_DIARIA',
    'REGISTRO_CALIENTE_PRIORITARIO',
  ]),
  minedecPerfil: MinedecPerfilInputSchema.optional(),
});

export type UpsertWorkspaceAccountInput = z.infer<typeof UpsertWorkspaceAccountRequestSchema>;

export const ResolveIdentityRequestSchema = z.object({
  googleSubId: z.string().trim().min(1),
  emailPrincipal: z.string().trim().email(),
  nombreCompleto: z.string().trim().min(1),
  idInterno: z.string().uuid().nullable().optional(),
  tipoIdentificacion: z.enum(TIPOS_IDENTIFICACION_PERSONA).nullable().optional(),
  numeroIdentificacion: z.string().trim().min(1).nullable().optional(),
});

export interface TemporalValidityEvaluation {
  validRange: boolean;
  isExpired: boolean;
}

export function evaluateTemporalValidity(
  fechaInicioVigencia: string | null | undefined,
  fechaFinVigencia: string | null | undefined,
  referenceDate: Date = new Date(),
): TemporalValidityEvaluation {
  const start = fechaInicioVigencia?.trim() || null;
  const end = fechaFinVigencia?.trim() || null;
  const refIso = referenceDate.toISOString().slice(0, 10);

  if (start && end && end < start) {
    return { validRange: false, isExpired: false };
  }
  if (end && end < refIso) {
    return { validRange: true, isExpired: true };
  }
  return { validRange: true, isExpired: false };
}

export interface DetectedProfileAnomaly {
  codigoCausal:
    | 'SIN_IDENTIFICACION_VALIDA'
    | 'COLISION_IDENTIFICADOR'
    | 'VIGENCIA_INVALIDA'
    | 'ATRIBUTO_OBLIGATORIO_FALTANTE'
    | 'FORMATO_AMIE_INVALIDO';
  efectoAcceso: EfectoAccesoAnomalia;
  detalleTecnico: string;
  atributosFaltantes?: string[];
}

export interface ProfileMatrixEvaluationResult {
  validDocument: boolean;
  tipoIdentificacionNormalizado: TipoIdentificacionPersona | null;
  numeroIdentificacionNormalizado: string | null;
  normalizedFromNaturalPersonRuc: boolean;
  nivelAcademicoDerivado: string | null;
  nivelAcademicoSobrescritoPorGradoCurso: boolean;
  esMenorDeEdad: boolean;
  requiereRepresentanteLegal: boolean;
  vigenciaExpirada: boolean;
  anomaliasDetectadas: DetectedProfileAnomaly[];
  efectoAccesoResultante: 'COMPLETO' | 'RESTRINGIDA_SOLO_AUTENTICADA' | 'BLOQUEADO';
}

export function calculateAgeInYears(fechaNacimientoIso: string, referenceDate: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimientoIso)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = fechaNacimientoIso.split('-');
  const birthYear = Number(yearStr);
  const birthMonth = Number(monthStr);
  const birthDay = Number(dayStr);
  if (!Number.isInteger(birthYear) || !Number.isInteger(birthMonth) || !Number.isInteger(birthDay)) {
    return null;
  }

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth() + 1;
  const refDay = referenceDate.getUTCDate();

  let age = refYear - birthYear;
  if (refMonth < birthMonth || (refMonth === birthMonth && refDay < birthDay)) {
    age -= 1;
  }
  return age;
}

export function deriveNivelAcademicoFromGradoCurso(
  gradoCurso: string | null | undefined,
  customDerivationMap?: Readonly<Record<string, string>>,
): string | null {
  if (typeof gradoCurso !== 'string' || gradoCurso.trim().length === 0) {
    return null;
  }
  const normalizedGrado = gradoCurso.trim().toUpperCase();
  const map = customDerivationMap ?? DEFAULT_GRADO_CURSO_DERIVATION_MAP;
  return map[normalizedGrado] ?? null;
}

export interface ValidateMinedecPerfilOptions {
  referenceDate?: Date;
  gradoCursoDerivationMap?: Readonly<Record<string, string>>;
  temporalSubtiposSet?: ReadonlySet<string>;
}

/**
 * Evalúa la matriz de obligatoriedad de los 21 atributos por población (ESTUDIANTE, DOCENTE,
 * ADMINISTRATIVO, EXTERNO), derivación determinística gradoCurso -> nivelAcademico,
 * regla de minoría de edad (< 18 años) con prelación de fechaNacimiento sobre catálogo,
 * y vigencias temporales.
 */
export function evaluateMinedecPerfilMatrix(
  perfilInput: MinedecPerfilInput | undefined,
  options?: ValidateMinedecPerfilOptions,
): ProfileMatrixEvaluationResult {
  const referenceDate = options?.referenceDate ?? new Date();
  const refDateIso = referenceDate.toISOString().slice(0, 10);
  const temporalSubtipos = options?.temporalSubtiposSet ?? DEFAULT_TEMPORAL_SUBTIPOS;

  const anomalias: DetectedProfileAnomaly[] = [];
  const p = perfilInput ?? {};

  // 1. Validar documento de identidad de persona natural
  const docResult = normalizeAndValidateNaturalPersonDocument(
    p.tipoIdentificacion,
    p.numeroIdentificacion,
  );

  let tipoIdentificacionNormalizado: TipoIdentificacionPersona | null = null;
  let numeroIdentificacionNormalizado: string | null = null;
  let normalizedFromNaturalPersonRuc = false;

  if (!docResult.valid) {
    anomalias.push({
      codigoCausal: 'SIN_IDENTIFICACION_VALIDA',
      efectoAcceso: 'BLOQUEANTE',
      detalleTecnico: docResult.motivo,
    });
  } else {
    tipoIdentificacionNormalizado = docResult.tipoIdentificacion;
    numeroIdentificacionNormalizado = docResult.numeroIdentificacion;
    normalizedFromNaturalPersonRuc = docResult.normalizedFromNaturalPersonRuc;
  }

  // 2. Derivación determinística de nivelAcademico a partir de gradoCurso (fuente maestra única)
  const derivedNivel = deriveNivelAcademicoFromGradoCurso(
    p.gradoCurso,
    options?.gradoCursoDerivationMap,
  );
  const nivelAcademicoEfectivo = derivedNivel ?? (p.nivelAcademico ? p.nivelAcademico.trim().toUpperCase() : null);
  const nivelAcademicoSobrescritoPorGradoCurso =
    derivedNivel !== null &&
    typeof p.nivelAcademico === 'string' &&
    p.nivelAcademico.trim().length > 0 &&
    p.nivelAcademico.trim().toUpperCase() !== derivedNivel;

  // 3. Evaluación de minoría de edad y obligatoriedad de representanteLegalCedula
  const tipoUsuario = p.tipoUsuario?.trim().toUpperCase() ?? '';
  const subtipoUsuario = p.subtipoUsuario?.trim().toUpperCase() ?? '';
  const nivelEstructura = p.nivelEstructura?.trim().toUpperCase() ?? '';

  let esMenorDeEdad = false;
  let requiereRepresentanteLegal = false;

  if (tipoUsuario === 'ESTUDIANTE') {
    if (p.fechaNacimiento) {
      const calculatedAge = calculateAgeInYears(p.fechaNacimiento, referenceDate);
      if (calculatedAge !== null) {
        esMenorDeEdad = calculatedAge < 18;
        requiereRepresentanteLegal = esMenorDeEdad;
      }
    } else {
      // Fallback por catálogo cuando fechaNacimiento no está informada (FR-006)
      const isAdultExemptSubtype =
        subtipoUsuario === 'EDUCACION_INCONCLUSA' || subtipoUsuario === 'ADULTOS_FPC';
      const isHigherOrNoLevel =
        nivelAcademicoEfectivo === 'EDUCACION_SUPERIOR' || nivelAcademicoEfectivo === 'NO_APLICA';
      esMenorDeEdad =
        !isAdultExemptSubtype &&
        !isHigherOrNoLevel &&
        (subtipoUsuario === 'REGULAR' ||
          subtipoUsuario === 'NEE' ||
          nivelAcademicoEfectivo !== null);
      requiereRepresentanteLegal = esMenorDeEdad;
    }
  }

  // 4. Validación de vigencias temporales (VIGENCIA_INVALIDA -> BLOQUEANTE)
  const requiresTemporalDates =
    tipoUsuario === 'EXTERNO' || temporalSubtipos.has(subtipoUsuario);
  const fechaInicio = p.fechaInicioVigencia?.trim() || null;
  const fechaFin = p.fechaFinVigencia?.trim() || null;

  let vigenciaExpirada = false;

  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    anomalias.push({
      codigoCausal: 'VIGENCIA_INVALIDA',
      efectoAcceso: 'BLOQUEANTE',
      detalleTecnico: `Rango de vigencia incoherente: fechaFinVigencia (${fechaFin}) es anterior a fechaInicioVigencia (${fechaInicio}).`,
    });
  } else if (requiresTemporalDates && (!fechaInicio || !fechaFin)) {
    anomalias.push({
      codigoCausal: 'VIGENCIA_INVALIDA',
      efectoAcceso: 'BLOQUEANTE',
      detalleTecnico: `El perfil con tipoUsuario='${tipoUsuario}' y subtipoUsuario='${subtipoUsuario}' exige fechaInicioVigencia y fechaFinVigencia obligatorias.`,
    });
  }

  if (fechaFin && fechaFin < refDateIso) {
    vigenciaExpirada = true;
  }

  // 5. Matriz de obligatoriedad de atributos por población (FR-006)
  const missingAttributes: string[] = [];

  if (!tipoUsuario) {
    missingAttributes.push('tipoUsuario');
  }
  if (!subtipoUsuario) {
    missingAttributes.push('subtipoUsuario');
  }

  const checkAmieAttribute = (amieVal: string | null | undefined, requiredForRole: boolean): void => {
    const trimmedAmie = amieVal?.trim() || '';
    if (!trimmedAmie) {
      if (requiredForRole) {
        missingAttributes.push('codigoInstitucion');
      }
      return;
    }
    if (!validateCodigoAmie(trimmedAmie)) {
      anomalias.push({
        codigoCausal: 'FORMATO_AMIE_INVALIDO',
        efectoAcceso: 'RESTRINGIDA',
        detalleTecnico: `El código AMIE '${trimmedAmie}' no cumple la expresión regular oficial ^(0[1-9]|1[0-9]|2[0-4]|90)[A-Z][0-9]{5}$.`,
      });
    }
  };

  const cargoUpper = p.cargoFuncion?.trim().toUpperCase() ?? '';
  const SCHOOL_ADMIN_CARGOS = new Set([
    'SECRETARIO_PLANTEL',
    'BIBLIOTECARIO',
    'GUARDALMACEN',
    'INSPECTOR_GENERAL',
    'SUBINSPECTOR',
    'DECE_PSICOLOGO',
    'DECE_ANALISTA',
  ]);

  if (tipoUsuario === 'ESTUDIANTE') {
    checkAmieAttribute(p.codigoInstitucion, true);
    if (!p.gradoCurso?.trim()) {
      missingAttributes.push('gradoCurso');
    }
    if (requiereRepresentanteLegal) {
      const repCedula = p.representanteLegalCedula?.trim() || '';
      if (!repCedula || !validateEcuadorianCedula(repCedula)) {
        missingAttributes.push('representanteLegalCedula');
      }
    }
  } else if (tipoUsuario === 'DOCENTE') {
    checkAmieAttribute(p.codigoInstitucion, true);
  } else if (tipoUsuario === 'ADMINISTRATIVO') {
    const parsedTerritorial = parseZonaDistritoCircuito(p.zonaDistritoCircuito);
    if (nivelEstructura !== 'PLANTA_CENTRAL' && !parsedTerritorial.valid) {
      missingAttributes.push('zonaDistritoCircuito');
    }

    const isSchoolAdmin =
      nivelEstructura === 'INSTITUCION_EDUCATIVA' || SCHOOL_ADMIN_CARGOS.has(cargoUpper);

    if (isSchoolAdmin) {
      checkAmieAttribute(p.codigoInstitucion, true);
    } else {
      if (nivelEstructura === 'PLANTA_CENTRAL' && !p.viceministerio?.trim()) {
        missingAttributes.push('viceministerio');
      }
      if (!p.codigoDependenciaAdmin?.trim()) {
        missingAttributes.push('codigoDependenciaAdmin');
      }
      if (p.codigoInstitucion) {
        checkAmieAttribute(p.codigoInstitucion, false);
      }
    }
  } else if (tipoUsuario === 'EXTERNO') {
    if (subtipoUsuario === 'REPRESENTANTE_LEGAL') {
      checkAmieAttribute(p.codigoInstitucion, true);
    } else if (p.codigoInstitucion) {
      checkAmieAttribute(p.codigoInstitucion, false);
    }
  }

  if (missingAttributes.length > 0) {
    anomalias.push({
      codigoCausal: 'ATRIBUTO_OBLIGATORIO_FALTANTE',
      efectoAcceso: 'RESTRINGIDA',
      detalleTecnico: `Atributos obligatorios faltantes o inválidos para la población ${tipoUsuario || 'DESCONOCIDA'}: ${missingAttributes.join(', ')}.`,
      atributosFaltantes: missingAttributes,
    });
  }

  const hasBlocking = anomalias.some((a) => a.efectoAcceso === 'BLOQUEANTE') || vigenciaExpirada;
  const hasRestricted = anomalias.some((a) => a.efectoAcceso === 'RESTRINGIDA');

  let efectoAccesoResultante: 'COMPLETO' | 'RESTRINGIDA_SOLO_AUTENTICADA' | 'BLOQUEADO' = 'COMPLETO';
  if (hasBlocking) {
    efectoAccesoResultante = 'BLOQUEADO';
  } else if (hasRestricted) {
    efectoAccesoResultante = 'RESTRINGIDA_SOLO_AUTENTICADA';
  }

  return {
    validDocument: docResult.valid,
    tipoIdentificacionNormalizado,
    numeroIdentificacionNormalizado,
    normalizedFromNaturalPersonRuc,
    nivelAcademicoDerivado: nivelAcademicoEfectivo,
    nivelAcademicoSobrescritoPorGradoCurso,
    esMenorDeEdad,
    requiereRepresentanteLegal,
    vigenciaExpirada,
    anomaliasDetectadas: anomalias,
    efectoAccesoResultante,
  };
}
