package com.inscription.waitlist.clients;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Inscription telle que renvoyée par le Service Inscriptions. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Inscription(String id, String etudiantId, String coursId, String date) {
}
