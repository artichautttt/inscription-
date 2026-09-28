import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Format d'erreur standard partagé avec le Dev A :
 *   { "code": "...", "message": "..." }  + code HTTP
 */
export class DomainException extends HttpException {
  constructor(code: string, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}

/** 404 — étudiant ou cours inconnu. */
export class RessourceIntrouvableException extends DomainException {
  constructor(message: string) {
    super('RESSOURCE_INTROUVABLE', message, HttpStatus.NOT_FOUND);
  }
}

/** 409 — l'étudiant est déjà inscrit à ce cours. */
export class InscriptionDupliqueeException extends DomainException {
  constructor(message = 'Cet étudiant est déjà inscrit à ce cours.') {
    super('INSCRIPTION_DUPLIQUEE', message, HttpStatus.CONFLICT);
  }
}

/** 422 — plus de place disponible. */
export class PlusDePlaceException extends DomainException {
  constructor(message = 'Ce cours est complet.') {
    super('COURS_COMPLET', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
