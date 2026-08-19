/**
 * Apply supabase/migrations/*.sql to the project database, in order, once.
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:migrate -- --status   show what is applied / pending
 *
 * Connects through Supabase's IPv4 session pooler (the direct db.* host is
 * IPv6-only). Needs SUPABASE_DB_PASSWORD (project-scoped — NOT an account
 * token) or a full SUPABASE_DB_URL in .env.local. Applied migrations are
 * recorded in _prn_migrations so re-running is safe.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

function loadEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}

function projectRef(): string {
  const url = process.env.SUPABASE_URL ?? "";
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url);
  if (!m) throw new Error("SUPABASE_URL missing or malformed in .env.local");
  return m[1];
}

/** Candidate session-pooler connection strings (host prefix varies by project). */
function candidates(): string[] {
  if (process.env.SUPABASE_DB_URL) return [process.env.SUPABASE_DB_URL];
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (!pw) return [];
  const ref = projectRef();
  const enc = encodeURIComponent(pw);
  const regions = (process.env.SUPABASE_DB_REGION ?? "us-east-2,us-east-1,us-west-1,eu-central-1")
    .split(",")
    .map((r) => r.trim());
  const hosts: string[] = [];
  for (const region of regions) {
    hosts.push(`aws-0-${region}.pooler.supabase.com`, `aws-1-${region}.pooler.supabase.com`);
  }
  return hosts.map((h) => `postgresql://postgres.${ref}:${enc}@${h}:5432/postgres`);
}

/**
 * Verify TLS against Supabase own CA rather than disabling verification: this
 * connection carries the database password, so an on-path attacker must not be
 * able to present a substitute certificate.
 */
function tlsOptions(): { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: true } {
  const caPath = path.join(process.cwd(), "certs", "supabase-prod-ca-2021.crt");
  if (existsSync(caPath)) return { ca: readFileSync(caPath, "utf-8"), rejectUnauthorized: true };
  return { rejectUnauthorized: true };
}

async function connect(): Promise<Client> {
  const urls = candidates();
  if (urls.length === 0) {
    console.error(
      "\nMISSING DATABASE PASSWORD.\n" +
        "Add this line to .env.local (the password you saved when creating the\n" +
        "Supabase project; reset it at Supabase > Project Settings > Database if lost):\n\n" +
        "  SUPABASE_DB_PASSWORD=your-database-password\n"
    );
    process.exit(2);
  }
  let lastErr: unknown = null;
  for (const url of urls) {
    const client = new Client({ connectionString: url, ssl: tlsOptions(), connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      const host = new URL(url).host;
      console.log(`connected via ${host}`);
      return client;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      // Wrong password fails the same way on every host — stop early.
      if (/password authentication failed|Tenant or user not found/i.test(msg) && urls.length > 1) continue;
    }
  }
  throw new Error(`could not connect to the database: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function main() {
  loadEnv();
  const statusOnly = process.argv.includes("--status");
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const client = await connect();
  try {
    await client.query(
      "create table if not exists _prn_migrations (name text primary key, applied_at timestamptz not null default now())"
    );
    // Same lockdown as every other table, from the moment it exists.
    await client.query("alter table _prn_migrations enable row level security");
    const { rows } = await client.query<{ name: string }>("select name from _prn_migrations");
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  [applied] ${file}`);
        continue;
      }
      if (statusOnly) {
        console.log(`  [PENDING] ${file}`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf-8");
      process.stdout.write(`  applying ${file} ... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _prn_migrations(name) values ($1)", [file]);
        await client.query("commit");
        console.log("ok");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`${file} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    const { rows: tables } = await client.query<{ tablename: string; rls: boolean }>(
      "select tablename, rowsecurity as rls from pg_tables where schemaname='public' order by tablename"
    );
    console.log(`\npublic tables: ${tables.length}`);
    const unprotected = tables.filter((t) => !t.rls).map((t) => t.tablename);
    console.log(unprotected.length === 0 ? "row-level security: ON for every table" : `RLS OFF (fix): ${unprotected.join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
