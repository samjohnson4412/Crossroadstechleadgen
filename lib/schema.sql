-- Run this in your Supabase SQL editor to set up the database

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  address text,
  city text,
  state text default 'FL',
  zip text,
  county text,
  employee_count_estimate text,
  industry text,
  contact_name text,
  contact_title text,
  contact_phone text,
  contact_email text,
  current_isp text,
  internet_speed text,
  phone_system text check (phone_system in ('POTS', 'VoIP', 'Unknown')),
  has_cameras boolean,
  has_managed_it boolean,
  lead_source text,
  pitch_angle text,
  status text not null default 'cold'
    check (status in ('cold','researched','contacted','engaged','qualified','transferred')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high')),
  assigned_to text,
  notes text,
  zoho_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists outreach_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  contact_date date not null,
  method text not null check (method in ('Call','Email','Visit','LinkedIn','Text')),
  outcome text not null,
  contacted_by text,
  notes text,
  next_follow_up date,
  created_at timestamptz not null default now()
);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists businesses_updated_at on businesses;
create trigger businesses_updated_at
  before update on businesses
  for each row execute function update_updated_at();

create index if not exists businesses_status_idx on businesses(status);
create index if not exists businesses_county_idx on businesses(county);
create index if not exists businesses_created_at_idx on businesses(created_at desc);
create index if not exists outreach_business_id_idx on outreach_log(business_id);
create index if not exists outreach_next_follow_up_idx on outreach_log(next_follow_up);
