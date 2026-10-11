package com.inscription.waitlist.clients;

import java.time.Clock;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** Branche les implémentations HTTP des clients sur les URLs configurées. */
@Configuration
public class ClientsConfig {

    @Bean
    public CoursesClient coursesClient(@Value("${clients.courses.url}") String baseUrl) {
        return new HttpCoursesClient(RestClient.create(baseUrl));
    }

    @Bean
    public EnrollmentsClient enrollmentsClient(@Value("${clients.enrollments.url}") String baseUrl) {
        return new HttpEnrollmentsClient(RestClient.create(baseUrl));
    }

    @Bean
    public StudentsClient studentsClient(@Value("${clients.students.url}") String baseUrl) {
        return new HttpStudentsClient(RestClient.create(baseUrl));
    }

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
