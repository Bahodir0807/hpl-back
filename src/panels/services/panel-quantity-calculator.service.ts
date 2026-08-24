import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { panelSizeAreaM2 } from '../hpl-catalog';

type DecimalInput = Prisma.Decimal | string | number;

@Injectable()
export class PanelQuantityCalculator {
  calculate(
    requiredAreaM2: DecimalInput,
    panelSize: { widthMm: number; heightMm: number },
  ) {
    if (panelSize.widthMm <= 0 || panelSize.heightMm <= 0) {
      throw new BadRequestException('panel size must be greater than 0');
    }

    const area = panelSizeAreaM2(panelSize.widthMm, panelSize.heightMm);
    const required = new Prisma.Decimal(requiredAreaM2.toString());

    if (required.lte(0)) {
      throw new BadRequestException('requiredAreaM2 must be greater than 0');
    }

    if (area.lte(0)) {
      throw new BadRequestException('panel area must be greater than 0');
    }

    const sheetsCount = required.div(area).ceil().toNumber();
    const actualAreaM2 = area.mul(sheetsCount);
    const wasteAreaM2 = actualAreaM2.minus(required);
    const wastePercent = wasteAreaM2
      .div(actualAreaM2)
      .mul(100)
      .toDecimalPlaces(2);

    return {
      sheetsCount,
      actualAreaM2,
      wasteAreaM2,
      wastePercent,
    };
  }
}
