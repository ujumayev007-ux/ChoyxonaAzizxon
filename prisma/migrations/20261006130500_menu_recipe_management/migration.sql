ALTER TABLE "Recipe" ADD COLUMN "unit" TEXT;

ALTER TABLE "Order" ADD COLUMN "recipesDeductedAt" TIMESTAMP(3);

ALTER TABLE "InventoryTransaction" ADD COLUMN "menuItemId" TEXT;

CREATE INDEX "InventoryTransaction_referenceOrderId_idx" ON "InventoryTransaction"("referenceOrderId");
CREATE INDEX "InventoryTransaction_menuItemId_idx" ON "InventoryTransaction"("menuItemId");

ALTER TABLE "InventoryTransaction"
ADD CONSTRAINT "InventoryTransaction_referenceOrderId_fkey"
FOREIGN KEY ("referenceOrderId") REFERENCES "Order"("id")
ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "InventoryTransaction"
ADD CONSTRAINT "InventoryTransaction_menuItemId_fkey"
FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

UPDATE "MenuCategory"
SET "name" = 'Baliqlar'
WHERE LOWER(BTRIM("name")) = 'baliq'
  AND NOT EXISTS (
    SELECT 1 FROM "MenuCategory" existing
    WHERE LOWER(BTRIM(existing."name")) = 'baliqlar'
  );

WITH required("name", "sortOrder") AS (
    VALUES
        ('Osh', 10),
        ('Suyuq ovqatlar', 20),
        ('Quyuq taomlar', 30),
        ('Hamirli taomlar', 40),
        ('Kaboblar', 50),
        ('Somsalar', 60),
        ('Fast Food', 70),
        ('Ichimliklar', 80),
        ('Baliqlar', 90)
)
INSERT INTO "MenuCategory" ("id", "name", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, required."name", required."sortOrder", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM required
WHERE NOT EXISTS (
    SELECT 1 FROM "MenuCategory" existing
    WHERE LOWER(BTRIM(existing."name")) = LOWER(required."name")
);

WITH required("name", "sortOrder") AS (
    VALUES
        ('Osh', 10),
        ('Suyuq ovqatlar', 20),
        ('Quyuq taomlar', 30),
        ('Hamirli taomlar', 40),
        ('Kaboblar', 50),
        ('Somsalar', 60),
        ('Fast Food', 70),
        ('Ichimliklar', 80),
        ('Baliqlar', 90)
)
UPDATE "MenuCategory" category
SET "sortOrder" = required."sortOrder"
FROM required
WHERE LOWER(BTRIM(category."name")) = LOWER(required."name")
  AND category."sortOrder" = 0;
