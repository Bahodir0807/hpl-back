import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { QUOTE_PERMISSIONS } from '../quotes/quote.constants';
import { CALCULATION_PERMISSIONS } from './calculation.constants';
import { CalculationsController } from './calculations.controller';

describe('CalculationsController legacy commercial RBAC', () => {
  it.each([
    ['create', CALCULATION_PERMISSIONS.CREATE],
    ['preview', CALCULATION_PERMISSIONS.CREATE],
    ['update', CALCULATION_PERMISSIONS.UPDATE],
    ['finalize', CALCULATION_PERMISSIONS.UPDATE],
    ['remove', CALCULATION_PERMISSIONS.DELETE],
  ] as const)(
    'requires quotes:approve for %s',
    (method, calculationPermission) => {
      expect(
        Reflect.getMetadata(
          REQUIRED_PERMISSIONS_KEY,
          CalculationsController.prototype[method],
        ),
      ).toEqual([calculationPermission, QUOTE_PERMISSIONS.APPROVE]);
    },
  );

  it('keeps the manager CalculationRequest create path non-commercial', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        CalculationsController.prototype.createRequest,
      ),
    ).toEqual([CALCULATION_PERMISSIONS.CREATE]);
  });
});
