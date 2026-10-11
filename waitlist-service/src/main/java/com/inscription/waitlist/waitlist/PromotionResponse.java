package com.inscription.waitlist.waitlist;

import com.inscription.waitlist.clients.Inscription;

/** Résultat d'une promotion : qui a été inscrit, et l'inscription créée. */
public record PromotionResponse(String etudiantId, String coursId, Inscription inscription) {
}
