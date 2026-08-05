"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
let PrismaService = class PrismaService extends client_1.PrismaClient {
    constructor() {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('DATABASE_URL is not configured');
        }
        const adapter = new adapter_pg_1.PrismaPg({
            connectionString: resolvePgConnectionString(connectionString),
        });
        super({ adapter });
    }
    async onModuleInit() {
        await this.$connect();
    }
    async onModuleDestroy() {
        await this.$disconnect();
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PrismaService);
function resolvePgConnectionString(connectionString) {
    const parsedUrl = new URL(connectionString);
    if (parsedUrl.protocol !== 'prisma+postgres:') {
        return connectionString;
    }
    const apiKey = parsedUrl.searchParams.get('api_key');
    if (!apiKey) {
        throw new Error('Prisma Postgres api_key is missing databaseUrl');
    }
    const decoded = Buffer.from(apiKey, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded);
    if (typeof payload !== 'object' ||
        payload === null ||
        !('databaseUrl' in payload)) {
        throw new Error('Prisma Postgres api_key payload is invalid');
    }
    const databaseUrl = payload.databaseUrl;
    if (typeof databaseUrl !== 'string') {
        throw new Error('Prisma Postgres api_key databaseUrl is invalid');
    }
    return databaseUrl;
}
//# sourceMappingURL=prisma.service.js.map