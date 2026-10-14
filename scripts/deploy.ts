// One-shot setup of the hosted app (idempotent, safe to re-run):
//   1. Supabase project (Frankfurt) + schema + auth settings + pg_cron job
//   2. Vercel project + environment variables + production deploy
//
// Needs: SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN, ALLOWED_EMAIL
// Optional: SUPABASE_PROJECT_REF (reuse an existing project), PROJECT_NAME (default "okuma")
// Secrets created here (DB password, VAPID keys, CRON_SECRET) are kept in
// .deploy/state.json, which is git-ignored. Nothing secret is printed.
//
//   npm run deploy

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const NAME = process.env.PROJECT_NAME || 'okuma';
const REGION = 'eu-central-1';
const STATE_FILE = path.resolve('.deploy/state.json');
const SB = 'https://api.supabase.com/v1';
const VC = 'https://api.vercel.com';

interface State {
  supabase?: { ref: string; dbPass?: string };
  vapid?: { publicKey: string; privateKey: string };
  cronSecret?: string;
  vercel?: { projectId: string; orgId: string; url?: string };
}

const state: State = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
};

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} ortam değişkeni eksik`);
  return v;
}

async function api<T>(base: string, token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (msg: string) => console.log(`\n▸ ${msg}`);

// ---------- Supabase ----------

async function supabaseProject(token: string): Promise<string> {
  const sb = <T>(m: string, u: string, b?: unknown) => api<T>(SB, token, m, u, b);
  let ref = process.env.SUPABASE_PROJECT_REF || state.supabase?.ref;
  if (!ref) {
    const projects = await sb<Array<{ id: string; name: string }>>('GET', '/projects');
    ref = projects.find((p) => p.name === NAME)?.id;
  }
  if (!ref) {
    const orgs = await sb<Array<{ id: string; name: string }>>('GET', '/organizations');
    if (!orgs.length) throw new Error('Supabase hesabında organizasyon yok');
    const dbPass = crypto.randomBytes(24).toString('base64url');
    console.log(`  yeni proje: ${NAME} (${REGION}, organizasyon ${orgs[0].name})`);
    const p = await sb<{ id: string }>('POST', '/projects', {
      name: NAME,
      organization_id: orgs[0].id,
      region: REGION,
      db_pass: dbPass,
    });
    ref = p.id;
    state.supabase = { ref, dbPass };
    save();
  } else {
    state.supabase = { ...state.supabase, ref };
    save();
  }
  for (let i = 0; i < 90; i++) {
    const p = await sb<{ status: string }>('GET', `/projects/${ref}`);
    if (p.status === 'ACTIVE_HEALTHY') return ref;
    if (i % 6 === 0) console.log(`  proje durumu: ${p.status} …`);
    await sleep(10_000);
  }
  throw new Error('Supabase projesi 15 dakikada hazır olmadı');
}

async function sql(token: string, ref: string, query: string) {
  await api(SB, token, 'POST', `/projects/${ref}/database/query`, { query });
}

async function supabaseKeys(token: string, ref: string) {
  const keys = await api<Array<{ name: string; api_key: string }>>(SB, token, 'GET', `/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.name === 'anon')?.api_key;
  const service = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!anon || !service) throw new Error('Supabase anon/service_role anahtarları okunamadı');
  return { url: `https://${ref}.supabase.co`, anon, service };
}

const MAGIC_LINK_TEMPLATE = `<h2>Okuma'ya giriş</h2>
<p>Giriş kodun: <strong style="font-size:24px;letter-spacing:2px">{{ .Token }}</strong></p>
<p>Ya da bu cihazda: <a href="{{ .ConfirmationURL }}">giriş yap</a></p>`;

async function supabaseAuth(token: string, ref: string, appUrl: string) {
  await api(SB, token, 'PATCH', `/projects/${ref}/config/auth`, {
    site_url: appUrl,
    uri_allow_list: `${appUrl}/**`,
    disable_signup: true,
    external_email_enabled: true,
    mailer_subjects_magic_link: 'Okuma giriş kodun',
    mailer_templates_magic_link_content: MAGIC_LINK_TEMPLATE,
  });
}

// ---------- Vercel ----------

async function vercelProject(token: string) {
  const vc = <T>(m: string, u: string, b?: unknown) => api<T>(VC, token, m, u, b);
  const { user } = await vc<{ user: { id: string; defaultTeamId?: string | null } }>('GET', '/v2/user');
  const orgId = user.defaultTeamId || user.id;
  const team = user.defaultTeamId ? `?teamId=${user.defaultTeamId}` : '';
  let project: { id: string } | null = null;
  try {
    project = await vc<{ id: string }>('GET', `/v9/projects/${NAME}${team}`);
  } catch (err) {
    if (!/→ 404/.test((err as Error).message)) throw err;
  }
  if (!project) {
    console.log(`  yeni Vercel projesi: ${NAME}`);
    project = await vc<{ id: string }>('POST', `/v10/projects${team}`, { name: NAME, framework: 'vite' });
  }
  state.vercel = { ...state.vercel, projectId: project.id, orgId };
  save();
  return { projectId: project.id, orgId, team };
}

