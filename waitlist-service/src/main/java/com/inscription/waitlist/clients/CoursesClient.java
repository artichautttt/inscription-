package com.inscription.waitlist.clients;

import java.util.Optional;

/**
 * Contrat de consommation du Service Cours.
 *   GET /courses/{id} -> 200 {id, titre, capacite, placesRestantes} | 404
 */
public interface CoursesClient {

    /** Retourne le cours, ou vide si le service répond 404. */
    Optional<Cours> findById(String id);
}
