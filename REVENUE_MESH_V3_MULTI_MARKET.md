# MIDAD Revenue Mesh v3 — Multi-Market Acquisition

Activation: 2026-10-08
Primary metric: VERIFIED_RECEIPT / FIRST_VERIFIED_DOLLAR
Architecture: NEED-FIRST → REQUIREMENTS → CAPABILITY → MARKET DISCOVERY → PROVIDER → INTEGRATION → FALLBACK → VERIFY

## Permanent routing rule
MIDAD must not restrict revenue discovery to a fixed list of connected platforms. Every revenue cycle must search broadly across the market before selecting providers. Provider choice is subordinate to the business/technical need.

## Revenue lanes
1. Arabic freelance: Khamsat, Mostaql
2. Global freelance: Upwork, Fiverr, Freelancer.com, Guru, Workana, Contra, PeoplePerHour
3. AI expert/data work: DataAnnotation, Alignerr, Outlier, OneForma, Clickworker, Toloka
4. Crypto-native work: Superteam Earn, Gitcoin Bounties, Bountycaster, OnlyDust, WorkUSDC, DevGhouse
5. API/x402 monetization: Payrelayer and other verified x402-compatible venues
6. Affiliate commerce: Amazon Associates, eBay Partner Network, Etsy Affiliates/Creator Collective, Awin, CJ
7. B2B SaaS partnerships: PartnerStack and comparable recurring-commission networks
8. Direct B2B: public professional prospect research + CRM/outreach
9. MIDAD product sales: fixed-scope services, audits, data rescue, code health, revenue rescue, API products
10. Content/video: HeyGen-driven sales assets and affiliate/product discovery content
11. Open-source/grants: Gitcoin, OnlyDust and future verified mechanisms
12. Continuous discovery: add new markets when they satisfy the need, not because they are already connected

## Current verified market evidence
- Khamsat officially supports selling digital services across programming/development, AI, data, writing, design and other categories.
- Mostaql officially supports freelancers submitting proposals to projects.
- Fiverr currently exposes AI automation, programming/tech, AI services, data, business and end-to-end projects.
- DataAnnotation currently lists software, data/ML, cybersecurity, STEM, finance and Arabic-language expert roles with published rate bands.
- Alignerr currently lists coding, STEM, Arabic-language, content and AI-training roles.
- Outlier currently lists coding, language, evaluation and other expert opportunities.
- eBay Partner Network is an active affiliate program and exposes trackable links and technical integration options.
- Etsy currently operates Affiliates and Creator Collective programs.
- PartnerStack offers affiliate/partner programs with recurring commission models.
- Awin and CJ are active affiliate-network surfaces.
- WorkUSDC, DevGhouse and Payrelayer currently expose crypto-native work/API monetization surfaces.

## Automation policy
DISCOVER → VERIFY → RANK → PREPARE → SUBMIT_WHERE_AUTHORIZED → BUILD → QA → DELIVER → VERIFY_PAYMENT → RECONCILE → LEARN → RECOVER
A blocked provider never stalls the mesh.

## Gates
- No credential theft, account takeover, impersonation, fraud, malware, unauthorized access or platform-control bypass.
- No CAPTCHA/rate-limit/authentication bypass.
- Identity/KYC, wallet signatures, external spend, withdrawals/transfers, live trading/investing and legal acceptance remain human-gated.
- External communication is prepared and queued; sending follows the configured approval policy.
- Affiliate claims are not revenue until the provider reports a payable commission.
- Bounty prize pools are not revenue until a verified award/payment is received.
- Applications, approvals and deliveries are not revenue; only verified receipt counts.

## Payment truth
VERIFIED_RECEIPT is the only realized-revenue state. Wallet receipt monitoring remains active for project receiving addresses.

## Source registry policy
Each discovered provider should carry: current official URL; current verification timestamp; market/region; payout asset/currency; access mode; automation mode; capability tags; account/authentication prerequisites; platform terms/rate limits; confidence and freshness.
New providers should be tested in read-only mode before automated submission. Existing API-enabled sources remain useful, but they are not privileged.

## Immediate priority
Revenue velocity is ranked by expected_net_value × acceptance_probability × payment_confidence ÷ estimated_minutes.
Priority goes to routes that can convert an existing MIDAD capability into money with the fewest external dependencies.