async function vercelEnv(token: string, projectId: string, team: string, vars: Record<string, string>) {
  const q = team ? `${team}&upsert=true` : '?upsert=true';
  for (const [key, value] of Object.entries(vars)) {
    await api(VC, token, 'POST', `/v10/projects/${projectId}/env${q}`, {
      key,
      value,
      type: key.startsWith('VAPID_PUBLIC') || key === 'SUPABASE_URL' ? 'plain' : 'encrypted',
      target: ['production', 'preview', 'development'],
    });
    console.log(`  ${key} ✓`);
  }
}

async function productionUrl(token: string, projectId: string, team: string): Promise<string> {
  const domains = await api<{ domains: Array<{ name: string }> }>(VC, token, 'GET', `/v9/projects/${projectId}/domains${team}`);
  const name = domains.domains.find((d) => d.name.endsWith('.vercel.app'))?.name ?? domains.domains[0]?.name;
  if (!name) throw new Error('Vercel üretim adresi bulunamadı');
  return `https://${name}`;
}

function vercelDeploy(token: string, projectId: string, orgId: string) {
  execFileSync('npx', ['--yes', 'vercel@latest', 'deploy', '--prod', '--yes', '--token', token], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, VERCEL_ORG_ID: orgId, VERCEL_PROJECT_ID: projectId },
  });
}

// ---------- main ----------

async function main() {
  const sbToken = need('SUPABASE_ACCESS_TOKEN');
  const vcToken = need('VERCEL_TOKEN');
  const allowedEmail = need('ALLOWED_EMAIL').toLowerCase();

  state.vapid ??= webpush.generateVAPIDKeys();
  state.cronSecret ??= crypto.randomBytes(32).toString('hex');
  save();

  step('Supabase projesi');
  const ref = await supabaseProject(sbToken);
  console.log(`  hazır: ${ref}`);

  step('Veritabanı şeması');
  await sql(sbToken, ref, fs.readFileSync('supabase/migrations/0001_init.sql', 'utf8'));
  console.log('  0001_init.sql ✓');

  const keys = await supabaseKeys(sbToken, ref);

  step('Vercel projesi');
  const v = await vercelProject(vcToken);

  step('Vercel ortam değişkenleri');
  await vercelEnv(vcToken, v.projectId, v.team, {
    SUPABASE_URL: keys.url,
    SUPABASE_ANON_KEY: keys.anon,
    SUPABASE_SERVICE_ROLE_KEY: keys.service,
    ALLOWED_EMAIL: allowedEmail,
    VAPID_PUBLIC_KEY: state.vapid.publicKey,
    VAPID_PRIVATE_KEY: state.vapid.privateKey,
    VAPID_SUBJECT: `mailto:${allowedEmail}`,
    CRON_SECRET: state.cronSecret,
  });

  step('Dağıtım (Vercel, üretim)');
  vercelDeploy(vcToken, v.projectId, v.orgId);
  // The stable <project>.vercel.app domain exists once production has been deployed.
  const appUrl = await productionUrl(vcToken, v.projectId, v.team);
  state.vercel = { ...state.vercel!, url: appUrl };
  save();
  console.log(`  adres: ${appUrl}`);

  step('Supabase giriş ayarları');
  await supabaseAuth(sbToken, ref, appUrl);
  console.log('  kayıt kapalı, e-posta şablonu (kod + bağlantı), yönlendirme adresi ✓');

  step('Bildirim zamanlayıcısı (pg_cron, 10 dakikada bir)');
  await sql(sbToken, ref, 'create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;');
  const cron = fs
    .readFileSync('supabase/cron.sql', 'utf8')
    .replace('https://APP_URL', appUrl)
    .replace('Bearer CRON_SECRET', `Bearer ${state.cronSecret}`);
  await sql(sbToken, ref, cron);
  console.log('  okuma-notify ✓');

  step('Kontrol');
  const cfg = (await (await fetch(`${appUrl}/api/config`)).json()) as { missing: string[] };
  console.log(cfg.missing.length ? `  eksik: ${cfg.missing.join(', ')}` : '  /api/config: tüm sunucu değişkenleri tanımlı ✓');
  const cronRes = await fetch(`${appUrl}/api/cron/notify`, { headers: { Authorization: `Bearer ${state.cronSecret}` } });
  console.log(`  /api/cron/notify → ${cronRes.status}`);

  console.log(`\n✓ Hazır: ${appUrl}`);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}`);
  process.exit(1);
});
