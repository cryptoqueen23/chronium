# Final letters for approval: Copperas Cove and CivicPlus

**Status: FINAL TEXT FOR MARI'S APPROVAL. NOT SENT.** Prepared 2026-10-23, after the public policy page went live. Nothing here changes any behavior: Copperas Cove and CivicPlus stay blocked for automated access until a written answer is recorded.

## Before sending

| Item | State |
|---|---|
| Public policy page the letters link to | **Live**: https://chronium-mind.truewolfflix777.workers.dev/crawler (deployed 2026-10-23, version `60045ea5-992c-499e-8290-a8ef08572667`, verified) |
| Contact address in the letters and on the page | marimercruz8@gmail.com (approved by Mari for publication) |
| Recipients (re-verified 2026-10-23, second reading, from the pages themselves) | **City of Copperas Cove staff directory** (https://www.copperascovetx.gov/Directory.aspx): **Lisa Wilson, City Secretary**, phone 254-547-4221, form "Contact Lisa Wilson" at https://www.copperascovetx.gov/formcenter/allcategories-0/62; **Scot Mullican, Director of Information Technology**, department phone 254-547-4221, form "Contact Scot Mullican" at https://www.copperascovetx.gov/formcenter/allcategories-0/59. Neither entry shows an email address. **CivicPlus**: its contact page (https://www.civicplus.com/contact-us/) offers phone 888-228-2233, the address 302 South 4th Street, Suite 500, Manhattan, Kansas 66502, and routing for Sales, Support and "Community Member Inquiry". **It publishes no legal contact and no email address.** Staff names change: a person should re-check the directory on the day of sending |
| What each recipient can actually be reached by | **City:** the two web forms above (paste Letter 1 into each, or one and say it is also addressed to the other), phone 254-547-4221 to ask the best way to send a letter, or post to City Hall, 914 S Main Street, Suite D (City Secretary), Copperas Cove, TX 76522. **CivicPlus:** its contact page sends "community members" to "your municipal administration" and sends customers to their Customer Success Manager, so a form submission may be redirected to the city. Practical routes: a postal letter to the Manhattan, Kansas address marked for its legal department (no department name is published, so ask by phone, 888-228-2233, where legal questions go), and ask the city (Letter 1 already does) to raise the question with its CivicPlus account manager. Its Terms list one email address, but only for copyright-infringement notices, so it must **not** be used for this letter |
| Delivery route | Not chosen. The letters are unchanged from the text approved for review and are written to be pasted into a web form, printed, or read over the phone |
| Reply handling | A reply, or a refusal, is recorded with its date and exact words in `public/discovery/connector.js` and `docs/CIVICPLUS_VERIFICATION.md` before anything changes. **No reply is not consent.** |
| The tool today | It contacts neither site automatically, and the letters say so. The block is tested: zero requests even with an acknowledgment |

## Letter 1: to the City of Copperas Cove

**To:** Lisa Wilson, City Secretary, and Scot Mullican, Director of Information Technology, City of Copperas Cove
**Subject:** Question about reading Copperas Cove's public agenda and document pages with a research tool

Dear Ms. Wilson and Mr. Mullican,

My name is Marimer Cruz. I build Chronium Mind, a free research tool that helps residents, journalists and students find public meeting records. Before I let the tool read any page of www.copperascovetx.gov, I want to ask whether that is acceptable to the City, and to follow your answer exactly.

**What I would like to do.** When a person starts a search themselves, the tool would read the public Agenda Center and Document Center pages that your robots.txt already allows, and save the public documents it finds to that person's own computer.

**How it behaves.** One request at a time. At least 10 seconds between requests, which is the Crawl-delay in your robots.txt, and never faster. It identifies itself as "ChroniumMind" in every request, and its rules and my contact details are published at https://chronium-mind.truewolfflix777.workers.dev/crawler, including how to tell it to stop. It obeys robots.txt, does not log in, submit forms or use any page that needs an account, and stops if your site asks it to slow down. A single search reads at most about 150 pages and 100 documents, and one person's browser makes at most 500 requests a day to your site. Documents are kept on the person's own device and are not republished; each is saved with its web address, the time it was read and a fingerprint, so anyone can check it against your site.

**My question.** Please tell me, in writing, whether this is acceptable. If you would prefer a different way, such as a bulk export, a feed or a data download, I will use that instead. If it is not acceptable, I will not read your pages automatically; people will still be able to save documents by hand.

I am also writing to CivicPlus to ask whether its Terms of Use (Sections 7 and 13) apply to a city's own CivicPlus-hosted public pages and to the people who read them, or whether the City's agreement with CivicPlus governs. If you know which applies, I would be grateful to hear it.

Until I hear from you, the tool does not contact www.copperascovetx.gov or civicplus.com automatically. I will record your reply, with its date, and follow it.

Thank you for your time, and for publishing these records.

Marimer Cruz
Chronium Mind
marimercruz8@gmail.com
https://chronium-mind.truewolfflix777.workers.dev/crawler

## Letter 2: to CivicPlus

**To:** CivicPlus (via https://www.civicplus.com/contact-us/)
**Subject:** Terms of Use question: automated reading of a city's public CivicPlus pages (Sections 7 and 13)

Hello,

My name is Marimer Cruz. I build Chronium Mind, a free research tool that helps people find public meeting records. I am writing before using it on any CivicPlus-hosted site, because I want to follow your rules rather than assume them.

The City of Copperas Cove, Texas, publishes its public agendas and documents through CivicPlus (www.copperascovetx.gov, the Agenda Center and Document Center). Its robots.txt allows those paths with a Crawl-delay of 10 seconds. Your Terms of Use (updated September 1, 2022) prohibit, in Section 7, automated systems that access "the Site or any Solution" faster than a person could, and, in Section 13, set liquidated damages for page requests above 1,000 in 24 hours. The Terms define the "Site" as the CivicPlus proprietary websites and do not say whether they apply to a city's own CivicPlus-hosted public pages, or to the people who read them.

**My question.** Do those sections apply to a person using a research tool, with that person's explicit instruction, to read a city's public Agenda Center and Document Center pages, or does the city's own agreement with CivicPlus govern? If your answer depends on the city's contract, please say so, and I will ask the city.

**What the tool would do**, so you can answer precisely: one request at a time; never faster than one request every 10 seconds (the city's Crawl-delay); it identifies itself as "ChroniumMind", and its rules and my contact details are published at https://chronium-mind.truewolfflix777.workers.dev/crawler; it obeys robots.txt, never logs in, submits forms or goes around any protection; at most about 150 pages and 100 documents in a search, and at most 500 requests a day from one person's browser to one site (well under the 1,000-page figure in Section 13).

Until I have a written answer, the tool does not contact civicplus.com or any CivicPlus-hosted site automatically. If you prefer another way to get public documents, such as a data export, I will use it.

Thank you,

Marimer Cruz
Chronium Mind
marimercruz8@gmail.com
https://chronium-mind.truewolfflix777.workers.dev/crawler

## Verified against the code (so the letters promise no more than the tool does)

10-second minimum from the site's Crawl-delay and a 3-second floor otherwise (`config.js`, `engine.js`); one request at a time (`scheduler.js`); stops when asked to slow down (`engine.js`); about 150 pages, 100 documents, 400 requests per search and 500 requests per site per day per browser (`config.js`); no login, no forms, GET only, no cookies (`fetchers.js`); documents stored locally with address, time and SHA-256 (`save.js`); both hosts blocked, tested with zero requests (`scripts/test-discovery-phase1.mjs`). The page it links to is the one deployed and verified.

## If a reply arrives

| Reply | Action |
|---|---|
| Permitted, perhaps with conditions | Record date, sender and exact words; implement the conditions as limits first; capture the list endpoint's real response with a handful of paced requests; write the parser against saved fixtures; set the registry entry to `allowed`; only then enable |
| Another method offered (export, feed, API) | Evaluate it as a new connector (terms, cost row) |
| Refused | Set the entry to `forbidden` with the reply attached; keep only hand-saved documents |
| No reply | Nothing changes |
