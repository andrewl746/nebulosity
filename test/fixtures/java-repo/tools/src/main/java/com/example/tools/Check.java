package com.example.tools;

import com.example.Sample;
import com.example.lib.Strings;

/** Checks a sample from outside both modules. */
public class Check {

    public static String run() {
        return Strings.shout(Sample.name());
    }
}
