-- A função de busca da base de conhecimento usa o operador <=> do pgvector, que vive no
-- schema "extensions". Com search_path = 'public' o operador não é encontrado (erro 42883).
-- Só ajusta o search_path das duas variantes; não altera dados.
alter function public.search_embeddings(vector, uuid, integer, uuid, double precision, integer)
  set search_path to public, extensions;
alter function public.search_embeddings(vector, uuid, double precision, integer, uuid)
  set search_path to public, extensions;
