import { PrismaClient } from '@prisma/client';
import {
  HPL_CANONICAL_PANEL_SIZES,
  panelSizeAreaM2,
  panelSizeDisplayName,
} from '../../src/panels/hpl-catalog';

export type PanelSizeSeedReport = {
  canonicalCount: number;
  upsertedCount: number;
};

export async function seedCanonicalPanelSizes(
  prisma: PrismaClient,
): Promise<PanelSizeSeedReport> {
  let sortOrder = 1;
  for (const size of HPL_CANONICAL_PANEL_SIZES) {
    await prisma.panelSize.upsert({
      where: {
        widthMm_heightMm: {
          widthMm: size.widthMm,
          heightMm: size.heightMm,
        },
      },
      update: {
        displayName: panelSizeDisplayName(size.widthMm, size.heightMm),
        sortOrder,
        areaM2: panelSizeAreaM2(size.widthMm, size.heightMm),
        isActive: true,
      },
      create: {
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        displayName: panelSizeDisplayName(size.widthMm, size.heightMm),
        sortOrder,
        areaM2: panelSizeAreaM2(size.widthMm, size.heightMm),
        isActive: true,
      },
    });
    sortOrder += 1;
  }

  return {
    canonicalCount: HPL_CANONICAL_PANEL_SIZES.length,
    upsertedCount: HPL_CANONICAL_PANEL_SIZES.length,
  };
}

export function printPanelSizeSeedReport(report: PanelSizeSeedReport): void {
  console.log(
    'Panel size reference seed completed (non-destructive upsert).',
  );
  console.log(`  Canonical panel sizes upserted: ${report.upsertedCount}`);
  console.log(
    '  Scope: PanelSize only. No panel types, pricing, suppliers, or legacy deactivation.',
  );
}
