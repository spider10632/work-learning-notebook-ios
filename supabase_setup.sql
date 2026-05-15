-- Supabase setup for Work Learning Notebook cloud MVP
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '',
  category text not null,
  tags text[] not null default '{}',
  favorite boolean not null default false,
  attachments text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_category_check check (
    category in (
      'SOP',
      'System',
      'Guest Handling',
      'Language',
      'Quick Access',
      'Training',
      'Other'
    )
  )
);

create index if not exists notes_user_id_idx on public.notes(user_id);
create index if not exists notes_user_updated_idx on public.notes(user_id, updated_at desc);
create index if not exists notes_user_favorite_updated_idx on public.notes(user_id, favorite desc, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notes_set_updated_at on public.notes;
create trigger trg_notes_set_updated_at
before update on public.notes
for each row
execute function public.set_updated_at();

alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;

create policy "notes_select_own"
on public.notes
for select
to authenticated
using (auth.uid() = user_id);

create policy "notes_insert_own"
on public.notes
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "notes_update_own"
on public.notes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "notes_delete_own"
on public.notes
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('note-attachments', 'note-attachments', false)
on conflict (id) do nothing;

drop policy if exists "storage_select_own" on storage.objects;
drop policy if exists "storage_insert_own" on storage.objects;
drop policy if exists "storage_update_own" on storage.objects;
drop policy if exists "storage_delete_own" on storage.objects;

create policy "storage_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'note-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'note-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'note-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'note-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'note-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
