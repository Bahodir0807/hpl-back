import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { QUOTE_PERMISSIONS } from './quote.constants';
import { QuotesController } from './quotes.controller';

describe('QuotesController PDF', () => {
  const manager = {
    id: 'manager-id',
    email: 'manager@example.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['quotes:read'],
  };

  it('requires HEAD approval permission for Quote-to-Deal conversion', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        QuotesController.prototype.convertToDeal,
      ),
    ).toEqual([QUOTE_PERMISSIONS.APPROVE]);
  });

  it('returns application/pdf only after object access succeeds', async () => {
    const quotes = {
      findOne: jest.fn().mockResolvedValue({
        id: 'quote-id',
        pdfFileId: 'file-id',
        finalizedAt: new Date(),
      }),
      assertCanDownloadCustomerDocument: jest.fn(),
    };
    const documents = {
      generate: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-test'),
        filename: 'quote-quote-id.pdf',
      }),
      generateDocx: jest.fn().mockResolvedValue({
        buffer: Buffer.from('PK-docx'),
        filename: 'quote-quote-id.docx',
      }),
    };
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new QuotesController(
      quotes as never,
      documents as never,
    );

    await controller.getPdf('quote-id', manager, response as never);

    expect(quotes.findOne).toHaveBeenCalledWith('quote-id', manager);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('%PDF-test'));
  });

  it('does not generate a document when object access is denied', async () => {
    const quotes = {
      findOne: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const documents = { generate: jest.fn() };
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new QuotesController(
      quotes as never,
      documents as never,
    );

    await expect(
      controller.getPdf('foreign-quote', manager, response as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documents.generate).not.toHaveBeenCalled();
  });

  it('returns the filled DOCX only after object access succeeds', async () => {
    const quotes = {
      findOne: jest.fn().mockResolvedValue({
        id: 'quote-id',
        pdfFileId: 'file-id',
        finalizedAt: new Date(),
      }),
      assertCanDownloadCustomerDocument: jest.fn(),
    };
    const documents = {
      generate: jest.fn(),
      generateDocx: jest.fn().mockResolvedValue({
        buffer: Buffer.from('PK-docx'),
        filename: 'quote-quote-id.docx',
      }),
    };
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new QuotesController(
      quotes as never,
      documents as never,
    );

    await controller.getDocx('quote-id', manager, response as never);

    expect(quotes.findOne).toHaveBeenCalledWith('quote-id', manager);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('PK-docx'));
  });

  it('does not generate a DOCX when object access is denied', async () => {
    const quotes = {
      findOne: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const documents = { generateDocx: jest.fn() };
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new QuotesController(
      quotes as never,
      documents as never,
    );

    await expect(
      controller.getDocx('foreign-quote', manager, response as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documents.generateDocx).not.toHaveBeenCalled();
  });

  it('does not let a manager generate a PDF before HEAD finalizes the quote', async () => {
    const quotes = {
      findOne: jest.fn().mockResolvedValue({
        id: 'quote-id',
        pdfFileId: null,
        finalizedAt: null,
      }),
      assertCanDownloadCustomerDocument: jest.fn(() => {
        throw new ForbiddenException();
      }),
    };
    const documents = { generate: jest.fn() };
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const controller = new QuotesController(
      quotes as never,
      documents as never,
    );

    await expect(
      controller.getPdf('quote-id', manager, response as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documents.generate).not.toHaveBeenCalled();
  });
});
