import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

interface RequestWithUser {
    user: AuthenticatedUser;
}

@Controller('api/waitlist')
export class WaitlistProxyController {
    private readonly baseUrl = process.env.WAITLIST_SERVICE_URL ?? 'http://localhost:3004';

    constructor(private readonly proxy: ProxyService) {}

    /**
     * POST /api/waitlist — un utilisateur authentifié rejoint la file d'attente d'un cours complet.
     * SECURITE : etudiantId est forcé à l'id du token (req.user.sub). On ignore
     * tout etudiantId présent dans le body — sinon un ELEVE pourrait mettre
     * quelqu'un d'autre en liste d'attente à sa place.
     */
    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    join(@Body() body: { coursId: string }, @Req() req: RequestWithUser) {
        return this.proxy.forward(
            this.baseUrl,
            '/waitlist',
            'POST',
            {
                etudiantId: req.user.sub,
                coursId: body?.coursId,
            },
        );
    }

    /**
     * GET /api/waitlist/courses/:coursId — file d'attente d'un cours (ordre FIFO, avec positions).
     * ADMIN uniquement.
     */
    @Get('courses/:coursId')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    findByCourse(@Param('coursId') coursId: string) {
        return this.proxy.forward(
            this.baseUrl,
            `/waitlist/courses/${coursId}`,
            'GET',
        );
    }

    /**
     * POST /api/waitlist/courses/:coursId/promote — inscrit le premier de la file
     * sur une place libérée. ADMIN uniquement.
     */
    @Post('courses/:coursId/promote')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    promote(@Param('coursId') coursId: string) {
        return this.proxy.forward(
            this.baseUrl,
            `/waitlist/courses/${coursId}/promote`,
            'POST',
        );
    }

    /**
     * DELETE /api/waitlist/:id — quitter la file d'attente.
     * Propage l'identité au service aval via X-User-Id / X-User-Role.
     * L'autorisation "propriétaire ou ADMIN" est appliquée côté waitlist-service.
     */
    @Delete(':id')
    @HttpCode(204)
    @UseGuards(JwtAuthGuard, RolesGuard)
    leave(@Param('id') id: string, @Req() req: RequestWithUser) {
        return this.proxy.forward(
            this.baseUrl,
            `/waitlist/${id}`,
            'DELETE',
            undefined,
            {
                'X-User-Id': req.user.sub,
                'X-User-Role': req.user.role,
            },
        );
    }
}
