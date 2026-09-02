-- Demo seed, runnable from the Supabase SQL editor.
--
-- `npm run seed` does the same thing through the Auth Admin API and is the
-- preferred route. This file exists because the Admin API needs the
-- service_role key, and the SQL editor does not — useful for a fresh clone or
-- a teammate who only has dashboard access.
--
-- Idempotent: re-running resets passwords and metadata rather than failing.

do $$
declare
  v_users jsonb := $j$[
    {"email":"kartik.bhardwaj@awign.example","name":"Kartik Bhardwaj","role":"REQUESTER","mgr":"priya.sharma@awign.example"},
    {"email":"ananya.rao@awign.example",     "name":"Ananya Rao",     "role":"REQUESTER","mgr":"rahul.verma@awign.example"},
    {"email":"priya.sharma@awign.example",   "name":"Priya Sharma",   "role":"MANAGER",  "mgr":null},
    {"email":"rahul.verma@awign.example",    "name":"Rahul Verma",    "role":"MANAGER",  "mgr":null},
    {"email":"finance@awign.example",        "name":"Meera Iyer",     "role":"FINANCE",  "mgr":null},
    {"email":"admin@awign.example",          "name":"Sysadmin",       "role":"ADMIN",    "mgr":null}
  ]$j$;
  u jsonb;
  v_id uuid;
  v_pw text := 'Awign@Demo123';
begin
  for u in select * from jsonb_array_elements(v_users) loop
    select id into v_id from auth.users where email = u->>'email';

    if v_id is null then
      v_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        -- GoTrue scans the columns below into a Go `string`, which cannot hold
        -- NULL. Leaving them to default produces "Database error querying
        -- schema" at login, which points nowhere near the real cause.
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        u->>'email',
        -- pgcrypto lives in the `extensions` schema on Supabase, not `public`.
        extensions.crypt(v_pw, extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', u->>'name', 'role', u->>'role',
                           'manager_email', coalesce(u->>'mgr','')),
        now(), now(),
        '', '', '', '', '', '', '', ''
      );

      -- Without a matching identities row the email/password provider finds
      -- no identity and refuses the login.
      insert into auth.identities (
        id, provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_id::text, v_id,
        jsonb_build_object('sub', v_id::text, 'email', u->>'email',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );
    else
      update auth.users
         set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             raw_user_meta_data = jsonb_build_object('full_name', u->>'name', 'role', u->>'role',
                                                     'manager_email', coalesce(u->>'mgr','')),
             updated_at = now()
       where id = v_id;
    end if;

    -- handle_new_user() fires on INSERT only and is a no-op on conflict, so a
    -- role change above would otherwise leave a stale profile row behind.
    insert into public.profiles (id, email, full_name, role, manager_email)
    values (v_id, u->>'email', u->>'name', (u->>'role')::public.app_role,
            nullif(u->>'mgr','')::citext)
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          role = excluded.role,
          manager_email = excluded.manager_email;
  end loop;
end $$;

insert into public.projects (code, name) values
  ('AWG-OPS-2026',    'Awign Operations FY26'),
  ('CLIENT-FLIPKART', 'Flipkart Onboarding Drive'),
  ('CLIENT-SWIGGY',   'Swiggy Rider Verification'),
  ('INTERNAL-RND',    'Internal R&D')
on conflict (code) do nothing;
