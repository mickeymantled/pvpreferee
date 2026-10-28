-- Exactly five domain tables. Migration bookkeeping uses a table comment, not a sixth table.
CREATE TABLE memes (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, scope text NOT NULL CHECK (scope IN ('artifact','concept')),
  canonical_name text NOT NULL, canonical_ticker text NOT NULL, source_url text NOT NULL,
  source_tier text NOT NULL CHECK (source_tier IN ('subject_post','official_asset','site_text','wiki')),
  source_image_hash text, subject_handle text, home_chain text, implied_pair text, beneficiary_wallet text,
  beneficiary_tie_at timestamptz(3), created_by text NOT NULL, override_audit jsonb NOT NULL, raw_record jsonb NOT NULL,
  CHECK (jsonb_typeof(override_audit) = 'array'), CHECK (raw_record->'overrides' = override_audit),
  CHECK (raw_record->>'id' = id)
);
CREATE TABLE coins (
  ca text NOT NULL, facts_hash text NOT NULL, meme_id text REFERENCES memes(id), chain text NOT NULL,
  launchpad text, pair_asset text, name text NOT NULL, ticker text NOT NULL, image_hash text,
  creator_wallet text, fee_wallet text, deployed_at timestamptz(3), first_real_buy_at timestamptz(3), bonded_at timestamptz(3),
  observed_at timestamptz(3) NOT NULL, raw_facts jsonb NOT NULL, config_hash text NOT NULL, frozen_config jsonb NOT NULL,
  PRIMARY KEY (ca, facts_hash), CHECK (raw_facts->>'ca' = ca)
);
CREATE TABLE snapshots (
  coin_ca text NOT NULL, at timestamptz(3) NOT NULL, config_hash text NOT NULL, id text NOT NULL UNIQUE,
  mcap_usd double precision, holders integer, distinct_buyers_lifetime integer, last_trade_at timestamptz(3),
  source text NOT NULL, complete boolean NOT NULL, raw_snapshot jsonb NOT NULL, frozen_config jsonb NOT NULL,
  PRIMARY KEY (coin_ca, at, config_hash), CHECK (complete),
  CHECK (mcap_usd >= 0 AND mcap_usd < 'Infinity'::float8), CHECK (holders >= 0), CHECK (distinct_buyers_lifetime >= 0),
  CHECK (mcap_usd IS NOT NULL AND holders IS NOT NULL AND distinct_buyers_lifetime IS NOT NULL),
  CHECK (last_trade_at IS NULL OR last_trade_at <= at), CHECK (raw_snapshot->>'coin_ca' = coin_ca),
  CHECK ((raw_snapshot->>'at')::timestamptz = at), CHECK (raw_snapshot->>'config_hash' = config_hash)
);
CREATE TABLE endorsements (
  id text PRIMARY KEY, coin_ca text NOT NULL, kind text NOT NULL CHECK (kind IN ('ca_post','majority_supply','fee_claim')),
  evidence_url text, evidence_tx text, at timestamptz(3) NOT NULL, verified_by text, raw_record jsonb NOT NULL,
  CHECK (raw_record->>'coin_ca' = coin_ca)
);
CREATE TABLE rulings (
  id text PRIMARY KEY, meme_id text NOT NULL REFERENCES memes(id), coin_cas text[] NOT NULL, winner_ca text,
  grid jsonb NOT NULL, flags jsonb NOT NULL, config_hash text NOT NULL, rules_version text NOT NULL,
  facts_hash text NOT NULL, created_at timestamptz(3) NOT NULL, share_slug text NOT NULL UNIQUE,
  frozen_facts jsonb NOT NULL, frozen_config jsonb NOT NULL, raw_ruling jsonb NOT NULL,
  CHECK (raw_ruling->>'id' = id), CHECK (raw_ruling->>'share_slug' = share_slug),
  CHECK (raw_ruling->'facts' = frozen_facts), CHECK (frozen_facts->'config' = frozen_config),
  CHECK (winner_ca IS NULL OR winner_ca = ANY(coin_cas))
);
CREATE FUNCTION pvp_reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; insert a new version', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER coins_immutable BEFORE UPDATE OR DELETE ON coins FOR EACH ROW EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER coins_no_truncate BEFORE TRUNCATE ON coins FOR EACH STATEMENT EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER snapshots_immutable BEFORE UPDATE OR DELETE ON snapshots FOR EACH ROW EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER snapshots_no_truncate BEFORE TRUNCATE ON snapshots FOR EACH STATEMENT EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER endorsements_immutable BEFORE UPDATE OR DELETE ON endorsements FOR EACH ROW EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER endorsements_no_truncate BEFORE TRUNCATE ON endorsements FOR EACH STATEMENT EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER rulings_immutable BEFORE UPDATE OR DELETE ON rulings FOR EACH ROW EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER rulings_no_truncate BEFORE TRUNCATE ON rulings FOR EACH STATEMENT EXECUTE FUNCTION pvp_reject_immutable_mutation();

