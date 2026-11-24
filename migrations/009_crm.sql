-- Sales CRM for OwnerTag B2B prospects (admin-only). One row per company;
-- the company record is JSON so the CRM page can evolve without migrations.
CREATE TABLE IF NOT EXISTS crm_companies (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
