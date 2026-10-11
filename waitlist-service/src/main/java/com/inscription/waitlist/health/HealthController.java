package com.inscription.waitlist.health;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final Clock clock;

    public HealthController(Clock clock) {
        this.clock = clock;
    }

    @GetMapping("/health")
    public Map<String, String> check() {
        return Map.of(
                "service", "waitlist",
                "status", "ok",
                "timestamp", Instant.now(clock).toString());
    }
}
