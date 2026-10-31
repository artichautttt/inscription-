package com.inscription.waitlist.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import org.junit.jupiter.api.Test;

class HealthControllerTest {

    @Test
    void renvoieLeStatutDuService() {
        Clock horloge = Clock.fixed(Instant.parse("2026-10-10T08:00:00Z"), ZoneOffset.UTC);

        assertThat(new HealthController(horloge).check()).isEqualTo(Map.of(
                "service", "waitlist",
                "status", "ok",
                "timestamp", "2026-10-10T08:00:00Z"));
    }
}
