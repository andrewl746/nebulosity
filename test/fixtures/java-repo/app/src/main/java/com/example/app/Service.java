package com.example.app;

import com.example.lib.Greeter;

/** Greets in the configured mode. */
public class Service implements Greeter {

    private final Mode mode;

    private final com.example.lib.Formatter formatter = new com.example.lib.Formatter();

    public Service(Mode mode) {
        this.mode = mode;
    }

    @Override
    public String greet(String name) {
        return PREFIX + com.example.lib.Strings.shout(name) + mode;
    }
}
