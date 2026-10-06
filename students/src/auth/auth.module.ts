import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StudentsModule } from '../students/students.module';

@Module({
    imports: [
        StudentsModule,
        JwtModule.register({
            global: false,
            secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
            signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '12h') as any },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService],
})
export class AuthModule {}
