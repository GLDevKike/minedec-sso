## Preámbulo MINEDEC (antes de specify)

Aplica estas reglas **además** del flujo Spec Kit que sigue. No las contradigas.

1. **Idioma**: el cuerpo de `specs/**/spec.md` va en **español** (historias, requisitos, criterios, supuestos).
2. **Etiquetas Spec Kit (no traducir)**: conserva `User Story N`, `Priority: P1`, `Independent Test`, `Acceptance Scenarios`, `Given` / `When` / `Then`, `FR-001`, `SC-001`. `/speckit.tasks`, `/speckit.analyze` y `/speckit.converge` las buscan así.
3. **Plantilla**: usa la spec de este preset (Contexto MINEDEC: OKF, SSO). Completa esos bloques; no los borres.
4. **Sin stack ni recetas de seguridad en la spec**: no declares Java, TypeScript, Python, OWASP, SQL parametrizado ni WAF. El lenguaje y el cómo se ratifican en la constitución y en `/speckit.plan`. En la spec: **quién puede hacer qué** (negocio).
5. **OKF / knowledge**: si existen `.okf/index.md` o `knowledge/index.md`, léelos y cita los conceptos usados. No inventes normas LOEI, actores ni topología GCP. Si falta un hecho, usa `[NEEDS CLARIFICATION]`.
6. **SSO consume-only**: las apps no implementan login/password ni un IdP. Integra OIDC Authorization Code + PKCE. Solo el repo de plataforma SSO (`[SSO_REPO]`) construye el servidor de autorización.
7. **Vocabulario**: AMIE, cantón, zona, distrito, predio, establecimiento, docente, planilla, `@educacion.gob.ec`.
8. **Observabilidad vs plataforma**: logs/métricas/trazas de *aplicación* (Cloud Logging / Monitoring / Trace). **No** Security Command Center, SOC ni landing zone.
9. **Siguiente paso oficial**: tras la spec, `/speckit.clarify` si hay ambigüedad, luego `/speckit.plan`. No saltes a implementar sin plan.

{CORE_TEMPLATE}
