# MedBook - architektúra backendu

## 1. Ciele návrhu

- Obslúžiť počiatočný rozsah: približne 500 lekárov, 50 000 pacientov a 2 000 rezervácií denne v špičke.
- Navrhnúť systém tak, aby zvládol približne 10x rast bez zásadného prepisu.
- Zabrániť dvojitej rezervácii rovnakého lekára v prekrývajúcom sa čase.
- Podporiť online platby, refundácie, video konzultácie, pripomienky a recenzie.
- Držať citlivé zdravotné údaje v súlade s GDPR a švajčiarskym FADP.
- Nepoužívať zbytočne ťažkú infraštruktúru tam, kde postačí Postgres a jednoduchá aplikačná logika.

## 2. Technologický stack

| Oblasť | Voľba | Dôvod |
|---|---|---|
| API | REST + JSON | Jednoduché pre web, iOS, Android, webhooky a OpenAPI codegen. |
| Backend | Python 3.12 + FastAPI | Typované requesty cez Pydantic, dobrá async podpora, rýchly vývoj. |
| Databáza | PostgreSQL 16 | Autoritatívna kontrola rezervácií cez `tstzrange` a `EXCLUDE` constraint. |
| Cache | Redis 7 | Krátkodobé cache pre vyhľadávanie, dostupnosť a idempotenciu. |
| Background jobs | Celery + Redis, trvalý stav v Postgres `scheduled_jobs` | Pripomienky a expirácie prežijú reštart workerov. |
| Súbory | S3 v švajčiarskom regióne | KYC dokumenty a fotky lekárov, šifrované at rest. |
| Platby | Stripe Payment Intents + Stripe Connect | SCA, refundácie, výplaty lekárov a platformový poplatok. |
| Video | Twilio Video | Miestnosť a access tokeny sa vytvárajú na požiadanie. |
| Vyhľadávanie | Postgres `tsvector`, GIN, trigram | Pri stovkách lekárov nie je potrebný Elasticsearch. |
| Hosting | Kontajnery v Zürichu, napr. AWS `eu-central-2` alebo Exoscale | Dátová rezidencia a jednoduché horizontálne škálovanie. |

Vysokoúrovňový kontext systému:

![C4 System Context - MedBook](<ChatGPT Image 8. 5. 2026, 01_50_21.png>)

## 3. API a autentifikácia

API je RESTové, verzované pod `/v1` a vracia JSON. Všetky stav meniace endpointy vyžadujú hlavičku `Idempotency-Key`, aby opakované klientské pokusy nevytvárali duplicitné rezervácie, platby alebo refundácie.

Hlavné skupiny endpointov:

- `/v1/auth/*` - registrácia, login, refresh, logout, reset hesla, žiadosť lekára.
- `/v1/doctors/*` - vyhľadávanie lekárov, profil, dostupnosť, úprava profilu a pravidiel dostupnosti.
- `/v1/appointments/*` - vytvorenie, detail, zoznam, zrušenie, dokončenie a no-show.
- `/v1/payments/*` - vytvorenie Payment Intentu a uloženie platobných metód.
- `/v1/reviews/*` - recenzie po dokončených rezerváciách.
- `/v1/admin/*` - schvaľovanie lekárov, refundácie, spory a analytika.
- `/v1/webhooks/stripe` a `/v1/webhooks/twilio` - príjem udalostí z externých služieb.

Kľúčové endpointy:

```text
POST   /v1/auth/register
POST   /v1/auth/doctor-apply
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout

GET    /v1/doctors
GET    /v1/doctors/{id}
GET    /v1/doctors/{id}/availability
PATCH  /v1/doctors/me
PUT    /v1/doctors/me/availability-rules
POST   /v1/doctors/me/availability-exceptions
GET    /v1/doctors/me/appointments
GET    /v1/doctors/me/earnings
GET    /v1/doctors/me/payouts

POST   /v1/appointments
GET    /v1/appointments
GET    /v1/appointments/{id}
POST   /v1/appointments/{id}/reschedule
POST   /v1/appointments/{id}/cancel
POST   /v1/appointments/{id}/complete
POST   /v1/appointments/{id}/no-show

POST   /v1/payments/intents
POST   /v1/payments/methods
GET    /v1/payments/methods

POST   /v1/reviews
GET    /v1/doctors/{id}/reviews

GET    /v1/admin/doctor-applications
POST   /v1/admin/doctor-applications/{id}/approve
POST   /v1/admin/doctor-applications/{id}/reject
GET    /v1/admin/disputes
POST   /v1/admin/refunds
GET    /v1/admin/analytics

POST   /v1/webhooks/stripe
POST   /v1/webhooks/twilio
```

