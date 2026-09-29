-- Do I Have It — Supabase schema
-- Run this once in your Supabase project's SQL editor (Dashboard → SQL Editor → New query).

create table if not exists items (
  id text not null,
  title text not null,
  format text default 'Unknown',
  barcode text,
  cover text,
  added timestamptz default now(),
  production_year int,
  premiere_date date,
  official_rating text,
  community_rating numeric,
  critic_rating numeric,
  runtime_minutes int,
  media_type text default 'Movie',
  status text,
  provider_ids jsonb default '{}',
  jellyfin_id text,
  jellyfin_collection_ids text[] default '{}',
  jellyfin_collection_names text[] default '{}',
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (user_id, id)
);

create table if not exists wishlist (
  id text not null,
  title text not null,
  cover text,
  added timestamptz default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (user_id, id)
);

alter table items enable row level security;
alter table wishlist enable row level security;
revoke all on table items, wishlist from anon;
grant select, insert, update, delete on table items, wishlist to authenticated;

-- Each signed-in user can only ever see or change their own rows.
-- This is what replaces the GitHub token: there is no separate "write secret" —
-- access is controlled by who is logged in.
drop policy if exists "owner full access" on items;
create policy "owner full access" on items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owner full access" on wishlist;
create policy "owner full access" on wishlist
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Helpful for the library filter/search and sorting by title.
create index if not exists items_title_idx on items (title);
create index if not exists wishlist_title_idx on wishlist (title);
