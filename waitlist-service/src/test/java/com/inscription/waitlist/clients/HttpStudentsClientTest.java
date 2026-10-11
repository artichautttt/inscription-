package com.inscription.waitlist.clients;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withResourceNotFound;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import com.inscription.waitlist.common.DomainException;

class HttpStudentsClientTest {

    private static final String ID = "11111111-1111-4111-8111-111111111111";
    private static final String URL = "http://students.test/students/" + ID;

    private MockRestServiceServer serveur;
    private HttpStudentsClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://students.test");
        serveur = MockRestServiceServer.bindTo(builder).build();
        client = new HttpStudentsClient(builder.build());
    }

    @Test
    void renvoieLEtudiantSur200EnIgnorantLesChampsInconnus() {
        serveur.expect(requestTo(URL)).andExpect(method(HttpMethod.GET)).andRespond(withSuccess(
                "{\"id\":\"" + ID + "\",\"nom\":\"Dupont\",\"prenom\":\"Jean\","
                        + "\"email\":\"jean.dupont@example.com\",\"role\":\"ELEVE\"}",
                MediaType.APPLICATION_JSON));

        assertThat(client.findById(ID)).contains(new Etudiant(ID, "Dupont", "jean.dupont@example.com"));
        serveur.verify();
    }

    @Test
    void renvoieVideSur404() {
        serveur.expect(requestTo(URL)).andRespond(withResourceNotFound());

        assertThat(client.findById(ID)).isEmpty();
    }

    @Test
    void renvoieVideSur200SansCorps() {
        serveur.expect(requestTo(URL)).andRespond(withSuccess());

        assertThat(client.findById(ID)).isEmpty();
    }

    @Test
    void leve502SurErreurServeur() {
        serveur.expect(requestTo(URL)).andRespond(withServerError());

        assertThatThrownBy(() -> client.findById(ID))
                .isInstanceOfSatisfying(DomainException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("SERVICE_INDISPONIBLE");
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY);
                });
    }

    @Test
    void leve502SiLeServiceEstInjoignable() {
        serveur.expect(requestTo(URL)).andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> client.findById(ID))
                .isInstanceOfSatisfying(DomainException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("SERVICE_INDISPONIBLE");
                    assertThat(e.getMessage()).startsWith("Service étudiants indisponible").contains("Connection refused");
                });
    }
}
