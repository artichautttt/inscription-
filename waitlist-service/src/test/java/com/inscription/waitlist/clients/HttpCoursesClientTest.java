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
import org.springframework.test.web.client.response.DefaultResponseCreator;
import org.springframework.web.client.RestClient;

import com.inscription.waitlist.common.DomainException;

class HttpCoursesClientTest {

    private static final String ID = "33333333-3333-4333-8333-333333333333";
    private static final String URL = "http://courses.test/courses/" + ID;

    private MockRestServiceServer serveur;
    private HttpCoursesClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://courses.test");
        serveur = MockRestServiceServer.bindTo(builder).build();
        client = new HttpCoursesClient(builder.build());
    }

    @Test
    void renvoieLeCoursSur200EnIgnorantLesChampsInconnus() {
        serveur.expect(requestTo(URL)).andExpect(method(HttpMethod.GET)).andRespond(withSuccess(
                "{\"id\":\"" + ID + "\",\"titre\":\"Bases de données\",\"capacite\":20,"
                        + "\"placesRestantes\":0,\"champInconnu\":true}",
                MediaType.APPLICATION_JSON));

        assertThat(client.findById(ID)).contains(new Cours(ID, "Bases de données", 20, 0));
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
        assertIndisponible(withServerError());
    }

    @Test
    void leve502SiLeServiceEstInjoignable() {
        serveur.expect(requestTo(URL)).andRespond(withException(new IOException("Connection refused")));

        assertThatThrownBy(() -> client.findById(ID))
                .isInstanceOfSatisfying(DomainException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("SERVICE_INDISPONIBLE");
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(e.getMessage()).startsWith("Service cours indisponible").contains("Connection refused");
                });
    }

    private void assertIndisponible(DefaultResponseCreator reponse) {
        serveur.expect(requestTo(URL)).andRespond(reponse);

        assertThatThrownBy(() -> client.findById(ID))
                .isInstanceOfSatisfying(DomainException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("SERVICE_INDISPONIBLE");
                    assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY);
                });
    }
}
