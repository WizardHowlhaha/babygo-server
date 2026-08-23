ALTER TABLE walk_plans
    ADD COLUMN IF NOT EXISTS activity_kind VARCHAR(30) NOT NULL DEFAULT 'custom',
    ADD COLUMN IF NOT EXISTS shared_toys TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS shared_pets TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE walk_plans
    ALTER COLUMN participant_limit DROP NOT NULL,
    ALTER COLUMN participant_limit DROP DEFAULT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'walk_plans_participant_limit_valid'
    ) THEN
        ALTER TABLE walk_plans
            DROP CONSTRAINT walk_plans_participant_limit_valid;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'walk_plans_participant_limit_valid'
    ) THEN
        ALTER TABLE walk_plans
            ADD CONSTRAINT walk_plans_participant_limit_valid
            CHECK (participant_limit IS NULL OR participant_limit BETWEEN 2 AND 20);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'walk_plans_activity_kind_valid'
    ) THEN
        ALTER TABLE walk_plans
            ADD CONSTRAINT walk_plans_activity_kind_valid
            CHECK (activity_kind IN ('outdoor', 'mall', 'pet', 'custom'));
    END IF;
END $$;
