import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ProxyService } from './proxy.service';

/**
 * Route PUBLIQUE (pas de guard) : relaie l'authentification vers le service Students
 * qui heberge la logique de login + emission du JWT.
 */
@Controller('api/auth')
export class AuthProxyController {
    private readonly baseUrl = process.env.STUDENTS_SERVICE_URL ?? 'http://localhost:3001';

    constructor(private readonly proxy: ProxyService) {}

    @Post('login')
    @HttpCode(200)
    login(@Body() body: unknown) {
        return this.proxy.forward(this.baseUrl, '/auth/login', 'POST', body);
    }

    /**
     * Inscription publique d'un ELEVE. Relayée telle quelle au service students
     * qui force role=ELEVE en dur côté serveur (le role éventuel dans le body est ignoré).
     */
    @Post('register')
    @HttpCode(201)
    register(@Body() body: unknown) {
        return this.proxy.forward(this.baseUrl, '/auth/register', 'POST', body);
    }
}
