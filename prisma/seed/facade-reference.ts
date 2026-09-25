import { PrismaClient } from '@prisma/client';
import { BASE_FACADE_CONFIG_CODE } from '../../src/modules/leads/engineering/facade/facade-norms';
import { FACADE_SYSTEM_TABLES } from '../../src/modules/leads/engineering/facade/facade-system-tables';
import { seedFacadeSubsystemCatalog } from './facade-subsystem';

export type FacadeReferenceSeedReport = {
  configCodes: string[];
  calculableSystemCodes: string[];
  normSetCodes: string[];
  materialCount: number;
  consumptionNormCount: number;
};

export async function seedFacadeReferenceConfiguration(
  prisma: PrismaClient,
): Promise<FacadeReferenceSeedReport> {
  await seedFacadeSubsystemCatalog(prisma);

  const [configs, normSets, materialCount, consumptionNormCount] =
    await Promise.all([
      prisma.facadeSystemConfig.findMany({
        select: { code: true, isCalculable: true },
        orderBy: { code: 'asc' },
      }),
      prisma.facadeNormSet.findMany({
        select: { code: true },
        orderBy: { code: 'asc' },
      }),
      prisma.facadeMaterial.count(),
      prisma.facadeConsumptionNorm.count(),
    ]);

  const expectedCalculable = FACADE_SYSTEM_TABLES.map((table) => table.code);

  return {
    configCodes: configs.map((row) => row.code),
    calculableSystemCodes: configs
      .filter((row) => row.isCalculable && expectedCalculable.includes(row.code))
      .map((row) => row.code),
    normSetCodes: normSets.map((row) => row.code),
    materialCount,
    consumptionNormCount,
  };
}

export function printFacadeReferenceSeedReport(
  report: FacadeReferenceSeedReport,
): void {
  console.log(
    'Facade subsystem reference seed completed (non-destructive upsert).',
  );
  console.log(`  Facade system configs: ${report.configCodes.join(', ')}`);
  console.log(
    `  Calculable production systems: ${report.calculableSystemCodes.join(', ')}`,
  );
  console.log(`  Norm sets: ${report.normSetCodes.join(', ')}`);
  console.log(`  Facade materials: ${report.materialCount}`);
  console.log(`  Consumption norms: ${report.consumptionNormCount}`);
  console.log(
    `  Historical config preserved: ${BASE_FACADE_CONFIG_CODE} (existing calculations only; not a new selectable default).`,
  );
  console.log(
    '  Scope: facade catalog only. No RBAC, users, demo data, or business records.',
  );
}
