package com.inscription.waitlist.waitlist;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class InMemoryWaitlistRepositoryTest {

    private static final Instant DATE = Instant.parse("2026-10-10T08:00:00Z");

    private InMemoryWaitlistRepository repository;

    private final WaitlistEntry a1 = new WaitlistEntry("a1", "etu-1", "cours-A", DATE);
    private final WaitlistEntry b1 = new WaitlistEntry("b1", "etu-1", "cours-B", DATE);
    private final WaitlistEntry a2 = new WaitlistEntry("a2", "etu-2", "cours-A", DATE);
    private final WaitlistEntry a3 = new WaitlistEntry("a3", "etu-3", "cours-A", DATE);

    @BeforeEach
    void setUp() {
        repository = new InMemoryWaitlistRepository();
    }

    private void remplir() {
        repository.save(a1);
        repository.save(b1);
        repository.save(a2);
        repository.save(a3);
    }

    @Test
    void saveRenvoieLEntreeSauvee() {
        assertThat(repository.save(a1)).isSameAs(a1);
    }

    @Test
    void fileVideParDefaut() {
        assertThat(repository.findByCoursId("cours-A")).isEmpty();
        assertThat(repository.findById("a1")).isEmpty();
    }

    @Test
    void findByCoursIdRenvoieLaFileDuCoursDansLOrdreDArrivee() {
        remplir();

        assertThat(repository.findByCoursId("cours-A")).containsExactly(a1, a2, a3);
        assertThat(repository.findByCoursId("cours-B")).containsExactly(b1);
        assertThat(repository.findByCoursId("cours-C")).isEmpty();
    }

    @Test
    void findByIdRetrouveLaBonneEntree() {
        remplir();

        assertThat(repository.findById("a2")).contains(a2);
        assertThat(repository.findById("inconnue")).isEmpty();
    }

    @ParameterizedTest(name = "exists({0}, {1}) = {2}")
    @CsvSource({
            "etu-1, cours-A, true",
            "etu-1, cours-B, true",
            "etu-2, cours-B, false",
            "etu-9, cours-A, false",
            "etu-2, cours-C, false",
    })
    void existsExigeLeBonEtudiantEtLeBonCours(String etudiantId, String coursId, boolean attendu) {
        remplir();

        assertThat(repository.existsByEtudiantIdAndCoursId(etudiantId, coursId)).isEqualTo(attendu);
    }

    @Test
    void deleteByIdRetireUniquementLEntreeVisee() {
        remplir();

        repository.deleteById("a2");

        assertThat(repository.findById("a2")).isEmpty();
        assertThat(repository.findByCoursId("cours-A")).containsExactly(a1, a3);
        assertThat(repository.findByCoursId("cours-B")).containsExactly(b1);
    }

    @Test
    void deleteByIdInconnuNeChangeRien() {
        remplir();

        repository.deleteById("inconnue");

        assertThat(repository.findByCoursId("cours-A")).containsExactly(a1, a2, a3);
    }
}
