import type { CurrentUser } from '../interfaces/current-user.interface';
export declare const CurrentUserDecorator: (...dataOrPipes: (import("@nestjs/common").PipeTransform<any, any> | import("@nestjs/common").Type<import("@nestjs/common").PipeTransform<any, any>> | keyof CurrentUser | undefined)[]) => ParameterDecorator;
export { CurrentUserDecorator as CurrentUser };
