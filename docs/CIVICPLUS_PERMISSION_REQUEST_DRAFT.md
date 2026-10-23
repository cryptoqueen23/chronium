# DRAFT: written permission request to the City of Copperas Cove and CivicPlus

**Status: DRAFT. NOT SENT. Do not send without Mari's approval.** Prepared 2026-10-23. Nothing in this file changes any behavior: until a reply is received and recorded, `copperascovetx.gov` and `civicplus.com` stay `unverified` and blocked for automated retrieval in both the engine and the Worker (`docs/CIVICPLUS_VERIFICATION.md`).

## Who to send it to (to confirm before sending)

- City of Copperas Cove: City Secretary / City Clerk (the office that keeps agendas and minutes) and the IT department. Contact details must be taken from the city's own website at the time of sending; none are recorded here because they have not been verified.
- CivicPlus: its legal or compliance contact (the address given in its Terms of Use) and, if the city has one, its CivicPlus account representative. The city may be the only party able to answer for its own contract; asking both avoids guessing which terms govern.

Send one message to both, or send to the city first and copy CivicPlus. Mari decides.

## Letter

**Subject:** Request for permission: polite, paced reading of Copperas Cove's public agenda and document pages

To the City Secretary and IT Department, City of Copperas Cove, and to CivicPlus:

My name is Marimer Cruz. I build Chronium Mind, a free research tool that helps residents, journalists and students find and read public meeting records. I am writing before using it on www.copperascovetx.gov, because I want to follow your rules rather than assume them.

**What I would like to do.** With a person's explicit instruction, Chronium would read the public agenda and document pages that your site already publishes (the Agenda Center and Document Center areas that your robots.txt permits) and save the public documents it finds to that person's own research folder on their own computer.

**How it would behave.**
- One request at a time, never in parallel.
- At least 10 seconds between requests, the Crawl-delay in your robots.txt (never faster, even if the site responds quickly).
- It obeys robots.txt, including every disallowed path, and does not log in, submit forms, or use any page that needs an account.
- It identifies itself in every request with the name "ChroniumMind" and a link to a page describing the tool and giving my contact details.
- A hard ceiling of 500 requests per day to your site per user (far below the 1,000-pages-per-day figure in the CivicPlus Terms of Use), and each search is capped at about 150 pages and 100 documents.
- It stops if the site answers "slow down" (HTTP 429 or 503) or asks it to wait.
- Documents are stored on the user's device only. Chronium does not republish them. Every saved document keeps its original address, the time it was retrieved and a fingerprint, so anyone can check it against your site.
- Searches run only when a person starts one, and can be paused or cancelled at any time.

**What I am asking.** Please tell me, in writing, which of these applies:
1. Yes, this paced, identified, robots-respecting reading of the Agenda Center and Document Center is permitted, under the conditions above (or under conditions you prefer, which I will follow).
2. Not by automated means, but there is another way you prefer, such as a bulk export, a feed, an API or a data download. Please describe it.
3. No, automated reading is not permitted. I will then use only pages a person opens and saves by hand, and Public Information Act requests where needed.

I also ask CivicPlus to say whether its Terms of Use (Sections 7 and 13) apply to a city's own CivicPlus-hosted public pages and to people who read them, or whether the city's agreement governs instead.

I will keep your reply on record, follow it exactly, and record the date and wording in the tool's source registry. Until I hear from you, Chronium will not contact www.copperascovetx.gov or civicplus.com automatically.

Thank you for your time and for publishing these records.

Marimer Cruz
Chronium Mind
[contact email and tool page address: to be filled in before sending]

## Before sending (checklist for Mari)

- [ ] Fill in the contact email and the page the User-Agent links to (today's User-Agent points to the Chronium Mind workers.dev address; confirm that page actually describes the tool and shows the contact details, or change it first).
- [ ] Confirm the recipients from the city's own site.
- [ ] Decide whether to name CivicPlus on the same message.
- [ ] Decide whether you want to mention that the existing tool refuses to contact the site until a reply arrives (true and tested; it builds trust).

## What happens with the reply

| Reply | Action (each recorded with date and text in `public/discovery/connector.js` and `docs/CIVICPLUS_VERIFICATION.md`) |
|---|---|
| Permitted, with conditions | Set the host policy to `allowed` with the date, the sender and the conditions; implement any conditions as limits in `config.js` first; capture the listing endpoint's real response shape with a handful of paced requests; write the list parser against saved fixtures; then enable |
| Another method offered | Evaluate that method (cost row, terms) as a new connector instead |
| Refused | Set the policy to `forbidden` with the reply attached; keep only user-selected capture |
| No reply | Nothing changes. No silence-as-consent. Mari may decide to accept a recorded risk later; that is her decision and is recorded as such |

## Meanwhile: individually selected, user-directed capture (allowed today; does not bypass the block)

Until access rules are clarified, the only way a Copperas Cove / CivicPlus document enters a case is by a person's own act, one document at a time, at human pace:

1. The person opens the agenda or document in their own browser and saves the file, then adds it with the existing **Add Research / import files** (hash, text, duplicates handled by the existing ingestion), or pastes the one address into **Add URL** (a source record with the address, no retrieval).
2. Chronium itself makes **no request** to the host. The Find Records screen, the engine and the Worker continue to refuse the host, and say so in words.

Nothing in this arrangement changes the block, and no code change is needed for it. If a future "capture this page I am viewing" button is wanted in the extension, it must read only the page the person is currently viewing, on a click for that page, with no fetch of its own and no following of links, and needs Mari's approval and its own acceptance tests before it is built. It is not part of this draft.
