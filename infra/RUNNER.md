# Runner de Codex (ChatGPT Plus, sin API)

Contenedor que envuelve `codex exec` con el login de tu suscripción de ChatGPT.
n8n lo llama por HTTP dentro de la red interna de Docker (`http://asist-runner:8080/run`).
No publica ningún puerto.

> Estado: probado con un `codex` simulado (autenticación, inyección de shell, cola, timeouts, errores).
> **No probado con Codex real ni con tu login**: eso se verifica en el Droplet (paso 6).

## 1. Requisito en ChatGPT
ChatGPT → Settings → Security → activar **"Allow device code login"** (necesario para el login sin navegador en el servidor).

## 2. En el Droplet (consola web)
```bash
git clone https://github.com/oherreraa/asistentepersonal.git
cd asistentepersonal/infra
cp ../.env.example .env
```
Edita `.env`:
- `RUNNER_TOKEN`: genera uno con `openssl rand -hex 32`.
- `N8N_NETWORK`: red Docker de n8n. Para saberla:
  `docker inspect <contenedor-n8n> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'`

## 3. Construir
```bash
docker compose -f docker-compose.runner.yml build
```

## 4. Iniciar sesión con tu cuenta de ChatGPT (una sola vez)
```bash
docker compose -f docker-compose.runner.yml run --rm asist-runner codex login --device-auth
```
Muestra una URL y un código: ábrelos en tu celular o PC personal e inicia sesión.
Las credenciales quedan en el volumen `asist-codex-home` (equivalen a tu sesión de ChatGPT: no las copies ni las subas a ningún lado).

## 5. Levantar el runner
```bash
docker compose -f docker-compose.runner.yml up -d
docker exec asist-runner node -e "fetch('http://127.0.0.1:8080/health').then(r=>r.text()).then(console.log)"
```
Debe responder `{"ok":true,"codexLoggedIn":true}`.

## 6. Prueba real del motor
```bash
docker exec -e T="$(grep RUNNER_TOKEN .env | cut -d= -f2)" asist-runner node -e "
fetch('http://127.0.0.1:8080/run',{method:'POST',headers:{authorization:'Bearer '+process.env.T,'content-type':'application/json'},body:JSON.stringify({prompt:'Di hola en una frase'})}).then(r=>r.text()).then(console.log)"
```
Si falla por el *sandbox* dentro de Docker, avísame con el mensaje de `docker logs asist-runner` antes de cambiar ningún flag.

## 7. En n8n
1. Credentials → Create → **Bearer Auth** → nombre `Runner token (ASIST)` → token = el `RUNNER_TOKEN`.
2. Abre el flujo `ASIST - Telegram a Codex` y asigna esa credencial al nodo "Consultar Codex (runner)".
3. **Despublica** `ASIST - Telegram prueba de eco` (un bot solo admite un webhook activo) y publica el nuevo.

## Seguridad
- Token comparado en tiempo constante; prompt por stdin (nunca por línea de comandos); `--sandbox read-only`.
- Una sola consulta a la vez, cola máxima de 3, tiempo máximo de 180 s, prompt máximo de 8000 caracteres.
- Contenedor sin privilegios: sistema de archivos de solo lectura, sin capacidades, sin puertos publicados.
- Si el token del runner se filtra: cambia `RUNNER_TOKEN`, `docker compose ... up -d` y actualiza la credencial en n8n.
