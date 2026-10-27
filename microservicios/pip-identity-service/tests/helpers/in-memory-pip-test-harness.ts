import { randomUUID } from 'crypto';
import { Express } from 'express';
import { Container } from 'inversify';
import {
  DatabaseTransactionManager,
  InMemoryRedisCacheClient,
  PipMetricsCollector,
  SqlQueryExecutor,
  TipoIdentificacionPersona,
} from '@minedec/shared';
import {
  AnomaliaIdentidadRepositoryPort,
  AnomalyFilterQuery,
  AnomalyPaginatedList,
  AsignacionContextoRepositoryPort,
  AuditLogPort,
  AuditRecordRequest,
  CatalogoAtributoRepositoryPort,
  CatalogoTerritorioSedeRepositoryPort,
  CuentaInstitucionalRepositoryPort,
  DominioInstitucionalRepositoryPort,
  PersonaIdentidadRepositoryPort,
} from '../../src/domain/ports';
import {
  CatalogoTerritorioSede,
  CuentaInstitucional,
  DominioInstitucional,
  EstadoPersonaIdentidad,
  PersonaIdentidad,
} from '../../src/domain/entities/identity-entities';
import {
  AnomaliaIdentidad,
} from '../../src/domain/services/anomaly-lifecycle.service';
import {
  CategoriaCatalogo,
  CatalogoAtributoMinedec,
} from '../../src/domain/services/catalog-derivation.service';
import {
  AsignacionContexto,
} from '../../src/domain/services/multisede-and-transition.service';
import { RedisIdentityCacheAdapter } from '../../src/infrastructure/cache/redis-identity-cache.adapter';
import { CloudTasksPrioritySyncAdapter } from '../../src/infrastructure/messaging/cloud-tasks-priority-sync.adapter';
import { PubSubCacheInvalidationAdapter } from '../../src/infrastructure/messaging/pubsub-cache-invalidation.adapter';
import { createPipExpressApp } from '../../src/index';

export class InMemoryPersonaIdentidadRepository implements PersonaIdentidadRepositoryPort {
  public readonly store = new Map<string, PersonaIdentidad>();

  public async findByIdInterno(idInterno: string): Promise<PersonaIdentidad | null> {
    return this.store.get(idInterno) ?? null;
  }

  public async findByDocument(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
  ): Promise<PersonaIdentidad | null> {
    const normalized = numeroIdentificacion.trim().toUpperCase();
    for (const p of this.store.values()) {
      if (p.tipoIdentificacion === tipoIdentificacion && p.numeroIdentificacion === normalized) {
        return { ...p };
      }
    }
    return null;
  }

  public async findByTipoAndNumeroIdentificacion(
    tipoIdentificacion: TipoIdentificacionPersona,
    numeroIdentificacion: string,
  ): Promise<PersonaIdentidad | null> {
    return this.findByDocument(tipoIdentificacion, numeroIdentificacion);
  }

  public async findByNumeroIdentificacionOnly(
    numeroIdentificacion: string,
  ): Promise<PersonaIdentidad | null> {
    const normalized = numeroIdentificacion.trim().toUpperCase();
    for (const p of this.store.values()) {
      if (
        p.numeroIdentificacion === normalized ||
        p.codigoMinedecAnterior === normalized
      ) {
        return { ...p };
      }
    }
    return null;
  }

  public async upsert(persona: PersonaIdentidad): Promise<PersonaIdentidad> {
    const copy: PersonaIdentidad = { ...persona };
    this.store.set(copy.idInterno, copy);
    return copy;
  }

  public async updateEstadoPersona(
    idInterno: string,
    estadoPersona: EstadoPersonaIdentidad,
  ): Promise<void> {
    const existing = this.store.get(idInterno);
    if (existing) {
      this.store.set(idInterno, {
        ...existing,
        estadoPersona,
        actualizadoEn: new Date().toISOString(),
      });
    }
  }
}

