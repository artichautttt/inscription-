import { Controller, Get, Param } from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Controller('api/students')
export class StudentsProxyController {
    private readonly baseUrl = process.env.STUDENTS_SERVICE_URL ?? 'http://localhost:3001';

    constructor(private readonly proxy: ProxyService) {}

    @Get()
    findAll() {
        return this.proxy.forward(this.baseUrl, '/students', 'GET');
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.proxy.forward(this.baseUrl, `/students/${id}`, 'GET');
    }
}