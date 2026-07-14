-- Fase "verificação funcional": process_inbound_message era anterior ao multi-tenant
-- (Fase 2A). Sem p_tenant_id, o lookup de conversa e o lookup de contato não
-- filtravam por tenant, e o INSERT em inbox_conversations/inbox_messages falhava
-- por violar a constraint NOT NULL de tenant_id (bloqueava 100% do recebimento
-- de mensagens em produção).
CREATE OR REPLACE FUNCTION public.process_inbound_message(
  p_tenant_id uuid,
  p_phone text,
  p_content text,
  p_whatsapp_message_id text DEFAULT NULL::text,
  p_message_type text DEFAULT 'text'::text,
  p_media_url text DEFAULT NULL::text,
  p_payload jsonb DEFAULT NULL::jsonb,
  p_contact_id text DEFAULT NULL::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id UUID;
  v_message_id UUID;
  v_conversation_status TEXT;
  v_conversation_mode TEXT;
  v_ai_agent_id UUID;
  v_human_mode_expires_at TIMESTAMPTZ;
  v_automation_paused_until TIMESTAMPTZ;
  v_is_new_conversation BOOLEAN := FALSE;
  v_message_preview TEXT;
  v_contact_id TEXT;
  v_current_contact_id TEXT;
BEGIN
  -- Auto-lookup contact by phone if not provided (agora escopado por tenant)
  IF p_contact_id IS NULL THEN
    SELECT id INTO v_contact_id FROM contacts WHERE phone = p_phone AND tenant_id = p_tenant_id LIMIT 1;
  ELSE
    v_contact_id := p_contact_id;
  END IF;

  v_message_preview := CASE
    WHEN LENGTH(p_content) > 100 THEN SUBSTRING(p_content, 1, 100) || '...'
    ELSE p_content
  END;

  -- 1. Busca conversa existente pelo telefone, escopada por tenant
  SELECT
    id, status, mode, ai_agent_id, human_mode_expires_at, automation_paused_until, contact_id
  INTO
    v_conversation_id, v_conversation_status, v_conversation_mode,
    v_ai_agent_id, v_human_mode_expires_at, v_automation_paused_until, v_current_contact_id
  FROM inbox_conversations
  WHERE phone = p_phone AND tenant_id = p_tenant_id
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 1;

  -- 2. Se não existe, cria nova conversa (com tenant_id)
  IF v_conversation_id IS NULL THEN
    INSERT INTO inbox_conversations (
      tenant_id,
      phone,
      contact_id,
      mode,
      status,
      total_messages,
      unread_count,
      last_message_at,
      last_message_preview
    ) VALUES (
      p_tenant_id,
      p_phone,
      v_contact_id,
      'bot',
      'open',
      1,
      1,
      NOW(),
      v_message_preview
    )
    RETURNING id, mode, ai_agent_id, human_mode_expires_at, automation_paused_until
    INTO v_conversation_id, v_conversation_mode, v_ai_agent_id,
         v_human_mode_expires_at, v_automation_paused_until;

    v_is_new_conversation := TRUE;
    v_conversation_status := 'open';
  ELSE
    -- 3. Se existe, atualiza contadores e reabre se fechada
    UPDATE inbox_conversations
    SET
      total_messages = total_messages + 1,
      unread_count = unread_count + 1,
      last_message_at = NOW(),
      last_message_preview = v_message_preview,
      status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
      contact_id = COALESCE(contact_id, v_contact_id),
      updated_at = NOW()
    WHERE id = v_conversation_id
    RETURNING status INTO v_conversation_status;
  END IF;

  -- 4. Cria mensagem (com tenant_id)
  INSERT INTO inbox_messages (
    tenant_id,
    conversation_id,
    direction,
    content,
    message_type,
    whatsapp_message_id,
    media_url,
    delivery_status,
    payload
  ) VALUES (
    p_tenant_id,
    v_conversation_id,
    'inbound',
    p_content,
    p_message_type,
    p_whatsapp_message_id,
    p_media_url,
    'delivered',
    p_payload
  )
  RETURNING id INTO v_message_id;

  -- 5. Retorna resultado completo
  RETURN json_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'is_new_conversation', v_is_new_conversation,
    'conversation_status', v_conversation_status,
    'conversation_mode', v_conversation_mode,
    'ai_agent_id', v_ai_agent_id,
    'human_mode_expires_at', v_human_mode_expires_at,
    'automation_paused_until', v_automation_paused_until
  );
END;
$function$;
