import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { QualifyLeadDto } from './qualify-lead.dto';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const TYPE_ID = '44444444-4444-4444-8444-444444444444';
const SIZE_ID = '55555555-5555-4555-8555-555555555555';
const LEAD_ID = '66666666-6666-4666-8666-666666666666';

type ManagerQualifyHttpBody = {
  clientId: string;
  contactId: string;
  projectObjectId: string;
  objectStage: string | null;
  objectExpectedDate: string | null;
  needDescription: string;
  decisionMakerContact: string;
  qualification: {
    installationRequired: boolean;
    ventFacadeExists: boolean | null;
    ventFacadeKitRequired: boolean | null;
    urgent: boolean;
    willingToWait: boolean;
    customerRequirements: string;
    items: Array<Record<string, unknown>>;
  };
};

/** Shape actually posted by `useQualifyLead` after stripping `id`. */
export function managerQualifyHttpBody(
  overrides: Record<string, unknown> = {},
): ManagerQualifyHttpBody {
  return {
    clientId: CLIENT_ID,
    contactId: CONTACT_ID,
    projectObjectId: OBJECT_ID,
    objectStage: 'Скоро фасад',
    objectExpectedDate: '2026-11-15T00:00:00.000Z',
    needDescription: 'HPL панели для фасада школы',
    decisionMakerContact: 'Главный архитектор',
    qualification: {
      installationRequired: true,
      ventFacadeExists: true,
      ventFacadeKitRequired: false,
      urgent: false,
      willingToWait: true,
      customerRequirements: 'HPL панели для фасада школы',
      items: [
        {
          application: 'INTERIOR',
          panelTypeId: TYPE_ID,
          thicknessMm: null,
          panelSizeId: SIZE_ID,
          customWidthMm: null,
          customHeightMm: null,
          colorCode: null,
          colorName: 'тёмно-серый',
          requiredAreaM2: 24.5,
        },
      ],
    },
    ...overrides,
  };
}

@Controller()
class QualifyContractController {
  @Post('leads/:id/qualify')
  qualify(@Body() dto: QualifyLeadDto) {
    return dto;
  }
}

describe('QualifyLeadDto production ValidationPipe', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QualifyContractController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(productionPipe);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts the MANAGER Qualify payload including object and vent-facade fields', async () => {
    const payload = managerQualifyHttpBody();

    const transformed = (await productionPipe.transform(payload, {
      type: 'body',
      metatype: QualifyLeadDto,
    })) as QualifyLeadDto;

    expect(transformed.objectStage).toBe('Скоро фасад');
    expect(transformed.objectExpectedDate).toEqual(
      new Date('2026-11-15T00:00:00.000Z'),
    );
    expect(transformed.qualification?.ventFacadeExists).toBe(true);
    expect(transformed.qualification?.ventFacadeKitRequired).toBe(false);
    expect(transformed.qualification?.installationRequired).toBe(true);
    expect(transformed.qualification?.items).toHaveLength(1);

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(`/leads/${LEAD_ID}/qualify`)
      .send(payload);

    const body = response.body as ManagerQualifyHttpBody;
    expect(response.status).toBe(201);
    expect(body.objectStage).toBe('Скоро фасад');
    expect(body.qualification.ventFacadeExists).toBe(true);
    expect(body.qualification.ventFacadeKitRequired).toBe(false);
  });

  it.each([true, false, null])(
    'accepts ventFacadeExists=%s and ventFacadeKitRequired=%s',
    async (value) => {
      const payload = managerQualifyHttpBody({
        qualification: {
          ...managerQualifyHttpBody().qualification,
          ventFacadeExists: value,
          ventFacadeKitRequired: value,
        },
      });

      const transformed = (await productionPipe.transform(payload, {
        type: 'body',
        metatype: QualifyLeadDto,
      })) as QualifyLeadDto;

      expect(transformed.qualification?.ventFacadeExists).toBe(value);
      expect(transformed.qualification?.ventFacadeKitRequired).toBe(value);
    },
  );

  it('still rejects unknown properties under forbidNonWhitelisted', async () => {
    try {
      await productionPipe.transform(
        managerQualifyHttpBody({ totallyUnknownField: 'x' }),
        { type: 'body', metatype: QualifyLeadDto },
      );
      throw new Error('expected validation to reject unknown properties');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).toContain('totallyUnknownField should not exist');
    }
  });
});