Autentifikácia:

- Access token je JWT podpísané cez RS256 s TTL 15 minút.
- Refresh token je nepriehľadný náhodný token uložený v DB iba ako hash, rotovaný pri každom použití.
- RBAC rozlišuje roly `patient`, `doctor` a `admin`.
- Lekár môže meniť iba vlastné dáta a termíny, pacient iba svoje rezervácie.
- 2FA cez TOTP je povinná pre lekárov a adminov.
- Heslá sú hashované cez Argon2id.

Chyby používajú jednotný `problem+json` formát s interným `code` a `trace_id`.

Kritické payloady sú zámerne malé a stabilné. Vyhľadávanie lekárov:

```text
GET /v1/doctors?specialty=cardiology&city=Zurich&consultation_type=video&max_price_chf=200&page=1&page_size=20
```

```json
{
  "page": 1,
  "page_size": 20,
  "total": 47,
  "results": [
    {
      "id": "doc_01HX...",
      "full_name": "Dr. Anna Meier",
      "specialties": ["cardiology"],
      "qualifications": ["FMH Cardiology"],
      "city": "Zurich",
      "languages": ["de", "en"],
      "consultation_types": [
        {"type": "video", "price_chf": 120, "duration_min": 30}
      ],
      "rating_avg": 4.7,
      "rating_count": 132,
      "next_available_slot": "2026-05-06T09:00:00Z"
    }
  ]
}
```

Dostupnosť lekára:

```json
{
  "doctor_id": "doc_01HX...",
  "consultation_type": "video",
  "duration_minutes": 30,
  "slots": [
    {"start": "2026-05-06T09:00:00Z", "end": "2026-05-06T09:30:00Z", "status": "free"},
    {"start": "2026-05-06T09:30:00Z", "end": "2026-05-06T10:00:00Z", "status": "held"}
  ]
}
```

Vytvorenie rezervácie:

```json
{
  "doctor_id": "doc_01HX...",
  "consultation_type": "video",
  "slot_start": "2026-05-06T09:00:00Z",
  "slot_end": "2026-05-06T09:30:00Z",
  "notes": "Kontrola po vyšetrení"
}
```

`POST /v1/appointments` vracia:

```json
{
  "id": "apt_01HX...",
  "status": "pending_payment",
  "hold_expires_at": "2026-05-06T08:15:00Z",
  "price_chf": 120,
  "payment": {
    "payment_intent_id": "pi_...",
    "client_secret": "pi_..._secret_..."
  }
}
```

Zrušenie rezervácie:

```json
{
  "reason": "schedule_conflict"
}
```

```json
{
  "id": "apt_01HX...",
  "status": "cancelled_by_patient",
  "refund": {
    "policy_applied": "12_to_24h_window",
    "amount_chf": 60,
    "status": "pending"
  }
}
```

Recenzia:

```json
{
  "appointment_id": "apt_01HX...",
  "rating": 5,
  "title": "Výborné",
  "body": "Dôkladný a profesionálny prístup."
}
```

Neúspešný pokus o už obsadený slot:

```json
{
  "type": "about:blank",
  "title": "Slot unavailable",
  "status": 409,
  "code": "slot_unavailable",
  "trace_id": "req_..."
}
```

## 4. Databázový model

Základné entity:

