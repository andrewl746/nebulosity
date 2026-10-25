package com.example.app;

/** How fast the app greets. */
public enum Mode {
    FAST,
    SLOW;

    public boolean quick() {
        return this == FAST;
    }
}

final class ModeNames {

    static final String FAST_NAME = "fast";
}
