package com.inscription.waitlist.clients;

/**
 * Contrat de consommation du Service Inscriptions.
 *   GET  /enrollments?etudiantId={id} -> 200 [{id, etudiantId, coursId, date}]
 *   POST /enrollments {etudiantId, coursId} -> 201 {id, etudiantId, coursId, date} | 404 | 409 | 422
 */
public interface EnrollmentsClient {

    /** Vrai si l'étudiant est déjà inscrit à ce cours. */
    boolean isEnrolled(String etudiantId, String coursId);

    /**
     * Inscrit l'étudiant au cours. Un refus métier du service (4xx au format
     * { code, message }) est relayé tel quel sous forme de DomainException.
     */
    Inscription enroll(String etudiantId, String coursId);
}
