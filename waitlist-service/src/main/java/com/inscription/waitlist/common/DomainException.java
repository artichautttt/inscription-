package com.inscription.waitlist.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;

/** Erreur métier, sérialisée en { code, message } par {@link GlobalExceptionHandler}. */
public class DomainException extends RuntimeException {

    private final String code;
    private final HttpStatusCode status;

    public DomainException(String code, String message, HttpStatusCode status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public HttpStatusCode getStatus() {
        return status;
    }

    /** 404 — étudiant, cours ou entrée de file inconnu. */
    public static DomainException ressourceIntrouvable(String message) {
        return new DomainException("RESSOURCE_INTROUVABLE", message, HttpStatus.NOT_FOUND);
    }

    /** 422 — il reste des places : inutile de passer par la liste d'attente. */
    public static DomainException coursNonComplet() {
        return new DomainException("COURS_NON_COMPLET",
                "Ce cours n'est pas complet : inscrivez-vous directement.", HttpStatus.UNPROCESSABLE_ENTITY);
    }

    /** 422 — aucune place libre : promotion impossible. */
    public static DomainException coursComplet() {
        return new DomainException("COURS_COMPLET",
                "Ce cours est complet : aucune place à attribuer.", HttpStatus.UNPROCESSABLE_ENTITY);
    }

    /** 409 — l'étudiant est déjà dans la file de ce cours. */
    public static DomainException dejaEnListeAttente() {
        return new DomainException("DEJA_EN_LISTE_ATTENTE",
                "Cet étudiant est déjà en liste d'attente pour ce cours.", HttpStatus.CONFLICT);
    }

    /** 409 — l'étudiant est déjà inscrit à ce cours. */
    public static DomainException dejaInscrit() {
        return new DomainException("DEJA_INSCRIT",
                "Cet étudiant est déjà inscrit à ce cours.", HttpStatus.CONFLICT);
    }

    /** 409 — personne à promouvoir dans la file de ce cours. */
    public static DomainException fileVide() {
        return new DomainException("FILE_VIDE",
                "La liste d'attente de ce cours est vide.", HttpStatus.CONFLICT);
    }

    /** 403 — l'utilisateur n'a pas le droit d'effectuer cette action. */
    public static DomainException accesInterdit(String message) {
        return new DomainException("ACCES_INTERDIT", message, HttpStatus.FORBIDDEN);
    }

    /** 502 — un service en aval est injoignable ou a répondu de façon inattendue. */
    public static DomainException serviceIndisponible(String message) {
        return new DomainException("SERVICE_INDISPONIBLE", message, HttpStatus.BAD_GATEWAY);
    }
}