export class InMemoryCuentaInstitucionalRepository implements CuentaInstitucionalRepositoryPort {
  public readonly store = new Map<string, CuentaInstitucional>();

  public async findByCuentaId(cuentaId: string): Promise<CuentaInstitucional | null> {
    const c = this.store.get(cuentaId);
    return c ? { ...c } : null;
  }

  public async findByGoogleSubId(googleSubId: string): Promise<CuentaInstitucional | null> {
    const sub = googleSubId.trim();
    for (const c of this.store.values()) {
      if (c.googleSubId === sub) {
        return { ...c };
      }
    }
    return null;
  }

  public async findByEmailPrincipal(emailPrincipal: string): Promise<CuentaInstitucional | null> {
    const email = emailPrincipal.trim().toLowerCase();
    for (const c of this.store.values()) {
      if (c.emailPrincipal.toLowerCase() === email) {
        return { ...c };
      }
    }
    return null;
  }

  public async findAllByIdInterno(idInterno: string): Promise<CuentaInstitucional[]> {
    const list: CuentaInstitucional[] = [];
    for (const c of this.store.values()) {
      if (c.idInterno === idInterno) {
        list.push({ ...c });
      }
    }
    return list;
  }

  public async upsert(cuenta: CuentaInstitucional): Promise<CuentaInstitucional> {
    const copy: CuentaInstitucional = { ...cuenta };
    this.store.set(copy.cuentaId, copy);
    return copy;
  }

  public async rebindToPersona(
    cuentaId: string,
    newIdInterno: string,
  ): Promise<CuentaInstitucional> {
    const existing = this.store.get(cuentaId);
    if (!existing) {
      throw new Error(`Cuenta ${cuentaId} no encontrada`);
    }
    const updated: CuentaInstitucional = {
      ...existing,
      idInterno: newIdInterno,
      actualizadoEn: new Date().toISOString(),
    };
    this.store.set(cuentaId, updated);
    return updated;
  }
}

export class InMemoryDominioInstitucionalRepository implements DominioInstitucionalRepositoryPort {
  public readonly store = new Map<string, DominioInstitucional>();

  public constructor() {
    this.seedDefaults();
  }

  private seedDefaults(): void {
    const defaults: DominioInstitucional[] = [
      {
        dominio: 'educacion.gob.ec',
        googleCustomerId: 'C01MINEDEC01',
        tipoPoblacion: 'ADMINISTRATIVO',
        esSubdominio: false,
        activo: true,
      },
      {
        dominio: 'docentes.educacion.gob.ec',
        googleCustomerId: 'C01MINEDEC01',
        tipoPoblacion: 'DOCENTE',
        esSubdominio: true,
        activo: true,
      },
      {
        dominio: 'estudiantes.educacion.gob.ec',
        googleCustomerId: 'C01MINEDEC01',
        tipoPoblacion: 'ESTUDIANTE',
        esSubdominio: true,
        activo: true,
      },
      {
        dominio: 'estudiante.edu.ec',
        googleCustomerId: 'C01MINEDEC01',
        tipoPoblacion: 'ESTUDIANTE',
        esSubdominio: false,
        activo: true,
      },
    ];
    for (const d of defaults) {
      this.store.set(d.dominio, d);
    }
  }

  public async findByDomain(dominio: string): Promise<DominioInstitucional | null> {
    return this.store.get(dominio.trim().toLowerCase()) ?? null;
  }

  public async listActiveDomains(): Promise<DominioInstitucional[]> {
    return Array.from(this.store.values()).filter((d) => d.activo);
  }

  public async upsert(dominio: DominioInstitucional): Promise<DominioInstitucional> {
    const normalized = { ...dominio, dominio: dominio.dominio.trim().toLowerCase() };
    this.store.set(normalized.dominio, normalized);
    return normalized;
  }
}