- `users` - identita, email, heslo, rola, stav účtu.
- `patients` - pacientsky profil a šifrované PII polia.
- `doctors` - profil lekára, kvalifikácie, bio, fotky, stav schválenia, jazyky, rating, Stripe účet.
- `doctor_documents` - KYC a credential dokumenty uložené v S3, metadáta a stav overenia.
- `specialties` a `doctor_specialties` - špecializácie.
- `consultation_types` - video, telefonická alebo osobná konzultácia, cena a dĺžka.
- `availability_rules` - opakujúci sa týždenný rozvrh lekára.
- `availability_exceptions` - dovolenky, blackout dni a jednorazové extra hodiny.
- `appointments` - rezervácie a ich stavový stroj.
- `payments`, `refunds`, `payouts` - platby, refundácie a výplaty.
- `reviews` - jedna recenzia na dokončenú rezerváciu.
- `notifications` a `scheduled_jobs` - odložené notifikácie, expirácie holdov a pripomienky.
- `audit_log` - audit citlivých administrátorských a stavových operácií.
- `idempotency_keys` a `processed_webhook_events` - ochrana proti duplicitným requestom a webhookom.

Primárne kľúče sú textové ULID s prefixom, napríklad `apt_01HX...`. Všetky timestampy sú `timestamptz`. Klinicky a finančne relevantné záznamy sa nemažú fyzicky, ale anonymizujú alebo označia cez `deleted_at`.

## 5. Rezervácie a ochrana proti dvojitej rezervácii

Najdôležitejšia garancia je v Postgrese, nie v aplikačnej pamäti ani v cache. Tabuľka `appointments` ukladá čas rezervácie ako `tstzrange` a používa `EXCLUDE` constraint, ktorý zakáže prekrývajúce sa neterminálne rezervácie rovnakého lekára.

```sql
CONSTRAINT no_overlap_per_doctor
  EXCLUDE USING gist (
    doctor_id WITH =,
    slot      WITH &&
  )
  WHERE (status IN ('held','pending_payment','confirmed','completed','no_show'))
```

Zrušené a expirované rezervácie sú z kontroly vylúčené, aby sa slot mohol znova ponúknuť. Ak dvaja pacienti naraz skúsia rovnaký slot, jeden insert prejde a druhý dostane DB chybu, ktorú API preloží na HTTP 409 `slot_unavailable`.

Stavy rezervácie:

- `held` - krátke podržanie slotu.
- `pending_payment` - čaká sa na dokončenie Stripe platby.
- `confirmed` - platba prešla a termín je potvrdený.
- `completed` - lekár označil konzultáciu ako dokončenú.
- `no_show` - pacient neprišiel.
- `cancelled_by_patient`, `cancelled_by_doctor`, `expired` - terminálne uvoľňujúce stavy.

Neplatné prechody stavu odmieta aplikačná služba aj databázový trigger. Napríklad zrušenie `completed` rezervácie, opätovné potvrdenie `expired` rezervácie alebo označenie `cancelled_by_patient` rezervácie ako `no_show` vracia HTTP 409 `invalid_state_transition`.

Preloženie termínu je modelované ako atómová operácia `POST /v1/appointments/{id}/reschedule`: v transakcii sa skontroluje oprávnenie, dostupnosť nového slotu a `EXCLUDE` constraint. Ak sa mení cena alebo typ konzultácie, API vytvorí doplatok alebo refundáciu; inak iba presunie `slot` a odošle notifikácie.

## 6. Výpočet dostupnosti

Sloty sa nematerializujú na 6 mesiacov dopredu. Pri čítaní sa vypočítajú z:

1. týždenných pravidiel lekára,
2. jednorazových výnimiek,
3. typu konzultácie a jej dĺžky,
4. existujúcich rezervácií v stavoch `held`, `pending_payment` a `confirmed`.

Výsledok sa krátko cacheuje v Redise:

- vyhľadávacie výsledky približne 30 sekúnd,
- `next_available_slot` približne 60 sekúnd,
- detail dostupnosti približne 10 sekúnd.

Redis nikdy nie je zdroj pravdy pre obsadenosť slotov. Je iba akcelerácia; autoritatívna kontrola je vždy v Postgrese.

## 7. Používateľské toky

### Rezervácia pacientom

