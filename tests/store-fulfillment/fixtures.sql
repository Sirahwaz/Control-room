\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.midad_wallets (
  id uuid primary key default gen_random_uuid()
);

CREATE TABLE public.midad_payment_intents (
  id uuid primary key,
  status text not null,
  reconciliation_status text not null,
  amount_fiat numeric not null,
  fiat_currency text not null,
  settlement_asset text,
  network text,
  quoted_crypto_amount numeric,
  wallet_address text,
  received_tx_hash text,
  verified_at timestamptz,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

CREATE TABLE public.midad_store_orders (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null unique references public.midad_payment_intents(id) on delete restrict,
  product_id text not null,
  product_name text not null,
  status text not null check (status in ('AWAITING_PAYMENT','PAID','FULFILLING','DELIVERED','REFUND_REVIEW','CANCELLED')),
  customer_requirements text,
  paid_at timestamptz,
  delivered_at timestamptz,
  fulfillment_job_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

CREATE TABLE public.midad_wallet_receipts (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.midad_wallets(id),
  tx_hash text not null,
  asset text not null,
  network text not null,
  amount numeric not null,
  direction text not null,
  matched_payment_intent_id uuid references public.midad_payment_intents(id),
  mint text,
  commitment text,
  detected_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb
);
