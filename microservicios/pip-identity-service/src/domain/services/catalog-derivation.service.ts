import {
  DEFAULT_GRADO_CURSO_DERIVATION_MAP,
  MinedecPerfilInput,
  normalizeCodigoZona,
  ZONA_DISTRITO_CIRCUITO_REGEX,
} from '@minedec/shared';
import { DomainRuleError } from '../entities/identity-entities';

export const CATEGORIAS_CATALOGO = [
  'TIPO_IDENTIFICACION',
  'TIPO_USUARIO',
  'SUBTIPO_USUARIO',
  'CARGO_FUNCION',
  'GRADO_CURSO',
  'NIVEL_ACADEMICO',
  'VICEMINISTERIO',
  'NIVEL_ESTRUCTURA',
  'REGIMEN_ESCOLAR',
  'MODALIDAD_EDUCATIVA',
  'JORNADA',
] as const;

export type CategoriaCatalogo = (typeof CATEGORIAS_CATALOGO)[number];

export interface CatalogoAtributoMinedec {
  catalogoId?: string;
  categoriaAtributo: CategoriaCatalogo;
  codigoValor: string;
  codigoPadre: string | null;
  etiquetaVisible: string;
  nivelAcademicoDerivado: string | null;
  sinonimosOrigen: string[];
  requiereVigenciaTemporal: boolean;
  metadatosRegla?: Record<string, unknown>;
  activo: boolean;
}

export interface HomologatedProfileResult {
  normalizedPerfil: MinedecPerfilInput;
  derivedNivelAcademico: string | null;
  nivelAcademicoOverwritten: boolean;
  invalidCatalogValues: Array<{ attribute: string; value: string; reason: string }>;
}

