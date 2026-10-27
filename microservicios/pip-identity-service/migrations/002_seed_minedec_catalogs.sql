-- =============================================================================
-- Migración: 002_seed_minedec_catalogs.sql
-- Feature:   001-modelo-identidades-perfil (Conecta MINEDEC - Subcomponente C2.2)
-- Propósito: Semilla idempotente del único tenant de Google Workspace (D-21),
--            sedes educativas base (AMIE, incluyendo registros FO-DNTIC-20)
--            y catálogos parametrizables iniciales de MINEDEC_Perfil (D-03).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Subdominios Institucionales del Único Tenant de Google Workspace (D-21)
-- -----------------------------------------------------------------------------
INSERT INTO dominio_institucional (
    dominio,
    google_customer_id,
    tipo_poblacion,
    es_subdominio,
    activo
) VALUES
    ('educacion.gob.ec', 'C01MINEDEC01', 'ADMINISTRATIVO', false, true),
    ('docentes.educacion.gob.ec', 'C01MINEDEC01', 'DOCENTE', true, true),
    ('estudiante.edu.ec', 'C01MINEDEC01', 'ESTUDIANTE', true, true),
    ('estudiantes.educacion.gob.ec', 'C01MINEDEC01', 'ESTUDIANTE', true, true)
ON CONFLICT (dominio) DO UPDATE
SET google_customer_id = EXCLUDED.google_customer_id,
    tipo_poblacion = EXCLUDED.tipo_poblacion,
    es_subdominio = EXCLUDED.es_subdominio,
    activo = EXCLUDED.activo,
    actualizado_en = NOW();

-- -----------------------------------------------------------------------------
-- 2. Sedes Educativas Base (AMIE) en 3FN (incluyendo sedes FO-DNTIC-20)
-- -----------------------------------------------------------------------------
INSERT INTO catalogo_territorio_sede (
    codigo_amie,
    nombre_institucion,
    codigo_zona,
    codigo_distrito,
    codigo_circuito,
    provincia_dpa,
    canton_dpa,
    parroquia_dpa,
    regimen_escolar,
    sostenimiento,
    modalidad_educativa,
    jornada,
    activo
) VALUES
    ('01H00123', 'UNIDAD EDUCATIVA BENIGNO MALO', '06', '01D01', '01D01C01', '01', '0101', '010150', 'SIERRA_AMAZONIA', 'FISCAL', 'PRESENCIAL', 'MATUTINA', true),
    ('09H00456', 'UNIDAD EDUCATIVA VICENTE ROCAFUERTE', '08', '09D03', '09D03C02', '09', '0901', '090150', 'COSTA_GALAPAGOS', 'FISCAL', 'PRESENCIAL', 'MATUTINA', true),
    ('17H00123', 'UNIDAD EDUCATIVA EXPERIMENTAL MEJIA', '09', '17D05', '17D05C01', '17', '1701', '170150', 'SIERRA_AMAZONIA', 'FISCAL', 'PRESENCIAL', 'MATUTINA', true),
    ('17H00124', 'UNIDAD EDUCATIVA JUAN MONTALVO', '09', '17D05', '17D05C02', '17', '1701', '170150', 'SIERRA_AMAZONIA', 'FISCAL', 'PRESENCIAL', 'MATUTINA', true),
    ('17H00999', 'COLEGIO EXPERIMENTAL 24 DE MAYO', '09', '17D05', '17D05C02', '17', '1701', '170150', 'SIERRA_AMAZONIA', 'FISCAL', 'PRESENCIAL', 'VESPERTINA', true),
    ('17B00045', 'UNIDAD EDUCATIVA COMUNITARIA INTERCULTURAL BILINGÜE', '09', '17D06', '17D06C01', '17', '1701', '170155', 'SIERRA_AMAZONIA', 'FISCAL', 'PRESENCIAL', 'MATUTINA', true),
    ('90H00001', 'UNIDAD EDUCATIVA ESPECIAL ZONA NO DELIMITADA FO-DNTIC-20', '90', NULL, NULL, NULL, NULL, NULL, 'NO_APLICA', 'FISCAL', 'A_DISTANCIA', 'NO_APLICA', true)
