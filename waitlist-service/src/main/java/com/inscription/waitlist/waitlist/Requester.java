package com.inscription.waitlist.waitlist;

/** Identité de l'appelant, posée par la gateway (X-User-Id / X-User-Role). */
public record Requester(String userId, String role) {

    boolean estAdmin() {
        return "ADMIN".equals(role);
    }
}
