-- Run this in the Supabase SQL editor

-- Token balances (one row per user)
create table if not exists token_balances (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade unique,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table token_balances enable row level security;

-- Users can read their own balance
create policy "Users can read own balance"
  on token_balances for select
  using (auth.uid() = user_id);

-- Token transaction log
create table if not exists token_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete cascade,
  amount            integer not null,
  type              text not null check (type in ('purchase', 'usage')),
  stripe_session_id text,
  created_at        timestamptz default now()
);

alter table token_transactions enable row level security;

create policy "Users can read own transactions"
  on token_transactions for select
  using (auth.uid() = user_id);

-- Atomic deduct: returns true if deducted, false if insufficient balance
create or replace function deduct_token(p_user_id uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  v_balance integer;
begin
  select balance into v_balance
  from token_balances
  where user_id = p_user_id
  for update;

  if v_balance is null or v_balance < 1 then
    return false;
  end if;

  update token_balances
  set balance = balance - 1, updated_at = now()
  where user_id = p_user_id;

  insert into token_transactions (user_id, amount, type)
  values (p_user_id, -1, 'usage');

  return true;
end;
$$;

-- Atomic credit: idempotent on stripe_session_id
create or replace function credit_tokens(p_user_id uuid, p_amount integer, p_stripe_session_id text)
returns void
language plpgsql
security definer
as $$
begin
  -- Guard against duplicate webhook delivery
  if exists (
    select 1 from token_transactions
    where stripe_session_id = p_stripe_session_id
  ) then
    return;
  end if;

  insert into token_balances (user_id, balance)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set balance = token_balances.balance + p_amount,
        updated_at = now();

  insert into token_transactions (user_id, amount, type, stripe_session_id)
  values (p_user_id, p_amount, 'purchase', p_stripe_session_id);
end;
$$;
