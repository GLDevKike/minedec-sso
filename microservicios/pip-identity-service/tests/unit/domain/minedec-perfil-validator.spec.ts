import { TransactionalAuditEventWriter } from '@minedec/shared';
import {
  CatalogDerivationService,
  CatalogoAtributoMinedec,
} from '../../../src/domain/services/catalog-derivation.service';
import { AnomalyLifecycleService } from '../../../src/domain/services/anomaly-lifecycle.service';
import { IdentityUnificationService } from '../../../src/domain/services/identity-unification.service';
import { MultisedeAndTransitionService } from '../../../src/domain/services/multisede-and-transition.service';
import {
  extractDomainFromEmail,
  resolveOrGenerateIdInterno,
} from '../../../src/domain/entities/identity-entities';
import {
  PubSubCacheInvalidationAdapter,
  TransactionalAuditLogAdapter,
} from '../../../src/infrastructure/messaging/pubsub-cache-invalidation.adapter';
import { CloudTasksPrioritySyncAdapter } from '../../../src/infrastructure/messaging/cloud-tasks-priority-sync.adapter';

describe('T015 - Servicios Puros de Dominio y Adaptadores de Mensajería (@minedec/pip-identity-service)', () => {
  it('valida derivación de catálogos, sinónimos FO-DNTIC-20 y jerarquía TIPO_USUARIO -> SUBTIPO_USUARIO', () => {
    const catalogService = new CatalogDerivationService();
    const entries: CatalogoAtributoMinedec[] = [
      {
        categoriaAtributo: 'TIPO_USUARIO',
        codigoValor: 'DOCENTE',
        codigoPadre: null,
        etiquetaVisible: 'Docente',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Profesor', 'Maestro'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        categoriaAtributo: 'SUBTIPO_USUARIO',
        codigoValor: 'DOCENTE_NOMBRAMIENTO',
        codigoPadre: 'DOCENTE',
        etiquetaVisible: 'Docente Fiscal',
        nivelAcademicoDerivado: null,
        sinonimosOrigen: ['Docente Nombramiento Definitivo'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
      {
        categoriaAtributo: 'GRADO_CURSO',
        codigoValor: '1EGB',
        codigoPadre: null,
        etiquetaVisible: 'Primero EGB',
        nivelAcademicoDerivado: 'EGB_PREPARATORIA',
        sinonimosOrigen: ['1ro EGB', 'Primero de Básica'],
        requiereVigenciaTemporal: false,
        activo: true,
      },
    ];

    expect(catalogService.resolveCanonicalCode('profesor', entries)).toEqual(
      expect.objectContaining({ matched: true, canonicalCode: 'DOCENTE' }),
    );

    expect(
      catalogService.validateHierarchyTipoAndSubtipo(
        'DOCENTE',
        'Docente Nombramiento Definitivo',
        entries,
      ),
    ).toEqual(expect.objectContaining({ valid: true, requiresTemporalValidity: false }));

    expect(catalogService.deriveNivelAcademico('Primero de Básica', null, entries)).toEqual({
      canonicalGradoCurso: '1EGB',
      derivedNivelAcademico: 'EGB_PREPARATORIA',
      overwritten: false,
    });
  });

  it('valida utilitarios de entidades y servicios de dominio puros (IdentityUnificationService, MultisedeAndTransitionService, AnomalyLifecycleService)', () => {
    expect(extractDomainFromEmail('Ana.Narvaez@Docentes.Educacion.Gob.Ec')).toBe(
      'docentes.educacion.gob.ec',
    );
    expect(resolveOrGenerateIdInterno(null)).toMatch(/^[0-9a-f-]{36}$/i);

    const unifySvc = new IdentityUnificationService();
    const transitionSvc = new MultisedeAndTransitionService();
    const anomalySvc = new AnomalyLifecycleService();
    expect(unifySvc).toBeDefined();

    expect(anomalySvc.getAccessEffectForCausal('SIN_IDENTIFICACION_VALIDA')).toBe('BLOQUEANTE');
    expect(anomalySvc.getAccessEffectForCausal('COLISION_IDENTIFICADOR')).toBe('BLOQUEANTE');
    expect(anomalySvc.getAccessEffectForCausal('VIGENCIA_INVALIDA')).toBe('BLOQUEANTE');
    expect(anomalySvc.getAccessEffectForCausal('ATRIBUTO_OBLIGATORIO_FALTANTE')).toBe(
      'RESTRINGIDA',
    );
    expect(anomalySvc.getAccessEffectForCausal('FORMATO_AMIE_INVALIDO')).toBe('RESTRINGIDA');

    expect(() =>
      anomalySvc.resolveAnomalyManually({
        anomaly: {
          anomaliaId: '990e8400-e29b-41d4-a716-446655440000',
          anomaliaAnteriorId: null,
          idInterno: null,
          cuentaId: null,
          googleSubId: 'sub-1',
          emailPrincipal: 'a@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          codigoCausal: 'FORMATO_AMIE_INVALIDO',
          efectoAcceso: 'RESTRINGIDA',
          estadoAnomalia: 'RESUELTA',
          origenResolucion: 'AUTO_SINCRONIZACION',
          resueltaPorIdentificacion: null,
          motivoResolucion: 'ok',
          valorAnterior: null,
          valorNuevo: null,
          detalleTecnico: 'det',
          detectadaEn: '2026-10-18T00:00:00Z',
          resueltaEn: '2026-10-18T00:00:00Z',
        },
        resueltaPorIdentificacion: 'ADMIN',
        motivoResolucion: 'Motivo suficientemente largo',
      }),
    ).toThrow(/ya se encuentra en estado/);

    expect(() =>
      anomalySvc.resolveAnomalyManually({
        anomaly: {
          anomaliaId: '990e8400-e29b-41d4-a716-446655440000',
          anomaliaAnteriorId: null,
          idInterno: null,
          cuentaId: null,
          googleSubId: 'sub-1',
          emailPrincipal: 'a@educacion.gob.ec',
          dominio: 'educacion.gob.ec',
          codigoCausal: 'FORMATO_AMIE_INVALIDO',
          efectoAcceso: 'RESTRINGIDA',
          estadoAnomalia: 'ABIERTA',
          origenResolucion: null,
          resueltaPorIdentificacion: null,
          motivoResolucion: null,
          valorAnterior: null,
          valorNuevo: null,
          detalleTecnico: 'det',
          detectadaEn: '2026-10-18T00:00:00Z',
          resueltaEn: null,
        },
        resueltaPorIdentificacion: 'ADMIN',
        motivoResolucion: 'corto',
      }),
    ).toThrow(/al menos 10 caracteres/);

    const sampleDelegated = [
      {
        asignacionId: '770e8400-e29b-41d4-a716-446655440000',
        idInterno: '550e8400-e29b-41d4-a716-446655440000',
        cuentaId: null,
        origenDatos: 'PAP_DELEGADO' as const,
        esSedePrimaria: false,
        nivelEstructura: 'INSTITUCION_EDUCATIVA' as const,
        viceministerio: 'EDUCACION' as const,
        codigoZona: '09',
        codigoDistrito: '17D05',
        codigoCircuito: '17D05C01',
        codigoAmie: '17H00123',
        codigoDependenciaAdmin: null,
        regimenEscolar: 'SIERRA_AMAZONIA' as const,
        modalidadEducativa: 'PRESENCIAL' as const,
        jornada: 'MATUTINA' as const,
        activo: true,
        asignadoPorIdentificacion: 'ADMIN',
        motivoAsignacion: 'Apoyo',
        creadoEn: '2026-10-18T00:00:00Z',
        actualizadoEn: '2026-10-18T00:00:00Z',
      },
    ];
    expect(
      transitionSvc.evaluateMultisedeDelegatedAssignments(sampleDelegated, true)
        .preservedDelegatedAssignments,
    ).toHaveLength(1);
    expect(
      transitionSvc.evaluateMultisedeDelegatedAssignments(sampleDelegated, false)
        .deactivatedDelegatedAssignments,
    ).toHaveLength(1);

    const pasaportePersona = {
      idInterno: '550e8400-e29b-41d4-a716-446655440000',
      tipoIdentificacion: 'PASAPORTE' as const,
      numeroIdentificacion: 'AB1234567',
      codigoMinedecAnterior: null,
      nombreCompleto: 'Extranjero',
      fechaNacimiento: null,
      representanteLegalCedula: null,
      estadoPersona: 'ACTIVA' as const,
      creadoEn: '2026-10-18T00:00:00Z',
      actualizadoEn: '2026-10-18T00:00:00Z',
    };
    expect(
      transitionSvc.evaluateIdentityDocumentTransition({
        existingPersona: pasaportePersona,
        incomingTipo: 'PASAPORTE',
        incomingNumero: 'AB1234567',
        collidingPersonaByDocument: null,
      }).action,
    ).toBe('NO_CHANGE');
    expect(() =>
      transitionSvc.evaluateIdentityDocumentTransition({
        existingPersona: pasaportePersona,
        incomingTipo: 'CODIGO_MINEDEC',
        incomingNumero: 'MIN-99999',
        collidingPersonaByDocument: null,
      }),
    ).toThrow(/Transición documental no permitida/);
  });

  it('ejercita PubSubCacheInvalidationAdapter, TransactionalAuditLogAdapter y CloudTasksPrioritySyncAdapter', async () => {
    const pubsub1 = new PubSubCacheInvalidationAdapter('custom-topic');
    const received: string[] = [];
    pubsub1.onInvalidationPublished((ev) => {
      received.push(ev.eventId);
    });
    await pubsub1.publishInvalidationEvent({
      eventId: 'ev-1',
      occurredAt: '2026-10-18T00:00:00Z',
      reason: 'IDENTITY_UPSERT',
      idInterno: '550e8400-e29b-41d4-a716-446655440000',
      keysUnlinkedCount: 3,
      identifiers: ['CEDULA:1710034065'],
      emails: ['a@educacion.gob.ec'],
      googleSubIds: ['sub-1'],
    });
    expect(received).toEqual(['ev-1']);
    expect(pubsub1.getPublishedEvents()).toHaveLength(1);
    pubsub1.clearPublishedEvents();
    expect(pubsub1.getPublishedEvents()).toHaveLength(0);

    const appendedEvents: unknown[] = [];
    const fakeAuditWriter = {
      appendEvent: async (input: unknown) => {
        appendedEvents.push(input);
      },
    } as unknown as TransactionalAuditEventWriter;
    const fakeExecutor = {
      query: async () => ({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }),
    };
    const auditAdapter = new TransactionalAuditLogAdapter(fakeAuditWriter, fakeExecutor);

    const eventTypes = [
      'TRANSICION_CODIGO_MINEDEC_A_CEDULA',
      'INTENTO_MUTACION_CEDULA_RECHAZADO',
      'REGISTRO_CALIENTE_PROVISIONAL',
      'REGISTRO_CALIENTE_UNIFICADO',
      'ANOMALIA_DETECTADA',
      'ANOMALIA_RESUELTA_MANUAL',
      'ASIGNACION_CONTEXTO_MODIFICADA',
      'ASIGNACION_CONTEXTO_DESACTIVADA',
      'CATALOGO_ACTUALIZADO',
      'IDENTIDAD_SUSPENDIDA',
      'IDENTIDAD_CREADA',
    ];
    const origenes: Array<'PAP_ADMIN' | 'PDP_MOTOR' | 'SINCRONIZADOR_GWS'> = [
      'PAP_ADMIN',
      'PDP_MOTOR',
      'SINCRONIZADOR_GWS',
    ];
    for (let i = 0; i < eventTypes.length; i += 1) {
      await auditAdapter.recordEvent({
        tipoEvento: eventTypes[i] as never,
        idInterno: i % 2 === 0 ? '550e8400-e29b-41d4-a716-446655440000' : null,
        cuentaId: i % 3 === 0 ? '660e8400-e29b-41d4-a716-446655440000' : null,
        actorIdentificacion: 'ACTOR',
        origenComponente: origenes[i % origenes.length],
        payloadEvento: { idx: i },
      });
    }
    expect(appendedEvents).toHaveLength(eventTypes.length);

    const adapterPip = new CloudTasksPrioritySyncAdapter({
      projectId: 'mec-003-sso-des',
      location: 'us-central1',
      queueName: 'sync-priority-hot-reg-queue-des',
    });
    const w3cTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    await adapterPip.enqueuePriorityAccountSync({
      googleSubId: 'sub-trace-001',
      emailPrincipal: 'docente.trace@docentes.educacion.gob.ec',
      dominio: 'docentes.educacion.gob.ec',
      provisionalIdInterno: '11111111-2222-4333-8444-555555555555',
      requestedAt: new Date().toISOString(),
      traceId: w3cTraceId,
    });
    const recorded = adapterPip.getRecordedTasks();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.headers['X-Trace-Id']).toBe(w3cTraceId);
  });
});
