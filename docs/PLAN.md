# Asistente personal — Plan de trabajo

## Objetivo
Web personal, alojada en un VPS propio y con login, que es el único punto de acceso a Claude (suscripción) y Codex (suscripción ChatGPT). n8n orquesta, PostgreSQL (en el mismo VPS) guarda historial, proyectos y notas. Uso exclusivo desde dispositivos y redes personales; no se almacena información del trabajo.

## Principios
- **Seguridad primero:** la web no es pública sin capa de acceso (Tailscale o Cloudflare Access) + login propio con 2FA.
- **Sin cobro por llamada:** se usan las CLI oficiales (`claude -p`, `codex exec`) con login de suscripción, no la API.
- **Agentes aislados:** cada CLI corre en un contenedor sin privilegios, con un único volumen de trabajo y herramientas mínimas.
- **Respuestas asíncronas:** las consultas largas se manejan con streaming/cola, no con una petición HTTP que espera.
- **Uso personal de una sola persona** (términos de uso de ambos proveedores).

## Arquitectura
```
Celular / PC personal ──(Tailscale o Cloudflare Access + HTTPS)──► Caddy
                                                                    │
                                                           Web (Next.js)
                                                                    │ webhook con secreto
                                                                  n8n
                                                       ┌────────────┼────────────┐
                                                  runner-claude  runner-codex  PostgreSQL
                                                  (claude -p)    (codex exec)  (local, VPS)
```

## Fases

### Fase 0 — Verificación (antes de construir)
- [ ] Leer términos de uso de Anthropic y OpenAI para uso personal automatizado con suscripción.
- [ ] Medir consumo de límites con 20–30 prompts reales vía `claude -p` y `codex exec`.
- [ ] Confirmar el comportamiento del crédito mensual del modo headless de Claude.
- **Criterio de salida:** decisión go/no-go con cifras de consumo.

### Fase 1 — VPS seguro
- [ ] Endurecer SSH (solo llaves, sin root, fail2ban), firewall (solo 443/tailnet), actualizaciones automáticas.
- [ ] Docker + Docker Compose; red interna aislada.
- [ ] Caddy con HTTPS (Let's Encrypt o `ts.net`), HSTS, cabeceras de seguridad.
- [ ] Tailscale (o Cloudflare Tunnel + Access).
- [ ] PostgreSQL local, sin puerto público, con backups cifrados diarios.
- [ ] n8n detrás del proxy, UI restringida, webhooks con header secreto.
- **Entregables:** `infra/docker-compose.yml`, `infra/Caddyfile`, `infra/HARDENING.md`, `.env.example`.

### Fase 2 — Runners de agentes (prueba de concepto)
- [ ] Imagen Docker con Claude Code y otra con Codex CLI; usuario sin privilegios.
- [ ] Autenticación (`claude setup-token`, `codex login`) guardada en volumen con permisos 600.
- [ ] Workflow n8n: webhook → runner → respuesta; prompt por stdin/archivo (sin concatenar en shell), herramientas permitidas mínimas.
- [ ] Manejo asíncrono (job id + consulta de estado o SSE).
- **Criterio de salida:** un prompt de ida y vuelta funciona desde ambos motores y queda registrado.

### Fase 3 — Base de datos
- [ ] Esquema: `usuarios`, `conversaciones`, `mensajes`, `proyectos`, `notas`, `jobs`.
- [ ] Migraciones versionadas en `db/migrations/`.
- [ ] Búsqueda de texto completo (`tsvector`) y, opcional, `pgvector`.
- [ ] Roles de BD con mínimo privilegio (web, n8n, backup).

### Fase 4 — Web MVP
- [ ] Next.js: login con 2FA (passkeys/TOTP), sesiones cortas, cookies `Secure/HttpOnly/SameSite=Strict`.
- [ ] Chat con selector de motor (Claude / Codex), streaming de respuesta.
- [ ] Lista de proyectos y conversaciones con búsqueda.
- [ ] Rate limiting y registro de auditoría.

### Fase 5 — Importador de historial
- [ ] Parser de exports de claude.ai y ChatGPT (JSON/ZIP) → tablas.
- [ ] Indexación y búsqueda; deduplicación.

### Fase 6 — Extras
- [ ] Sesiones de Claude Code sobre repos propios (contenedor por proyecto).
- [ ] Tareas programadas y notificaciones.
- [ ] Cifrado de columnas sensibles; E2E opcional para lo almacenado.

## Riesgos abiertos
| Riesgo | Mitigación / acción |
|---|---|
| Términos de uso de las suscripciones | Fase 0; mantener uso personal |
| Límites de uso agotados por modo headless | Medición en Fase 0; cuotas por día en la web |
| Tokens caducan o se revocan | Alerta y re-login manual documentado |
| Inyección de comandos/prompts | Prompt por stdin, herramientas mínimas, contenedor aislado |
| Compromiso del VPS | Hardening, backups cifrados, secretos fuera del repo |

## Herramientas y skills de apoyo
- n8n MCP (conectado en esta sesión) y [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) / [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) para construir y validar workflows.
- Skills integradas: `security-review`, `code-review`, `simplify`, `claude-api` (solo si más adelante se usa la API).
- Docker y `psql` disponibles en el entorno de desarrollo; el VPS se configura con los archivos de `infra/`.
