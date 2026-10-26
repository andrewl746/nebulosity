package com.example;

import org.junit.jupiter.api.Test;

class SampleTest {

    @Test
    void namesTheModule() {
        if (!Sample.name().equals("app")) {
            throw new AssertionError(Sample.name());
        }
    }
}
