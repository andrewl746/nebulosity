package com.example.lib;

import java.util.Locale;

public final class Strings {

    private Strings() {
    }

    public static String shout(String text) {
        return text.toUpperCase(Locale.ROOT);
    }

    static String whisper(String text) {
        return text.toLowerCase(Locale.ROOT);
    }
}
