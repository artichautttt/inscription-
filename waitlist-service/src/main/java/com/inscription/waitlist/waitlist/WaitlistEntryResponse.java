package com.inscription.waitlist.waitlist;

import java.time.Instant;

/** Entrée de file telle qu'exposée par l'API : l'entrée + sa position (1 = prochain promu). */
public record WaitlistEntryResponse(String id, String etudiantId, String coursId, Instant dateAjout, int position) {

    static WaitlistEntryResponse of(WaitlistEntry entry, int position) {
        return new WaitlistEntryResponse(
                entry.id(), entry.etudiantId(), entry.coursId(), entry.dateAjout(), position);
    }
}
