package com.inscription.waitlist.waitlist;

import java.util.List;
import java.util.Optional;

public interface WaitlistRepository {

    WaitlistEntry save(WaitlistEntry entry);

    Optional<WaitlistEntry> findById(String id);

    /** File d'un cours, dans l'ordre d'arrivée (FIFO). */
    List<WaitlistEntry> findByCoursId(String coursId);

    boolean existsByEtudiantIdAndCoursId(String etudiantId, String coursId);

    void deleteById(String id);
}
