import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
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

@Controller('api/enrollments')
export class EnrollmentsProxyController {
    private readonly baseUrl = process.env.ENROLLMENTS_SERVICE_URL ?? 'http://localhost:3003';

    constructor(private readonly proxy: ProxyService) {}

    /**
     * POST /api/enrollments — un utilisateur authentifié s'inscrit à un cours.
     * SECURITE : etudiantId est forcé à l'id du token (req.user.sub). On ignore
     * tout etudiantId présent dans le body — sinon un ELEVE pourrait inscrire
     * quelqu'un d'autre à sa place.
     */
    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    create(@Body() body: { coursId: string }, @Req() req: RequestWithUser) {
        return this.proxy.forward(
            this.baseUrl,
            '/enrollments',
            'POST',
            {
                etudiantId: req.user.sub,
                coursId: body?.coursId,
            },
        );
    }

    /**
     * GET /api/enrollments[?etudiantId=UUID] — lister des inscriptions.
     * ELEVE : voit uniquement les SIENNES (le filter est forcé à req.user.sub).
     * ADMIN : peut filtrer par étudiant ou tout lister (sans query param).
     */
    @Get()
    @UseGuards(JwtAuthGuard, RolesGuard)
    findForStudent(
        @Query('etudiantId') etudiantIdParam: string | undefined,
        @Req() req: RequestWithUser,
    ) {
        const estAdmin = req.user.role === 'ADMIN';
        const cible = estAdmin ? etudiantIdParam : req.user.sub;
        const path = cible ? `/enrollments?etudiantId=${cible}` : '/enrollments';
        return this.proxy.forward(this.baseUrl, path, 'GET');
    }

    /**
     * GET /api/enrollments/by-course/:coursId — lister les élèves inscrits à un cours.
     * ADMIN uniquement. Réponse enrichie avec etudiantNom + etudiantEmail.
     */
    @Get('by-course/:coursId')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    findByCourse(@Param('coursId') coursId: string) {
        return this.proxy.forward(
            this.baseUrl,
            `/enrollments/by-course/${coursId}`,
            'GET',
        );
    }

    /**
     * DELETE /api/enrollments/:id — annulation d'inscription.
     * Propage l'identité au service aval via X-User-Id / X-User-Role.
     * L'autorisation "propriétaire ou ADMIN" est appliquée côté enrollments.
     */
    @Delete(':id')
    @HttpCode(204)
    @UseGuards(JwtAuthGuard, RolesGuard)
    remove(@Param('id') id: string, @Req() req: RequestWithUser) {
        return this.proxy.forward(
            this.baseUrl,
            `/enrollments/${id}`,
            'DELETE',
            undefined,
            {
                'X-User-Id': req.user.sub,
                'X-User-Role': req.user.role,
            },
        );
    }
}
