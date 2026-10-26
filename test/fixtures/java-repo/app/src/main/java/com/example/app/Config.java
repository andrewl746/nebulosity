package com.example.app;

/** Where the app listens. */
public record Config(String host, int port) {

    public static Config defaults() {
        return new Config("localhost", 8080);
    }
}
