package com.example.app;

import static com.example.lib.Constants.*;
import static com.example.lib.Strings.shout;

import com.example.lib.*;
import com.example.lib.Greeter;
import com.example.lib.Outer.Inner;
import java.util.List;

/** Starts the app. */
public class App {

    private final Greeter greeter;

    public App(Greeter greeter) {
        this.greeter = greeter;
    }

    public String run(List<Widget> widgets) {
        Inner first = new Inner(DEFAULT_NAME);
        return shout(greeter.greet(first.label())) + widgets.size();
    }

    public static void main(String[] args) {
        Service service = new Service(Mode.FAST);
        System.out.println(new App(service).run(List.of(Widget.of("a"))));
    }
}
