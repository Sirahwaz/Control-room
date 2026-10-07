# MIDAD+ — Distribution Mesh v1

## STATE
IMPLEMENTED / VERIFIED E2E

## OBJECTIVE
تحويل Revenue Store الموجود إلى مسار قابل للقياس:
Discovery → Qualified Target → Offer → Checkout → Payment → Delivery → Repeat

## WHAT IS NOW LIVE IN CODE
- `revenue/index.html` يحفظ attribution من UTM/ref/lane.
- attribution ينتقل إلى Public Checkout.
- Public Checkout يكتب attribution داخل payment intent وstore order metadata.
- قناة التوزيع لها registry موحد بدل روابط غير قابلة للقياس.
- الهدف التشغيلي: 10–20 qualified targets/day، وليس 10–20 رسائل عشوائية.

## TRACKING CONTRACT
Use:
`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `lane`, `ref`

Example:
`https://sirahwaz.github.io/Control-room/revenue/?utm_source=telegram&utm_medium=direct&utm_campaign=rev_oct_2026&utm_content=bug-fix&utm_term=typescript&lane=global_remote_crypto&ref=tg-aimidad`

## CHANNEL PRIORITY
1. Owned Web — primary conversion surface.
2. Telegram — qualified direct conversations; human approval before outbound.
3. Professional outreach — targeted prospects only; evidence first.
4. GitHub proof — technical credibility → offer.
5. Community contribution — value first, offer second.
6. Marketplace — activate only after current marketplace capability/policy is verified.

## DAILY LOOP
Discover → qualify → select 10–20 targets → attach the most relevant offer → use a tracked link → record outcome → follow up only on legitimate interest.

## DO NOT
- spam or bulk unsolicited outreach
- claim payment/revenue before on-chain verification
- create parallel checkout systems
- add a provider without capability evidence
- bypass existing approval gates