CREATE FUNCTION pvp_validate_meme_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_count integer; new_count integer; i integer; field_name text; entry jsonb;
BEGIN
  -- Indexed columns must agree with the audited JSON; direct SQL cannot bypass audit by editing an index column alone.
  FOREACH field_name IN ARRAY ARRAY['id','slug','scope','canonical_name','canonical_ticker','source_url','source_tier','source_image_hash','subject_handle','home_chain','implied_pair','beneficiary_wallet','created_by'] LOOP
    IF to_jsonb(NEW)->field_name IS DISTINCT FROM NEW.raw_record->field_name THEN
      RAISE EXCEPTION 'Meme index field % disagrees with audited JSON', field_name USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF NEW.beneficiary_tie_at IS DISTINCT FROM (NEW.raw_record->>'beneficiary_tie_at')::timestamptz THEN
    RAISE EXCEPTION 'Meme timestamp disagrees with audited JSON' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    old_count := 0;
  ELSE
  old_count := jsonb_array_length(OLD.override_audit);
  END IF;
  new_count := jsonb_array_length(NEW.override_audit);
  IF (TG_OP = 'UPDATE' AND NEW.id <> OLD.id) OR new_count < old_count THEN
    RAISE EXCEPTION 'Meme identity and override audit cannot be replaced' USING ERRCODE = '55000';
  END IF;
  IF old_count > 0 THEN
    FOR i IN 0..old_count-1 LOOP
      IF NEW.override_audit->i IS DISTINCT FROM OLD.override_audit->i THEN
        RAISE EXCEPTION 'Meme audit must be append-only' USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END IF;
  IF new_count > old_count THEN
    FOR i IN old_count..new_count-1 LOOP
      entry := NEW.override_audit->i;
      IF NOT (entry ?& ARRAY['field','previous','value','actor','at','reason']) OR
         COALESCE(entry->>'field','') = '' OR COALESCE(entry->>'actor','') = '' OR COALESCE(entry->>'reason','') = '' OR
         jsonb_typeof(entry->'at') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Override needs field, previous, value, actor, at and reason' USING ERRCODE = '23514';
      END IF;
      PERFORM (entry->>'at')::timestamptz;
    END LOOP;
  END IF;
  IF TG_OP = 'UPDATE' THEN
  FOR field_name IN SELECT jsonb_object_keys(OLD.raw_record || NEW.raw_record) LOOP
    IF field_name <> 'overrides' AND OLD.raw_record->field_name IS DISTINCT FROM NEW.raw_record->field_name THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.override_audit) WITH ORDINALITY AS a(value, ordinal)
        WHERE ordinal > old_count AND value->>'field' = field_name
        AND value->'previous' = COALESCE(OLD.raw_record->field_name, 'null'::jsonb)
        AND value->'value' = COALESCE(NEW.raw_record->field_name, 'null'::jsonb)) THEN
        RAISE EXCEPTION 'Meme field % changed without a matching audit entry', field_name USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER memes_audit BEFORE INSERT OR UPDATE ON memes FOR EACH ROW EXECUTE FUNCTION pvp_validate_meme_audit();
CREATE TRIGGER memes_no_delete BEFORE DELETE ON memes FOR EACH ROW EXECUTE FUNCTION pvp_reject_immutable_mutation();
CREATE TRIGGER memes_no_truncate BEFORE TRUNCATE ON memes FOR EACH STATEMENT EXECUTE FUNCTION pvp_reject_immutable_mutation();
COMMENT ON TABLE rulings IS 'pvp-ingest:0001';
