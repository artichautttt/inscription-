import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Post('login')
    @HttpCode(200)
    login(@Body() dto: LoginDto) {
        return this.auth.login(dto.email, dto.password);
    }

    /**
     * Inscription publique d'un ELEVE.
     * Attention : le DTO ne contient PAS `role` ; même si le body en envoie un,
     * AuthService.register force role=ELEVE en dur.
     */
    @Post('register')
    @HttpCode(201)
    register(@Body() dto: RegisterDto) {
        return this.auth.register(dto);
    }
}
