import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.RUNNER_TOKEN ?? '';
const CODEX_BIN = process.env.CODEX_BIN ?? 'codex';
const CODEX_HOME = process.env.CODEX_HOME ?? '/home/node/.codex';
const WORKDIR = process.env.RUNNER_WORKDIR ?? '/work';
const TIMEOUT_MS = Number(process.env.RUNNER_TIMEOUT_MS ?? 180_000);
const MAX_PROMPT = Number(process.env.RUNNER_MAX_PROMPT ?? 8000);
const MAX_QUEUE = Number(process.env.RUNNER_MAX_QUEUE ?? 3);
const PREAMBLE =
  process.env.RUNNER_PREAMBLE ??
  'Responde en español, de forma clara y concisa. No modifiques archivos ni ejecutes comandos.';

if (TOKEN.length < 32) {
  console.error('RUNNER_TOKEN ausente o menor a 32 caracteres');
  process.exit(1);
}

const tokenBuf = Buffer.from(TOKEN);
function authorized(header = '') {
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
}

let tail = Promise.resolve();
let pending = 0;

function enqueue(job) {
  if (pending >= MAX_QUEUE) return null;
  pending += 1;
  const run = tail.then(job, job);
  tail = run.catch(() => {}).finally(() => {
    pending -= 1;
  });
  return run;
}

async function runCodex(prompt) {
  const dir = await mkdtemp(join(tmpdir(), 'asist-'));
  const outFile = join(dir, 'last.txt');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        CODEX_BIN,
        ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-o', outFile, '-'],
        {
          cwd: WORKDIR,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME },
          stdio: ['pipe', 'ignore', 'pipe']
        }
      );
      let stderr = '';
      child.stderr.on('data', (d) => {
        if (stderr.length < 4000) stderr += d;
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
      }, TIMEOUT_MS);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`codex exit ${code}: ${stderr.trim().slice(-500)}`));
      });
      child.stdin.end(`${PREAMBLE}\n\n${prompt}`);
    });
    return (await readFile(outFile, 'utf8')).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 32_768) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const loggedIn = await access(join(CODEX_HOME, 'auth.json')).then(() => true, () => false);
      return send(res, 200, { ok: true, codexLoggedIn: loggedIn });
    }
    if (req.method !== 'POST' || req.url !== '/run') return send(res, 404, { ok: false });
    if (!authorized(req.headers.authorization)) return send(res, 401, { ok: false });

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false, error: 'json inválido' });
    }
    const { engine = 'codex', prompt } = payload ?? {};
    if (engine !== 'codex') return send(res, 400, { ok: false, error: 'engine no soportado' });
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) {
      return send(res, 400, { ok: false, error: `prompt vacío o mayor a ${MAX_PROMPT}` });
    }

    const started = Date.now();
    const job = enqueue(() => runCodex(prompt));
    if (!job) return send(res, 429, { ok: false, error: 'cola llena' });
    try {
      const text = await job;
      return send(res, 200, { ok: true, engine, text, ms: Date.now() - started });
    } catch (e) {
      console.error('[runner] fallo:', e.message);
      if (e.code === 'TIMEOUT') return send(res, 504, { ok: false, error: 'tiempo agotado' });
      return send(res, 500, { ok: false, error: 'fallo del motor' });
    }
  } catch (e) {
    console.error('[runner] error:', e.message);
    if (e.code === 'TOO_LARGE') return send(res, 413, { ok: false });
    send(res, 500, { ok: false });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`[runner] escuchando en :${PORT}`));
