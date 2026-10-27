import crypto from 'node:crypto';
import type { MinedecPerfilInput } from './minedec-perfil-schema';

export interface CanonicalGwsAccountSnapshotInput {
  googleSubId?: string;
  id?: string;
  emailPrincipal?: string;
  primaryEmail?: string;
  givenName?: string | null;
  familyName?: string | null;
  nombreCompleto?: string;
  name?: {
    fullName?: string;
    givenName?: string | null;
    familyName?: string | null;
  };
  orgUnitPath?: string;
  suspendedEnGws?: boolean;
  suspended?: boolean;
  deletedEnGws?: boolean;
  deleted?: boolean;
  archived?: boolean;
  minedecPerfil?: MinedecPerfilInput | Record<string, unknown> | null;
  customSchemas?: {
    MINEDEC_Perfil?: Record<string, unknown>;
    minedecPerfil?: MinedecPerfilInput | Record<string, unknown>;
  } | null;
}

const ORDERED_MINEDEC_PERFIL_KEYS: ReadonlyArray<keyof MinedecPerfilInput> = [
  'idInterno',
  'tipoIdentificacion',
  'numeroIdentificacion',
  'fechaNacimiento',
  'tipoUsuario',
  'subtipoUsuario',
  'cargoFuncion',
  'nivelEstructura',
  'zonaDistritoCircuito',
  'viceministerio',
  'codigoInstitucion',
  'codigoDependenciaAdmin',
  'regimenEscolar',
  'nivelAcademico',
  'gradoCurso',
  'modalidadEducativa',
  'jornada',
  'docenteMultisede',
  'representanteLegalCedula',
  'fechaInicioVigencia',
  'fechaFinVigencia',
];

function normalizeOptionalString(val: string | null | undefined, lowercase = false): string | null {
  if (typeof val !== 'string') {
    return null;
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return lowercase ? trimmed.toLowerCase() : trimmed;
}

/**
 * Construye una representación JSON determinística y ordenada de la cuenta institucional
 * y los 21 atributos del esquema personalizado `minedecPerfil` de Google Workspace.
 */
export function buildCanonicalGwsProfileObject(
  input: CanonicalGwsAccountSnapshotInput | Record<string, unknown>,
): Record<string, unknown> {
  const snapshot = input as CanonicalGwsAccountSnapshotInput;
  const rawPerfil = (snapshot.minedecPerfil ??
    snapshot.customSchemas?.minedecPerfil ??
    snapshot.customSchemas?.MINEDEC_Perfil ??
    {}) as Record<string, unknown>;
  const canonicalPerfil: Record<string, unknown> = {};

  for (const key of ORDERED_MINEDEC_PERFIL_KEYS) {
    const rawValue = rawPerfil[key];
    if (key === 'docenteMultisede') {
      canonicalPerfil[key] = typeof rawValue === 'boolean' ? rawValue : null;
    } else {
      canonicalPerfil[key] = normalizeOptionalString(rawValue as string | null | undefined);
    }
  }

  const googleSubId = (snapshot.googleSubId ?? snapshot.id ?? '').trim();
  const emailPrincipal = (snapshot.emailPrincipal ?? snapshot.primaryEmail ?? '')
    .trim()
    .toLowerCase();
  const givenName = normalizeOptionalString(
    snapshot.givenName ?? snapshot.name?.givenName ?? null,
  );
  const familyName = normalizeOptionalString(
    snapshot.familyName ?? snapshot.name?.familyName ?? null,
  );
  const nombreCompleto = (
    snapshot.nombreCompleto ??
    snapshot.name?.fullName ??
    [givenName, familyName].filter(Boolean).join(' ') ??
    emailPrincipal
  ).trim();
  const orgUnitPath = (snapshot.orgUnitPath ?? '/').trim() || '/';
  const suspendedEnGws = Boolean(snapshot.suspendedEnGws ?? snapshot.suspended);
  const deletedEnGws = Boolean(snapshot.deletedEnGws ?? snapshot.deleted ?? snapshot.archived);

  return {
    googleSubId,
    emailPrincipal,
    givenName,
    familyName,
    nombreCompleto,
    orgUnitPath,
    suspendedEnGws,
    deletedEnGws,
    minedecPerfil: canonicalPerfil,
  };
}

/**
 * Calcula el resumen SHA-256 (64 caracteres hexadecimales) sobre la representación JSON canónica
 * de la cuenta de Google Workspace y su esquema `minedecPerfil` (`FR-015`).
 */
export function computeCanonicalGwsProfileHash(
  input: CanonicalGwsAccountSnapshotInput | Record<string, unknown>,
): string {
  const canonicalObj = buildCanonicalGwsProfileObject(input);
  const canonicalJson = JSON.stringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

export const computeCanonicalGwsPayloadHash = computeCanonicalGwsProfileHash;
export const hashPayloadGws = computeCanonicalGwsProfileHash;

/**
 * Determina si el payload entrante de Google Workspace cambió respecto al `hash_payload_gws`
 * previamente almacenado en `cuenta_institucional`.
 */
export function hasGwsProfileChanged(
  previousHash: string | null | undefined,
  incomingSnapshot: CanonicalGwsAccountSnapshotInput | Record<string, unknown> | string,
): boolean {
  if (!previousHash || previousHash.trim().length !== 64) {
    return true;
  }
  const incomingHash =
    typeof incomingSnapshot === 'string'
      ? incomingSnapshot.trim().toLowerCase()
      : computeCanonicalGwsProfileHash(incomingSnapshot);
  return previousHash.trim().toLowerCase() !== incomingHash;
}
