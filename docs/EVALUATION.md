# Evaluation

This page explains how I tested whether Nebulosity makes Claude Code faster on large codebases, and what the latest test (October 2026) found. The data for every run is in the repo.

## How the test worked

I gave Claude Code the same questions in two setups:

- **Alone:** Claude Code with its built-in tools. It could search and read the code and run small Node.js scripts.
- **With Nebulosity:** the same, plus Nebulosity's tools. No question mentioned Nebulosity, so Claude Code chose for itself when to use them.

Both setups used the same model (Claude Sonnet 5.5 at medium effort) and the same version of Claude Code (2.1.301). The questions were about three large open-source TypeScript codebases: VS Code, AFFiNE and Theia. I never adjusted Nebulosity for Theia, so it's the fairest test of the three. Each question was asked 3 times in each setup: 378 runs in all, from 61 questions and two four-question sessions. Nebulosity's code was frozen before the first run.

## How the answers were scored

Each answer was checked against a reference answer that didn't come from Nebulosity:

- **Import questions:** the eval's own import graph, built by two separate programs that share no code with Nebulosity. Every place the two disagreed was checked in the source.
- **Questions about method calls:** TypeScript's own type checker.
- **Open-ended questions** about how a codebase is organized: a written rubric, applied by two AI graders that couldn't see which setup wrote the answer. A third model settled their disagreements.

Time is how long Claude Code took to finish. Cost is Claude Code's own estimate at list price.

## What it found

**Questions that follow imports through several files.** With Nebulosity, Claude Code was:

| Question | VS Code and AFFiNE | Theia |
|---|---|---|
| What could changing this file affect? | 4.3× faster, 2.1× cheaper | not asked |
| How does this entry point end up loading that file? | 4.4× faster, 2.6× cheaper | 3.2× faster, 1.2× cheaper |
| Which entry points end up loading this file? | 4.2× faster, 1.6× cheaper | 2.8× faster, about the same cost |
| Which files depend on this one, directly or not? | 2.3× faster, 1.4× cheaper | 2.0× faster, 1.3× cheaper |
| Is this file part of an import cycle? | 2.3× faster, 1.5× cheaper | 1.5× faster, 1.1× cheaper |

Each figure compares medians: 6 runs per setup on VS Code and AFFiNE together, 3 on Theia. Across these questions, Claude Code with Nebulosity got all 42 answers fully right. Alone, it got 29 fully right and the other 13 partly right.

The reason is how search works. A text search like `grep` finds one step at a time, so a question that spans several files needs a new search for every file it turns up. Nebulosity has already indexed every import, so a single tool call answers the whole question.

**Everything else came out about even.** That covers questions one step through the imports (on two of those types, Claude Code never used Nebulosity's tools), questions about who calls a method (somewhat faster on VS Code and Theia), planning a change to a method's signature, and broad questions about how a codebase is organized.

## Caveats

- **The split by question type was made after the runs.** It describes this test, and fresh questions haven't checked it yet. One result doesn't depend on it: the import questions carried over from the previous eval, fixed before any of these runs, took 63% of the time on VS Code and 38% on AFFiNE with Nebulosity, scoring 1.00 against 0.98.
- **Four of seven targets set before the runs were missed.** Three were about the new questions this eval added: with Nebulosity, Claude Code didn't reach the needed files sooner, didn't make fewer mistakes, and wasn't faster or cheaper on the questions about method calls and signature changes. The fourth was how often it used Nebulosity's tools: in 58% of the runs where the target was 90%. The other three passed: refused commands stayed under 5% in both setups, so the comparison was fair; nothing else got worse; and the tools added little to each request.
- **The samples are small:** one question per type per codebase, asked 3 times in each setup.
- **Only TypeScript was tested.** Nebulosity also reads Python, Go, Java, C# and Rust, but no eval has covered them.

## The data

- `eval3/results.json`: every run's score, time, cost and tool calls.
- `eval3/runs/`: all 378 transcripts.
- `npm run eval:score -- --eval eval3`: the script that computed the results.
- `eval/` and `eval2/`: the data from two earlier evals, 90 and 270 runs.
