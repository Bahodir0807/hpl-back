import { BadRequestException } from '@nestjs/common';
import { HplApplication } from '@prisma/client';
import {
  assertCustomDimensionsPair,
  assertStage1QualificationComplete,
} from './lead-qualification.rules';

describe('Stage-1 qualification rules', () => {
  const complete = {
    application: HplApplication.EXTERIOR_WITH_UV,
    thicknessMm: 10,
    panelSizeId: 'size-1',
    customWidthMm: null,
    customHeightMm: null,
    colorCode: 'W100',
    colorName: 'White',
    requiredAreaM2: 12.5,
    installationRequired: false,
    customerRequirements: 'Need in stock',
  };

  it('rejects missing qualification as incomplete Stage-1', () => {
    expect(() => assertStage1QualificationComplete(null)).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown installationRequired', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        installationRequired: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts installationRequired=false', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        installationRequired: false,
      }),
    ).not.toThrow();
  });

  it('accepts installationRequired=true', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        installationRequired: true,
      }),
    ).not.toThrow();
  });

  it('allows incomplete technical data for every item in a multi-item qualification', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        items: [
          {
            application: HplApplication.EXTERIOR_WITH_UV,
            requiredAreaM2: 10,
          },
          {
            application: HplApplication.INTERIOR,
            requiredAreaM2: 20,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('accepts an empty items list when installation is known', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        items: [],
      }),
    ).not.toThrow();
  });

  it('still requires an application and positive area for each item', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        items: [{ application: HplApplication.INTERIOR, requiredAreaM2: 0 }],
      }),
    ).toThrow(BadRequestException);
  });

  it('treats null installationRequired as different from false', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        installationRequired: null,
      }),
    ).toThrow(BadRequestException);

    try {
      assertStage1QualificationComplete({
        ...complete,
        installationRequired: null,
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          missingFields: ['installationRequired'],
        }),
      );
    }
  });

  it('rejects zero required area', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        requiredAreaM2: 0,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts custom dimensions without a catalog size', () => {
    expect(() =>
      assertStage1QualificationComplete({
        ...complete,
        panelSizeId: null,
        customWidthMm: 1220,
        customHeightMm: 2440,
      }),
    ).not.toThrow();
  });

  it('rejects a lone custom width', () => {
    expect(() =>
      assertCustomDimensionsPair({
        customWidthMm: 1220,
        customHeightMm: null,
      }),
    ).toThrow(BadRequestException);
  });
});