export class InMemoryCatalogoTerritorioSedeRepository
  implements CatalogoTerritorioSedeRepositoryPort
{
  public readonly store = new Map<string, CatalogoTerritorioSede>();

  public constructor() {
    this.seedDefaults();
  }

  private seedDefaults(): void {
    const sedes: CatalogoTerritorioSede[] = [
      {
        codigoAmie: '17H00123',
        nombreInstitucion: 'UNIDAD EDUCATIVA EXPERIMENTAL MEJIA',
        codigoZona: '09',
        codigoDistrito: '17D05',
        codigoCircuito: '17D05C01',
        provinciaDpa: '17',
        cantonDpa: '1701',
        parroquiaDpa: '170150',
        regimenEscolar: 'SIERRA_AMAZONIA',
        sostenimiento: 'FISCAL',
        modalidadEducativa: 'PRESENCIAL',
        jornada: 'MATUTINA',
        activo: true,
      },
      {
        codigoAmie: '17H00456',
        nombreInstitucion: 'COLEGIO FISCAL BENALCAZAR',
        codigoZona: '09',
        codigoDistrito: '17D06',
        codigoCircuito: '17D06C02',
        provinciaDpa: '17',
        cantonDpa: '1701',
        parroquiaDpa: '170152',
        regimenEscolar: 'SIERRA_AMAZONIA',
        sostenimiento: 'FISCAL',
        modalidadEducativa: 'PRESENCIAL',
        jornada: 'VESPERTINA',
        activo: true,
      },
      {
        // Sede especial / binacional sin distrito ni circuito (homologación FO-DNTIC-20)
        codigoAmie: '90H00001',
        nombreInstitucion: 'CENTRO EDUCATIVO ESPECIAL ZONA NO DELIMITADA',
        codigoZona: '90',
        codigoDistrito: null,
        codigoCircuito: null,
        provinciaDpa: '90',
        cantonDpa: null,
        parroquiaDpa: null,
        regimenEscolar: 'NO_APLICA',
        sostenimiento: 'FISCAL',
        modalidadEducativa: 'A_DISTANCIA',
        jornada: 'NO_APLICA',
        activo: true,
      },
    ];
    for (const s of sedes) {
      this.store.set(s.codigoAmie, s);
    }
  }

  public async findByCodigoAmie(codigoAmie: string): Promise<CatalogoTerritorioSede | null> {
    return this.store.get(codigoAmie.trim().toUpperCase()) ?? null;
  }

  public async upsert(sede: CatalogoTerritorioSede): Promise<CatalogoTerritorioSede> {
    const normalized = { ...sede, codigoAmie: sede.codigoAmie.trim().toUpperCase() };
    this.store.set(normalized.codigoAmie, normalized);
    return normalized;
  }
}

export class InMemoryAsignacionContextoRepository implements AsignacionContextoRepositoryPort {
  public readonly store = new Map<string, AsignacionContexto>();

  public async findActiveByIdInterno(idInterno: string): Promise<AsignacionContexto[]> {
    return Array.from(this.store.values()).filter(
      (a) => a.idInterno === idInterno && a.activo,
    );
  }

  public async findAllByIdInterno(idInterno: string): Promise<AsignacionContexto[]> {
    return Array.from(this.store.values()).filter((a) => a.idInterno === idInterno);
  }

  public async findPrimaryByCuentaId(cuentaId: string): Promise<AsignacionContexto | null> {
    for (const existing of this.store.values()) {
      if (
        existing.cuentaId === cuentaId &&
        existing.origenDatos === 'GWS_PRIMARIO' &&
        existing.esSedePrimaria &&
        existing.activo
      ) {
        return { ...existing };
      }
    }
    return null;
  }

  public async upsertPrimaryAssignment(
    assignment: AsignacionContexto,
  ): Promise<AsignacionContexto> {
    for (const [id, existing] of this.store.entries()) {
      if (
        existing.idInterno === assignment.idInterno &&
        existing.origenDatos === 'GWS_PRIMARIO' &&
        (existing.cuentaId === assignment.cuentaId || existing.esSedePrimaria)
      ) {
        const updated: AsignacionContexto = {
          ...assignment,
          asignacionId: id,
        };
        this.store.set(id, updated);
        return updated;
      }
    }
    const copy: AsignacionContexto = {
      ...assignment,
      asignacionId: assignment.asignacionId ?? randomUUID(),
    };
    this.store.set(copy.asignacionId, copy);
    return copy;
  }

