DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Table"
        GROUP BY "roomId", "number"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate table numbers exist within a room. Resolve them without deleting tables before applying this migration.';
    END IF;
END;
$$;

CREATE UNIQUE INDEX "Table_roomId_number_key" ON "Table"("roomId", "number");
