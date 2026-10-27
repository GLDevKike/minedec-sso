# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## Contexto MINEDEC *(mandatory)*

<!--
  Alcance de negocio. NO declarar lenguaje ni stack: eso se ratifica en la constitución de este repo y se aplica en /speckit.plan.
  Dominio: SIEE | SGD | GIS | Analítica | SSO | Transversal
-->

| Campo | Valor |
|-------|--------|
| **Dominio** | [SIEE \| SGD \| GIS \| Analítica \| SSO \| Transversal] |
| **Iniciativa** | [p. ej. minedec-calificaciones] |

### Referencias OKF / knowledge

<!--
  Si existen `.okf/` o `knowledge/`, citar rutas concretas. Si no hay bundle, escribir "N/A".
  No inventar artículos LOEI, actores ni topología GCP.
-->

- Concepto(s): `[ruta/al/concepto.md]` — [qué aporta a esta funcionalidad]
- Índice leído: [`.okf/index.md` \| `knowledge/index.md` \| N/A]

### Integración SSO (consume-only)

<!--
  Requisito de identidad (qué/por qué), no diseño de implementación.
  Las apps consumidoras no implementan login/password. Si esta funcionalidad ES el IdP (dominio SSO), indicarlo.
-->

- **Rol**: [Consumidor OIDC+PKCE \| Plataforma IdP (`[SSO_REPO]`)]
- **Qué se consume**: [p. ej. Authorization Code + PKCE, claims `roles`/`permissions`, JWKS]
- **Qué no se construye**: [p. ej. formulario de contraseña, servidor de autorización propio]

## User Scenarios & Testing *(mandatory)*

<!--
  Priorizar historias como viajes de usuario. Cada historia debe ser comprobable de forma independiente:
  si se implementa solo UNA, debe entregar un MVP viable.
  Prioridades P1, P2, P3... P1 es la más crítica.
  Conservar el encabezado "User Story N" y Given/When/Then: Spec Kit los usa en /speckit.tasks.
  El texto descriptivo va en español. Vocabulario: AMIE, cantón, zona, docente, establecimiento, predio, planilla.
-->

### User Story 1 - [Título breve] (Priority: P1)

[Describir el viaje del usuario en español.]

**Why this priority**: [Valor y motivo del nivel]

**Independent Test**: [Cómo se prueba sola y qué valor entrega]

**Acceptance Scenarios**:

1. **Given** [estado inicial], **When** [acción], **Then** [resultado esperado]
2. **Given** [estado inicial], **When** [acción], **Then** [resultado esperado]

---

### User Story 2 - [Título breve] (Priority: P2)

[Viaje del usuario en español]

**Why this priority**: [Valor]

**Independent Test**: [Cómo se prueba sola]

**Acceptance Scenarios**:

1. **Given** [estado inicial], **When** [acción], **Then** [resultado esperado]

---

### User Story 3 - [Título breve] (Priority: P3)

[Viaje del usuario en español]

**Why this priority**: [Valor]

**Independent Test**: [Cómo se prueba sola]

**Acceptance Scenarios**:

1. **Given** [estado inicial], **When** [acción], **Then** [resultado esperado]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

- ¿Qué ocurre cuando [condición de borde]?
- ¿Cómo maneja el sistema [escenario de error]?

## Requirements *(mandatory)*

### Functional Requirements

<!--
  Spec Kit: aquí el QUÉ (negocio). Quién puede ver o cambiar qué.
  No nombrar OWASP, SQL parametrizado, WAF ni Cloud Armor: eso es constitución XIV y /speckit.plan.
-->

- **FR-001**: El sistema DEBE [capacidad concreta]
- **FR-002**: El sistema DEBE [capacidad concreta]
- **FR-003**: Los usuarios DEBEN poder [interacción clave]
- **FR-004**: El sistema DEBE [requisito de datos]
- **FR-005**: El sistema DEBE [comportamiento, p. ej. auditar]
- **FR-006**: [Actor] SOLO DEBE poder [acción] sobre [recursos de su alcance]; NO DEBE acceder a [lo ajeno]

*Si un requisito no está claro, marcarlo así:*

- **FR-007**: El sistema DEBE autenticar usuarios mediante [NEEDS CLARIFICATION: no aplica login local; aclarar cliente OIDC y scopes]
- **FR-008**: El sistema DEBE conservar datos durante [NEEDS CLARIFICATION: periodo de retención no especificado]

### Key Entities *(include if feature involves data)*

Mapear contra `estructuradb.md` cuando exista.

- **[Entidad 1]**: [Qué representa, atributos clave sin implementación]
- **[Entidad 2]**: [Qué representa, relaciones con otras entidades]

## Success Criteria *(mandatory)*

Deben ser medibles y agnósticos de tecnología (sin nombrar Java, Angular, Cloud Run, etc.).

### Measurable Outcomes

- **SC-001**: [Métrica, p. ej. "El docente registra la planilla del periodo en menos de 3 minutos"]
- **SC-002**: [Carga, p. ej. "El sistema sostiene el pico de cierre de periodo sin degradación"]
- **SC-003**: [Éxito de tarea, p. ej. "El 90% completa el trámite en el primer intento"]
- **SC-004**: [Acceso, p. ej. "Un docente no obtiene la planilla de otro establecimiento"]

## Assumptions

- [Usuarios objetivo, p. ej. "El docente se autentica con cuenta `@educacion.gob.ec`"]
- [Límites de alcance, p. ej. "SIEE queda fuera de esta funcionalidad"]
- [Datos/entorno, p. ej. "Se reutiliza el IdP existente; no se crea login"]
- [Dependencia, p. ej. "Requiere el contrato publicado de expediente docente"]
- Referencias OKF citadas arriba se asumen vigentes; si el bundle no cubre un hecho, se usa `[NEEDS CLARIFICATION]`
