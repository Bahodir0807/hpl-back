import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CalculationRequest nullable supplier database contract', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260822170000_calculation_request_supplier_optional',
      'migration.sql',
    ),
    'utf8',
  );

  it('keeps CalculationLineItem supplier optional in Prisma and PostgreSQL', () => {
    expect(schema).toMatch(/supplierId\s+String\?/);
    expect(migration).toContain('ALTER COLUMN "supplierId" DROP NOT NULL');
    expect(migration).toContain('ON DELETE SET NULL');
  });
});
