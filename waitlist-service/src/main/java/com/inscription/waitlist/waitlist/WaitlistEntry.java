package com.inscription.waitlist.waitlist;

import java.time.Instant;

/** Une place dans la file d'attente d'un cours. */
public record WaitlistEntry(String id, String etudiantId, String coursId, Instant dateAjout) {
}
