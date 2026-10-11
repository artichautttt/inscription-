package com.inscription.waitlist.waitlist;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

/** Stockage en mémoire : une liste dont l'ordre d'insertion fait office d'ordre FIFO. */
@Repository
public class InMemoryWaitlistRepository implements WaitlistRepository {

    private final List<WaitlistEntry> entries = new ArrayList<>();

    @Override
    public synchronized WaitlistEntry save(WaitlistEntry entry) {
        entries.add(entry);
        return entry;
    }

    @Override
    public synchronized Optional<WaitlistEntry> findById(String id) {
        return entries.stream().filter(e -> e.id().equals(id)).findFirst();
    }

    @Override
    public synchronized List<WaitlistEntry> findByCoursId(String coursId) {
        return entries.stream().filter(e -> e.coursId().equals(coursId)).toList();
    }

    @Override
    public synchronized boolean existsByEtudiantIdAndCoursId(String etudiantId, String coursId) {
        return entries.stream()
                .anyMatch(e -> e.etudiantId().equals(etudiantId) && e.coursId().equals(coursId));
    }

    @Override
    public synchronized void deleteById(String id) {
        entries.removeIf(e -> e.id().equals(id));
    }
}
