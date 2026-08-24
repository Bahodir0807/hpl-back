import { PrismaClient } from '@prisma/client';
import { seedCalculatorProduct } from './calculator-product';
import {
  hasActiveCnyUsdRate,
  seedPanels,
  type ReferenceSeedReport,
} from './panels';

export type { ReferenceSeedReport };

export async function seedReferenceConfiguration(prisma: PrismaClient): Promise<
  ReferenceSeedReport & {
    calculatorProductSku: string;
    calculatorProductId: string;
  }
> {
  const panels = await seedPanels(prisma);
  const calculator = await seedCalculatorProduct(prisma);
  const activeCnyUsdRate = await hasActiveCnyUsdRate(prisma);

  return {
    ...panels,
    activeCnyUsdRate,
    calculatorProductSku: 'HPL-CALC-PANEL',
    calculatorProductId: calculator.id,
  };
}

export function printReferenceSeedReport(
  report: Awaited<ReturnType<typeof seedReferenceConfiguration>>,
): void {
  console.log(
    'Reference/configuration seed completed (non-destructive upsert).',
  );
  console.log(`  Panel types: ${report.panelTypeCodes.join(', ')}`);
  console.log(`  Canonical panel sizes: ${report.canonicalSizeCount}`);
  console.log(
    `  Deactivated legacy sizes: ${report.deactivatedLegacySizeCount}`,
  );
  console.log(`  Quality classes: ${report.qualityClassCodes.join(', ')}`);
  console.log(`  Suppliers: ${report.supplierCodes.join(', ')}`);
  console.log(`  Supplier quality mappings: ${report.mappingCount}`);
  console.log(
    '  Quality lines: each CRM manufacturer (wuya/tianran/polybet) exposes economy, medium and premium for every standard HPL type.',
  );
  console.log(
    `  Calculator product: ${report.calculatorProductSku} (${report.calculatorProductId})`,
  );
  console.log(
    `  Deactivated unconfirmed 16mm pricing rows: ${report.deactivatedLegacyPricingCount}`,
  );

  if (report.activeCnyUsdRate) {
    console.log('  CurrencyRate: an active CNY→USD rate already exists.');
  } else {
    console.log(
      '  CurrencyRate: no active CNY→USD rate. DIRECTOR must enter one before pricing can run.',
    );
  }

  console.log(
    '  Thickness pricing: no supplier CNY prices were invented. Missing thicknesses fail with PRICING_NOT_CONFIGURED.',
  );
}
