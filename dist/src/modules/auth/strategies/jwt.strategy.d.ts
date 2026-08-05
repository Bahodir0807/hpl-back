import { Strategy } from 'passport-jwt';
import { CurrentUser } from '../../../common/interfaces/current-user.interface';
import { UsersService } from '../../users/users.service';
type JwtPayload = {
    userId?: string;
    sub?: string;
    email?: string;
};
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly usersService;
    constructor(usersService: UsersService);
    validate(payload: JwtPayload): Promise<CurrentUser>;
}
export {};