  public async insertDelegatedAssignment(
    assignment: AsignacionContexto,
  ): Promise<AsignacionContexto> {
    const copy: AsignacionContexto = {
      ...assignment,
      asignacionId: assignment.asignacionId ?? randomUUID(),
    };
    this.store.set(copy.asignacionId, copy);
    return copy;
  }

  public async deactivateDelegatedAssignmentsByIdInterno(
    idInterno: string,
    _cuentaId?: string,
  ): Promise<AsignacionContexto[]> {
    const deactivated: AsignacionContexto[] = [];
    const nowIso = new Date().toISOString();
    for (const [id, existing] of this.store.entries()) {
      if (
        existing.idInterno === idInterno &&
        existing.origenDatos === 'PAP_DELEGADO' &&
        existing.activo
      ) {
        const updated: AsignacionContexto = {
          ...existing,
          activo: false,
          actualizadoEn: nowIso,
        };
        this.store.set(id, updated);
        deactivated.push(updated);
      }
    }
    return deactivated;
  }

  public async relinkAssignmentsToPersona(
    fromIdInterno: string,
    toIdInterno: string,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    for (const [id, existing] of this.store.entries()) {
      if (existing.idInterno === fromIdInterno) {
        this.store.set(id, {
          ...existing,
          idInterno: toIdInterno,
          actualizadoEn: nowIso,
        });
      }
    }
  }
}

export class InMemoryAnomaliaIdentidadRepository implements AnomaliaIdentidadRepositoryPort {
  public readonly store = new Map<string, AnomaliaIdentidad>();

  public async findById(anomaliaId: string): Promise<AnomaliaIdentidad | null> {
    const found = this.store.get(anomaliaId);
    return found ? { ...found } : null;
  }

  public async findActiveByGoogleSubId(googleSubId: string): Promise<AnomaliaIdentidad[]> {
    return Array.from(this.store.values()).filter(
      (a) =>
        a.googleSubId === googleSubId &&
        (a.estadoAnomalia === 'ABIERTA' ||
          a.estadoAnomalia === 'EN_REVISION' ||
          a.estadoAnomalia === 'LISTA_PARA_CERRAR'),
    );
  }

  public async findActiveByIdInterno(idInterno: string): Promise<AnomaliaIdentidad[]> {
    return Array.from(this.store.values()).filter(
      (a) =>
        a.idInterno === idInterno &&
        (a.estadoAnomalia === 'ABIERTA' ||
          a.estadoAnomalia === 'EN_REVISION' ||
          a.estadoAnomalia === 'LISTA_PARA_CERRAR'),
    );
  }

  public async findLatestResolvedByGoogleSubIdAndCausal(
    googleSubId: string,
    codigoCausal: AnomaliaIdentidad['codigoCausal'],
  ): Promise<AnomaliaIdentidad | null> {
    const resolved = Array.from(this.store.values())
      .filter(
        (a) =>
          a.googleSubId === googleSubId &&
          a.codigoCausal === codigoCausal &&
          a.estadoAnomalia === 'RESUELTA',
      )
      .sort((a, b) => (b.resueltaEn ?? b.detectadaEn).localeCompare(a.resueltaEn ?? a.detectadaEn));
    return resolved[0] ? { ...resolved[0] } : null;
  }

  public async insert(anomaly: AnomaliaIdentidad): Promise<AnomaliaIdentidad> {
    const copy = { ...anomaly };
    this.store.set(copy.anomaliaId, copy);
    return copy;
  }

  public async update(anomaly: AnomaliaIdentidad): Promise<AnomaliaIdentidad> {
    const copy = { ...anomaly };
    this.store.set(copy.anomaliaId, copy);
    return copy;
  }

