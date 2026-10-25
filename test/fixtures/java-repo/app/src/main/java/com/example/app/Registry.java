package com.example.app;

import com.example.lib.*;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/** Keeps the app's parts: every way a type name is used. */
@Audited("registry")
public class Registry<T extends Widget> extends Outer implements Greeter {

    static final List<Registry<?>> ALL = new ArrayList<>();

    private final List<T> items = new ArrayList<>();

    public Object formatter() {
        return new Formatter();
    }

    public String greet(String name) {
        Function<String, String> loud = Strings::shout;
        return loud.apply(name) + Constants.class.getSimpleName() + Config.defaults() + Mode.FAST + ALL.size() + items.size();
    }
}
