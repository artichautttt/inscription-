package com.inscription.waitlist.waitlist;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.inscription.waitlist.clients.Inscription;
import com.inscription.waitlist.common.DomainException;

@WebMvcTest(WaitlistController.class)
class WaitlistControllerTest {

    private static final String ETUDIANT = "11111111-1111-4111-8111-111111111111";
    private static final String COURS = "33333333-3333-4333-8333-333333333333";
    private static final String ENTREE = "44444444-4444-4444-8444-444444444444";
    private static final Instant DATE = Instant.parse("2026-10-10T08:00:00Z");

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private WaitlistService waitlist;

    private static String body(String etudiantId, String coursId) {
        return "{\"etudiantId\":\"" + etudiantId + "\",\"coursId\":\"" + coursId + "\"}";
    }

    // ---------- POST /waitlist ----------

    @Test
    void postRenvoie201AvecLEntreeEtSaPosition() throws Exception {
        when(waitlist.join(ETUDIANT, COURS))
                .thenReturn(new WaitlistEntryResponse(ENTREE, ETUDIANT, COURS, DATE, 3));

        mvc.perform(post("/waitlist").contentType(MediaType.APPLICATION_JSON).content(body(ETUDIANT, COURS)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(ENTREE))
                .andExpect(jsonPath("$.etudiantId").value(ETUDIANT))
                .andExpect(jsonPath("$.coursId").value(COURS))
                .andExpect(jsonPath("$.dateAjout").value("2026-10-10T08:00:00Z"))
                .andExpect(jsonPath("$.position").value(3));
    }

    static Stream<Arguments> erreursMetier() {
        return Stream.of(
                Arguments.of(DomainException.ressourceIntrouvable("Cours x introuvable."), 404, "RESSOURCE_INTROUVABLE"),
                Arguments.of(DomainException.coursNonComplet(), 422, "COURS_NON_COMPLET"),
                Arguments.of(DomainException.dejaEnListeAttente(), 409, "DEJA_EN_LISTE_ATTENTE"),
                Arguments.of(DomainException.dejaInscrit(), 409, "DEJA_INSCRIT"),
                Arguments.of(DomainException.serviceIndisponible("Service cours indisponible"), 502, "SERVICE_INDISPONIBLE"));
    }

    @ParameterizedTest(name = "{2} -> HTTP {1}")
    @MethodSource("erreursMetier")
    void postTraduitLesErreursMetierAuFormatCodeMessage(DomainException erreur, int statut, String code)
            throws Exception {
        when(waitlist.join(ETUDIANT, COURS)).thenThrow(erreur);

        mvc.perform(post("/waitlist").contentType(MediaType.APPLICATION_JSON).content(body(ETUDIANT, COURS)))
                .andExpect(status().is(statut))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.message").value(erreur.getMessage()))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @ParameterizedTest(name = "body {0} -> 400 mentionnant {1}")
    @CsvSource(delimiter = '|', value = {
            "{\"etudiantId\":\"11111111-1111-4111-8111-111111111111\"} | coursId",
            "{\"coursId\":\"33333333-3333-4333-8333-333333333333\"} | etudiantId",
    })
    void postRefuseUnChampManquant(String json, String champ) throws Exception {
        mvc.perform(post("/waitlist").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("REQUETE_INVALIDE"))
                .andExpect(jsonPath("$.message", containsString(champ)));

        verifyNoInteractions(waitlist);
    }

    @Test
    void postListeTousLesChampsManquantsDansLOrdre() throws Exception {
        mvc.perform(post("/waitlist").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("REQUETE_INVALIDE"))
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.matchesPattern("coursId .+, etudiantId .+")));
    }

    @ParameterizedTest(name = "body illisible : {0}")
    @CsvSource(delimiter = '|', value = {
            "{\"etudiantId\":\"pas-un-uuid\",\"coursId\":\"33333333-3333-4333-8333-333333333333\"}",
            "{ceci n'est pas du json",
    })
    void postRefuseUnBodyIllisible(String json) throws Exception {
        mvc.perform(post("/waitlist").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("REQUETE_INVALIDE"))
                .andExpect(jsonPath("$.message", containsString("invalide")));

        verifyNoInteractions(waitlist);
    }

    // ---------- GET /waitlist/courses/:coursId ----------

