# PROMPT MEMORY PROTOCOL — every prompt becomes a note

A protocol, not a suggestion. From this document forward, **every user prompt produces exactly one memory
note**, written in the same turn as the reply. The note is the durable record; the chat is the working
copy.

| Field | Value |
| --- | --- |
| Web project | `C:\Users\jeduc\Downloads\AM Web 2\alight-motion-web` |
| Vault | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain` |
| Companion | `Session Log.md` (narrative), `AM Web Memory Log.md` (index of documents) |
| Date | 2026-11-19 |

---

## 1. The rule

> [!important] One prompt, one note, same turn
> A reply is not finished until its prompt note exists. If the turn produced a document, the note records
> the prompt and links the document. If the turn produced only an answer, the note records the prompt and
> the answer in one line.

The failure this prevents: a session where the *outputs* are documented but the *requests* are lost, so
nobody can reconstruct why a document exists, what was actually asked, or which instruction was
misinterpreted.

## 2. Where things live

```
AM Web Memory\Alight Web Brain\
  Prompts.md                      <- index: rules + ledger table (human entry point)
  Prompts.base                    <- Bases view: filter/group/sort the same notes
  Prompts\
    P-0001.md
    P-0002.md
    ...
    P-0007.md
  Memory\                          <- one note per produced document
  Session Log.md                   <- narrative, updated per work block
  AM Web Memory Log.md             <- master index
```

A prompt note **never** goes in `Memory\`. `Memory\` answers "what do we know", `Prompts\` answers "what
was asked, when, and what happened".

## 3. Identity

| Field | Rule |
| --- | --- |
| ID | `P-NNNN`, zero-padded to 4, monotonic, **never reused, never renumbered** |
| File name | `Prompts/P-0007.md` — the ID and the file name are the same string |
| Title property | `P-0007 — <short verb-led phrase>` |
| Deletion | never delete a note. Mark `status: void` and say why in one line |

If the numbering ever drifts (a note written out of order), the ledger is the authority and the next ID is
`max(existing) + 1`.

## 4. Frontmatter schema

```yaml
---
title: P-0007 — prompt memory protocol
id: P-0007
seq: 7
date: 2026-11-19
time: "14:32"
type: spec            # spec | fix | question | decision | meta | banter
status: shipped       # shipped | partial | open | superseded | void
docs:                 # documents produced or edited by this prompt ([] if none)
  - PROMPT_MEMORY_PROTOCOL.md
memory:               # vault memory notes this prompt created or changed
  - PROMPT_MEMORY_PROTOCOL
tags:
  - amweb
  - prompt