function normalizeLookupText(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export class CatalogDerivationService {
  /**
   * Homologa un valor crudo (código canónico o etiqueta de sinonimosOrigen de FO-DNTIC-20)
   * contra las entradas activas del catálogo para una categoría dada.
   */
  public resolveCanonicalCode(
    rawValue: string | null | undefined,
    activeEntries: readonly CatalogoAtributoMinedec[],
  ): { matched: boolean; canonicalCode: string | null; entry?: CatalogoAtributoMinedec } {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      return { matched: false, canonicalCode: null };
    }

    const trimmedUpper = rawValue.trim().toUpperCase();
    const normalizedTarget = normalizeLookupText(rawValue);

    for (const entry of activeEntries) {
      if (!entry.activo) {
        continue;
      }
      if (entry.codigoValor.toUpperCase() === trimmedUpper) {
        return { matched: true, canonicalCode: entry.codigoValor, entry };
      }
      if (normalizeLookupText(entry.etiquetaVisible) === normalizedTarget) {
        return { matched: true, canonicalCode: entry.codigoValor, entry };
      }
      for (const synonym of entry.sinonimosOrigen) {
        if (
          synonym.trim().toUpperCase() === trimmedUpper ||
          normalizeLookupText(synonym) === normalizedTarget
        ) {
          return { matched: true, canonicalCode: entry.codigoValor, entry };
        }
      }
    }

    return { matched: false, canonicalCode: null };
  }

  /**
   * Valida la relación jerárquica tipoUsuario -> subtipoUsuario mediante codigoPadre (D-03 / FR-002).
   */
  public validateHierarchyTipoAndSubtipo(
    tipoUsuario: string,
    subtipoUsuario: string,
    subtipoEntries: readonly CatalogoAtributoMinedec[],
  ): { valid: boolean; reason?: string; requiresTemporalValidity: boolean } {
    const resolved = this.resolveCanonicalCode(subtipoUsuario, subtipoEntries);
    if (!resolved.matched || !resolved.entry) {
      return {
        valid: false,
        reason: `El subtipoUsuario '${subtipoUsuario}' no existe o está inactivo en el catálogo SUBTIPO_USUARIO.`,
        requiresTemporalValidity: false,
      };
    }

    const expectedParent = resolved.entry.codigoPadre?.toUpperCase() ?? null;
    if (expectedParent !== tipoUsuario.trim().toUpperCase()) {
      return {
        valid: false,
        reason: `Combinación jerárquica inválida: subtipoUsuario '${resolved.entry.codigoValor}' pertenece a '${expectedParent ?? 'N/A'}', no a '${tipoUsuario}'.`,
        requiresTemporalValidity: resolved.entry.requiereVigenciaTemporal,
      };
    }

    return {
      valid: true,
      requiresTemporalValidity: resolved.entry.requiereVigenciaTemporal,
    };
  }

  /**
   * Deriva determinísticamente nivelAcademico a partir de gradoCurso como fuente maestra única (FR-006).
   */
  public deriveNivelAcademico(
    rawGradoCurso: string | null | undefined,
    rawNivelAcademico: string | null | undefined,
    gradoEntries: readonly CatalogoAtributoMinedec[],
  ): {
    canonicalGradoCurso: string | null;
    derivedNivelAcademico: string | null;
    overwritten: boolean;
  } {
    if (typeof rawGradoCurso !== 'string' || rawGradoCurso.trim().length === 0) {
      return {
        canonicalGradoCurso: null,
        derivedNivelAcademico: rawNivelAcademico ? rawNivelAcademico.trim().toUpperCase() : null,
        overwritten: false,
      };
    }

    const resolvedGrado = this.resolveCanonicalCode(rawGradoCurso, gradoEntries);
    const canonicalGrado = resolvedGrado.canonicalCode ?? rawGradoCurso.trim().toUpperCase();
    const derivedFromCatalog =
      resolvedGrado.entry?.nivelAcademicoDerivado ??
      DEFAULT_GRADO_CURSO_DERIVATION_MAP[canonicalGrado] ??
      null;

    const incomingNivel =
      typeof rawNivelAcademico === 'string' && rawNivelAcademico.trim().length > 0
        ? rawNivelAcademico.trim().toUpperCase()
        : null;

    const overwritten =
      derivedFromCatalog !== null && incomingNivel !== null && incomingNivel !== derivedFromCatalog;

    return {
      canonicalGradoCurso: canonicalGrado,
      derivedNivelAcademico: derivedFromCatalog ?? incomingNivel,
      overwritten,
    };
  }

  /**
   * Homologa todos los atributos de entrada de MINEDEC_Perfil contra los catálogos activos (incluyendo FO-DNTIC-20).
   */
  public homologatePerfilInput(
    perfilInput: MinedecPerfilInput | undefined,
    catalogByCategory: Readonly< Partial<Record<CategoriaCatalogo, readonly CatalogoAtributoMinedec[]>> >,
  ): HomologatedProfileResult {
    if (!perfilInput) {
      return {
        normalizedPerfil: {},
        derivedNivelAcademico: null,
        nivelAcademicoOverwritten: false,
        invalidCatalogValues: [],
      };
    }

    const invalidCatalogValues: Array<{ attribute: string; value: string; reason: string }> = [];
    const normalized: MinedecPerfilInput = { ...perfilInput };

    const tryNormalizeCategory = (
      fieldValue: string | null | undefined,
      category: CategoriaCatalogo,
      attributeName: string,
    ): string | null | undefined => {
      if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
        return fieldValue;
      }
      const entries = catalogByCategory[category] ?? [];
      if (entries.length === 0) {
        return fieldValue.trim().toUpperCase();
      }
      const match = this.resolveCanonicalCode(fieldValue, entries);
      if (!match.matched || !match.canonicalCode) {
        invalidCatalogValues.push({
          attribute: attributeName,
          value: fieldValue,
          reason: `Valor '${fieldValue}' no permitido o inactivo en catálogo ${category}.`,
        });
        return fieldValue.trim().toUpperCase();
      }
      return match.canonicalCode;
    };

    normalized.tipoUsuario =
      tryNormalizeCategory(perfilInput.tipoUsuario, 'TIPO_USUARIO', 'tipoUsuario') ?? undefined;
    normalized.subtipoUsuario =
      tryNormalizeCategory(perfilInput.subtipoUsuario, 'SUBTIPO_USUARIO', 'subtipoUsuario') ??
      undefined;
    normalized.cargoFuncion = tryNormalizeCategory(
      perfilInput.cargoFuncion,
      'CARGO_FUNCION',
      'cargoFuncion',
    );
    normalized.nivelEstructura =
      tryNormalizeCategory(perfilInput.nivelEstructura, 'NIVEL_ESTRUCTURA', 'nivelEstructura') ??
      undefined;
    normalized.viceministerio = tryNormalizeCategory(
      perfilInput.viceministerio,
      'VICEMINISTERIO',
      'viceministerio',
    );
    normalized.regimenEscolar = tryNormalizeCategory(
      perfilInput.regimenEscolar,
      'REGIMEN_ESCOLAR',
      'regimenEscolar',
    );
    normalized.modalidadEducativa = tryNormalizeCategory(
      perfilInput.modalidadEducativa,
      'MODALIDAD_EDUCATIVA',
      'modalidadEducativa',
    );
    normalized.jornada = tryNormalizeCategory(perfilInput.jornada, 'JORNADA', 'jornada');

    // Validar jerarquía tipoUsuario -> subtipoUsuario si ambos existen y hay catálogo cargado
    const subtipoEntries = catalogByCategory.SUBTIPO_USUARIO ?? [];
    if (normalized.tipoUsuario && normalized.subtipoUsuario && subtipoEntries.length > 0) {
      const hierarchyCheck = this.validateHierarchyTipoAndSubtipo(
        normalized.tipoUsuario,
        normalized.subtipoUsuario,
        subtipoEntries,
      );
      if (!hierarchyCheck.valid && hierarchyCheck.reason) {
        invalidCatalogValues.push({
          attribute: 'subtipoUsuario',
          value: normalized.subtipoUsuario,
          reason: hierarchyCheck.reason,
        });
      }
    }

    // Derivar nivelAcademico desde gradoCurso (fuente maestra única)
    const gradoEntries = catalogByCategory.GRADO_CURSO ?? [];
    if (perfilInput.gradoCurso) {
      const resolvedGrado = this.resolveCanonicalCode(perfilInput.gradoCurso, gradoEntries);
      if (gradoEntries.length > 0 && !resolvedGrado.matched) {
        invalidCatalogValues.push({
          attribute: 'gradoCurso',
          value: perfilInput.gradoCurso,
          reason: `Valor '${perfilInput.gradoCurso}' no permitido en catálogo GRADO_CURSO.`,
        });
      }
    }

    const academicDerivation = this.deriveNivelAcademico(
      perfilInput.gradoCurso,
      perfilInput.nivelAcademico,
      gradoEntries,
    );
    if (academicDerivation.canonicalGradoCurso) {
      normalized.gradoCurso = academicDerivation.canonicalGradoCurso;
    }
    if (academicDerivation.derivedNivelAcademico) {
      normalized.nivelAcademico = academicDerivation.derivedNivelAcademico;
    }

    // Normalizar zonaDistritoCircuito cuando proviene como ZONA simple ('1'..'9' -> '01'..'09')
    if (typeof perfilInput.zonaDistritoCircuito === 'string') {
      const rawZdc = perfilInput.zonaDistritoCircuito.trim().toUpperCase();
      if (!ZONA_DISTRITO_CIRCUITO_REGEX.test(rawZdc)) {
        const normalizedZona = normalizeCodigoZona(rawZdc);
        if (normalizedZona) {
          normalized.zonaDistritoCircuito = normalizedZona;
        }
      } else {
        normalized.zonaDistritoCircuito = rawZdc;
      }
    }

    return {
      normalizedPerfil: normalized,
      derivedNivelAcademico: academicDerivation.derivedNivelAcademico,
      nivelAcademicoOverwritten: academicDerivation.overwritten,
      invalidCatalogValues,
    };
  }

  public validateCatalogUpsertEntry(
    entry: CatalogoAtributoMinedec,
    existingParentEntries?: readonly CatalogoAtributoMinedec[],
  ): void {
    if (entry.categoriaAtributo === 'SUBTIPO_USUARIO' && !entry.codigoPadre) {
      throw new DomainRuleError(
        'Toda entrada en SUBTIPO_USUARIO requiere obligatoriamente codigoPadre apuntando a TIPO_USUARIO.',
        'CATALOG_PARENT_REQUIRED',
        400,
      );
    }
    if (
      entry.categoriaAtributo === 'SUBTIPO_USUARIO' &&
      entry.codigoPadre &&
      existingParentEntries &&
      existingParentEntries.length > 0
    ) {
      const parentExists = existingParentEntries.some(
        (p) => p.activo && p.codigoValor.toUpperCase() === entry.codigoPadre?.toUpperCase(),
      );
      if (!parentExists) {
        throw new DomainRuleError(
          `El codigoPadre '${entry.codigoPadre}' no existe como valor activo en TIPO_USUARIO.`,
          'INVALID_CATALOG_PARENT',
          400,
        );
      }
    }
    if (entry.categoriaAtributo === 'GRADO_CURSO' && !entry.nivelAcademicoDerivado) {
      throw new DomainRuleError(
        'Toda entrada en GRADO_CURSO requiere nivelAcademicoDerivado para garantizar derivación determinística.',
        'GRADOCURSO_DERIVATION_REQUIRED',
        400,
      );
    }
  }
}
