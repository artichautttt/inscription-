package com.inscription.waitlist.clients;

import java.util.Optional;

/**
 * Contrat de consommation du Service Étudiants.
 *   GET /students/{id} -> 200 {id, nom, email} | 404
 */
public interface StudentsClient {

    /** Retourne l'étudiant, ou vide si le service répond 404. */
    Optional<Etudiant> findById(String id);
}