ON CONFLICT (codigo_amie) DO UPDATE
SET nombre_institucion = EXCLUDED.nombre_institucion,
    codigo_zona = EXCLUDED.codigo_zona,
    codigo_distrito = EXCLUDED.codigo_distrito,
    codigo_circuito = EXCLUDED.codigo_circuito,
    provincia_dpa = EXCLUDED.provincia_dpa,
    canton_dpa = EXCLUDED.canton_dpa,
    parroquia_dpa = EXCLUDED.parroquia_dpa,
    regimen_escolar = EXCLUDED.regimen_escolar,
    sostenimiento = EXCLUDED.sostenimiento,
    modalidad_educativa = EXCLUDED.modalidad_educativa,
    jornada = EXCLUDED.jornada,
    activo = EXCLUDED.activo,
    actualizado_en = NOW();

-- -----------------------------------------------------------------------------
-- 3. Catálogo Parametrizable MINEDEC_Perfil (D-03 + Homologación FO-DNTIC-20)
-- -----------------------------------------------------------------------------
INSERT INTO catalogo_atributo_minedec (
    categoria_atributo,
    codigo_valor,
    codigo_padre,
    etiqueta_visible,
    nivel_academico_derivado,
    requiere_vigencia_temporal,
    metadatos_regla,
    activo
) VALUES
    -- TIPO_IDENTIFICACION (Solo Personas Naturales - Constitución X.2)
    ('TIPO_IDENTIFICACION', 'CEDULA', NULL, 'Cédula de Identidad Ecuatoriana', NULL, false, '{"longitudExacta": 10, "modulo10": true, "inmutableConsolidada": true, "sinonimosOrigen": ["CÉDULA", "CEDULA DE IDENTIDAD"]}'::jsonb, true),
    ('TIPO_IDENTIFICACION', 'PASAPORTE', NULL, 'Pasaporte Extranjero', NULL, false, '{"longitudMin": 6, "longitudMax": 20, "sinonimosOrigen": ["PASSPORT"]}'::jsonb, true),
    ('TIPO_IDENTIFICACION', 'CODIGO_MINEDEC', NULL, 'Código Institucional MINEDEC', NULL, false, '{"permiteTransicionACedula": true, "sinonimosOrigen": ["CÓDIGO MINEDEC", "EXPEDIENTE ESTUDIANTIL"]}'::jsonb, true),

    -- TIPO_USUARIO
    ('TIPO_USUARIO', 'ESTUDIANTE', NULL, 'Estudiante del Sistema Nacional de Educación', NULL, false, '{"sinonimosOrigen": ["ALUMNO", "ESTUDIANTES"]}'::jsonb, true),
    ('TIPO_USUARIO', 'DOCENTE', NULL, 'Docente del Magisterio / Instituciones Educativas', NULL, false, '{"sinonimosOrigen": ["PROFESOR", "MAESTRO", "DOCENTES"]}'::jsonb, true),
    ('TIPO_USUARIO', 'ADMINISTRATIVO', NULL, 'Servidor Administrativo MINEDEC', NULL, false, '{"sinonimosOrigen": ["SERVIDOR PUBLICO", "FUNCIONARIO ADMINISTRATIVO"]}'::jsonb, true),
    ('TIPO_USUARIO', 'EXTERNO', NULL, 'Usuario Externo / Pasante / Consultor', NULL, true, '{"sinonimosOrigen": ["EXTERNO TEMPORAL", "INVITADO"]}'::jsonb, true),

    -- SUBTIPO_USUARIO (Hijos de ESTUDIANTE)
    ('SUBTIPO_USUARIO', 'ESTUDIANTE_REGULAR', 'ESTUDIANTE', 'Estudiante de Educación Regular', NULL, false, '{"sinonimosOrigen": ["ORDINARIO", "REGULAR"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'ESTUDIANTE_EJA', 'ESTUDIANTE', 'Estudiante de Educación para Jóvenes y Adultos (EJA)', NULL, false, '{"sinonimosOrigen": ["EBJA", "JOVENES Y ADULTOS"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'ESTUDIANTE_ESPECIAL', 'ESTUDIANTE', 'Estudiante de Educación Especializada e Inclusiva', NULL, false, '{"sinonimosOrigen": ["ESPECIALIZADA", "INCLUSIVA"]}'::jsonb, true),

    -- SUBTIPO_USUARIO (Hijos de DOCENTE)
    ('SUBTIPO_USUARIO', 'DOCENTE_NOMBRAMIENTO', 'DOCENTE', 'Docente con Nombramiento Definitivo (LOEI)', NULL, false, '{"sinonimosOrigen": ["LOEI NOMBRAMIENTO", "NOMBRAMIENTO DEFINITIVO"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'DOCENTE_CONTRATO', 'DOCENTE', 'Docente bajo Contrato de Servicios Ocasionales', NULL, true, '{"sinonimosOrigen": ["CONTRATO OCASIONAL DOCENTE", "DOCENTE OCASIONAL"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'DOCENTE_FISCOMISIONAL', 'DOCENTE', 'Docente de Institución Fiscomisional', NULL, false, '{"sinonimosOrigen": ["FISCOMISIONAL"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'DOCENTE_PARTICULAR', 'DOCENTE', 'Docente de Institución Particular', NULL, false, '{"sinonimosOrigen": ["PARTICULAR", "PRIVADO"]}'::jsonb, true),

    -- SUBTIPO_USUARIO (Hijos de ADMINISTRATIVO)
    ('SUBTIPO_USUARIO', 'ADMIN_LOSEP', 'ADMINISTRATIVO', 'Servidor Público bajo Régimen LOSEP', NULL, false, '{"sinonimosOrigen": ["LOSEP", "SERVIDOR LOSEP"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'ADMIN_CODIGO_TRABAJO', 'ADMINISTRATIVO', 'Trabajador Público bajo Código del Trabajo', NULL, false, '{"sinonimosOrigen": ["CODIGO DEL TRABAJO", "CÓDIGO DE TRABAJO"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'CONTRATISTA', 'ADMINISTRATIVO', 'Contratista / Servicios Técnicos Especializados', NULL, true, '{"sinonimosOrigen": ["CONTRATISTA EXTERNO"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'HONORARIOS_PROFESIONALES', 'ADMINISTRATIVO', 'Contrato Civil de Servicios Profesionales', NULL, true, '{"sinonimosOrigen": ["SERVICIOS PROFESIONALES", "HONORARIOS"]}'::jsonb, true),

    -- SUBTIPO_USUARIO (Hijos de EXTERNO)
    ('SUBTIPO_USUARIO', 'PASANTE', 'EXTERNO', 'Pasante / Practicante Preprofesional', NULL, true, '{"sinonimosOrigen": ["PRACTICANTE"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'CONSULTOR_COOPERACION', 'EXTERNO', 'Consultor de Organismo de Cooperación Internacional', NULL, true, '{"sinonimosOrigen": ["COOPERACION INTERNACIONAL", "CONSULTOR"]}'::jsonb, true),
    ('SUBTIPO_USUARIO', 'AUDITOR_EXTERNO', 'EXTERNO', 'Auditor Externo / Ente de Control', NULL, true, '{"sinonimosOrigen": ["CONTRALORIA", "AUDITOR"]}'::jsonb, true),

    -- CARGO_FUNCION
    ('CARGO_FUNCION', 'RECTOR', NULL, 'Rector/a de Institución Educativa', NULL, false, '{"sinonimosOrigen": ["RECTOR", "RECTORA"]}'::jsonb, true),
    ('CARGO_FUNCION', 'VICERRECTOR', NULL, 'Vicerrector/a de Institución Educativa', NULL, false, '{"sinonimosOrigen": ["VICERRECTOR", "VICERRECTORA"]}'::jsonb, true),
    ('CARGO_FUNCION', 'INSPECTOR_GENERAL', NULL, 'Inspector/a General', NULL, false, '{"sinonimosOrigen": ["INSPECTOR GENERAL"]}'::jsonb, true),
    ('CARGO_FUNCION', 'DOCENTE_AULA', NULL, 'Docente de Aula / Asignatura', NULL, false, '{"sinonimosOrigen": ["DOCENTE DE AULA", "PROFESOR DE AULA"]}'::jsonb, true),
    ('CARGO_FUNCION', 'DOCENTE_DECE', NULL, 'Profesional del Departamento de Consejería Estudiantil (DECE)', NULL, false, '{"sinonimosOrigen": ["DECE", "PSICOLOGO DECE"]}'::jsonb, true),
    ('CARGO_FUNCION', 'ANALISTA_DISTRITAL', NULL, 'Analista Distrital', NULL, false, '{"sinonimosOrigen": ["ANALISTA DE DISTRITO"]}'::jsonb, true),
    ('CARGO_FUNCION', 'ANALISTA_ZONAL', NULL, 'Analista Zonal', NULL, false, '{"sinonimosOrigen": ["ANALISTA DE ZONA"]}'::jsonb, true),
    ('CARGO_FUNCION', 'ANALISTA_CENTRAL', NULL, 'Analista de Planta Central', NULL, false, '{"sinonimosOrigen": ["ANALISTA PLANTA CENTRAL", "ESPECIALISTA CENTRAL"]}'::jsonb, true),
    ('CARGO_FUNCION', 'DIRECTOR_NACIONAL', NULL, 'Director/a Nacional / Subsecretario/a', NULL, false, '{"sinonimosOrigen": ["DIRECTOR NACIONAL", "SUBSECRETARIO"]}'::jsonb, true),

    -- NIVEL_ACADEMICO (7 niveles canónicos homologados con FO-DNTIC-20)
    ('NIVEL_ACADEMICO', 'INICIAL', NULL, 'Educación Inicial', NULL, false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["EDUCACION INICIAL", "EDUCACIÓN INICIAL"]}'::jsonb, true),
    ('NIVEL_ACADEMICO', 'EGB_PREPARATORIA', NULL, 'Educación General Básica Preparatoria (1.º EGB)', NULL, false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["PREPARATORIA", "BASICA PREPARATORIA"]}'::jsonb, true),
    ('NIVEL_ACADEMICO', 'EGB_ELEMENTAL', NULL, 'Educación General Básica Elemental (2.º a 4.º EGB)', NULL, false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["BASICA ELEMENTAL", "ELEMENTAL"]}'::jsonb, true),
    ('NIVEL_ACADEMICO', 'EGB_MEDIA', NULL, 'Educación General Básica Media (5.º a 7.º EGB)', NULL, false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["BASICA MEDIA", "MEDIA"]}'::jsonb, true),
    ('NIVEL_ACADEMICO', 'EGB_SUPERIOR', NULL, 'Educación General Básica Superior (8.º a 10.º EGB)', NULL, false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["BASICA SUPERIOR"]}'::jsonb, true),
    ('NIVEL_ACADEMICO', 'BGU', NULL, 'Bachillerato General Unificado (1.º a 3.º BGU)', NULL, false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["BACHILLERATO", "BACHILLERATO GENERAL UNIFICADO"]}'::jsonb, true),
    ('NIVEL_ACADEMICO', 'EDUCACION_SUPERIOR', NULL, 'Educación Superior / Tercer Nivel Tecnológico (FO-DNTIC-20)', NULL, false, '{"requiereRepresentanteMenorEdad": false, "sinonimosOrigen": ["EDUCACIÓN SUPERIOR", "TERCER NIVEL TECNOLÓGICO SUPERIOR", "INSTITUTO SUPERIOR"]}'::jsonb, true),

    -- GRADO_CURSO (17 valores canónicos con derivación determinística de nivel_academico_derivado)
    ('GRADO_CURSO', 'INICIAL_1', NULL, 'Inicial 1 (Subnivel 1)', 'INICIAL', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["INICIAL 1", "INICIAL SUBNIVEL 1"]}'::jsonb, true),
    ('GRADO_CURSO', 'INICIAL_2', NULL, 'Inicial 2 (Subnivel 2)', 'INICIAL', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["INICIAL 2", "INICIAL SUBNIVEL 2"]}'::jsonb, true),
    ('GRADO_CURSO', '1EGB', NULL, 'Primero de Educación General Básica', 'EGB_PREPARATORIA', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["1RO EGB", "PRIMERO DE BASICA", "1ERO BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '2EGB', NULL, 'Segundo de Educación General Básica', 'EGB_ELEMENTAL', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["2DO EGB", "SEGUNDO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '3EGB', NULL, 'Tercero de Educación General Básica', 'EGB_ELEMENTAL', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["3RO EGB", "TERCERO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '4EGB', NULL, 'Cuarto de Educación General Básica', 'EGB_ELEMENTAL', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["4TO EGB", "CUARTO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '5EGB', NULL, 'Quinto de Educación General Básica', 'EGB_MEDIA', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["5TO EGB", "QUINTO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '6EGB', NULL, 'Sexto de Educación General Básica', 'EGB_MEDIA', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["6TO EGB", "SEXTO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '7EGB', NULL, 'Séptimo de Educación General Básica', 'EGB_MEDIA', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["7MO EGB", "SEPTIMO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '8EGB', NULL, 'Octavo de Educación General Básica', 'EGB_SUPERIOR', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["8VO EGB", "8VO AÑO BASICA", "8VO AÑO BÁSICA", "OCTAVO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '9EGB', NULL, 'Noveno de Educación General Básica', 'EGB_SUPERIOR', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["9NO EGB", "NOVENO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '10EGB', NULL, 'Décimo de Educación General Básica', 'EGB_SUPERIOR', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["10MO EGB", "DECIMO DE BASICA"]}'::jsonb, true),
    ('GRADO_CURSO', '1BGU', NULL, 'Primero de Bachillerato General Unificado', 'BGU', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["1RO BGU", "PRIMERO DE BACHILLERATO", "1ERO BACHILLERATO"]}'::jsonb, true),
    ('GRADO_CURSO', '2BGU', NULL, 'Segundo de Bachillerato General Unificado', 'BGU', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["2DO BGU", "SEGUNDO DE BACHILLERATO"]}'::jsonb, true),
    ('GRADO_CURSO', '3BGU', NULL, 'Tercero de Bachillerato General Unificado', 'BGU', false, '{"requiereRepresentanteMenorEdad": true, "sinonimosOrigen": ["3RO BGU", "TERCERO DE BACHILLERATO"]}'::jsonb, true),
    ('GRADO_CURSO', 'SUPERIOR_1', NULL, 'Primer Nivel de Educación Superior (FO-DNTIC-20)', 'EDUCACION_SUPERIOR', false, '{"requiereRepresentanteMenorEdad": false, "sinonimosOrigen": ["1ER NIVEL SUPERIOR", "SEMESTRE 1 SUPERIOR"]}'::jsonb, true),
    ('GRADO_CURSO', 'SUPERIOR_2', NULL, 'Segundo Nivel de Educación Superior (FO-DNTIC-20)', 'EDUCACION_SUPERIOR', false, '{"requiereRepresentanteMenorEdad": false, "sinonimosOrigen": ["2DO NIVEL SUPERIOR", "SEMESTRE 2 SUPERIOR"]}'::jsonb, true),
    ('GRADO_CURSO', 'SUPERIOR_3', NULL, 'Tercer Nivel de Educación Superior (FO-DNTIC-20)', 'EDUCACION_SUPERIOR', false, '{"requiereRepresentanteMenorEdad": false, "sinonimosOrigen": ["3ER NIVEL SUPERIOR", "TERCER NIVEL TECNOLÓGICO SUPERIOR"]}'::jsonb, true),

    -- VICEMINISTERIO
    ('VICEMINISTERIO', 'EDUCACION', NULL, 'Viceministerio de Educación', NULL, false, '{"sinonimosOrigen": ["VE", "VICEMINISTERIO DE EDUCACIÓN"]}'::jsonb, true),
    ('VICEMINISTERIO', 'GESTION_EDUCATIVA', NULL, 'Viceministerio de Gestión Educativa', NULL, false, '{"sinonimosOrigen": ["VGE", "VICEMINISTERIO DE GESTIÓN EDUCATIVA"]}'::jsonb, true),
    ('VICEMINISTERIO', 'DEPORTE', NULL, 'Viceministerio del Deporte', NULL, false, '{"sinonimosOrigen": ["DEPORTES", "VICEMINISTERIO DE DEPORTE"]}'::jsonb, true),
    ('VICEMINISTERIO', 'CULTURA', NULL, 'Viceministerio de Cultura y Patrimonio', NULL, false, '{"sinonimosOrigen": ["CULTURA Y PATRIMONIO"]}'::jsonb, true),
    ('VICEMINISTERIO', 'NO_APLICA', NULL, 'No Aplica / Desconcentrado', NULL, false, '{"sinonimosOrigen": ["N/A", "SIN VICEMINISTERIO"]}'::jsonb, true),

    -- NIVEL_ESTRUCTURA
    ('NIVEL_ESTRUCTURA', 'PLANTA_CENTRAL', NULL, 'Planta Central Ministerial', NULL, false, '{"sinonimosOrigen": ["MATRIZ", "ADMINISTRACION CENTRAL"]}'::jsonb, true),
    ('NIVEL_ESTRUCTURA', 'ZONA', NULL, 'Coordinación Zonal / Subsecretaría de Educación', NULL, false, '{"sinonimosOrigen": ["COORDINACION ZONAL", "ZONAL"]}'::jsonb, true),
    ('NIVEL_ESTRUCTURA', 'DISTRITO', NULL, 'Dirección Distrital de Educación', NULL, false, '{"sinonimosOrigen": ["DIRECCION DISTRITAL", "DISTRITAL"]}'::jsonb, true),
    ('NIVEL_ESTRUCTURA', 'CIRCUITO', NULL, 'Circuito Educativo', NULL, false, '{"sinonimosOrigen": ["CIRCUITO ADMINISTRATIVO"]}'::jsonb, true),
    ('NIVEL_ESTRUCTURA', 'INSTITUCION_EDUCATIVA', NULL, 'Institución Educativa (Sede AMIE)', NULL, false, '{"sinonimosOrigen": ["UNIDAD EDUCATIVA", "PLANTEL EDUCATIVO", "ESTABLECIMIENTO"]}'::jsonb, true),

    -- REGIMEN_ESCOLAR
    ('REGIMEN_ESCOLAR', 'COSTA_GALAPAGOS', NULL, 'Régimen Costa - Galápagos', NULL, false, '{"sinonimosOrigen": ["COSTA", "REGIMEN COSTA", "GALAPAGOS"]}'::jsonb, true),
    ('REGIMEN_ESCOLAR', 'SIERRA_AMAZONIA', NULL, 'Régimen Sierra - Amazonía', NULL, false, '{"sinonimosOrigen": ["SIERRA", "REGIMEN SIERRA", "ORIENTE", "AMAZONIA"]}'::jsonb, true),
    ('REGIMEN_ESCOLAR', 'NO_APLICA', NULL, 'No Aplica', NULL, false, '{"sinonimosOrigen": ["N/A", "SIN REGIMEN"]}'::jsonb, true),

    -- MODALIDAD_EDUCATIVA
    ('MODALIDAD_EDUCATIVA', 'PRESENCIAL', NULL, 'Modalidad Presencial', NULL, false, '{"sinonimosOrigen": ["ORDINARIA PRESENCIAL"]}'::jsonb, true),
    ('MODALIDAD_EDUCATIVA', 'SEMIPRESENCIAL', NULL, 'Modalidad Semipresencial', NULL, false, '{"sinonimosOrigen": ["SEMI-PRESENCIAL", "SEMI PRESENCIAL"]}'::jsonb, true),
    ('MODALIDAD_EDUCATIVA', 'A_DISTANCIA', NULL, 'Modalidad a Distancia', NULL, false, '{"sinonimosOrigen": ["DISTANCIA", "EDUCACION A DISTANCIA"]}'::jsonb, true),
    ('MODALIDAD_EDUCATIVA', 'VIRTUAL', NULL, 'Modalidad Virtual / En Línea', NULL, false, '{"sinonimosOrigen": ["ONLINE", "EN LINEA", "EN LÍNEA"]}'::jsonb, true),
    ('MODALIDAD_EDUCATIVA', 'NO_APLICA', NULL, 'No Aplica', NULL, false, '{"sinonimosOrigen": ["N/A", "NO APLICA MODALIDAD"]}'::jsonb, true),

    -- JORNADA
    ('JORNADA', 'MATUTINA', NULL, 'Jornada Matutina', NULL, false, '{"sinonimosOrigen": ["MAÑANA", "DIURNA"]}'::jsonb, true),
    ('JORNADA', 'VESPERTINA', NULL, 'Jornada Vespertina', NULL, false, '{"sinonimosOrigen": ["TARDE"]}'::jsonb, true),
    ('JORNADA', 'NOCTURNA', NULL, 'Jornada Nocturna', NULL, false, '{"sinonimosOrigen": ["NOCHE"]}'::jsonb, true),
    ('JORNADA', 'INTENSIVA', NULL, 'Jornada Intensiva', NULL, false, '{"sinonimosOrigen": ["INTENSIVO"]}'::jsonb, true),
    ('JORNADA', 'NO_APLICA', NULL, 'No Aplica Jornada (FO-DNTIC-20)', NULL, false, '{"sinonimosOrigen": ["N/A", "NO APLICA JORNADA", "SIN JORNADA"]}'::jsonb, true)
ON CONFLICT (categoria_atributo, codigo_valor) DO UPDATE
SET codigo_padre = EXCLUDED.codigo_padre,
    etiqueta_visible = EXCLUDED.etiqueta_visible,
    nivel_academico_derivado = EXCLUDED.nivel_academico_derivado,
    requiere_vigencia_temporal = EXCLUDED.requiere_vigencia_temporal,
    metadatos_regla = EXCLUDED.metadatos_regla,
    activo = EXCLUDED.activo,
    actualizado_en = NOW();

COMMIT;
