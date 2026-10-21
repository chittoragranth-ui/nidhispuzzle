create extension if not exists pgcrypto with schema extensions;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  creator_id uuid not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  current_session_id uuid
);
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  nickname text not null check (char_length(nickname) between 1 and 24),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (room_id, user_id)
);
create table public.puzzle_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  image_path text not null,
  aspect real not null,
  seed int not null,
  cols int not null default 10,
  rows int not null default 10,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.pieces (
  session_id uuid not null references public.puzzle_sessions(id) on delete cascade,
  idx int not null,
  x real not null,
  y real not null,
  correct_x real not null,
  correct_y real not null,
  locked boolean not null default false,
  held_by uuid,
  held_until timestamptz,
  version int not null default 0,
  primary key (session_id, idx)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nickname text not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index on public.messages(room_id, created_at);
create index on public.participants(user_id);

grant select on public.rooms, public.participants, public.puzzle_sessions, public.pieces, public.messages to authenticated;
grant insert on public.messages to authenticated;
grant all on public.rooms, public.participants, public.puzzle_sessions, public.pieces, public.messages to service_role;

alter table public.rooms enable row level security;
alter table public.participants enable row level security;
alter table public.puzzle_sessions enable row level security;
alter table public.pieces enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_member(_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from participants where room_id = _room and user_id = auth.uid())
$$;

create policy "members read room" on public.rooms for select to authenticated using (public.is_member(id));
create policy "members read participants" on public.participants for select to authenticated using (public.is_member(room_id));
create policy "members read sessions" on public.puzzle_sessions for select to authenticated using (public.is_member(room_id));
create policy "members read pieces" on public.pieces for select to authenticated using (
  exists (select 1 from puzzle_sessions s where s.id = session_id and public.is_member(s.room_id)));
create policy "members read messages" on public.messages for select to authenticated using (public.is_member(room_id));
create policy "members send messages" on public.messages for insert to authenticated with check (
  user_id = auth.uid() and public.is_member(room_id));

create or replace function public.messages_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select nickname into new.nickname from participants where room_id = new.room_id and user_id = auth.uid();
  if (select count(*) from messages where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 8 then
    raise exception 'Slow down a little';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger messages_guard before insert on public.messages for each row execute function public.messages_guard();

create or replace function public.create_room(_nickname text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare _token text; _id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(trim(_nickname)) not between 1 and 24 then raise exception 'Nickname must be 1–24 characters'; end if;
  if (select count(*) from rooms where creator_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many rooms created. Try again later.';
  end if;
  _token := encode(gen_random_bytes(24), 'hex');
  insert into rooms(token_hash, creator_id) values (encode(digest(_token, 'sha256'), 'hex'), auth.uid()) returning id into _id;
  insert into participants(room_id, user_id, nickname) values (_id, auth.uid(), trim(_nickname));
  return json_build_object('room_id', _id, 'token', _token);
end $$;

create or replace function public.check_invite(_room uuid, _token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r rooms; _count int; _host text;
begin
  select * into r from rooms where id = _room;
  if r.id is null or r.token_hash <> encode(digest(coalesce(_token,''), 'sha256'), 'hex') then
    return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if r.status = 'revoked' then return json_build_object('ok', false, 'reason', 'revoked'); end if;
  if r.expires_at < now() then return json_build_object('ok', false, 'reason', 'expired'); end if;
  if exists (select 1 from participants where room_id = _room and user_id = auth.uid()) then
    return json_build_object('ok', true, 'member', true); end if;
  select count(*) into _count from participants where room_id = _room;
  if _count >= 2 then return json_build_object('ok', false, 'reason', 'full'); end if;
  select nickname into _host from participants where room_id = _room and user_id = r.creator_id;
  return json_build_object('ok', true, 'member', false, 'host', _host);
end $$;

create or replace function public.join_room(_room uuid, _token text, _nickname text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare _check json;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(trim(_nickname)) not between 1 and 24 then raise exception 'Nickname must be 1–24 characters'; end if;
  perform pg_advisory_xact_lock(hashtext(_room::text));
  _check := public.check_invite(_room, _token);
  if not (_check->>'ok')::boolean then raise exception 'Cannot join: %', _check->>'reason'; end if;
  insert into participants(room_id, user_id, nickname) values (_room, auth.uid(), trim(_nickname))
    on conflict (room_id, user_id) do update set nickname = excluded.nickname, last_seen = now();
  return _room;
end $$;

create or replace function public.revoke_invite(_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update rooms set status = 'revoked' where id = _room and creator_id = auth.uid();
end $$;

create or replace function public.create_session(_room uuid, _image_path text, _aspect real, _seed int, _positions jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare _sid uuid; i int; pw real := 1000; ph real; cw real; ch real;
begin
  if not exists (select 1 from rooms where id = _room and creator_id = auth.uid()) then raise exception 'Only the host can set the picture'; end if;
  if _aspect < 0.33 or _aspect > 3 then raise exception 'Unsupported aspect ratio'; end if;
  if jsonb_array_length(_positions) <> 100 then raise exception 'Expected 100 pieces'; end if;
  if split_part(_image_path, '/', 1) <> _room::text then raise exception 'Invalid image path'; end if;
  ph := pw / _aspect; cw := pw / 10; ch := ph / 10;
  insert into puzzle_sessions(room_id, image_path, aspect, seed) values (_room, _image_path, _aspect, _seed) returning id into _sid;
  for i in 0..99 loop
    insert into pieces(session_id, idx, x, y, correct_x, correct_y)
    values (_sid, i, (_positions->i->>0)::real, (_positions->i->>1)::real, (i % 10) * cw, (i / 10) * ch);
  end loop;
  update rooms set current_session_id = _sid where id = _room;
  return _sid;
end $$;

create or replace function public.grab_piece(_session uuid, _idx int) returns boolean
language plpgsql security definer set search_path = public as $$
declare _room uuid; _n int;
begin
  select room_id into _room from puzzle_sessions where id = _session;
  if not public.is_member(_room) then raise exception 'Not a member'; end if;
  update pieces set held_by = auth.uid(), held_until = now() + interval '20 seconds', version = version + 1
   where session_id = _session and idx = _idx and not locked
     and (held_by is null or held_by = auth.uid() or held_until < now());
  get diagnostics _n = row_count;
  return _n = 1;
end $$;

create or replace function public.drop_piece(_session uuid, _idx int, _x real, _y real) returns json
language plpgsql security definer set search_path = public as $$
declare s puzzle_sessions; p pieces; pw real := 1000; ph real; cw real; _locked boolean := false; _left int;
begin
  select * into s from puzzle_sessions where id = _session;
  if not public.is_member(s.room_id) then raise exception 'Not a member'; end if;
  select * into p from pieces where session_id = _session and idx = _idx for update;
  if p.locked then return json_build_object('locked', true, 'x', p.x, 'y', p.y); end if;
  if p.held_by is distinct from auth.uid() and p.held_until > now() then
    return json_build_object('rejected', true, 'x', p.x, 'y', p.y); end if;
  ph := pw / s.aspect; cw := pw / 10;
  _x := greatest(-0.9 * pw, least(1.8 * pw, _x));
  _y := greatest(-0.9 * ph, least(1.8 * ph, _y));
  if sqrt(power(_x - p.correct_x, 2) + power(_y - p.correct_y, 2)) < cw * 0.28 then
    _x := p.correct_x; _y := p.correct_y; _locked := true;
  end if;
  update pieces set x = _x, y = _y, locked = _locked, held_by = null, held_until = null, version = version + 1
   where session_id = _session and idx = _idx;
  if _locked then
    select count(*) into _left from pieces where session_id = _session and not locked;
    if _left = 0 then update puzzle_sessions set completed_at = now() where id = _session and completed_at is null; end if;
  end if;
  return json_build_object('locked', _locked, 'x', _x, 'y', _y);
end $$;

revoke execute on function public.create_room(text), public.check_invite(uuid,text), public.join_room(uuid,text,text),
  public.revoke_invite(uuid), public.create_session(uuid,text,real,int,jsonb), public.grab_piece(uuid,int),
  public.drop_piece(uuid,int,real,real) from public, anon;
grant execute on function public.create_room(text), public.check_invite(uuid,text), public.join_room(uuid,text,text),
  public.revoke_invite(uuid), public.create_session(uuid,text,real,int,jsonb), public.grab_piece(uuid,int),
  public.drop_piece(uuid,int,real,real), public.is_member(uuid) to authenticated;

create policy "members read images" on storage.objects for select to authenticated
  using (bucket_id = 'puzzle-images' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "host uploads images" on storage.objects for insert to authenticated
  with check (bucket_id = 'puzzle-images' and exists (select 1 from public.rooms r where r.id::text = (storage.foldername(name))[1] and r.creator_id = auth.uid()));

alter table public.pieces replica identity full;
alter publication supabase_realtime add table public.pieces, public.messages, public.puzzle_sessions, public.participants, public.rooms;