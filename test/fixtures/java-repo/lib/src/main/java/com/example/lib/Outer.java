package com.example.lib;

import java.util.ArrayList;
import java.util.List;

/** Holds a list of parts. */
public class Outer {

    private final List<Inner> parts = new ArrayList<>();

    public void add(Inner part) {
        parts.add(part);
    }

    /** One part. */
    public static class Inner {

        private final String label;

        public Inner(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }

    enum Kind { SMALL, LARGE }
}