  public async listPaginated(query: AnomalyFilterQuery): Promise<AnomalyPaginatedList> {
    let items = Array.from(this.store.values());
    if (query.estadoAnomalia) {
      items = items.filter((a) => a.estadoAnomalia === query.estadoAnomalia);
    }
    if (query.efectoAcceso) {
      items = items.filter((a) => a.efectoAcceso === query.efectoAcceso);
    }
    if (query.codigoCausal) {
      items = items.filter((a) => a.codigoCausal === query.codigoCausal);
    }
    if (query.dominio) {
      items = items.filter((a) => a.dominio === query.dominio?.toLowerCase());
    }
    const pageSize = query.pageSize ?? 50;
    return {
      items: items.slice(0, pageSize),
      nextCursor: items.length > pageSize ? items[pageSize]?.anomaliaId ?? null : null,
    };
  }
}

export class InMemoryCatalogoAtributoRepository implements CatalogoAtributoRepositoryPort {
  public readonly store = new Map<string, CatalogoAtributoMinedec>();
  public invalidatedCategories: Array<CategoriaCatalogo | 'ALL'> = [];

  public constructor() {
    this.seedDefaults();
  }

  private key(cat: CategoriaCatalogo, code: string): string {
    return `${cat}:${code.toUpperCase()}`;
  }

