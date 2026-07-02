-- Add REBAR_UNDER_70CM enum value (must be in its own migration before use).
ALTER TYPE "SalesOrderKind" ADD VALUE IF NOT EXISTS 'REBAR_UNDER_70CM';
