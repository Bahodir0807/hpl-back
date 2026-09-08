import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CalculationRequest nullable supplier database contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );
  const supplierMigration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260822170000_calculation_request_supplier_optional',
      'migration.sql',
    ),
    'utf8',
  );
  const incompleteMigration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260831010000_calculation_line_item_incomplete_ok',
      'migration.sql',
    ),
    'utf8',
  );

  it('keeps CalculationLineItem supplier optional in Prisma and PostgreSQL', () => {
    expect(schema).toMatch(/supplierId\s+String\?/);
    expect(supplierMigration).toContain(
      'ALTER COLUMN "supplierId" DROP NOT NULL',
    );
    expect(supplierMigration).toContain('ON DELETE SET NULL');
  });

  it('allows incomplete qualification snapshots without fake catalog values', () => {
    expect(schema).toMatch(/panelTypeId\s+String\?/);
    expect(schema).toMatch(/panelSizeId\s+String\?/);
    expect(schema).toMatch(/thicknessMm\s+Decimal\?/);
    expect(schema).toMatch(/qualityClassId\s+String\?/);
    expect(incompleteMigration).toContain(
      'ALTER COLUMN "panelSizeId" DROP NOT NULL',
    );
    expect(incompleteMigration).toContain(
      'ALTER COLUMN "qualityClassId" DROP NOT NULL',
    );
  });

  it('stores customer coating/texture on qualification items and free-text Decor on line items', () => {
    expect(schema).toMatch(
      /model LeadQualificationItem \{[\s\S]*coating\s+String\?/,
    );
    expect(schema).toMatch(
      /model LeadQualificationItem \{[\s\S]*texture\s+String\?/,
    );
    expect(schema).toMatch(
      /model CalculationLineItem \{[\s\S]*decor\s+String\?/,
    );
  });
});
