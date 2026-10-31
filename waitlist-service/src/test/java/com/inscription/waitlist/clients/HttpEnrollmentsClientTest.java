package com.inscription.waitlist.clients;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import com.inscription.waitlist.common.DomainException;

class HttpEnrollmentsClientTest {

    private static final String ETUDIANT = "11111111-1111-4111-8111-111111111111";
    private static final String COURS = "33333333-3333-4333-8333-333333333333";
    private static final String AUTRE_COURS = "22222222-2222-4222-8222-222222222222";
    private static final String URL_LISTE = "http://enrollments.test/enrollments?etudiantId=" + ETUDIANT;
    private static final String URL_CREATION = "http://enrollments.test/enrollments";

    private MockRestServiceServer serveur;
    private HttpEnrollmentsClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://enrollments.test");
        serveur = MockRestServiceServer.bindTo(builder).build();
        client = new HttpEnrollmentsClient(builder.build());
    }

    private static String inscription(String coursId) {
        return "{\"id\":\"insc-" + coursId.charAt(0) + "\",\"etudiantId\":\"" + ETUDIANT + "\",\"coursId\":\""
                + coursId + "\",\"date\":\"2026-10-10T08:00:00.000Z\",\"coursTitre\":\"Un cours\"}";
    }

    private static void assertIndisponible(ThrowingCallable appel) {
        assertThatThrownBy(appel).isInstanceOfSatisfying(DomainException.class, e -> {
            assertThat(e.getCode()).isEqualTo("SERVICE_INDISPONIBLE");
            assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY);
            assertThat(e.getMessage()).startsWith("Service inscriptions indisponible");
        });
    }

    @Nested
    class IsEnrolled {

        @Test
        void vraiSiUneInscriptionPorteSurCeCours() {
            serveur.expect(requestTo(URL_LISTE)).andExpect(method(HttpMethod.GET)).andRespond(withSuccess(
                    "[" + inscription(AUTRE_COURS) + "," + inscription(COURS) + "]", MediaType.APPLICATION_JSON));

            assertThat(client.isEnrolled(ETUDIANT, COURS)).isTrue();
            serveur.verify();
        }

        @Test
        void fauxSiLesInscriptionsPortentSurDAutresCours() {
            serveur.expect(requestTo(URL_LISTE)).andRespond(withSuccess(
                    "[" + inscription(AUTRE_COURS) + "]", MediaType.APPLICATION_JSON));

            assertThat(client.isEnrolled(ETUDIANT, COURS)).isFalse();
        }

        @Test
        void fauxSiAucuneInscription() {
            serveur.expect(requestTo(URL_LISTE)).andRespond(withSuccess("[]", MediaType.APPLICATION_JSON));

            assertThat(client.isEnrolled(ETUDIANT, COURS)).isFalse();
        }

        @Test
        void fauxSur200SansCorps() {
            serveur.expect(requestTo(URL_LISTE)).andRespond(withSuccess());

            assertThat(client.isEnrolled(ETUDIANT, COURS)).isFalse();
        }

        @Test
        void leve502SurErreurServeur() {
            serveur.expect(requestTo(URL_LISTE)).andRespond(withServerError());

            assertIndisponible(() -> client.isEnrolled(ETUDIANT, COURS));
        }

        @Test
        void leve502SiLeServiceEstInjoignable() {
            serveur.expect(requestTo(URL_LISTE)).andRespond(withException(new IOException("Connection refused")));

            assertIndisponible(() -> client.isEnrolled(ETUDIANT, COURS));
        }
    }

    @Nested
    class Enroll {

        @Test
        void posteEtudiantIdEtCoursIdEtRenvoieLInscription() {
            serveur.expect(requestTo(URL_CREATION))
                    .andExpect(method(HttpMethod.POST))
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(content().json(
                            "{\"etudiantId\":\"" + ETUDIANT + "\",\"coursId\":\"" + COURS + "\"}", true))
                    .andRespond(withStatus(HttpStatus.CREATED)
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(inscription(COURS)));

            assertThat(client.enroll(ETUDIANT, COURS))
                    .isEqualTo(new Inscription("insc-3", ETUDIANT, COURS, "2026-10-10T08:00:00.000Z"));
            serveur.verify();
        }

        @ParameterizedTest(name = "HTTP {0} {1} est relayé tel quel")
        @CsvSource({
                "409, INSCRIPTION_DUPLIQUEE, Cet étudiant est déjà inscrit à ce cours.",
                "422, COURS_COMPLET, Ce cours est complet.",
                "404, RESSOURCE_INTROUVABLE, Étudiant introuvable.",
        })
        void relaieUnRefusMetier(int statut, String code, String message) {
            serveur.expect(requestTo(URL_CREATION)).andRespond(withStatus(HttpStatus.valueOf(statut))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"code\":\"" + code + "\",\"message\":\"" + message + "\"}"));

            assertThatThrownBy(() -> client.enroll(ETUDIANT, COURS))
                    .isInstanceOfSatisfying(DomainException.class, e -> {
                        assertThat(e.getCode()).isEqualTo(code);
                        assertThat(e.getMessage()).isEqualTo(message);
                        assertThat(e.getStatus().value()).isEqualTo(statut);
                    });
        }

        @Test
        void leve502SurUn4xxQuiNEstPasAuFormatCodeMessage() {
            // Format d'erreur de validation NestJS : pas de "code", "message" est un tableau.
            serveur.expect(requestTo(URL_CREATION)).andRespond(withStatus(HttpStatus.BAD_REQUEST)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"statusCode\":400,\"message\":[\"coursId must be a UUID\"],\"error\":\"Bad Request\"}"));

            assertIndisponible(() -> client.enroll(ETUDIANT, COURS));
        }

        @Test
        void leve502SurUn4xxSansCode() {
            serveur.expect(requestTo(URL_CREATION)).andRespond(withStatus(HttpStatus.CONFLICT)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"message\":\"sans code\"}"));

            assertIndisponible(() -> client.enroll(ETUDIANT, COURS));
        }

        @Test
        void leve502SurUn4xxSansCorps() {
            serveur.expect(requestTo(URL_CREATION)).andRespond(withStatus(HttpStatus.CONFLICT));

            assertIndisponible(() -> client.enroll(ETUDIANT, COURS));
        }

        @Test
        void leve502SurUneErreurServeurMemeAuFormatCodeMessage() {
            serveur.expect(requestTo(URL_CREATION)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"code\":\"ERREUR_INTERNE\",\"message\":\"boom\"}"));

            assertIndisponible(() -> client.enroll(ETUDIANT, COURS));
        }

        @Test
        void leve502SiLeServiceEstInjoignable() {
            serveur.expect(requestTo(URL_CREATION)).andRespond(withException(new IOException("Connection refused")));

            assertIndisponible(() -> client.enroll(ETUDIANT, COURS));
        }
    }
}