    @Test
    void getRenvoieLaFileOrdonnee() throws Exception {
        when(waitlist.getQueue(COURS)).thenReturn(List.of(
                new WaitlistEntryResponse("e1", "etu-1", COURS, DATE, 1),
                new WaitlistEntryResponse("e2", "etu-2", COURS, DATE, 2)));

        mvc.perform(get("/waitlist/courses/{coursId}", COURS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].etudiantId").value("etu-1"))
                .andExpect(jsonPath("$[0].position").value(1))
                .andExpect(jsonPath("$[1].etudiantId").value("etu-2"))
                .andExpect(jsonPath("$[1].position").value(2));
    }

    @Test
    void getRenvoieUnTableauVidePourUneFileVide() throws Exception {
        when(waitlist.getQueue(COURS)).thenReturn(List.of());

        mvc.perform(get("/waitlist/courses/{coursId}", COURS))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }

    @Test
    void getRefuseUnCoursIdQuiNEstPasUnUuid() throws Exception {
        mvc.perform(get("/waitlist/courses/{coursId}", "pas-un-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("REQUETE_INVALIDE"))
                .andExpect(jsonPath("$.message", containsString("coursId")));

        verifyNoInteractions(waitlist);
    }

    // ---------- DELETE /waitlist/:id ----------

    @Test
    void deleteRenvoie204EtTransmetLIdentiteDeLAppelant() throws Exception {
        mvc.perform(delete("/waitlist/{id}", ENTREE)
                        .header("X-User-Id", ETUDIANT)
                        .header("X-User-Role", "ELEVE"))
                .andExpect(status().isNoContent())
                .andExpect(content().string(""));

        verify(waitlist).leave(ENTREE, new Requester(ETUDIANT, "ELEVE"));
    }

    @ParameterizedTest(name = "X-User-Id=[{0}] X-User-Role=[{1}] -> 403")
    @CsvSource(value = {
            "NULL, NULL",
            "11111111-1111-4111-8111-111111111111, NULL",
            "NULL, ELEVE",
            "'', ELEVE",
            "11111111-1111-4111-8111-111111111111, ''",
    }, nullValues = "NULL")
    void deleteRefuseSansIdentiteComplete(String userId, String role) throws Exception {
        var requete = delete("/waitlist/{id}", ENTREE);
        if (userId != null) {
            requete.header("X-User-Id", userId);
        }
        if (role != null) {
            requete.header("X-User-Role", role);
        }

        mvc.perform(requete)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCES_INTERDIT"));

        verifyNoInteractions(waitlist);
    }

    @Test
    void deleteRelaieLeRefusDuService() throws Exception {
        doThrow(DomainException.accesInterdit("Pas votre entrée."))
                .when(waitlist).leave(ENTREE, new Requester("autre", "ELEVE"));

        mvc.perform(delete("/waitlist/{id}", ENTREE)
                        .header("X-User-Id", "autre")
                        .header("X-User-Role", "ELEVE"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCES_INTERDIT"))
                .andExpect(jsonPath("$.message").value("Pas votre entrée."));
    }

    // ---------- POST /waitlist/courses/:coursId/promote ----------

    @Test
    void promoteRenvoie201AvecLInscriptionCreee() throws Exception {
        when(waitlist.promote(COURS)).thenReturn(new PromotionResponse(
                ETUDIANT, COURS, new Inscription("insc-1", ETUDIANT, COURS, "2026-10-10T08:00:00.000Z")));

        mvc.perform(post("/waitlist/courses/{coursId}/promote", COURS))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.etudiantId").value(ETUDIANT))
                .andExpect(jsonPath("$.coursId").value(COURS))
                .andExpect(jsonPath("$.inscription.id").value("insc-1"));
    }

    static Stream<Arguments> erreursPromotion() {
        return Stream.of(
                Arguments.of(DomainException.fileVide(), 409, "FILE_VIDE"),
                Arguments.of(DomainException.coursComplet(), 422, "COURS_COMPLET"),
                Arguments.of(DomainException.ressourceIntrouvable("Cours x introuvable."), 404, "RESSOURCE_INTROUVABLE"));
    }

    @ParameterizedTest(name = "{2} -> HTTP {1}")
    @MethodSource("erreursPromotion")
    void promoteTraduitLesErreursMetier(DomainException erreur, int statut, String code) throws Exception {
        when(waitlist.promote(COURS)).thenThrow(erreur);

        mvc.perform(post("/waitlist/courses/{coursId}/promote", COURS))
                .andExpect(status().is(statut))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.message").value(erreur.getMessage()));
    }
}
