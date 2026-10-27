create table public.pocket_cards (
  card_id text primary key,
  category text not null
);
create table public.pocket_study_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references public.pocket_cards(card_id),
  status text not null check (status in ('new','known','weak')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index pocket_marks_card_idx on public.pocket_study_marks(card_id);
create table public.pocket_view_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  card_id text references public.pocket_cards(card_id),
  filter text not null check (filter in ('core','all','weak','new')),
  category text not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
create index pocket_view_card_idx on public.pocket_view_state(card_id);
create table public.pocket_sync_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.pocket_cards enable row level security;
alter table public.pocket_study_marks enable row level security;
alter table public.pocket_view_state enable row level security;
alter table public.pocket_sync_operations enable row level security;
revoke all on public.pocket_cards, public.pocket_study_marks, public.pocket_view_state, public.pocket_sync_operations from public, anon, authenticated;
grant select on public.pocket_cards to authenticated;
grant select, insert, update on public.pocket_study_marks, public.pocket_view_state to authenticated;
grant select, insert on public.pocket_sync_operations to authenticated;
create policy pocket_catalog_read on public.pocket_cards for select to authenticated using (true);
create policy pocket_marks_read on public.pocket_study_marks for select to authenticated using ((select auth.uid()) = user_id);
create policy pocket_marks_insert on public.pocket_study_marks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pocket_marks_update on public.pocket_study_marks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy pocket_view_read on public.pocket_view_state for select to authenticated using ((select auth.uid()) = user_id);
create policy pocket_view_insert on public.pocket_view_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pocket_view_update on public.pocket_view_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy pocket_operations_read on public.pocket_sync_operations for select to authenticated using ((select auth.uid()) = user_id);
create policy pocket_operations_insert on public.pocket_sync_operations for insert to authenticated with check ((select auth.uid()) = user_id);

create function public.pocket_stamp_record() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'pocket_sync_operations' then
    new.created_at := clock_timestamp();
  else
    if tg_op = 'INSERT' then new.revision := 1;
    else new.revision := old.revision + 1;
    end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.pocket_stamp_record() from public, anon;
grant execute on function public.pocket_stamp_record() to authenticated;
create trigger pocket_marks_stamp before insert or update on public.pocket_study_marks for each row execute function public.pocket_stamp_record();
create trigger pocket_view_stamp before insert or update on public.pocket_view_state for each row execute function public.pocket_stamp_record();
create trigger pocket_operations_stamp before insert on public.pocket_sync_operations for each row execute function public.pocket_stamp_record();

create function public.pocket_sync_progress(p_operations jsonb default '[]'::jsonb, p_view jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_op jsonb;
  v_id uuid;
  v_card text;
  v_status text;
  v_base bigint;
  v_hash text;
  v_saved public.pocket_sync_operations%rowtype;
  v_mark public.pocket_study_marks%rowtype;
  v_position public.pocket_view_state%rowtype;
  v_exists boolean;
  v_revision bigint;
  v_next text;
  v_conflict boolean;
  v_view_conflict boolean := false;
  v_ack jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_marks jsonb;
  v_view_result jsonb;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations) > 200 then
    raise exception 'Invalid operation batch' using errcode = '22023';
  end if;
  if octet_length(p_operations::text || coalesce(p_view::text,'')) > 131072 then
    raise exception 'Request too large' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  for v_op in select value from jsonb_array_elements(p_operations) loop
    if jsonb_typeof(v_op) is distinct from 'object'
       or not (v_op ?& array['operationId','cardId','status','baseRevision'])
       or v_op - array['operationId','cardId','status','baseRevision'] <> '{}'::jsonb
       or jsonb_typeof(v_op->'baseRevision') is distinct from 'number'
       or (v_op->>'baseRevision') !~ '^[0-9]+$' then
      raise exception 'Invalid operation' using errcode = '22023';
    end if;
    v_id := (v_op->>'operationId')::uuid;
    v_card := v_op->>'cardId'; v_status := v_op->>'status'; v_base := (v_op->>'baseRevision')::bigint;
    if v_id is null or v_base > 9007199254740991 or v_status is null or v_status not in ('new','known','weak')
       or not exists (select 1 from public.pocket_cards where card_id = v_card) then
      raise exception 'Invalid card or status' using errcode = '22023';
    end if;
    v_hash := encode(sha256(convert_to(jsonb_build_object('kind','mark','payload',v_op)::text,'UTF8')),'hex');
    select * into v_saved from public.pocket_sync_operations where user_id = v_uid and operation_id = v_id;
    if found then
      if v_saved.request_hash <> v_hash then raise exception 'Operation ID reused with different data' using errcode = '22023'; end if;
      if coalesce((v_saved.result->>'conflict')::boolean,false) then v_conflicts := v_conflicts || jsonb_build_array(v_card); end if;
    else
      select * into v_mark from public.pocket_study_marks where user_id = v_uid and card_id = v_card;
      v_exists := found; v_revision := case when v_exists then v_mark.revision else 0 end;
      if v_base > v_revision then raise exception 'Client revision ahead of server' using errcode = '22023'; end if;
      v_conflict := v_base <> v_revision and coalesce(v_mark.status,'new') <> v_status;
      v_next := v_status;
      if v_conflict then
        v_next := case when v_status = 'weak' or v_mark.status = 'weak' then 'weak'
                       when v_status = 'known' or v_mark.status = 'known' then 'known' else 'new' end;
      end if;
      if not v_exists then
        insert into public.pocket_study_marks(user_id,card_id,status) values(v_uid,v_card,v_next) returning * into v_mark;
      elsif v_mark.status <> v_next then
        update public.pocket_study_marks set status = v_next where user_id = v_uid and card_id = v_card returning * into v_mark;
      end if;
      insert into public.pocket_sync_operations(user_id,operation_id,request_hash,result)
        values(v_uid,v_id,v_hash,jsonb_build_object('kind','mark','cardId',v_card,'conflict',v_conflict,'revision',v_mark.revision));
      if v_conflict then v_conflicts := v_conflicts || jsonb_build_array(v_card); end if;
    end if;
    v_ack := v_ack || jsonb_build_array(v_id::text);
  end loop;

  if p_view is not null and p_view <> 'null'::jsonb then
    if jsonb_typeof(p_view) is distinct from 'object'
       or not (p_view ?& array['operationId','cardId','filter','category','baseRevision'])
       or p_view - array['operationId','cardId','filter','category','baseRevision'] <> '{}'::jsonb
       or jsonb_typeof(p_view->'baseRevision') is distinct from 'number'
       or (p_view->>'baseRevision') !~ '^[0-9]+$' then
      raise exception 'Invalid view' using errcode = '22023';
    end if;
    v_id := (p_view->>'operationId')::uuid; v_base := (p_view->>'baseRevision')::bigint; v_card := p_view->>'cardId';
    if v_id is null or v_base > 9007199254740991 or (v_card is not null and not exists(select 1 from public.pocket_cards where card_id = v_card))
       or coalesce(p_view->>'filter','') not in ('core','all','weak','new')
       or not (p_view->>'category' = 'all' or exists(select 1 from public.pocket_cards where category = p_view->>'category')) then
      raise exception 'Invalid view scope' using errcode = '22023';
    end if;
    v_hash := encode(sha256(convert_to(jsonb_build_object('kind','view','payload',p_view)::text,'UTF8')),'hex');
    select * into v_saved from public.pocket_sync_operations where user_id = v_uid and operation_id = v_id;
    if found then
      if v_saved.request_hash <> v_hash then raise exception 'Operation ID reused with different data' using errcode = '22023'; end if;
      v_view_conflict := coalesce((v_saved.result->>'conflict')::boolean,false);
    else
      select * into v_position from public.pocket_view_state where user_id = v_uid;
      v_exists := found; v_revision := case when v_exists then v_position.revision else 0 end;
      if v_base > v_revision then raise exception 'View revision ahead of server' using errcode = '22023'; end if;
      v_view_conflict := v_base <> v_revision;
      if not v_exists then
        insert into public.pocket_view_state(user_id,card_id,filter,category) values(v_uid,v_card,p_view->>'filter',p_view->>'category');
      elsif not v_view_conflict and (v_position.card_id is distinct from v_card or v_position.filter <> p_view->>'filter' or v_position.category <> p_view->>'category') then
        update public.pocket_view_state set card_id = v_card, filter = p_view->>'filter', category = p_view->>'category' where user_id = v_uid;
      end if;
      insert into public.pocket_sync_operations(user_id,operation_id,request_hash,result) values(v_uid,v_id,v_hash,jsonb_build_object('kind','view','conflict',v_view_conflict));
    end if;
    v_ack := v_ack || jsonb_build_array(v_id::text);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('cardId',card_id,'status',status,'revision',revision,'updatedAt',updated_at) order by card_id),'[]'::jsonb)
    into v_marks from public.pocket_study_marks where user_id = v_uid;
  select jsonb_build_object('cardId',card_id,'filter',filter,'category',category,'revision',revision,'updatedAt',updated_at)
    into v_view_result from public.pocket_view_state where user_id = v_uid;
  return jsonb_build_object('complete',true,'marks',v_marks,'view',v_view_result,'acknowledgedOperationIds',v_ack,'conflicts',v_conflicts,'viewConflict',v_view_conflict);
