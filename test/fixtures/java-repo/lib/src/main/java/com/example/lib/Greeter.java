package com.example.lib;

/** Says hello. */
public interface Greeter {

    String PREFIX = "Hello, ";

    String greet(String name);

    default Greeter twice() {
        return name -> greet(greet(name));
    }
}
