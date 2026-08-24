-- Ensure confirmed quality classes exist (no fourth class).
INSERT INTO "QualityClass" ("id", "code", "nameRu")
VALUES
  (gen_random_uuid()::text, 'economy', 'Эконом'),
  (gen_random_uuid()::text, 'medium', 'Медиум'),
  (gen_random_uuid()::text, 'premium', 'Премиум')
ON CONFLICT ("code") DO UPDATE SET "nameRu" = EXCLUDED."nameRu";

-- Every in-use CRM manufacturer must expose Эконом / Медиум / Премиум
-- for every standard HPL type via SupplierQualityMapping.
INSERT INTO "SupplierQualityMapping" ("id", "supplierId", "panelTypeId", "qualityClassId", "isDefault")
SELECT
  gen_random_uuid()::text,
  s."id",
  pt."id",
  qc."id",
  (qc."code" = CASE s."code"
    WHEN 'wuya' THEN 'economy'
    WHEN 'polybet' THEN 'premium'
    ELSE 'medium'
  END)
FROM "Supplier" s
CROSS JOIN "PanelType" pt
CROSS JOIN "QualityClass" qc
WHERE s."code" IN ('wuya', 'tianran', 'polybet')
  AND pt."code" IN ('interior', 'exterior_with_uv', 'laboratory', 'furniture')
  AND qc."code" IN ('economy', 'medium', 'premium')
ON CONFLICT ("supplierId", "panelTypeId", "qualityClassId") DO UPDATE
SET "isDefault" = EXCLUDED."isDefault";
