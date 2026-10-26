# DRAFT: written permission request to the City of Copperas Cove and CivicPlus

> **SUPERSEDED. DO NOT USE OR SEND THIS DRAFT.** It is replaced by `docs/CIVICPLUS_LETTER_FINAL.md` (revised 2026-10-26 with Mari's wording corrections). This older text contains wording that has been withdrawn, including comparisons to the 1,000-request figure in the CivicPlus terms and the original "My question" paragraph. It is kept only as a record of how the letters evolved. Neither letter has been sent.


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

---

## Update 2026-10-23 (later): recipients verified, public User-Agent page drafted, final letter for approval

**Still NOT sent. Copperas Cove automated discovery is still blocked.** Nothing below changes any behavior.

### Recipients, as printed on the city's and CivicPlus's own pages today

Read through a page-reading tool on 2026-10-23; staff names change, so a person should re-check them on the day of sending.

| Recipient | What the official page shows | Source |
|---|---|---|
| City Secretary, City of Copperas Cove | Lisa Wilson, City Secretary. Phone 254-547-4221. Fax 254-542-8927. 914 S Main Street, Suite D (City Hall: 914 South Main Street), Copperas Cove, TX 76522. **No email address is printed.** The directory entry offers only a "Contact Lisa Wilson" web form. | `https://www.copperascovetx.gov/Directory.aspx`; the Open Records Requests page is listed under the City Secretary at `https://www.copperascovetx.gov/187` |
| Director of Information Technology, City of Copperas Cove | Scot Mullican, Director of Information Technology. Phone not printed for him (the department listing shows 254-547-4221). **No email printed**; a "Contact Scot Mullican" web form only. | `https://www.copperascovetx.gov/Directory.aspx` |
| CivicPlus | Contact page `https://www.civicplus.com/contact-us/`; phone 888-228-2233; 302 South 4th Street, Suite 500, Manhattan, Kansas 66502. The Terms of Use give **one** email address, `DMCAnotice@civicplus.com`, and say it is for copyright or intellectual-property infringement notices only, so it is **not** the right place for this letter. No legal or compliance contact is published in the Terms. | `https://www.civicplus.com/terms-of-use` (Section 24 and the footer) |

Notes for Mari:
- The city's online open-records portal (`copperascovetx.mycusthelp.com`) requires an account and is for Public Information Act requests. **This letter is a different kind of message** (a permission question about how a tool reads the city's public pages), so it should go to the City Secretary and IT Director through their published contact forms, or by mail to City Hall, not through the PIA portal.
- Because no email is printed, the practical routes are: the two "Contact" web forms on the directory page, a phone call to 254-547-4221 to ask where such a letter should go, or a letter by post. Mari decides.
- CivicPlus: use its "Contact us" page, naming the Terms of Use sections in the subject. If that is not answered, ask the city to raise it with its CivicPlus account representative.
- **No project email address has been invented.** Mari must choose one for the letter and for the public page (an address she is willing to publish). The only address available in this session is the one on her account; it is not used in any draft because publishing it is her decision.

### Public User-Agent information page (drafted, not published)

`public/crawler.html` (moved from `docs/drafts/` on 2026-10-23 after Mari approved the contact address; **in the repository but not live until a deployment**): a plain, accessible page that says who ChroniumMind is, the rules it follows (identification, robots.txt, Crawl-delay never shortened, 3-second floor, one request at a time, back-off, small searches, public pages only, no logins or forms, refuses private addresses, where requests come from in extension versus website mode), and how to stop or slow it (a robots.txt group for `ChroniumMind`, Crawl-delay, or a contact address). It contains two placeholders that must be filled by Mari: the **contact address** and the **date**.

**Verified against the code on 2026-10-23** (so the page does not promise more than the tool does): User-Agent token `ChroniumMind` and the 0.1 version string (`config.js`); robots.txt group selection by that token (`robots.js`); `Crawl-delay` honored with a 3,000 ms floor and refusal above 60 s (`config.js`, `engine.js`); one request at a time per host (`scheduler.js`); `Retry-After`, back-off on 429/503 and stop after three (`engine.js`); caps of 150 pages, 100 documents, 400 requests per search and 500 requests per host per day per browser (`config.js`); GET only, `credentials: omit`, no scripts run (`fetchers.js`); private and loopback addresses refused including redirects (`urlGuard.js`, `extension/network.js`); website mode limited to 25 requests per search (`config.js`, `src/discoveryProxy.js`).

**Before the letter is sent** the page must be live at a stable address, and the User-Agent string (`USER_AGENT` in `public/discovery/config.js`, which today links only to the site's home page) must point to it. That is a code change and a deployment, so it needs Mari's explicit approval and is listed as a release item in `docs/CLAUDE_HANDOFF.md`. Until then the letter should not claim that the page exists.

### Final letter, for approval

(Replaces the letter above; bracketed items need Mari's input. Shorter, and it asks one clear question.)

> **Subject:** Question about reading Copperas Cove's public agenda and document pages with a research tool
>
> Dear [Ms. Wilson / City Secretary] and [Mr. Mullican / IT Director],
>
> My name is Marimer Cruz. I build Chronium Mind, a free research tool that helps residents, journalists and students find public meeting records. Before I let the tool read any page of www.copperascovetx.gov, I want to ask whether that is acceptable, and to follow your answer exactly.
>
> **What I would like to do.** When a person starts a search themselves, the tool would read the public Agenda Center and Document Center pages that your robots.txt already allows, and save the public documents it finds to that person's own computer.
>
> **How it behaves.** One request at a time. At least 10 seconds between requests, which is the Crawl-delay in your robots.txt, and never faster. It identifies itself as "ChroniumMind" in every request, with a link to a page that explains the tool and how to stop it (https://chronium-mind.truewolfflix777.workers.dev/crawler). It obeys robots.txt, does not log in, submit forms or use any page that needs an account, and stops if your site asks it to slow down. A single search reads at most about 150 pages and 100 documents, and one person's browser makes at most 500 requests a day to your site. Documents are kept on the person's device and are not republished; each is saved with its web address, the time it was read and a fingerprint, so anyone can check it against your site.
>
> **My question.** Please tell me, in writing, whether this is acceptable. If you would prefer a different way, such as a bulk export, a feed or a data download, I will use that instead. If it is not acceptable, I will not read your pages automatically; people will still be able to save documents by hand.
>
> I am also writing to CivicPlus to ask whether its Terms of Use (Sections 7 and 13) apply to a city's own CivicPlus-hosted public pages and to the people who read them, or whether your agreement with CivicPlus governs.
>
> Until I hear from you, the tool does not contact www.copperascovetx.gov or civicplus.com automatically, and I will record your reply, with its date, and follow it.
>
> Thank you for your time and for publishing these records.
>
> Marimer Cruz, Chronium Mind
> Email: marimercruz8@gmail.com   Page: https://chronium-mind.truewolfflix777.workers.dev/crawler (live only after the approved deployment)

### What must happen before this is sent (checklist)

- [ ] Mari approves this letter, or edits it.
- [x] Contact address chosen and approved for publication by Mari (2026-10-23): marimercruz8@gmail.com. It is now in the page and the letter.
- [ ] Mari approves moving the User-Agent page into `public/` and changing `USER_AGENT` to link to it, and approves the deployment that makes it live (nothing is deployed today).
- [ ] A person re-checks the names and routes above on the day.
- [ ] Mari chooses the route (contact forms, phone call first, or post).
