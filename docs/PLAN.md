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

## Infraestructura (DigitalOcean, Droplet con Docker)
- PostgreSQL corre como contenedor en el mismo Droplet, creado desde la consola web del Droplet con `docker compose` (archivos en `infra/`).
- Postgres solo en la red interna de Docker o en `127.0.0.1`; nunca publicado en la IP pública. Volumen persistente + backup diario cifrado (y snapshot de DigitalOcean como respaldo adicional).
- Cloud Firewall de DigitalOcean delante: solo 443 (y SSH restringido a la tailnet o a una IP).

## n8n: decisión tomada
n8n corre en el Droplet (Docker) y es la misma instancia que usa el conector de esta sesión. Ya tiene 100+ flujos (proyecto PAS360) que no se tocan; los flujos nuevos llevan prefijo `ASIST -` y se crean sin publicar.
- El nodo *Execute Command* no está disponible en esta instancia (probablemente excluido por defecto en n8n 2.x). Existe el nodo *SSH*, pero daría a n8n acceso de shell al host: se descarta.
- **Diseño elegido:** un servicio *runner* (contenedor propio, API HTTP mínima autenticada) que envuelve `claude -p` y `codex exec`. Escucha solo en la red interna de Docker; n8n lo llama con el nodo *HTTP Request*. No se publica ningún puerto nuevo.
- Como el conector MCP alcanza n8n desde fuera, n8n queda accesible por internet: protegerlo con HTTPS, 2FA/owner fuerte y webhooks con header secreto. Un acceso solo-Tailscale a n8n cortaría el conector.
- Pendiente: ver cómo está desplegado n8n hoy (compose, red, ubicación del Postgres existente) para integrar sin romper PAS360.

## Herramientas y skills de apoyo
- n8n MCP (conectado en esta sesión) para crear, validar y probar workflows.
- Skills instaladas en `.claude/skills/` (revisadas; sin hooks ni scripts de red): del repo [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) — `n8n-agents`, `n8n-binary-and-data`, `n8n-code-javascript`, `n8n-code-python`, `n8n-code-tool`, `n8n-error-handling`, `n8n-expression-syntax`, `n8n-node-configuration`, `n8n-self-hosting`, `n8n-subworkflows`, `n8n-validation-expert`, `n8n-workflow-patterns`; y `webapp-testing` de [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills). Licencias en `docs/third-party/`.
- No instaladas a propósito: las skills de n8n que dependen de los nombres de herramientas de [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) (`n8n-mcp-tools-expert`, `n8n-multi-instance`, `using-n8n-mcp-skills`) y los *hooks* del plugin, porque nuestro conector oficial usa otras herramientas. `n8n-mcp` puede añadirse más adelante si se instala n8n en el Droplet.
- [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) y ComposioHQ son catálogos de enlaces: se consultan cuando haga falta, no se instalan completos.
- Skills integradas: `security-review`, `code-review`, `simplify`, `claude-api` (solo si más adelante se usa la API).
