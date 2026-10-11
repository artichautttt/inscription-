package com.inscription.waitlist.clients;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Cours tel que renvoyé par le Service Cours. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cours(String id, String titre, int capacite, int placesRestantes) {
}
