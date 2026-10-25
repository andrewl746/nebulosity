package com.example.app;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class AppIT {

    @Test
    void runsInFastMode() {
        assertTrue(Mode.FAST.quick());
        App.main(new String[0]);
    }
}