  private seedDefaults(): void {
    const defaults: CatalogoAtributoMinedec[] = [
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'TIPO_USUARIO',
        codigoValor: 'DOCENTE',
        codigoPadre: null,
        etiquetaVisible: 'Docente',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Profesor', 'Maestro Fiscal'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'TIPO_USUARIO',
        codigoValor: 'ESTUDIANTE',
        codigoPadre: null,
        etiquetaVisible: 'Estudiante',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Alumno', 'Estudiante Regular'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'TIPO_USUARIO',
        codigoValor: 'ADMINISTRATIVO',
        codigoPadre: null,
        etiquetaVisible: 'Administrativo',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Servidor Público', 'Funcionario Administrativo'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'TIPO_USUARIO',
        codigoValor: 'EXTERNO',
        codigoPadre: null,
        etiquetaVisible: 'Externo',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Usuario Externo', 'Actor Externo'],
        requiereVigenciaTemporal: true,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'DOCENTE_NOMBRAMIENTO',
        codigoPadre: 'DOCENTE',
        etiquetaVisible: 'Docente con Nombramiento Definitivo',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Nombramiento Definitivo', 'Docente Fiscal Titular'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'DOCENTE_CONTRATO',
        codigoPadre: 'DOCENTE',
        etiquetaVisible: 'Docente con Contrato Ocasional',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Contrato Ocasional Docente', 'Docente Contrato'],
        requiereVigenciaTemporal: true,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'ESTUDIANTE_REGULAR',
        codigoPadre: 'ESTUDIANTE',
        etiquetaVisible: 'Estudiante Regular',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Estudiante Matriculado'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'SERVIDOR_PUBLICO',
        codigoPadre: 'ADMINISTRATIVO',
        etiquetaVisible: 'Servidor Público LOSEP',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['LOSEP', 'Servidor Público de Carrera'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'CONTRATISTA',
        codigoPadre: 'ADMINISTRATIVO',
        etiquetaVisible: 'Contratista / Servicios Profesionales',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Honorarios Profesionales'],
        requiereVigenciaTemporal: true,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'PASANTE',
        codigoPadre: 'ADMINISTRATIVO',
        etiquetaVisible: 'Pasante Universitario',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Practicante Preprofesional'],
        requiereVigenciaTemporal: true,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'PROVEEDOR',
        codigoPadre: 'EXTERNO',
        etiquetaVisible: 'Proveedor o Consultor Externo',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Consultor Externo'],
        requiereVigenciaTemporal: true,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'REPRESENTANTE_LEGAL',
        codigoPadre: 'EXTERNO',
        etiquetaVisible: 'Representante Legal de Estudiante',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Padre de Familia', 'Tutor Legal'],
        requiereVigenciaTemporal: true,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'JORNADA',
        codigoValor: 'MATUTINA',
        codigoPadre: null,
        etiquetaVisible: 'Jornada Matutina',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Mañana', 'Matutina'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'JORNADA',
        codigoValor: 'VESPERTINA',
        codigoPadre: null,
        etiquetaVisible: 'Jornada Vespertina',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Tarde', 'Vespertina'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'JORNADA',
        codigoValor: 'NOCTURNA',
        codigoPadre: null,
        etiquetaVisible: 'Jornada Nocturna',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Noche', 'Nocturna'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'JORNADA',
        codigoValor: 'NO_APLICA',
        codigoPadre: null,
        etiquetaVisible: 'No Aplica Jornada',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['NO APLICA JORNADA', 'SIN JORNADA', 'NO APLICA'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: 'INICIAL_2',
        codigoPadre: null,
        etiquetaVisible: 'Inicial 2',
        nivelAcademicoDerivado: 'INICIAL',
        sinonimosOrigen: ['Inicial II', 'Educación Inicial 2'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: '1EGB',
        codigoPadre: null,
        etiquetaVisible: 'Primero de EGB',
        nivelAcademicoDerivado: 'EGB_PREPARATORIA',
        sinonimosOrigen: ['1ro de Básica', 'Primero EGB Preparatoria'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: '3EGB',
        codigoPadre: null,
        etiquetaVisible: 'Tercero de EGB',
        nivelAcademicoDerivado: 'EGB_ELEMENTAL',
        sinonimosOrigen: ['3ro de Básica'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: '6EGB',
        codigoPadre: null,
        etiquetaVisible: 'Sexto de EGB',
        nivelAcademicoDerivado: 'EGB_MEDIA',
        sinonimosOrigen: ['6to de Básica'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: '9EGB',
        codigoPadre: null,
        etiquetaVisible: 'Noveno de EGB',
        nivelAcademicoDerivado: 'EGB_SUPERIOR',
        sinonimosOrigen: ['9no de Básica'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        catalogoId: randomUUID(),
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: '3BGU',
        codigoPadre: null,
        etiquetaVisible: 'Tercero de Bachillerato General Unificado',
        nivelAcademicoDerivado: 'BGU',
        sinonimosOrigen: ['3ro de Bachillerato', 'Tercero BGU', 'Sexto Curso'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
    ];

    for (const item of defaults) {
      this.store.set(this.key(item.categoriaAtributo, item.codigoValor), item);
    }
  }

  public async listByCategory(
    categoriaAtributo: CategoriaCatalogo,
    onlyActive = true,
  ): Promise<CatalogoAtributoMinedec[]> {
    return Array.from(this.store.values()).filter(
      (item) =>
        item.categoriaAtributo === categoriaAtributo && (!onlyActive || item.activo),
    );
  }

  public async listAllActiveGrouped(): Promise<
    Record<CategoriaCatalogo, CatalogoAtributoMinedec[]>
  > {
    const grouped: Record<CategoriaCatalogo, CatalogoAtributoMinedec[]> = {
      TIPO_IDENTIFICACION: [],
      TIPO_USUARIO: [],
      SUBTIPO_USUARIO: [],
      CARGO_FUNCION: [],
      GRADO_CURSO: [],
      NIVEL_ACADEMICO: [],
      VICEMINISTERIO: [],
      NIVEL_ESTRUCTURA: [],
      REGIMEN_ESCOLAR: [],
      MODALIDAD_EDUCATIVA: [],
      JORNADA: [],
    };
    for (const item of this.store.values()) {
      if (item.activo) {
        grouped[item.categoriaAtributo].push(item);
      }
    }
    return grouped;
  }

  public async upsert(entry: CatalogoAtributoMinedec): Promise<CatalogoAtributoMinedec> {
    const saved: CatalogoAtributoMinedec = {
      ...entry,
      catalogoId: entry.catalogoId ?? randomUUID(),
    };
    this.store.set(this.key(saved.categoriaAtributo, saved.codigoValor), saved);
    return saved;
  }

  public async invalidateCatalogCache(categoriaAtributo?: CategoriaCatalogo): Promise<void> {
    this.invalidatedCategories.push(categoriaAtributo ?? 'ALL');
  }
}

export class InMemoryAuditLogAdapter implements AuditLogPort {
  public readonly events: Array<AuditRecordRequest & { entidadId: string | null }> = [];

  public async recordEvent(request: AuditRecordRequest): Promise<void> {
    this.events.push({
      ...request,
      entidadId: request.idInterno ?? request.cuentaId ?? null,
    });
  }
}

export interface PipTestHarness {
  app: Express;
  container: Container;
  redisStore: InMemoryRedisCacheClient;
  cacheAdapter: RedisIdentityCacheAdapter;
  pubsubPublisher: PubSubCacheInvalidationAdapter;
  prioritySyncQueue: CloudTasksPrioritySyncAdapter;
  auditLog: InMemoryAuditLogAdapter;
  metrics: PipMetricsCollector;
  personaRepo: InMemoryPersonaIdentidadRepository;
  cuentaRepo: InMemoryCuentaInstitucionalRepository;
  dominioRepo: InMemoryDominioInstitucionalRepository;
  sedeRepo: InMemoryCatalogoTerritorioSedeRepository;
  contextRepo: InMemoryAsignacionContextoRepository;
  anomalyRepo: InMemoryAnomaliaIdentidadRepository;
  catalogRepo: InMemoryCatalogoAtributoRepository;
}

export function createInMemoryPipTestHarness(): PipTestHarness {
  const noopSqlExecutor: SqlQueryExecutor = {
    query: async () => ({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    }),
  };

  const txManager: DatabaseTransactionManager = {
    query: noopSqlExecutor.query,
    withTransaction: async <T>(fn: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> =>
      fn(noopSqlExecutor),
    close: async (): Promise<void> => {},
  };

  const redisStore = new InMemoryRedisCacheClient();
  const cacheAdapter = new RedisIdentityCacheAdapter(redisStore);
  const pubsubPublisher = new PubSubCacheInvalidationAdapter('test-pip-cache-invalidation');
  const prioritySyncQueue = new CloudTasksPrioritySyncAdapter();
  const auditLog = new InMemoryAuditLogAdapter();
  const metrics = new PipMetricsCollector();

  const personaRepo = new InMemoryPersonaIdentidadRepository();
  const cuentaRepo = new InMemoryCuentaInstitucionalRepository();
  const dominioRepo = new InMemoryDominioInstitucionalRepository();
  const sedeRepo = new InMemoryCatalogoTerritorioSedeRepository();
  const contextRepo = new InMemoryAsignacionContextoRepository();
  const anomalyRepo = new InMemoryAnomaliaIdentidadRepository();
  const catalogRepo = new InMemoryCatalogoAtributoRepository();

  const { app, container } = createPipExpressApp({
    overrides: {
      sqlExecutor: noopSqlExecutor,
      txManager,
      redisStore,
      metrics,
      personaRepository: personaRepo,
      cuentaRepository: cuentaRepo,
      dominioRepository: dominioRepo,
      sedeRepository: sedeRepo,
      contextRepository: contextRepo,
      anomalyRepository: anomalyRepo,
      catalogRepository: catalogRepo,
      cachePort: cacheAdapter,
      cacheInvalidationPublisher: pubsubPublisher,
      prioritySyncQueuePort: prioritySyncQueue,
      auditLogPort: auditLog,
    },
  });

  return {
    app,
    container,
    redisStore,
    cacheAdapter,
    pubsubPublisher,
    prioritySyncQueue,
    auditLog,
    metrics,
    personaRepo,
    cuentaRepo,
    dominioRepo,
    sedeRepo,
    contextRepo,
    anomalyRepo,
    catalogRepo,
  };
}
