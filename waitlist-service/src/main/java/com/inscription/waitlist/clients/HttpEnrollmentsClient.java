package com.inscription.waitlist.clients;

import java.util.Arrays;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import com.inscription.waitlist.common.DomainException;
import com.inscription.waitlist.common.ErrorResponse;

/** Implémentation HTTP : appelle le Service Inscriptions (ENROLLMENTS_SERVICE_URL). */
public class HttpEnrollmentsClient implements EnrollmentsClient {

    private final RestClient http;

    public HttpEnrollmentsClient(RestClient http) {
        this.http = http;
    }

    @Override
    public boolean isEnrolled(String etudiantId, String coursId) {
        try {
            Inscription[] inscriptions = http.get()
                    .uri("/enrollments?etudiantId={id}", etudiantId)
                    .retrieve()
                    .body(Inscription[].class);
            return inscriptions != null
                    && Arrays.stream(inscriptions).anyMatch(i -> coursId.equals(i.coursId()));
        } catch (RestClientException e) {
            throw indisponible(e);
        }
    }

    @Override
    public Inscription enroll(String etudiantId, String coursId) {
        try {
            return http.post()
                    .uri("/enrollments")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("etudiantId", etudiantId, "coursId", coursId))
                    .retrieve()
                    .body(Inscription.class);
        } catch (RestClientResponseException e) {
            throw relayer(e);
        } catch (RestClientException e) {
            throw indisponible(e);
        }
    }

    /** Relaie un refus métier { code, message } ; toute autre réponse devient un 502. */
    private DomainException relayer(RestClientResponseException e) {
        if (e.getStatusCode().is4xxClientError()) {
            ErrorResponse erreur = lireErreur(e);
            if (erreur != null && erreur.code() != null) {
                return new DomainException(erreur.code(), erreur.message(), e.getStatusCode());
            }
        }
        return indisponible(e);
    }

    private ErrorResponse lireErreur(RestClientResponseException e) {
        try {
            return e.getResponseBodyAs(ErrorResponse.class);
        } catch (RuntimeException illisible) {
            return null;
        }
    }

    private DomainException indisponible(RestClientException e) {
        return DomainException.serviceIndisponible("Service inscriptions indisponible : " + e.getMessage());
    }
}
