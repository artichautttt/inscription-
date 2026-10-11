package com.inscription.waitlist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.inscription.waitlist.clients.CoursesClient;
import com.inscription.waitlist.clients.EnrollmentsClient;
import com.inscription.waitlist.clients.HttpCoursesClient;
import com.inscription.waitlist.clients.HttpEnrollmentsClient;
import com.inscription.waitlist.clients.HttpStudentsClient;
import com.inscription.waitlist.clients.StudentsClient;

@SpringBootTest
@AutoConfigureMockMvc
class WaitlistServiceApplicationTests {

    @Autowired
    private MockMvc mvc;
    @Autowired
    private CoursesClient courses;
    @Autowired
    private EnrollmentsClient enrollments;
    @Autowired
    private StudentsClient students;

    @Test
    void leContexteBrancheLesClientsHttp() {
        assertThat(courses).isInstanceOf(HttpCoursesClient.class);
        assertThat(enrollments).isInstanceOf(HttpEnrollmentsClient.class);
        assertThat(students).isInstanceOf(HttpStudentsClient.class);
    }

    @Test
    void healthRepondOk() throws Exception {
        mvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service").value("waitlist"))
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.timestamp").isNotEmpty());
    }
}
