package com.example.lib;

public class Widget implements Comparable<Widget> {

    private final String name;

    public Widget(String name) {
        this.name = name;
    }

    public static Widget of(String name) {
        return new Widget(name);
    }

    @Override
    public int compareTo(Widget other) {
        return name.compareTo(other.name);
    }
}
