package com.inscription.waitlist.common;

/**
 * Format d'erreur standard partagé avec les autres services :
 *   { "code": "...", "message": "..." }  + code HTTP
 */
public record ErrorResponse(String code, String message) {
}
