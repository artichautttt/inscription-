package com.inscription.waitlist.waitlist;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.inscription.waitlist.common.DomainException;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/waitlist")
public class WaitlistController {

    private final WaitlistService waitlist;

    public WaitlistController(WaitlistService waitlist) {
        this.waitlist = waitlist;
    }

    /** Rejoindre la file d'attente d'un cours complet. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WaitlistEntryResponse join(@Valid @RequestBody JoinWaitlistRequest request) {
        return waitlist.join(request.etudiantId().toString(), request.coursId().toString());
    }

    /** File d'attente d'un cours, ordonnée FIFO (vue admin, gating à la gateway). */
    @GetMapping("/courses/{coursId}")
    public List<WaitlistEntryResponse> getQueue(@PathVariable UUID coursId) {
        return waitlist.getQueue(coursId.toString());
    }

    /**
     * Quitter la file.
     * L'identité (X-User-Id, X-User-Role) est posée par la gateway après vérification du JWT.
     * En appel direct sans ces headers, on refuse (le service n'est pas une porte ouverte).
     */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(
            @PathVariable UUID id,
            @RequestHeader(value = "X-User-Id", required = false) String userId,
            @RequestHeader(value = "X-User-Role", required = false) String role) {
        if (userId == null || userId.isBlank() || role == null || role.isBlank()) {
            throw DomainException.accesInterdit("Identité requise pour cette action.");
        }
        waitlist.leave(id.toString(), new Requester(userId, role));
    }

    /** Inscrire le premier de la file sur une place libérée (admin, gating à la gateway). */
    @PostMapping("/courses/{coursId}/promote")
    @ResponseStatus(HttpStatus.CREATED)
    public PromotionResponse promote(@PathVariable UUID coursId) {
        return waitlist.promote(coursId.toString());
    }
}
