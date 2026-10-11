package com.inscription.waitlist.waitlist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.inscription.waitlist.clients.Cours;
import com.inscription.waitlist.clients.CoursesClient;
import com.inscription.waitlist.clients.EnrollmentsClient;
import com.inscription.waitlist.clients.Etudiant;
import com.inscription.waitlist.clients.Inscription;
import com.inscription.waitlist.clients.StudentsClient;
import com.inscription.waitlist.common.DomainException;

@ExtendWith(MockitoExtension.class)
class WaitlistServiceTest {

    private static final String ETUDIANT = "11111111-1111-4111-8111-111111111111";
    private static final String COURS = "33333333-3333-4333-8333-333333333333";
    private static final Instant MAINTENANT = Instant.parse("2026-10-10T08:00:00Z");

    @Mock
    private WaitlistRepository repository;
    @Mock
    private StudentsClient students;
    @Mock
    private CoursesClient courses;
    @Mock
    private EnrollmentsClient enrollments;

    private WaitlistService service;

    @BeforeEach
    void setUp() {
        service = new WaitlistService(
                repository, students, courses, enrollments, Clock.fixed(MAINTENANT, ZoneOffset.UTC));
    }

    private static Cours cours(int placesRestantes) {
        return new Cours(COURS, "Bases de données", 20, placesRestantes);
    }

    private static WaitlistEntry entree(String id, String etudiantId) {
        return new WaitlistEntry(id, etudiantId, COURS, MAINTENANT);
    }

    /** File de n entrées : ids "e1".."en", étudiants "etu-1".."etu-n". */
    private static List<WaitlistEntry> file(int taille) {
        return IntStream.rangeClosed(1, taille)
                .mapToObj(i -> entree("e" + i, "etu-" + i))
                .toList();
    }

    private void etudiantExiste() {
        when(students.findById(ETUDIANT))
                .thenReturn(Optional.of(new Etudiant(ETUDIANT, "Dupont", "jean.dupont@example.com")));
    }

    private void coursAvecPlaces(int placesRestantes) {
        when(courses.findById(COURS)).thenReturn(Optional.of(cours(placesRestantes)));
    }

    private static void assertErreur(ThrowingCallable appel, String code, HttpStatus status) {
        assertThatThrownBy(appel).isInstanceOfSatisfying(DomainException.class, e -> {
            assertThat(e.getCode()).isEqualTo(code);
            assertThat(e.getStatus()).isEqualTo(status);
        });
    }

    @Nested
    class Join {

        @Test
        void refuseSiEtudiantIntrouvable() {
            when(students.findById(ETUDIANT)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.join(ETUDIANT, COURS))
                    .isInstanceOfSatisfying(DomainException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("RESSOURCE_INTROUVABLE");
                        assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                        assertThat(e.getMessage()).contains("Étudiant").contains(ETUDIANT);
                    });

            verifyNoInteractions(courses, enrollments, repository);
        }

        @Test
        void refuseSiCoursIntrouvable() {
            etudiantExiste();
            when(courses.findById(COURS)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.join(ETUDIANT, COURS))
                    .isInstanceOfSatisfying(DomainException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("RESSOURCE_INTROUVABLE");
                        assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                        assertThat(e.getMessage()).contains("Cours").contains(COURS);
                    });

