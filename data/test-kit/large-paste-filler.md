Engineering handbook: how we ship changes

This handbook describes the everyday routine of the platform team. It is deliberately generic: it covers how work moves from an idea to production, how reviews are run, and how we keep the documentation in step with the code. Nothing here is confidential, and new joiners are encouraged to read it during their first week.

Planning. Every change starts as a short written proposal. The proposal states the problem, the smallest change that would solve it, and how we will know it worked. Proposals are discussed in the weekly planning session, where the team agrees on scope and on the order in which work will be picked up. Large proposals are split into slices that can each be shipped and observed on their own.

Branches and commits. Work happens on short-lived branches that are merged within a few days. Commit messages follow the conventional format, with a type, an optional scope and a short imperative summary. A commit should do one thing; unrelated tidy-ups go into their own commits so that reviewers can follow the history without guessing which line belongs to which change.

Reviews. Every merge request needs one approving review from someone who did not write the change. Reviewers read the description first, then the tests, then the code. They look for behaviour that is not covered by a test, for names that do not say what a thing does, and for error paths that would leave the system in an unclear state. Comments are phrased as questions or suggestions, and the author decides how to respond.

Testing. Unit tests cover pure logic and run on every push. Integration tests exercise the boundaries between services against local containers. End-to-end tests drive the user interface in a real browser and run before each release. A failing test blocks the merge; a flaky test is quarantined, tracked as a defect and fixed within the sprint rather than retried until it passes.

Continuous integration. The pipeline builds the project, runs the linters and the type checker, runs the test suites in parallel and publishes the coverage report. Build times are watched closely: when a stage grows slower than its budget, the team looks for caching opportunities or splits the stage. The pipeline configuration lives in the repository and is reviewed like any other code.

Releases. We release from the main branch on a fixed weekly rhythm. The release notes are generated from the commit history and edited by hand so that they read well for people outside the team. Feature flags let us ship code that is not yet switched on, which keeps releases small and makes rollbacks rare. When a rollback is needed, it is a routine operation rather than an emergency.

Observability. Each service emits structured logs, request metrics and traces. Dashboards show the request rate, the error rate and the latency percentiles for every endpoint. Alerts fire on symptoms that users would notice, not on every internal warning. Each alert links to a runbook page that explains what the alert means and which first steps usually help.

Incidents. When something goes wrong, one person takes the role of incident lead and another keeps a written timeline. The lead focuses on restoring service; root-cause analysis waits until things are stable. Afterwards the team writes a blameless review that describes what happened, what made it worse, what helped, and which follow-up actions will make a repeat less likely.

Documentation. Each repository has a readme that explains how to build, test and run it locally. Architecture decisions are recorded as short decision records that state the context, the options considered and the choice made. Documentation changes ride along with the code changes they describe, so that the two never drift apart for long.

Dependencies. Third-party libraries are added deliberately. Before adding one, we check its licence, its maintenance history and whether a few lines of our own code would do the same job. An automated job proposes version updates each week; the updates are reviewed and merged like any other change, with the release notes of the library read before approval.

Accessibility. Interfaces are built to work with a keyboard alone and with a screen reader. Colour is never the only way information is conveyed, text keeps a readable contrast against its background, and motion respects the reduced-motion preference. Accessibility checks run in the end-to-end suite, and manual checks are part of the review for any new screen.

Performance. Pages are measured on mid-range hardware and a throttled connection, because that is what many people actually use. Budgets are set for bundle size, time to interactive and memory, and the pipeline reports when a change pushes a budget over its limit. Optimisation work starts from a measurement, never from a hunch, and ends with a second measurement that shows the gain.

Working together. Meetings have a written agenda and end with written decisions. Questions are asked in shared channels rather than in private messages, so that the answers help the next person too. Pairing is encouraged for tricky changes and for onboarding. Everyone is expected to leave the codebase a little clearer than they found it.