verdict: one line the reader can quote
---
```

- `type: spec` — asked for a document. `fix` — asked to change behaviour or code. `question` — asked to
  explain. `decision` — picked between options. `meta` — about the workspace itself. `banter` — no work.
- `status` — reflects whether the **request** is satisfied, not whether the reply was sent.
- `verdict` is the single sentence a future reader needs. Not a summary of the whole note.

## 5. Note body — the exact template

````markdown
# P-0007 — prompt memory protocol

## Prompt

> [!quote] Verbatim, 2026-11-19 14:32
> <the user's message, character for character>

## Read as

- <the concrete request, decomposed into the things actually being asked>
- <one bullet per separable requirement>

## Assumed

- <every ambiguity that was resolved without asking, and the reading chosen>
- <"none" is a valid answer, but say it>

## Verdict

<2–4 lines. What was produced or changed, and whether the request is satisfied.>

## Artefacts

| Kind | Path |
| --- | --- |
| Document | `PROMPT_MEMORY_PROTOCOL.md` |
| Vault note | `[[PROMPT_MEMORY_PROTOCOL]]` |

## Carry forward

- <the one thing the next prompt must not forget>
````

Four sections are mandatory: **Prompt**, **Read as**, **Verdict**, **Carry forward**. `Assumed` and
`Artefacts` are required whenever they apply — and `Assumed` applies more often than it looks.

## 6. Verbatim rule

> [!warning] Never paraphrase the prompt
> The `Prompt` block is copied character for character, **including typos, missing punctuation, and
> broken casing**. `eveytime` stays `eveytime`. A cleaned-up prompt is a lie about what was asked, and the
> typos are how a future reader recognises the real message.

- Multi-message turns: one note per user message, in order. Do not merge.
- A pasted document, XML dump, or conversation checkpoint goes in a collapsed callout or an appendix
  section, not in the `Prompt` block — the prompt is what *asked*, the payload is *evidence*.
- URLs are kept whole and unshortened.

## 7. Append-only, corrections get their own entry

- A note is **never rewritten** after the fact, except to fix a link that broke.
- If a request was misunderstood and corrected later, the correction is a **new** note with
  `status: supersedes` context on it, and the older note gets `status: superseded` — that pair is the
  history of the misunderstanding, and it is worth keeping.
- If a document is later implemented, the prompt note does **not** change; the memory note's status does.

## 8. The turn checklist

Every turn, in this order:

1. **Assign the ID** — read `Prompts.md`'s ledger table, take `max(seq) + 1`.
2. **Write the note** at `Prompts/P-NNNN.md` from the template.
3. **Update the ledger** — append one row to the table in `Prompts.md`.
4. **Link the artefacts** — if a document was produced, add the wikilink in both directions (`docs:` here,
   and a `Memory log` line in the document if it does not already point back).
5. **Update `Session Log.md`** — only for work blocks, not for every banter turn.

`Prompts.base` needs no maintenance; it reads the frontmatter.

## 9. Edge cases

| Situation | Handling |
| --- | --- |
| Greeting or one-word ack | Still a note. `type: banter`, `docs: []`, verdict one line. Never skip — a skipped ID breaks the ledger's meaning. |
| Prompt contains a 40 KB paste | Note keeps the asking text; the paste goes to an appendix with a note of what it was. |
| Prompt is a correction ("no, do X instead") | New note, `type: fix`, links the note it corrects, and the older note is marked `superseded`. |
| Turn was interrupted before the reply | Note is still written, `status: open`, carry-forward says where it stopped. |
| Two prompts in one message | One note, `Read as` split into numbered parts, `docs` lists every artefact. |
| Prompt asks about a different project | Still recorded here if it happened in this session, with a `project:` tag — one ledger, no orphans. |

## 10. Backfill policy

Anything before this protocol is **not** reconstructed in full. Instead:

- The first note that predates the protocol is flagged `backfilled: true` in frontmatter.
- Backfilled notes carry the verbatim text **only when it survived** (in a checkpoint or a copied
  message). Where it did not, the note says `reconstructed from the session summary` and points at
  `Session Log.md`.

`P-0001` … `P-0008` exist already, covering this session.

| Note | Origin | Verbatim? |
| --- | --- | --- |
| `P-0001` … `P-0006` | backfilled | ❌ reconstructed from the session summary |
| `P-0007` | backfilled | ✅ verbatim (the Obsidian skills install message) |
| `P-0008` | native — this protocol's own prompt | ✅ verbatim |

`P-0008` is the first native entry, and it is the protocol executing against itself: the note was written
from the same template it defines. Next ID: `P-0009`.

## 11. Acceptance

| # | Test | Pass |
| --- | --- | --- |
| PM-A1 | Send any prompt, then look at `Prompts/` | exactly one new note, ID = previous + 1 |
| PM-A2 | Diff the note's `Prompt` block against the message | byte-identical, typos intact |
| PM-A3 | `Prompts.base` | the new note appears without editing the base |
| PM-A4 | Send a correction | two notes exist, the older is `superseded`, neither is rewritten |
| PM-A5 | Send a greeting | one note, `type: banter`, `docs: []` |
| PM-A6 | A prompt producing a document | document ends with a `## Memory log` block, note lists it in `docs` |
| PM-A7 | Read `Prompts.md` cold | the last 10 requests are recoverable in under a minute |

## 12. Why this is worth the bytes

Three concrete payoffs, all of which have already cost time in this project:

- **Pretence detection.** "You said it renders" vs "I asked whether it renders" is answerable from the
  notes, not from memory.
- **Assumption audit.** `Assumed` blocks accumulate into a pattern — that is how a recurring
  misinterpretation gets found before it costs a rebuild.
- **Continuity.** A new session reads `Prompts.md`, then the last three notes, and is caught up without
  re-reading nine 20–50 KB documents.

---

## Memory log

| Field | Value |
| --- | --- |
| Vault note | `[[PROMPT_MEMORY_PROTOCOL]]` |
| Vault path | `C:\Users\jeduc\Downloads\AM Web 2\AM Web Memory\Alight Web Brain\Memory\PROMPT_MEMORY_PROTOCOL.md` |
| Status | active |

Carry forward: every turn ends with `Prompts/P-NNNN.md` + a ledger row, before the reply is sent.
