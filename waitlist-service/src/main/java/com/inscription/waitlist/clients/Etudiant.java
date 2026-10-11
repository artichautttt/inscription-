package com.inscription.waitlist.clients;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Étudiant tel que renvoyé par le Service Étudiants. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Etudiant(String id, String nom, String email) {
}
