import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Controller('api/enrollments')
export class EnrollmentsProxyController {
    private readonly baseUrl = process.env.ENROLLMENTS_SERVICE_URL ?? 'http://localhost:3003';

    constructor(private readonly proxy: ProxyService) {}

    /** POST /api/enrollments -> POST {ENROLLMENTS}/enrollments */
    @Post()
    create(@Body() body: any) {
        return this.proxy.forward(this.baseUrl, '/enrollments', 'POST', body);
    }

    /** GET /api/enrollments?etudiantId=... -> relaie vers le service Inscriptions */
    @Get()
    findForStudent(@Query('etudiantId') etudiantId: string) {
        return this.proxy.forward(
            this.baseUrl,
            `/enrollments?etudiantId=${etudiantId}`,
            'GET',
        );
    }
}