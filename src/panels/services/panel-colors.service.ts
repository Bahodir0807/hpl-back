import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  CreatePanelColorDto,
  resolvePanelColorCode,
  resolvePanelColorName,
} from '../dto/create-panel-color.dto';
import { FilterPanelColorsDto } from '../dto/filter-panel-colors.dto';
import { UpdatePanelColorDto } from '../dto/update-panel-color.dto';

const colorInclude = Prisma.validator<Prisma.PanelColorInclude>()({
  supplier: { select: { id: true, code: true, name: true } },
});

@Injectable()
export class PanelColorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePanelColorDto, createdByManagerId: string) {
    try {
      return await this.prisma.panelColor.create({
        data: {
          supplierId: dto.supplierId,
          colorCode: resolvePanelColorCode(dto) ?? '',
          colorName: resolvePanelColorName(dto) ?? '',
          createdByManagerId,
        },
        include: colorInclude,
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async update(id: string, dto: UpdatePanelColorDto) {
    const existing = await this.prisma.panelColor.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Panel color not found');
    }

    try {
      return await this.prisma.panelColor.update({
        where: { id },
        data: {
          colorCode: resolvePanelColorCode(dto),
          colorName: resolvePanelColorName(dto),
        },
        include: colorInclude,
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async findAll(filter: FilterPanelColorsDto) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 50;
    const where: Prisma.PanelColorWhereInput = {
      ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(filter.search
        ? {
            OR: [
              { colorCode: { contains: filter.search, mode: 'insensitive' } },
              { colorName: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.panelColor.findMany({
        where,
        include: colorInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.panelColor.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Color code already exists for this supplier',
      );
    }

    throw error;
  }
}