            verifyNoInteractions(enrollments, repository);
        }

        @ParameterizedTest(name = "placesRestantes = {0} -> COURS_NON_COMPLET")
        @ValueSource(ints = {1, 2, 30})
        void refuseSiCoursNonComplet(int placesRestantes) {
            etudiantExiste();
            coursAvecPlaces(placesRestantes);

            assertErreur(() -> service.join(ETUDIANT, COURS),
                    "COURS_NON_COMPLET", HttpStatus.UNPROCESSABLE_ENTITY);

            verifyNoInteractions(enrollments, repository);
        }

        @Test
        void refuseLeDoublonDansLaFile() {
            etudiantExiste();
            coursAvecPlaces(0);
            when(repository.existsByEtudiantIdAndCoursId(ETUDIANT, COURS)).thenReturn(true);

            assertErreur(() -> service.join(ETUDIANT, COURS),
                    "DEJA_EN_LISTE_ATTENTE", HttpStatus.CONFLICT);

            verify(repository, never()).save(any());
            verifyNoInteractions(enrollments);
        }

        @Test
        void refuseSiDejaInscritAuCours() {
            etudiantExiste();
            coursAvecPlaces(0);
            when(repository.existsByEtudiantIdAndCoursId(ETUDIANT, COURS)).thenReturn(false);
            when(enrollments.isEnrolled(ETUDIANT, COURS)).thenReturn(true);

            assertErreur(() -> service.join(ETUDIANT, COURS), "DEJA_INSCRIT", HttpStatus.CONFLICT);

            verify(repository, never()).save(any());
        }

        @ParameterizedTest(name = "file de {0} -> nouvelle position {1}")
        @CsvSource({"0, 1", "1, 2", "3, 4"})
        void ajouteEnFinDeFileAvecLaBonnePosition(int tailleExistante, int positionAttendue) {
            etudiantExiste();
            coursAvecPlaces(0);
            when(repository.existsByEtudiantIdAndCoursId(ETUDIANT, COURS)).thenReturn(false);
            when(enrollments.isEnrolled(ETUDIANT, COURS)).thenReturn(false);
            List<WaitlistEntry> stockage = new ArrayList<>(file(tailleExistante));
            when(repository.save(any())).thenAnswer(appel -> {
                WaitlistEntry e = appel.getArgument(0);
                stockage.add(e);
                return e;
            });
            when(repository.findByCoursId(COURS)).thenAnswer(appel -> List.copyOf(stockage));

            WaitlistEntryResponse reponse = service.join(ETUDIANT, COURS);

            ArgumentCaptor<WaitlistEntry> sauvee = ArgumentCaptor.forClass(WaitlistEntry.class);
            verify(repository).save(sauvee.capture());
            assertThat(sauvee.getValue().etudiantId()).isEqualTo(ETUDIANT);
            assertThat(sauvee.getValue().coursId()).isEqualTo(COURS);
            assertThat(sauvee.getValue().dateAjout()).isEqualTo(MAINTENANT);
            assertThat(UUID.fromString(sauvee.getValue().id())).isNotNull();

            assertThat(reponse).isEqualTo(new WaitlistEntryResponse(
                    sauvee.getValue().id(), ETUDIANT, COURS, MAINTENANT, positionAttendue));
        }

        @ParameterizedTest(name = "placesRestantes = {0} -> cours considéré complet")
        @ValueSource(ints = {0, -1})
        void accepteQuandLeCoursEstComplet(int placesRestantes) {
            etudiantExiste();
            coursAvecPlaces(placesRestantes);
            when(repository.save(any())).thenAnswer(appel -> appel.getArgument(0));
            when(repository.findByCoursId(COURS))
                    .thenAnswer(appel -> List.of());

            service.join(ETUDIANT, COURS);

            verify(repository).save(any());
        }
    }

    @Nested
    class GetQueue {

        @ParameterizedTest(name = "file de {0} élément(s)")
        @ValueSource(ints = {0, 1, 3})
        void renvoieLaFileEnOrdreFifoAvecPositions(int taille) {
            List<WaitlistEntry> file = file(taille);
            when(repository.findByCoursId(COURS)).thenReturn(file);

            List<WaitlistEntryResponse> reponse = service.getQueue(COURS);

            assertThat(reponse).hasSize(taille);
            for (int i = 0; i < taille; i++) {
                assertThat(reponse.get(i))
                        .isEqualTo(new WaitlistEntryResponse("e" + (i + 1), "etu-" + (i + 1), COURS, MAINTENANT, i + 1));
            }
            verifyNoInteractions(courses, students, enrollments);
        }
    }

    @Nested
    class Leave {

        @Test
        void refuseSiEntreeIntrouvable() {
            when(repository.findById("inconnue")).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.leave("inconnue", new Requester(ETUDIANT, "ELEVE")))
                    .isInstanceOfSatisfying(DomainException.class, e -> {
                        assertThat(e.getCode()).isEqualTo("RESSOURCE_INTROUVABLE");
                        assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
                        assertThat(e.getMessage()).contains("inconnue");
                    });

            verify(repository, never()).deleteById(anyString());
        }

        @ParameterizedTest(name = "appelant {0} / {1} -> autorisé")
        @CsvSource({
                "11111111-1111-4111-8111-111111111111, ELEVE",
                "11111111-1111-4111-8111-111111111111, ADMIN",
                "un-admin, ADMIN",
        })
        void proprietaireOuAdminPeutRetirerLEntree(String userId, String role) {
            when(repository.findById("e1")).thenReturn(Optional.of(entree("e1", ETUDIANT)));

            service.leave("e1", new Requester(userId, role));

            verify(repository).deleteById("e1");
        }

        @ParameterizedTest(name = "appelant autre-eleve / {0} -> ACCES_INTERDIT")
        @ValueSource(strings = {"ELEVE", "admin", "INCONNU"})
        void unAutreEleveNePeutPasRetirerLEntree(String role) {
            when(repository.findById("e1")).thenReturn(Optional.of(entree("e1", ETUDIANT)));

            assertErreur(() -> service.leave("e1", new Requester("autre-eleve", role)),
                    "ACCES_INTERDIT", HttpStatus.FORBIDDEN);

            verify(repository, never()).deleteById(anyString());
        }
    }

    @Nested
    class Promote {

        private final Inscription inscription =
                new Inscription("insc-1", "etu-1", COURS, "2026-10-10T08:00:00.000Z");

        @Test
        void refuseSiCoursIntrouvable() {
            when(courses.findById(COURS)).thenReturn(Optional.empty());

            assertErreur(() -> service.promote(COURS), "RESSOURCE_INTROUVABLE", HttpStatus.NOT_FOUND);

            verifyNoInteractions(enrollments, repository);
        }

        @ParameterizedTest(name = "placesRestantes = {0} -> COURS_COMPLET")
        @ValueSource(ints = {0, -1})
        void refuseSansPlaceLibre(int placesRestantes) {
            coursAvecPlaces(placesRestantes);
            when(repository.findByCoursId(COURS)).thenReturn(file(2));

            assertErreur(() -> service.promote(COURS), "COURS_COMPLET", HttpStatus.UNPROCESSABLE_ENTITY);

            verifyNoInteractions(enrollments);
            verify(repository, never()).deleteById(anyString());
        }

        @ParameterizedTest(name = "file vide, placesRestantes = {0} -> FILE_VIDE (prime sur COURS_COMPLET)")
        @ValueSource(ints = {1, 0, -1})
        void refuseSiLaFileEstVide(int placesRestantes) {
            coursAvecPlaces(placesRestantes);
            when(repository.findByCoursId(COURS)).thenReturn(List.of());

            assertErreur(() -> service.promote(COURS), "FILE_VIDE", HttpStatus.CONFLICT);

            verifyNoInteractions(enrollments);
            verify(repository, never()).deleteById(anyString());
        }

        @ParameterizedTest(name = "file de {0}, {1} place(s) -> seul le premier est promu")
        @CsvSource({"1, 1", "3, 1", "3, 5"})
        void inscritLePremierPuisLeRetireDeLaFile(int taille, int placesRestantes) {
            coursAvecPlaces(placesRestantes);
            when(repository.findByCoursId(COURS)).thenReturn(file(taille));
            when(enrollments.enroll("etu-1", COURS)).thenReturn(inscription);

            PromotionResponse reponse = service.promote(COURS);

            assertThat(reponse).isEqualTo(new PromotionResponse("etu-1", COURS, inscription));
            InOrder ordre = inOrder(enrollments, repository);
            ordre.verify(enrollments).enroll("etu-1", COURS);
            ordre.verify(repository).deleteById("e1");
            ordre.verifyNoMoreInteractions();
        }

        @Test
        void gardeLEtudiantDansLaFileSiLInscriptionEchoue() {
            coursAvecPlaces(1);
            when(repository.findByCoursId(COURS)).thenReturn(file(2));
            DomainException refus = new DomainException("COURS_COMPLET", "Ce cours est complet.",
                    HttpStatus.UNPROCESSABLE_ENTITY);
            when(enrollments.enroll("etu-1", COURS)).thenThrow(refus);

            assertThatThrownBy(() -> service.promote(COURS)).isSameAs(refus);

            verify(repository, never()).deleteById(anyString());
        }
    }
}
