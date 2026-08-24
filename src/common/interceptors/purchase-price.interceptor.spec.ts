import { of } from 'rxjs';
import type { CurrentUser } from '../interfaces/current-user.interface';
import { PurchasePriceInterceptor } from './purchase-price.interceptor';

describe('PurchasePriceInterceptor', () => {
  const interceptor = new PurchasePriceInterceptor();

  const createContext = (user?: CurrentUser) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as never;

  it('strips nested cost fields when the caller lacks purchase-price permission', (done) => {
    interceptor
      .intercept(
        createContext({ permissions: ['clients:read'] } as CurrentUser),
        {
          handle: () =>
            of({
              id: 'client-id',
              deals: [{ id: 'deal-id', margin: 1200, title: 'Deal' }],
            }),
        },
      )
      .subscribe((payload) => {
        expect(payload).toEqual({
          id: 'client-id',
          deals: [{ id: 'deal-id', title: 'Deal' }],
        });
        done();
      });
  });

  it('keeps cost fields when the caller has products:read_purchase_price', (done) => {
    interceptor
      .intercept(
        createContext({
          permissions: ['products:read_purchase_price'],
        } as CurrentUser),
        {
          handle: () => of({ margin: 1200, purchasePrice: 10 }),
        },
      )
      .subscribe((payload) => {
        expect(payload).toEqual({ margin: 1200, purchasePrice: 10 });
        done();
      });
  });

  it('strips manual purchasePricePerM2Cny from calculation preview for MANAGER', (done) => {
    interceptor
      .intercept(
        createContext({ permissions: ['calculations:create'] } as CurrentUser),
        {
          handle: () =>
            of({
              sheetsCount: 359,
              purchasePricePerM2Cny: '80',
              supplierPricePerM2: '80',
              total: '240.00',
            }),
        },
      )
      .subscribe((payload) => {
        expect(payload).toEqual({
          sheetsCount: 359,
          total: '240.00',
        });
        done();
      });
  });
});