end;
$$;
revoke all on function public.pocket_sync_progress(jsonb,jsonb) from public, anon;
grant execute on function public.pocket_sync_progress(jsonb,jsonb) to authenticated;

-- Canonical card IDs and categories are appended from the existing lesson data.

insert into public.pocket_cards(card_id,category) values
('compass-1','compass'),
('compass-2','compass'),
('compass-3','compass'),
('compass-4','compass'),
('compass-5','compass'),
('compass-6','compass'),
('compass-7','compass'),
('compass-8','compass'),
('compass-9','compass'),
('compass-10','compass'),
('compass-11','compass'),
('compass-12','compass'),
('compass-13','compass'),
('position-14','position'),
('position-15','position'),
('position-16','position'),
('position-17','position'),
('position-18','position'),
('position-19','position'),
('position-20','position'),
('position-21','position'),
('position-22','position'),
('position-23','position'),
('position-24','position'),
('position-25','position'),
('position-26','position'),
('position-27','position'),
('position-28','position'),
('position-29','position'),
('position-30','position'),
('position-31','position'),
('position-32','position'),
('position-33','position'),
('position-34','position'),
('position-35','position'),
('position-36','position'),
('route-37','route'),
('route-38','route'),
('route-39','route'),
('route-40','route'),
('route-41','route'),
('route-42','route'),
('route-43','route'),
('route-44','route'),
('route-45','route'),
('route-46','route'),
('route-47','route'),
('route-48','route'),
('route-49','route'),
('route-50','route'),
('route-51','route'),
('route-52','route'),
('route-53','route'),
('route-54','route'),
('route-55','route'),
('route-56','route'),
('route-57','route'),
('route-58','route'),
('route-59','route'),
('route-60','route'),
('junction-61','junction'),
('junction-62','junction'),
('junction-63','junction'),
('junction-64','junction'),
('junction-65','junction'),
('junction-66','junction'),
('junction-67','junction'),
('junction-68','junction'),
('junction-69','junction'),
('junction-70','junction'),
('junction-71','junction'),
('junction-72','junction'),
('junction-73','junction'),
('junction-74','junction'),
('junction-75','junction'),
('junction-76','junction'),
('junction-77','junction'),
('junction-78','junction'),
('junction-79','junction'),
('junction-80','junction'),
('precise-81','precise'),
('precise-82','precise'),
('precise-83','precise'),
('precise-84','precise'),
('precise-85','precise'),
('precise-86','precise'),
('precise-87','precise'),
('precise-88','precise'),
('precise-89','precise'),
('precise-90','precise'),
('precise-91','precise'),
('precise-92','precise'),
('precise-93','precise'),
('precise-94','precise'),
('precise-95','precise'),
('precise-96','precise'),
('precise-97','precise'),
('precise-98','precise'),
('precise-99','precise'),
('precise-100','precise'),
('precise-101','precise'),
('precise-102','precise'),
('precise-103','precise'),
('precise-104','precise'),
('indoor-105','indoor'),
('indoor-106','indoor'),
('indoor-107','indoor'),
('indoor-108','indoor'),
('indoor-109','indoor'),
('indoor-110','indoor'),
('indoor-111','indoor'),
('indoor-112','indoor'),
('indoor-113','indoor'),
('indoor-114','indoor'),
('indoor-115','indoor'),
('indoor-116','indoor'),
('indoor-117','indoor'),
('indoor-118','indoor'),
('indoor-119','indoor'),
('changes-120','changes'),
('changes-121','changes'),
('changes-122','changes'),
('changes-123','changes'),
('changes-124','changes'),
('changes-125','changes'),
('changes-126','changes'),
('changes-127','changes'),
('changes-128','changes'),
('extra-129','extra'),
('extra-130','extra'),
('extra-131','extra'),
('extra-132','extra');
