/**
 * Seeds demo users and projects. Idempotent.
 *
 *   npm run seed
 *
 * Uses the Auth Admin API rather than inserting into `auth.users` directly:
 * hand-written inserts must also create the matching `auth.identities` row and
 * bcrypt the password with the right cost, and get silently wrong in ways that
 * only surface as "invalid login credentials".
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    '\nMissing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Copy .env.example to .env.local and paste the service_role key from\n' +
      'Supabase Dashboard > Project Settings > API Keys.\n',
  );
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Awign@Demo123';

const USERS = [
  {
    email: 'kartik.bhardwaj@awign.example',
    full_name: 'Kartik Bhardwaj',
    role: 'REQUESTER',
    manager_email: 'priya.sharma@awign.example',
  },
  {
    email: 'ananya.rao@awign.example',
    full_name: 'Ananya Rao',
    role: 'REQUESTER',
    manager_email: 'rahul.verma@awign.example',
  },
  { email: 'priya.sharma@awign.example', full_name: 'Priya Sharma', role: 'MANAGER', manager_email: '' },
  { email: 'rahul.verma@awign.example', full_name: 'Rahul Verma', role: 'MANAGER', manager_email: '' },
  { email: 'finance@awign.example', full_name: 'Meera Iyer', role: 'FINANCE', manager_email: '' },
  { email: 'admin@awign.example', full_name: 'Sysadmin', role: 'ADMIN', manager_email: '' },
] as const;

const PROJECTS = [
  { code: 'AWG-OPS-2026', name: 'Awign Operations FY26' },
  { code: 'CLIENT-FLIPKART', name: 'Flipkart Onboarding Drive' },
  { code: 'CLIENT-SWIGGY', name: 'Swiggy Rider Verification' },
  { code: 'INTERNAL-RND', name: 'Internal R&D' },
];

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // listUsers is paginated; six demo accounts fit in one page, but a real
  // directory would not — page until exhausted so this stays correct.
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.email) existing.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 200) break;
  }

  for (const u of USERS) {
    const meta = { full_name: u.full_name, role: u.role, manager_email: u.manager_email };
    const id = existing.get(u.email);

    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, {
        password: DEMO_PASSWORD,
        user_metadata: meta,
        email_confirm: true,
      });
      if (error) throw error;
    } else {
      const { error } = await admin.auth.admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true, // no inbox exists for @awign.example
        user_metadata: meta,
      });
      if (error) throw error;
    }

    // The auth.users trigger populates profiles on INSERT only, so an existing
    // user whose role changed here would otherwise keep the old profile row.
    const uid = id ?? existing.get(u.email);
    const { data: created } = uid
      ? { data: null }
      : await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const resolvedId =
      uid ?? created?.users.find((x) => x.email?.toLowerCase() === u.email)?.id ?? null;

    if (resolvedId) {
      const { error } = await admin.from('profiles').upsert(
        {
          id: resolvedId,
          email: u.email,
          full_name: u.full_name,
          role: u.role,
          manager_email: u.manager_email || null,
        },
        { onConflict: 'id' },
      );
      if (error) throw error;
    }
    console.log(`  ✓ ${u.email.padEnd(32)} ${u.role}`);
  }

  const { error: projectError } = await admin
    .from('projects')
    .upsert(PROJECTS, { onConflict: 'code' });
  if (projectError) throw projectError;
  console.log(`  ✓ ${PROJECTS.length} projects`);

  console.log(`\nDone. All demo accounts use the password: ${DEMO_PASSWORD}\n`);
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message ?? err, '\n');
  process.exit(1);
});
