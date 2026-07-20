-- `CREATE OR REPLACE FUNCTION` with a new signature creates a new function
-- object. PostgreSQL grants EXECUTE to PUBLIC by default, so the tenant-scoped
-- inbox RPC introduced in 20260719000001 became callable through Data API by
-- anon/authenticated roles despite being SECURITY DEFINER.
--
-- This RPC is an internal webhook hot-path and is called only with the
-- server-side service role. Restrict execution accordingly.
REVOKE ALL ON FUNCTION public.process_inbound_message(
  uuid, text, text, text, text, text, jsonb, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_inbound_message(
  uuid, text, text, text, text, text, jsonb, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.process_inbound_message(
  uuid, text, text, text, text, text, jsonb, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_inbound_message(
  uuid, text, text, text, text, text, jsonb, text, text
) TO service_role;
