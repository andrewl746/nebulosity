package com.example.lib;

import static com.example.lib.Strings.shout;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.Sample;
import org.junit.jupiter.api.Test;

class StringsTest {

    @Test
    void shoutsTheSampleName() {
        assertEquals("LIB", shout(Sample.name()));
    }
}