1. Pacient vyhľadá lekára cez `GET /v1/doctors`.
2. Klient načíta dostupnosť cez `GET /v1/doctors/{id}/availability`.
3. Pacient zavolá `POST /v1/appointments` s `Idempotency-Key`.
4. API v transakcii overí, že slot je podľa pravidiel ponúkaný.
5. API vloží rezerváciu v stave `held` alebo `pending_payment` s 15-minútovou expiráciou.
6. Postgres `EXCLUDE` constraint garantuje, že sa slot neprekrýva s inou aktívnou rezerváciou.
7. API vytvorí Stripe Payment Intent a vráti klientovi `client_secret`.
8. Klient dokončí platbu cez Stripe.js, vrátane prípadného 3DS/SCA.
9. Stripe pošle webhook `payment_intent.succeeded`.
10. Webhook handler idempotentne prepne rezerváciu na `confirmed`, uloží platbu a zaradí notifikácie.
11. Pri video konzultácii sa vytvorí Twilio miestnosť a access tokeny.

Platobný success callback z klienta nie je zdroj pravdy. Potvrdenie rezervácie robí až server po overenom Stripe webhooku.

### Onboarding lekára

1. Lekár odošle `POST /v1/auth/doctor-apply` s profilom, špecializáciami, kvalifikáciami, typmi konzultácií a základnými cenami.
2. API vytvorí `users(role=doctor)` a `doctors(status=pending)` a vráti presigned S3 URL na nahratie licencie, ID a dokladov o poistení.
3. Admin v `/v1/admin/doctor-applications` skontroluje dokumenty a kvalifikáciu voči príslušnému registru.
4. Pri schválení sa nastaví `doctors.status='approved'`, lekár dokončí TOTP a Stripe Connect onboarding.
5. Lekár nastaví dostupnosť cez `availability-rules` a `availability-exceptions`.
6. Lekár je viditeľný vo vyhľadávaní až po schválení, overenom Stripe účte a aspoň jednom aktívnom type konzultácie.

### Zrušenie a refundácia

Pacientské zrušenie:

1. Pacient zavolá `POST /v1/appointments/{id}/cancel`.
2. API načíta rezerváciu `FOR UPDATE` a povolí iba stavy `held`, `pending_payment` alebo `confirmed`.
3. Podľa času do začiatku termínu vypočíta refundáciu: viac ako 24h = 100 %, 12-24h = 50 %, menej ako 12h = 0 %.
4. Rezervácia prejde do `cancelled_by_patient`, pending joby sa zrušia a prípadná refundácia sa zaradí workerovi.

Lekárske zrušenie:

1. Lekár zavolá rovnaký cancel endpoint nad vlastnou rezerváciou.
2. API nastaví `cancelled_by_doctor`, vytvorí 100 % refundáciu a zvýši `doctors.penalty_flags`.
3. Pacient aj lekár dostanú notifikáciu a slot sa uvoľní.

### Recenzie, no-show a výplaty

- Recenzia je povolená iba pre rezerváciu v stave `completed`, iba pacientovi danej rezervácie, najneskôr do 7 dní od `completed_at` a maximálne raz na rezerváciu.
- Lekár môže po skončení slotu označiť rezerváciu ako `no_show`; pri treťom no-show sa účet pacienta prepne na `restricted`.
- Lekár vidí zárobky cez `/v1/doctors/me/earnings` a históriu výplat cez `/v1/doctors/me/payouts`.
- Výplaty sú týždenné, iba za `completed` rezervácie, mínus 15 % platformový poplatok.

## 8. Platby, refundácie a výplaty

Platby idú cez Stripe Payment Intents s automatic capture. Stripe Connect rieši výplaty lekárom a platformový poplatok, napríklad 15 % cez `application_fee_amount`.

Stavy platby:

- `pending` - intent je vytvorený alebo čaká na potvrdenie.
- `authorized` - karta vyžaduje akciu alebo autorizácia prešla.
- `captured` - platba je úspešne stiahnutá.
- `failed` - platba zlyhala.
- `cancelled` - intent bol zrušený, napríklad pri expirácii holdu.
- `refunded` alebo `partially_refunded` - refundácia prebehla úplne alebo čiastočne.

Refundácie:

- zrušenie pacientom viac ako 24 hodín pred termínom: 100 % refundácia,
- zrušenie pacientom 12 až 24 hodín pred termínom: 50 % refundácia,
- zrušenie pacientom menej ako 12 hodín pred termínom: bez automatickej refundácie,
- zrušenie lekárom: 100 % refundácia a penalizačný príznak pre lekára.

