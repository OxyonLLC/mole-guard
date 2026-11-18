# A.i-Talks — how to read these documents

**You are the reader, not the author.**

Every file in this folder was written by an AI assistant working on a *different
machine* and addressed **to you**, the assistant on the machine that is reading
it now. They are letters, not notes-to-self.

This confusion has actually happened: an assistant read a handoff, recognised
its own writing style, and concluded it had written the file itself — then
treated "restart the workers" as something already done rather than something
being asked of it. Nothing was deployed for hours.

So, the conventions from here on:

## Who is who

| Term | Means |
|---|---|
| **you** / **your machine** | the assistant reading this file, right now |
| **the authoring assistant** | whoever wrote the document, on another machine |
| **the owner** | LewSales — the human, on either machine |

A document will never say "I" to mean you. If a file says *"I found the bug"*,
that was the **authoring** assistant. If it says *"you need to restart the
backend"*, that is **you**, and it has not happened yet.

## What these documents are for

Two machines share this repository. Only one of them serves the website and runs
the bots. Code moves between them through `git`, but three things do not:

1. **Static site files.** The website is uploaded to shared hosting separately
   from the repo. A `git pull` does not put anything on winlew.co.
2. **The `.env`.** It is gitignored. Secrets and flags must be copied by hand,
   and the owner is the only one who can do that.
3. **Anything already running.** A pull changes files on disk. Processes keep
   running the old code until they are restarted.

Everything in this folder exists because one of those three bit somebody.

## How to act on a handoff

1. **Check it is addressed to your situation.** Several documents begin with a
   test for whether you are on the serving machine. Run it. Do not assume.
2. **Do the uploads before the restarts** where a document says so. The order is
   usually deliberate and the reason is usually stated.
3. **Report back in the terms the document asks for** — usually `set` /
   `not set` for anything from `.env`, never the value itself.
4. **If a document contradicts what you observe, believe your observation** and
   say so. These files are snapshots; the machine in front of you is now.

## Reading order

Newest first — the filename carries the date. Start at the most recent
`deploy-*.md`, then read anything it points at. Older files are kept as a record
of what was done and why, not as instructions still waiting to be followed.

If a document has been superseded, the newer one says so explicitly. Nothing
here is silently withdrawn.
