package com.inscription.waitlist.clients;

import java.util.Optional;

import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.inscription.waitlist.common.DomainException;

/** Implémentation HTTP : appelle le Service Cours (COURSES_SERVICE_URL). */
public class HttpCoursesClient implements CoursesClient {

    private final RestClient http;

    public HttpCoursesClient(RestClient http) {
        this.http = http;
    }

    @Override
    public Optional<Cours> findById(String id) {
        try {
            return Optional.ofNullable(
                    http.get().uri("/courses/{id}", id).retrieve().body(Cours.class));
        } catch (HttpClientErrorException.NotFound e) {
            return Optional.empty();
        } catch (RestClientException e) {
            throw DomainException.serviceIndisponible("Service cours indisponible : " + e.getMessage());
        }
    }
}