Refundácia sa najprv zapíše do DB ako `pending`, potom ju worker odošle do Stripe idempotentne podľa `refund.id`.

## 9. Spracovanie chýb a spoľahlivosť

Kritické operácie sú idempotentné:

- klientské zápisy cez `Idempotency-Key`,
- Stripe API volania cez vlastné idempotency keys,
- webhooky cez tabuľku `processed_webhook_events`.

15-minútová expirácia platby je uložená v `scheduled_jobs` v rovnakej transakcii ako rezervácia. Worker pravidelne spracúva expirované holdy cez `FOR UPDATE SKIP LOCKED`. Ak worker dočasne vypadne, pending joby ostanú v DB a po návrate sa dobehnú.

Pri výpadkoch externých služieb:

- Stripe pri vytvorení intentu zlyhá: rezervácia sa rollbackne a slot sa nepodrží.
- Platba zlyhá počas `pending_payment`: rezervácia ostáva podržaná do `hold_expires_at`, pacient môže skúsiť nový Payment Intent bez vytvárania novej rezervácie.
- Stripe webhook mešká: handler je idempotentný a doplnený reconcilerom pre staršie `pending_payment` rezervácie.
- Twilio zlyhá: rezervácia ostáva potvrdená, vytvorenie miestnosti retryuje worker.
- Email/SMS provider zlyhá: notifikácie retryujú s backoffom.
- Redis zlyhá: systém pokračuje bez cache, pomalšie, ale korektne.

## 10. Bezpečnosť a ochrana údajov

- TLS 1.2+ medzi klientmi a backendom, mTLS medzi internými službami tam, kde je to praktické.
- Šifrované disky pre Postgres a SSE-KMS pre S3.
- Field-level encryption pre priame PII: meno, priezvisko, dátum narodenia, telefón a klinické poznámky.
- Admin čítanie citlivých údajov sa zapisuje do `audit_log`.
- Dáta zostávajú v švajčiarskom alebo vhodnom európskom regióne, preferovane Zürich.
- Právo na výmaz sa rieši anonymizáciou PII, nie fyzickým zmazaním klinických a finančných riadkov.
- Retencia: rezervácie a platby približne 10 rokov, access logy 1 rok, raw notifikácie 90 dní.

## 11. Observabilita a prevádzka

Kontajnerový pohľad na runtime architektúru:

![C4 Container Diagram - MedBook](<ChatGPT Image 8. 5. 2026, 01_50_27.png>)

Backend je stateless FastAPI služba za load balancerom. Horizontálne sa škáluje podľa request rate a latencie. Workery sú oddelené minimálne na `default` a `webhooks`, aby pripomienky neblokovali spracovanie platobných udalostí.

Sledujú sa najmä:

- počet vytvorených rezervácií,
- počet konfliktov `slot_unavailable`,
- oneskorenie Stripe webhookov,
- oneskorenie `scheduled_jobs`,
- zlyhané refundácie a payouty,
- chybovosť externých služieb,
- latencia vyhľadávania a dostupnosti.

Logy sú štruktúrované JSON a každá požiadavka má `X-Request-Id`. Tracing beží cez OpenTelemetry, s vyšším samplingom pri chybách.

Databáza má primary, synchronnú repliku a async read repliku pre analytiku a čítacie dotazy. Zálohovanie používa denné base backupy a kontinuálne WAL archiving s cieľom PITR do približne 5 minút.

## 12. Rozsah mimo prvej verzie

Do v1 nie sú zahrnuté:

- lekár pracujúci paralelne vo viacerých ambulanciách,
- rodinné účty a rezervácia v mene dieťaťa,
- waiting list pre uvoľnené osobné termíny,
- plné i18n admin nástrojov a šablón,
- Elasticsearch alebo iný samostatný vyhľadávací cluster.

Tieto časti sa dajú doplniť neskôr bez zmeny hlavného jadra: `users`, `doctors`, `appointments`, `availability_rules`, `payments` a `scheduled_jobs`.
