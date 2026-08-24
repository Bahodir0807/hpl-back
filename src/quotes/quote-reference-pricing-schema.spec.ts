import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PanelQuote optional reference pricing database contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260823010000_quote_reference_pricing_optional',
      'migration.sql',
    ),
    'utf8',
  );

  it('allows an unpriced draft item without changing calculation pricing', () => {
    expect(schema).toMatch(/model PanelQuoteItem[\s\S]*pricePerM2\s+Decimal\?/);
    expect(schema).toMatch(
      /model PanelQuoteItem[\s\S]*supplierPricePerM2\s+Decimal\?/,
    );
    expect(migration).toContain(
      'ALTER COLUMN "supplierPricePerM2" DROP NOT NULL',
    );
    expect(migration).toContain('ALTER COLUMN "pricePerM2" DROP NOT NULL');
    expect(schema).toMatch(
      /model CalculationLineItem[\s\S]*supplierPricePerM2\s+Decimal\s/,
    );
  });
});
