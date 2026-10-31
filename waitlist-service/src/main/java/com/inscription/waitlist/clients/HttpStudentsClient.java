package com.inscription.waitlist.clients;

import java.util.Optional;

import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.inscription.waitlist.common.DomainException;

/** Implémentation HTTP : appelle le Service Étudiants (STUDENTS_SERVICE_URL). */
public class HttpStudentsClient implements StudentsClient {

    private final RestClient http;

    public HttpStudentsClient(RestClient http) {
        this.http = http;
    }

    @Override
    public Optional<Etudiant> findById(String id) {
        try {
            return Optional.ofNullable(
                    http.get().uri("/students/{id}", id).retrieve().body(Etudiant.class));
        } catch (HttpClientErrorException.NotFound e) {
            return Optional.empty();
        } catch (RestClientException e) {
            throw DomainException.serviceIndisponible("Service étudiants indisponible : " + e.getMessage());
        }
    }
}
