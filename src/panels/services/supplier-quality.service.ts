import { BadRequestException, Injectable } from '@nestjs/common';
import {
  HPL_CUSTOM_PANEL_TYPE_CODE,
  HPL_QUALITY_CLASS_CODES,
  canonicalizePanelTypeCode,
  resolvePanelTypeQuery,
} from '../hpl-catalog';
import { PrismaService } from '../../modules/prisma/prisma.service';

export type SupplierQualityClassDto = {
  id: string;
  code: string;
  nameRu: string;
};

type PanelTypeFilter =
  { kind: 'all' } | { kind: 'type'; id: string } | { kind: 'invalid' };

@Injectable()
export class SupplierQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async findQualityClasses(
    supplierKey: string,
    panelTypeQuery: string,
  ): Promise<SupplierQualityClassDto[]> {
    const supplier = await this.findSupplier(supplierKey);
    if (!supplier) {
      return [];
    }

    const panelTypeFilter = await this.resolvePanelTypeFilter(panelTypeQuery);
    if (panelTypeFilter.kind === 'invalid') {
      throw new BadRequestException('panelType is not a canonical HPL type');
    }

    const mappings = await this.prisma.supplierQualityMapping.findMany({
      where: {
        supplierId: supplier.id,
        ...(panelTypeFilter.kind === 'type'
          ? { panelTypeId: panelTypeFilter.id }
          : {}),
      },
      include: {
        qualityClass: {
          select: { id: true, code: true, nameRu: true },
        },
      },
      orderBy: { qualityClass: { code: 'asc' } },
    });

    const seen = new Set<string>();
    const classes: SupplierQualityClassDto[] = [];

    for (const mapping of mappings) {
      const qualityClass = mapping.qualityClass;
      if (!qualityClass || seen.has(qualityClass.id)) {
        continue;
      }

      if (
        !HPL_QUALITY_CLASS_CODES.includes(
          qualityClass.code as (typeof HPL_QUALITY_CLASS_CODES)[number],
        )
      ) {
        continue;
      }

      seen.add(qualityClass.id);
      classes.push({
        id: qualityClass.id,
        code: qualityClass.code,
        nameRu: qualityClass.nameRu,
      });
    }

    return classes;
  }

  private async findSupplier(
    supplierKey: string,
  ): Promise<{ id: string } | null> {
    const key = supplierKey.trim();
    if (!key) {
      return null;
    }

    return this.prisma.supplier.findFirst({
      where: {
        OR: [{ code: { equals: key, mode: 'insensitive' } }, { id: key }],
      },
      select: { id: true },
    });
  }

  private async resolvePanelTypeFilter(
    query: string,
  ): Promise<PanelTypeFilter> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { kind: 'invalid' };
    }

    const lowered = trimmed.toLowerCase();
    if (lowered === HPL_CUSTOM_PANEL_TYPE_CODE || lowered === 'custom') {
      return { kind: 'all' };
    }

    const canonical = resolvePanelTypeQuery(trimmed);
    if (canonical) {
      const row = await this.prisma.panelType.findFirst({
        where: { code: canonical },
        select: { id: true },
      });
      return row ? { kind: 'type', id: row.id } : { kind: 'invalid' };
    }

    const byId = await this.prisma.panelType.findUnique({
      where: { id: trimmed },
      select: { id: true, code: true },
    });
    if (!byId) {
      return { kind: 'invalid' };
    }

    if (
      byId.code === HPL_CUSTOM_PANEL_TYPE_CODE ||
      byId.code.toLowerCase() === 'custom'
    ) {
      return { kind: 'all' };
    }

    const remapped = canonicalizePanelTypeCode(byId.code);
    if (!remapped) {
      return { kind: 'invalid' };
    }

    if (remapped !== byId.code) {
      const canonicalRow = await this.prisma.panelType.findFirst({
        where: { code: remapped },
        select: { id: true },
      });
      return canonicalRow
        ? { kind: 'type', id: canonicalRow.id }
        : { kind: 'type', id: byId.id };
    }

    return { kind: 'type', id: byId.id };
  }
}
