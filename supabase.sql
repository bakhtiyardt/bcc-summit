-- Опросы BCC-HUB: схема базы для Supabase.
-- Вставьте целиком в SQL Editor и нажмите Run. Повторный запуск безопасен.
--
-- Таблицы закрыты для прямого доступа (RLS без политик). Страница работает
-- только через функции ниже, и каждая сама проверяет права:
--   * участник может прочитать опубликованный опрос и отправить одну анкету;
--   * редактирование и результаты доступны только по секретному ключу автора
--     (в базе хранится лишь его SHA-256).

create table if not exists public.polls (
  id           text primary key,
  admin_hash   text not null,
  title        text not null check (char_length(title) between 1 and 120),
  description  text not null default '' check (char_length(description) <= 500),
  questions    jsonb not null,
  status       text not null default 'draft' check (status in ('draft','published','closed')),
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists polls_admin_hash_idx on public.polls (admin_hash);

create table if not exists public.responses (
  id         bigint generated always as identity primary key,
  poll_id    text not null references public.polls (id) on delete cascade,
  client_id  text not null check (char_length(client_id) between 8 and 64),
  answers    jsonb not null,
  created_at timestamptz not null default now(),
  unique (poll_id, client_id)
);

alter table public.polls enable row level security;
alter table public.responses enable row level security;
revoke all on public.polls, public.responses from anon, authenticated;

-- ---------- служебные ----------
create or replace function public._hash(k text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(k, 'UTF8')), 'hex')
$$;

create or replace function public._valid_questions(q jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare item jsonb; opt jsonb;
begin
  if coalesce(jsonb_typeof(q), '') <> 'array' or jsonb_array_length(q) not between 1 and 30 then
    return false;
  end if;
  for item in select * from jsonb_array_elements(q) loop
    if coalesce(jsonb_typeof(item->'id'), '') <> 'string'
       or coalesce(jsonb_typeof(item->'text'), '') <> 'string'
       or char_length(item->>'text') not between 1 and 200
       or coalesce(jsonb_typeof(item->'options'), '') <> 'array'
       or jsonb_array_length(item->'options') not between 2 and 10 then
      return false;
    end if;
    for opt in select * from jsonb_array_elements(item->'options') loop
      if coalesce(jsonb_typeof(opt), '') <> 'string' or char_length(opt #>> '{}') not between 1 and 120 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- ---------- автор ----------
create or replace function public.save_poll(
  p_key text, p_id text, p_title text, p_description text, p_questions jsonb, p_status text
) returns text
language plpgsql security definer set search_path = public as $$
declare h text; v_id text; cur public.polls;
begin
  if p_key is null or char_length(p_key) < 24 then raise exception 'bad_key'; end if;
  if p_status not in ('draft','published') then raise exception 'bad_status'; end if;
  if not public._valid_questions(p_questions) then raise exception 'bad_questions'; end if;
  h := public._hash(p_key);

  if p_id is null then
    v_id := substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into public.polls (id, admin_hash, title, description, questions, status, published_at)
    values (v_id, h, trim(p_title), coalesce(trim(p_description), ''), p_questions, p_status,
            case when p_status = 'published' then now() end);
    return v_id;
  end if;

  select * into cur from public.polls where id = p_id and admin_hash = h;
  if not found then raise exception 'not_found'; end if;
  if cur.status <> 'draft' then raise exception 'locked'; end if;
  update public.polls
     set title = trim(p_title), description = coalesce(trim(p_description), ''),
         questions = p_questions, status = p_status,
         published_at = case when p_status = 'published' then now() end
   where id = p_id;
  return p_id;
end $$;

create or replace function public.set_poll_status(p_key text, p_id text, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('published','closed') then raise exception 'bad_status'; end if;
  update public.polls
     set status = p_status, published_at = coalesce(published_at, now())
   where id = p_id and admin_hash = public._hash(p_key);
  return found;
end $$;

create or replace function public.delete_poll(p_key text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.polls where id = p_id and admin_hash = public._hash(p_key);
  return found;
end $$;

create or replace function public.list_my_polls(p_key text)
returns table (id text, title text, description text, questions jsonb, status text,
               created_at timestamptz, published_at timestamptz, responses bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.description, p.questions, p.status, p.created_at, p.published_at,
         (select count(*) from public.responses r where r.poll_id = p.id)
    from public.polls p
   where p.admin_hash = public._hash(p_key)
   order by p.created_at desc
$$;

create or replace function public.get_results(p_key text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cur public.polls; q jsonb; total bigint; counts jsonb := '{}'::jsonb; arr jsonb;
begin
  select * into cur from public.polls where id = p_id and admin_hash = public._hash(p_key);
  if not found then return null; end if;
  select count(*) into total from public.responses where poll_id = p_id;
  for q in select * from jsonb_array_elements(cur.questions) loop
    select coalesce(jsonb_agg(coalesce(t.c, 0) order by i), '[]'::jsonb) into arr
      from generate_series(0, jsonb_array_length(q->'options') - 1) as i
      left join (
        select (r.answers->>(q->>'id'))::int as a, count(*) as c
          from public.responses r where r.poll_id = p_id group by 1
      ) t on t.a = i;
    counts := counts || jsonb_build_object(q->>'id', arr);
  end loop;
  return jsonb_build_object('total', total, 'counts', counts);
end $$;

-- ---------- участник ----------
create or replace function public.get_poll(p_id text)
returns table (id text, title text, description text, questions jsonb, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.description, p.questions, p.status
    from public.polls p where p.id = p_id and p.status <> 'draft'
$$;

create or replace function public.submit_response(p_poll_id text, p_client_id text, p_answers jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare cur public.polls; q jsonb; v jsonb; n numeric; clean jsonb := '{}'::jsonb;
begin
  select * into cur from public.polls where id = p_poll_id;
  if not found or cur.status = 'draft' then return 'not_found'; end if;
  if cur.status <> 'published' then return 'closed'; end if;
  if p_client_id is null or char_length(p_client_id) not between 8 and 64 then return 'invalid'; end if;
  for q in select * from jsonb_array_elements(cur.questions) loop
    v := p_answers -> (q->>'id');
    if v is null or jsonb_typeof(v) <> 'number' then return 'invalid'; end if;
    n := (v #>> '{}')::numeric;
    if n <> trunc(n) or n < 0 or n >= jsonb_array_length(q->'options') then return 'invalid'; end if;
    clean := clean || jsonb_build_object(q->>'id', n::int);
  end loop;
  insert into public.responses (poll_id, client_id, answers)
  values (p_poll_id, p_client_id, clean)
  on conflict (poll_id, client_id) do nothing;
  if not found then return 'already'; end if;
  return 'ok';
end $$;

-- ---------- права на вызов ----------
revoke execute on function public._hash(text), public._valid_questions(jsonb) from public, anon, authenticated;
grant execute on function
  public.save_poll(text, text, text, text, jsonb, text),
  public.set_poll_status(text, text, text),
  public.delete_poll(text, text),
  public.list_my_polls(text),
  public.get_results(text, text),
  public.get_poll(text),
  public.submit_response(text, text, jsonb)
to anon, authenticated;
