import { BadRequestException, Injectable } from '@nestjs/common';
import { PanelSize, Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | string | number;

@Injectable()
export class PanelQuantityCalculator {
  calculate(requiredAreaM2: DecimalInput, panelSize: Pick<PanelSize, 'areaM2'>) {
    const area = new Prisma.Decimal(panelSize.areaM2.toString());
    const required = new Prisma.Decimal(requiredAreaM2.toString());

    if (required.lte(0)) {
      throw new BadRequestException('requiredAreaM2 must be greater than 0');
    }

    const sheetsCount = Math.ceil(required.div(area).toNumber());
    const actualAreaM2 = area.mul(sheetsCount);
    const wasteAreaM2 = actualAreaM2.minus(required);
    const wastePercent = wasteAreaM2.div(actualAreaM2).mul(100).toDecimalPlaces(2);

    return {
      sheetsCount,
      actualAreaM2,
      wasteAreaM2,
      wastePercent,
    };
  }
}
