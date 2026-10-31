package com.inscription.waitlist.waitlist;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/** Body de POST /waitlist. Le type UUID rejette (400) tout identifiant mal formé. */
public record JoinWaitlistRequest(@NotNull UUID etudiantId, @NotNull UUID coursId) {
}
