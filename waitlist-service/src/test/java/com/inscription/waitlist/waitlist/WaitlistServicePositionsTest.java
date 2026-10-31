package com.inscription.waitlist.waitlist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.inscription.waitlist.clients.Cours;
import com.inscription.waitlist.clients.CoursesClient;
import com.inscription.waitlist.clients.EnrollmentsClient;
import com.inscription.waitlist.clients.Etudiant;
import com.inscription.waitlist.clients.Inscription;
import com.inscription.waitlist.clients.StudentsClient;

/**
 * Scénarios de bout en bout sur la file (service + vrai repository en mémoire,
 * clients mockés) : c'est ici qu'on vérifie le recalcul des positions.
 */
@ExtendWith(MockitoExtension.class)
class WaitlistServicePositionsTest {

    private static final String COURS = "33333333-3333-4333-8333-333333333333";

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
                new InMemoryWaitlistRepository(), students, courses, enrollments, Clock.systemUTC());
        when(students.findById(anyString()))
                .thenAnswer(appel -> Optional.of(new Etudiant(appel.getArgument(0), "Nom", "e@x.y")));
        when(courses.findById(COURS)).thenReturn(Optional.of(new Cours(COURS, "Cours", 1, 0)));
    }

    private List<String> etudiantsEnFile() {
        return service.getQueue(COURS).stream().map(WaitlistEntryResponse::etudiantId).toList();
    }

    private List<Integer> positions() {
        return service.getQueue(COURS).stream().map(WaitlistEntryResponse::position).toList();
    }

    @Test
    void lesPositionsSuiventLOrdreDArrivee() {
        assertThat(service.join("etu-1", COURS).position()).isEqualTo(1);
        assertThat(service.join("etu-2", COURS).position()).isEqualTo(2);
        assertThat(service.join("etu-3", COURS).position()).isEqualTo(3);

        assertThat(etudiantsEnFile()).containsExactly("etu-1", "etu-2", "etu-3");
        assertThat(positions()).containsExactly(1, 2, 3);
    }

    @Test
    void quitterLaFileRecalculeLesPositionsDesSuivants() {
        service.join("etu-1", COURS);
        WaitlistEntryResponse deuxieme = service.join("etu-2", COURS);
        service.join("etu-3", COURS);

        service.leave(deuxieme.id(), new Requester("etu-2", "ELEVE"));

        assertThat(etudiantsEnFile()).containsExactly("etu-1", "etu-3");
        assertThat(positions()).containsExactly(1, 2);
    }

    @Test
    void quitterPuisRevenirPlaceEnFinDeFile() {
        WaitlistEntryResponse premier = service.join("etu-1", COURS);
        service.join("etu-2", COURS);

        service.leave(premier.id(), new Requester("etu-1", "ELEVE"));

        assertThat(service.join("etu-1", COURS).position()).isEqualTo(2);
        assertThat(etudiantsEnFile()).containsExactly("etu-2", "etu-1");
    }

    @Test
    void promouvoirRetireLePremierEtFaitAvancerLaFile() {
        service.join("etu-1", COURS);
        service.join("etu-2", COURS);
        when(courses.findById(COURS)).thenReturn(Optional.of(new Cours(COURS, "Cours", 1, 1)));
        when(enrollments.enroll("etu-1", COURS))
                .thenReturn(new Inscription("insc-1", "etu-1", COURS, "2026-10-10T08:00:00.000Z"));

        PromotionResponse promotion = service.promote(COURS);

        assertThat(promotion.etudiantId()).isEqualTo("etu-1");
        assertThat(etudiantsEnFile()).containsExactly("etu-2");
        assertThat(positions()).containsExactly(1);
    }
}
