package com.inscription.waitlist.waitlist;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import org.springframework.stereotype.Service;

import com.inscription.waitlist.clients.Cours;
import com.inscription.waitlist.clients.CoursesClient;
import com.inscription.waitlist.clients.EnrollmentsClient;
import com.inscription.waitlist.clients.Inscription;
import com.inscription.waitlist.clients.StudentsClient;
import com.inscription.waitlist.common.DomainException;

/**
 * Logique métier de la liste d'attente.
 * Les méthodes qui modifient la file sont synchronized : le stockage est en mémoire
 * dans une instance unique, on sérialise donc les "vérifier puis écrire".
 */
@Service
public class WaitlistService {

    private final WaitlistRepository repository;
    private final StudentsClient students;
    private final CoursesClient courses;
    private final EnrollmentsClient enrollments;
    private final Clock clock;

    public WaitlistService(
            WaitlistRepository repository,
            StudentsClient students,
            CoursesClient courses,
            EnrollmentsClient enrollments,
            Clock clock) {
        this.repository = repository;
        this.students = students;
        this.courses = courses;
        this.enrollments = enrollments;
        this.clock = clock;
    }

    public synchronized WaitlistEntryResponse join(String etudiantId, String coursId) {
        // Règle 1 — l'étudiant doit exister
        if (students.findById(etudiantId).isEmpty()) {
            throw DomainException.ressourceIntrouvable("Étudiant " + etudiantId + " introuvable.");
        }

        // Règle 2 — le cours doit exister
        Cours cours = trouverCours(coursId);

        // Règle 3 — la liste d'attente n'a de sens que si le cours est complet
        if (cours.placesRestantes() > 0) {
            throw DomainException.coursNonComplet();
        }

        // Règle 4 — pas de doublon dans la file
        if (repository.existsByEtudiantIdAndCoursId(etudiantId, coursId)) {
            throw DomainException.dejaEnListeAttente();
        }

        // Règle 5 — pas déjà inscrit au cours
        if (enrollments.isEnrolled(etudiantId, coursId)) {
            throw DomainException.dejaInscrit();
        }

        WaitlistEntry entry = repository.save(
                new WaitlistEntry(UUID.randomUUID().toString(), etudiantId, coursId, Instant.now(clock)));
        int position = repository.findByCoursId(coursId).indexOf(entry) + 1;
        return WaitlistEntryResponse.of(entry, position);
    }

    /** File d'un cours en ordre FIFO, positions à partir de 1. */
    public List<WaitlistEntryResponse> getQueue(String coursId) {
        List<WaitlistEntry> file = repository.findByCoursId(coursId);
        return IntStream.range(0, file.size())
                .mapToObj(i -> WaitlistEntryResponse.of(file.get(i), i + 1))
                .toList();
    }

    /**
     * Quitter la file : autorisé au propriétaire de l'entrée OU à un ADMIN.
     * Les positions étant dérivées de l'ordre de la file, elles sont recalculées d'office.
     */
    public synchronized void leave(String id, Requester requester) {
        WaitlistEntry entry = repository.findById(id)
                .orElseThrow(() -> DomainException.ressourceIntrouvable(
                        "Entrée de liste d'attente " + id + " introuvable."));

        boolean estProprietaire = entry.etudiantId().equals(requester.userId());
        if (!estProprietaire && !requester.estAdmin()) {
            throw DomainException.accesInterdit(
                    "Vous ne pouvez pas retirer un autre étudiant de la liste d'attente.");
        }

        repository.deleteById(id);
    }

    /**
     * Promeut le premier de la file : l'inscrit au cours, puis le retire de la file.
     * Si l'inscription échoue, l'erreur du service Inscriptions est relayée et
     * l'étudiant garde sa place dans la file.
     */
    public synchronized PromotionResponse promote(String coursId) {
        Cours cours = trouverCours(coursId);

        // La file vide prime : sans personne à promouvoir, le nombre de places n'a pas d'importance.
        List<WaitlistEntry> file = repository.findByCoursId(coursId);
        if (file.isEmpty()) {
            throw DomainException.fileVide();
        }

        if (cours.placesRestantes() <= 0) {
            throw DomainException.coursComplet();
        }

        WaitlistEntry premier = file.get(0);
        Inscription inscription = enrollments.enroll(premier.etudiantId(), coursId);
        repository.deleteById(premier.id());
        return new PromotionResponse(premier.etudiantId(), coursId, inscription);
    }

    private Cours trouverCours(String coursId) {
        return courses.findById(coursId)
                .orElseThrow(() -> DomainException.ressourceIntrouvable("Cours " + coursId + " introuvable."));
    }
}
