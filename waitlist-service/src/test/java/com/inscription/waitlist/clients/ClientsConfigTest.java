package com.inscription.waitlist.clients;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpServer;

/**
 * Vérifie que chaque client construit par la config appelle bien l'URL qu'on lui donne,
 * via un vrai aller-retour HTTP sur un serveur local éphémère.
 */
class ClientsConfigTest {

    private static final String ETUDIANT = "11111111-1111-4111-8111-111111111111";
    private static final String COURS = "33333333-3333-4333-8333-333333333333";

    private final ClientsConfig config = new ClientsConfig();
    private HttpServer serveur;
    private String baseUrl;

    @BeforeEach
    void demarrerServeur() throws IOException {
        serveur = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        repondre("/courses/" + COURS,
                "{\"id\":\"" + COURS + "\",\"titre\":\"Bases de données\",\"capacite\":20,\"placesRestantes\":0}");
        repondre("/students/" + ETUDIANT,
                "{\"id\":\"" + ETUDIANT + "\",\"nom\":\"Dupont\",\"email\":\"jean.dupont@example.com\"}");
        repondre("/enrollments",
                "[{\"id\":\"insc-1\",\"etudiantId\":\"" + ETUDIANT + "\",\"coursId\":\"" + COURS
                        + "\",\"date\":\"2026-10-10T08:00:00.000Z\"}]");
        serveur.start();
        baseUrl = "http://localhost:" + serveur.getAddress().getPort();
    }

    @AfterEach
    void arreterServeur() {
        serveur.stop(0);
    }

    private void repondre(String chemin, String json) {
        serveur.createContext(chemin, echange -> {
            byte[] corps = json.getBytes(StandardCharsets.UTF_8);
            echange.getResponseHeaders().add("Content-Type", "application/json");
            echange.sendResponseHeaders(200, corps.length);
            echange.getResponseBody().write(corps);
            echange.close();
        });
    }

    @Test
    void coursesClientAppelleLUrlConfiguree() {
        assertThat(config.coursesClient(baseUrl).findById(COURS))
                .contains(new Cours(COURS, "Bases de données", 20, 0));
    }

    @Test
    void studentsClientAppelleLUrlConfiguree() {
        assertThat(config.studentsClient(baseUrl).findById(ETUDIANT))
                .contains(new Etudiant(ETUDIANT, "Dupont", "jean.dupont@example.com"));
    }

    @Test
    void enrollmentsClientAppelleLUrlConfiguree() {
        assertThat(config.enrollmentsClient(baseUrl).isEnrolled(ETUDIANT, COURS)).isTrue();
    }

    @Test
    void lHorlogeEstEnUtc() {
        assertThat(config.clock()).isEqualTo(Clock.systemUTC());
    }
}
